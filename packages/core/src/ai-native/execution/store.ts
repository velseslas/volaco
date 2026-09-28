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

  constructor(options?: { persist?: boolean }) {
    if (options?.persist) {
      this.filePath = dataFilePath('executions');
      const raw = readJsonFile<Record<string, ExecutionRecord>>(this.filePath, {});
      for (const [key, record] of Object.entries(raw)) {
        this.executions.set(key, record);
        this.orderCounter = Math.max(this.orderCounter, record.order || 0);
      }
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    const obj: Record<string, ExecutionRecord> = {};
    for (const [key, record] of this.executions.entries()) {
      obj[key] = record;
    }
    writeJsonFileSync(this.filePath, obj);
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
    this.persist();
    return this.executions.get(record.executionId)!;
  }

  /** Ajoute un événement typé. Refusé si l'exécution est terminée (invariant). */
  public appendEvent(executionId: string, input: AppendEventInput): ExecutionEvent {
    const record = this.executions.get(executionId);
    if (!record) {
      throw new NotFoundError(`Exécution ${executionId}`);
    }
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(record.status) && !['EXECUTION_COMPLETED', 'EXECUTION_FAILED', 'EXECUTION_CANCELLED', 'SUMMARY_GENERATED'].includes(input.type)) {
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
    this.persist();
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
    this.persist();
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
