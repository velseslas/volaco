/**
 * VibeCode Core — Observability
 * ÉTAPE 38 Phase 3 — AgentTraceStore : registre persistant des ExecutionTrace
 *
 * RÉUTILISE EXCLUSIVEMENT le mécanisme de persistance existant
 * (dataFilePath + readJsonFile/writeJsonFileSync → SQLite/documents, repli
 * fichiers) — le même patron que AuditStore. Aucun nouveau backend,
 * aucun node:fs, aucune écriture dans les fichiers projet.
 *
 * LE STORE EST PASSIF :
 * - il n'accepte que des ExecutionTrace déjà construites par les projections
 *   pures É38 Phase 2 (buildTaskTrace/buildBatchTrace) ;
 * - il ne crée AUCUN executionId/batchExecutionId/taskId/timestamp/phase/
 *   transactionId/repairId, ne modifie AUCUN status, ne recalcule AUCUNE
 *   corrélation, ne produit AUCUN verdict ;
 * - décision documentée sur sanitizePayload : AuditStore applique
 *   sanitizePayload (journal d'événements hétérogènes) — ICI les traces
 *   proviennent des projections pures É38 Phase 2 (aucun secret : statuts,
 *   phases, identifiants, résumés d'artifacts) et le store est un registre
 *   de traçabilité, pas un journal de secrets : le contenu est stocké
 *   structurellement fidèle (deepFreeze), sans transformation.
 *
 * ISOLATION : clé logique `tenantId:projectId:executionId` + filtre
 * simultané tenant+projet à la lecture ET à l'écriture (upsert par clé
 * composée — même clé = remplacement, jamais de doublon).
 *
 * CAP : AGENT_TRACE_MAX = 500 — slice(-500) à l'écriture (les plus
 * récentes conservées, déterministe), même politique que AuditStore.
 *
 * FAILURE-SAFE : aucun problème de persistance ne jette vers l'appelant ni
 * ne modifie le verdict contenu dans une trace.
 */

import { deepFreeze } from '../ai-native/ai-orchestrator/canonical.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../persistence/json-disk-cache.js';
import type { ExecutionTrace } from '../ai-native/ai-orchestrator/execution/trace.js';

export const AGENT_TRACE_MAX = 500;

/** Clé logique composite (dérivée des champs de la trace — rien de généré). */
export function agentTraceKey(tenantId: string, projectId: string, executionId: string): string {
  return `${tenantId.trim()}:${projectId.trim()}:${executionId.trim()}`;
}

export class AgentTraceStore {
  private traces: ExecutionTrace[] = [];
  private readonly persistent: boolean;
  private readonly filePath: string;

  constructor(options?: { persist?: boolean }) {
    this.persistent = options?.persist === true;
    this.filePath = dataFilePath('agent-execution-traces');
    if (this.persistent) {
      try {
        const loaded = readJsonFile<ExecutionTrace[]>(this.filePath, []);
        if (Array.isArray(loaded)) {
          this.traces = loaded;
        }
      } catch {
        // Un problème de chargement ne casse jamais l'instanciation du store.
        this.traces = [];
      }
    }
  }

  private persist(): void {
    if (!this.persistent) return;
    try {
      writeJsonFileSync(this.filePath, this.traces.slice(-AGENT_TRACE_MAX));
    } catch {
      // FAILURE-SAFE : la persistance ne doit jamais faire échouer l'appelant
      // ni modifier le verdict contenu dans une trace.
    }
  }

  /**
   * Enregistre une ExecutionTrace DÉJÀ construite (projections pures É38
   * Phase 2). Upsert déterministe par clé composite tenantId:projectId:
   * executionId — même clé = remplacement. La trace stockée est figée
   * (deepFreeze) : une mutation ultérieure de l'objet original ne modifie
   * pas silencieusement la trace stockée. Aucun champ ajouté, aucun champ
   * transformé.
   */
  public record(trace: ExecutionTrace): void {
    const key = agentTraceKey(trace.tenantId, trace.projectId, trace.executionId);
    const storedIndex = this.traces.findIndex(
      (t) => agentTraceKey(t.tenantId, t.projectId, t.executionId) === key
    );
    // Copie défensive : une mutation ultérieure de l'objet original ne
    // modifie pas silencieusement la trace stockée (deepFreeze seul gèlerait
    // la référence — et jetterait en module strict à la moindre écriture).
    const frozen = deepFreeze(structuredClone(trace));
    if (storedIndex >= 0) {
      this.traces[storedIndex] = frozen;
    } else {
      this.traces.push(frozen);
    }
    if (this.traces.length > AGENT_TRACE_MAX) {
      this.traces = this.traces.slice(-AGENT_TRACE_MAX);
    }
    this.persist();
  }

  /** Lecture isolée : tenantId + projectId + executionId tous requis. */
  public get(tenantId: string, projectId: string, executionId: string): ExecutionTrace | undefined {
    const key = agentTraceKey(tenantId, projectId, executionId);
    return this.traces.find((t) => agentTraceKey(t.tenantId, t.projectId, t.executionId) === key);
  }

  /** Lecture isolée : uniquement les traces du couple tenant/projet exact. */
  public query(tenantId: string, projectId: string): ExecutionTrace[] {
    return this.traces.filter(
      (t) => t.tenantId === tenantId.trim() && t.projectId === projectId.trim()
    );
  }

  /** Vide le store en mémoire et la persistance associée (primitives existantes). */
  public clear(): void {
    this.traces = [];
    this.persist();
  }
}
