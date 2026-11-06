/**
 * ExecutionEventStore — persistance des exécutions du moteur de génération.
 *
 * Convention identique aux autres stores (revision-store, audit) : document
 * JSON unique via json-disk-cache (SQLite derrière), Map en mémoire, écriture
 * à chaque mutation. Le volume reste maîtrisé : MAX_EXECUTIONS_PER_PROJECT
 * exécutions par projet, MAX_EVENTS_PER_EXECUTION événements par exécution
 * (les seq ne sont jamais réécrites, seuls les plus anciens events sortent).
 */

import { randomUUID } from 'node:crypto';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../persistence/json-disk-cache.js';
import { NotFoundError, ValidationError } from '../../errors.js';
import type {
  ExecutionEvent,
  ExecutionEventType,
  ExecutionMode,
  ExecutionPhase,
  ExecutionRecord,
  ExecutionStatus,
  ExecutionSummary
} from './types.js';

export const MAX_EVENTS_PER_EXECUTION = 300;
export const MAX_EXECUTIONS_PER_PROJECT = 20;

/**
 * PERF-TTF (2026-11-03, audit moteurs) — le blob `executions` (tous tenants)
 * était réécrit en SYNCHRONE à CHAQUE événement (~50-85 ms mesuré sur le
 * volume réel) : le temps jusqu'à la première frame `start` du stream
 * dépassait 1 s et dégradait avec le nombre d'exécutions accumulées.
 *
 * Correctif double, avec durabilité honnête et bornée :
 *   1. COALESCENCE : les événements intermédiaires marquent le document
 *      « sale » et une réécriture décalée la regroupe (défaut 250 ms,
 *      `VOLACO_EXECUTION_PERSIST_DEBOUNCE_MS`). Les événements TERMINAUX
 *      (COMPLETED/FAILED/CANCELLED/clear) restent un flush SYNCHRONE, et le
 *      processus vide le tampon à sa sortie — la trace est donc toujours sur
 *      disque au plus tard à la fin de l'exécution (CDC §26 : durée/jamais
 *      inventée, trace persistée à la clôture).
 *   2. BORNE GLOBALE : le document ne garde que les MAX_EXECUTIONS_GLOBAL
 *      exécutions les plus récentes (terminales d'abord évictées ;
 *      `VOLACO_EXECUTION_STORE_MAX_RECORDS`), en plus de la borne par projet.
 */
const EXECUTION_PERSIST_DEBOUNCE_MS = readPositiveIntEnv('VOLACO_EXECUTION_PERSIST_DEBOUNCE_MS', 250);
const MAX_EXECUTIONS_GLOBAL = readPositiveIntEnv('VOLACO_EXECUTION_STORE_MAX_RECORDS', 200);

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

interface AppendEventInput {
  type: ExecutionEventType;
  phase: ExecutionPhase;
  status: ExecutionStatus;
  title: string;
  detail?: Record<string, unknown>;
  durationMs?: number;
}

export class ExecutionEventStore {
  private executions = new Map<string, ExecutionRecord>();
  private orderCounter = 0;
  private readonly filePath: string | undefined;
  private persistTimer: NodeJS.Timeout | undefined;
  private exitFlushArmed = false;

  constructor(options?: { persist?: boolean }) {
    if (options?.persist) {
      this.filePath = dataFilePath('executions');
      const raw = readJsonFile<Record<string, ExecutionRecord>>(this.filePath, {});
      for (const [key, record] of Object.entries(raw)) {
        this.executions.set(key, record);
        this.orderCounter = Math.max(this.orderCounter, record.order || 0);
      }
      // PERF-TTF — borne globale appliquée au démarrage : les exécutions
      // HISTORY au-delà de la borne sortent du document (les plus récentes
      // d'abord), le blob redevient borné dès le prochain flush.
      this.pruneGlobal();
      // Garantie CDC §26 : le tampon décalé est écrit même si le processus
      // s'arrête entre deux flush programmés.
      if (!this.exitFlushArmed) {
        this.exitFlushArmed = true;
        process.once('exit', () => this.flushPersist());
      }
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    // PERF-TTF — un flush décalé en attente devient inutile : on écrit tout,
    // tout de suite.
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    const obj: Record<string, ExecutionRecord> = {};
    for (const [key, record] of this.executions.entries()) {
      obj[key] = record;
    }
    writeJsonFileSync(this.filePath, obj);
  }

  /** Flush synchrone explicitement demandé (fin d'exécution, shutdown). */
  public flushPersist(): void {
    if (!this.filePath) return;
    this.persist();
  }

  /**
   * PERF-TTF — coalescence : marque le document sale et programme UNE
   * réécriture dans la fenêtre de debounce. Aucun await filé : les écrivains
   * restent non bloquants ; événements suivants rafraîchissent le tampon.
   */
  private persistSoon(): void {
    if (!this.filePath) return;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.persist();
    }, EXECUTION_PERSIST_DEBOUNCE_MS);
    this.persistTimer.unref?.();
  }

  /**
   * Ouvre une exécution. L'anti-doublon est garanti par construction : un
   * executionId déjà connu est retourné tel quel (idempotence CDC §42).
   * Le premier événement (EXECUTION_STARTED) est émis par l'appelant avec
   * la frame `start` — il ne doit jamais précéder la réponse HTTP.
   */
  public startExecution(input: {
    executionId: string;
    tenantId: string;
    projectId: string;
    mode: ExecutionMode;
    prompt: string;
  }): ExecutionRecord {
    const existing = this.executions.get(input.executionId);
    if (existing) return existing;
    if (!input.executionId || !input.tenantId || !input.projectId) {
      throw new ValidationError('executionId, tenantId et projectId sont obligatoires');
    }
    const now = Date.now();
    const record: ExecutionRecord = {
      executionId: input.executionId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      order: ++this.orderCounter,
      status: 'RUNNING',
      phase: 'UNDERSTAND',
      mode: input.mode,
      prompt: (input.prompt || '').slice(0, 500),
      startedAt: now,
      updatedAt: now,
      events: []
    };
    this.executions.set(record.executionId, record);
    this.pruneProject(input.tenantId, input.projectId);
    this.pruneGlobal();
    this.persist();
    return this.executions.get(record.executionId)!;
  }

  /**
   * Ajoute un événement typé. Refusé si l'exécution est terminée, SAUF les
   * événements post-clôture légitimes : bilan/fin, synthèse, et cycles de
   * réparation/vérification déclenchés après coup (Self-Repair sur une
   * génération déjà terminée — T6).
   */
  public appendEvent(executionId: string, input: AppendEventInput): ExecutionEvent {
    const record = this.executions.get(executionId);
    if (!record) {
      throw new NotFoundError(`Exécution ${executionId}`);
    }
    const postTerminalAllowed: readonly string[] = [
      'EXECUTION_COMPLETED', 'EXECUTION_FAILED', 'EXECUTION_CANCELLED', 'SUMMARY_GENERATED',
      'REPAIR_STARTED', 'RETRY_STARTED', 'REPAIR_COMPLETED',
      'VALIDATION_STARTED', 'VALIDATION_COMPLETED', 'VALIDATION_FAILED'
    ];
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(record.status) && !postTerminalAllowed.includes(input.type)) {
      throw new ValidationError(`Exécution ${executionId} déjà terminée (${record.status})`);
    }
    const last = record.events[record.events.length - 1];
    const event: ExecutionEvent = {
      id: 'evt_' + randomUUID().replace(/-/g, '').slice(0, 16),
      executionId,
      seq: (last?.seq || 0) + 1,
      ts: Date.now(),
      phase: input.phase,
      type: input.type,
      status: input.status,
      title: input.title,
      ...(input.detail ? { detail: input.detail } : {}),
      ...(typeof input.durationMs === 'number' ? { durationMs: input.durationMs } : {})
    };
    record.events.push(event);
    if (record.events.length > MAX_EVENTS_PER_EXECUTION) {
      record.events.splice(0, record.events.length - MAX_EVENTS_PER_EXECUTION);
    }
    record.phase = input.phase;
    record.updatedAt = event.ts;
    // PERF-TTF — événement intermédiaire : coalescé (flush décalé). Les
    // opérations terminales ci-dessous font leur flush synchrone.
    this.persistSoon();
    return event;
  }

  /** Change de phase ; no-op (retourne null) si la phase est déjà courante. */
  public transitionPhase(executionId: string, phase: ExecutionPhase): ExecutionEvent | null {
    const record = this.executions.get(executionId);
    if (!record || record.phase === phase) return null;
    record.phase = phase;
    return this.appendEvent(executionId, {
      type: 'PHASE_CHANGED',
      phase,
      status: 'RUNNING',
      title: `Phase : ${phaseLabels[phase]}`,
      detail: { phase }
    });
  }

  public setStatus(executionId: string, status: ExecutionStatus): void {
    const record = this.executions.get(executionId);
    if (!record) return;
    record.status = status;
    record.updatedAt = Date.now();
    // WAITING_USER / reparabilité entre deux flush synchro — coalescé,
    // flush synchrone garanti à la clôture (complete/fail/cancel).
    this.persistSoon();
  }

  public completeExecution(executionId: string, summary?: ExecutionSummary): void {
    const record = this.executions.get(executionId);
    if (!record) return;
    record.status = 'COMPLETED';
    record.phase = 'COMPLETE';
    record.completedAt = Date.now();
    record.updatedAt = record.completedAt;
    if (summary) record.summary = { ...record.summary, ...summary };
    this.appendEvent(executionId, {
      type: 'EXECUTION_COMPLETED',
      phase: 'COMPLETE',
      status: 'COMPLETED',
      title: 'Exécution terminée',
      detail: { summary: record.summary }
    });
    this.persist();
  }

  public failExecution(executionId: string, error: string): void {
    const record = this.executions.get(executionId);
    if (!record) return;
    record.status = 'FAILED';
    record.completedAt = Date.now();
    record.updatedAt = record.completedAt;
    record.summary = { ...record.summary, error: (error || '').slice(0, 300) };
    this.appendEvent(executionId, {
      type: 'EXECUTION_FAILED',
      phase: record.phase,
      status: 'FAILED',
      title: "L'exécution a échoué",
      detail: { error: (error || '').slice(0, 300) }
    });
    this.persist();
  }

  /** Annulation : ⏹ et non ❌ (CDC §20) — le motif est conservé. */
  public cancelExecution(executionId: string, reason: string): void {
    const record = this.executions.get(executionId);
    if (!record || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(record.status)) return;
    record.status = 'CANCELLED';
    record.completedAt = Date.now();
    record.updatedAt = record.completedAt;
    record.cancelReason = reason.slice(0, 200);
    this.appendEvent(executionId, {
      type: 'EXECUTION_CANCELLED',
      phase: record.phase,
      status: 'CANCELLED',
      title: 'Exécution annulée',
      detail: { reason: record.cancelReason }
    });
    this.persist();
  }

  public getExecution(executionId: string): ExecutionRecord | null {
    return this.executions.get(executionId) || null;
  }

  public listExecutions(tenantId: string, projectId: string): ExecutionRecord[] {
    return [...this.executions.values()]
      .filter((r) => r.tenantId === tenantId && r.projectId === projectId)
      .sort((a, b) => b.order - a.order);
  }

  public getLatestExecution(tenantId: string, projectId: string): ExecutionRecord | null {
    return this.listExecutions(tenantId, projectId)[0] || null;
  }

  private pruneProject(tenantId: string, projectId: string): void {
    const records = this.listExecutions(tenantId, projectId);
    if (records.length <= MAX_EXECUTIONS_PER_PROJECT) return;
    for (const record of records.slice(MAX_EXECUTIONS_PER_PROJECT)) {
      this.executions.delete(record.executionId);
    }
  }

  /**
   * PERF-TTF — borne globale du document : au-delà de MAX_EXECUTIONS_GLOBAL,
   * les exécutions les plus ANCIENNES sortent, en commençant par les
   * terminales (une exécution en cours n'est jamais evictée).
   */
  private pruneGlobal(): void {
    let overflow = this.executions.size - MAX_EXECUTIONS_GLOBAL;
    if (overflow <= 0) return;
    const all = [...this.executions.values()].sort((a, b) => a.order - b.order);
    const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
    for (const pass of [true, false]) {
      for (const record of all) {
        if (overflow <= 0) return;
        // Passe 1 : terminales uniquement (sécurité) ; passe 2 : tout.
        if (pass && !terminal.has(record.status)) continue;
        this.executions.delete(record.executionId);
        overflow -= 1;
      }
    }
  }

  /** Usage tests uniquement. */
  public clear(): void {
    this.executions.clear();
    this.persist();
  }
}

export const phaseLabels: Record<ExecutionPhase, string> = {
  UNDERSTAND: 'Analyse',
  PLAN: 'Plan',
  INSPECT: 'Inspection',
  IMPLEMENT: 'Construction',
  VALIDATE: 'Vérification',
  REPAIR: 'Réparation',
  COMPLETE: 'Terminé'
};

/**
 * T5 (CDC §20) — drapeaux d'annulation des exécutions ACTIVES. La route du
 * stream enregistre son drapeau au démarrage et le retire à la fin ; la route
 * POST /executions/:id/cancel le retourne. Le stream vérifie le drapeau à
 * chaque chunk LLM — l'interruption est réelle (plus de tokens facturés),
 * rien n'est sauvegardé, et l'exécution reste marquée CANCELLED (⏹, pas ❌).
 */
export const activeCancelFlags = new Map<string, { cancelled: boolean }>();

export const executionStore = new ExecutionEventStore({ persist: true });
