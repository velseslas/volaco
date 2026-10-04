/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * ÉTAPE 38 — ExecutionTrace : contrat de traçabilité + projections pures
 *
 * CETTE PHASE NE CONTIENT AUCUN COMPORTEMENT : uniquement le contrat typé
 * et deux projections PURES des outcomes réels existants
 * (AgentExecutionOutcome É32→É36 / MultiAgentSchedulerOutcome É37).
 *
 * Règles strictes :
 * - une projection n'utilise QUE les données présentes dans l'outcome ;
 * - aucune phase, statut, transactionId, gate/repair/rollback inventés ;
 * - une donnée absente reste absente (undefined) — jamais transformée en
 *   succès ni complétée ;
 * - aucune action, aucune écriture, aucune lecture du FileStore, aucun
 *   node:fs, aucun identifiant aléatoire ;
 * - corrélation batch→tâche : reprise TELLE QUELLE de la dérivation É37
 *   (`taskExecutionId = '<batchId>--<taskId>'`) — le préfixe/suffixe est lu,
 *   jamais fabriqué.
 *
 * À état identique, deux projections sont deepEqual (aucun champ temporel
 * généré ici : les timestamps viennent des phases/outcomes réels).
 */

import { deepFreeze } from '../canonical.js';
import type {
  AgentExecutionOutcome,
  AgentExecutionMutationOutcome,
  AgentExecutionRollback,
  AgentExecutionCancellation,
  AgentExecutionPhaseEntry
} from './agent-execution.js';
import type { GateResult } from './gate.js';
import type { MultiAgentSchedulerOutcome } from './multi-agent-scheduler.js';

// ---------------------------------------------------------------------------
// Contrat
// ---------------------------------------------------------------------------

export type ExecutionTraceKind = 'BATCH' | 'TASK';

/** Résumé RÉEL d'un artifact produit (jamais reconstruit). */
export interface ExecutionTraceArtifactSummary {
  readonly id: string;
  readonly kind: string;
  readonly targetFiles: readonly string[];
  readonly hash: string;
}

/** Entrée de corrélation batch → tâche (données réelles É37). */
export interface ExecutionTraceTaskEntry {
  readonly taskId: string;
  readonly agentId: string;
  /** Tel que produit par É37 : '<batchId>--<taskId>'. */
  readonly taskExecutionId: string;
  /** Statut réel au niveau scheduler (COMPLETED/FAILED/…/BLOCKED/PENDING). */
  readonly status: string;
  /** Verdict réel É36 si la tâche a été exécutée. */
  readonly executionStatus?: string | undefined;
  readonly blockedReason?: string | undefined;
}

/** Résumé réel de la vérification (Gate) — observation, jamais un verdict propre. */
export interface ExecutionTraceVerificationSummary {
  readonly performed: boolean;
  readonly passed: boolean;
  readonly checkCount: number;
  readonly error?: string | undefined;
}

export interface ExecutionTrace {
  readonly executionId: string;
  readonly kind: ExecutionTraceKind;
  /** Pour une tâche de batch : l'executionId du batch parent (lu, pas inventé). */
  readonly parentExecutionId?: string | undefined;
  readonly batchExecutionId?: string | undefined;
  /** Pour une tâche : le taskId réel (outcome.result.taskId). */
  readonly taskId?: string | undefined;
  readonly agentId?: string | undefined;
  readonly tenantId: string;
  readonly projectId: string;
  /** Verdict RÉEL de l'outcome — recopié tel quel. */
  readonly status: string;
  readonly startedAt: string;
  readonly endedAt?: string | undefined;
  readonly durationMs?: number | undefined;
  /** Phases RÉELLEMENT enregistrées par É35/É36/É37 (projection fidèle). */
  readonly phases: readonly AgentExecutionPhaseEntry[];
  readonly artifactCount?: number | undefined;
  readonly artifacts?: readonly ExecutionTraceArtifactSummary[] | undefined;
  readonly mutation?: AgentExecutionMutationOutcome | undefined;
  readonly verification?: ExecutionTraceVerificationSummary | undefined;
  readonly gate?: GateResult | undefined;
  readonly repair?: AgentExecutionOutcome['repair'] | undefined;
  readonly rollback?: AgentExecutionRollback | undefined;
  readonly cancellation?: AgentExecutionCancellation | undefined;
  /** Traces BATCH : compteurs réels É37. */
  readonly counts?: MultiAgentSchedulerOutcome['counts'] | undefined;
  /** Traces BATCH : corrélation réelle batch → tâches. */
  readonly tasks?: readonly ExecutionTraceTaskEntry[] | undefined;
  readonly error?: string | undefined;
}

// ---------------------------------------------------------------------------
// Dérivation de corrélation (lecture de la convention É37, pas une invention)
// ---------------------------------------------------------------------------

/**
 * Extrait la corrélation batch réelle d'un taskExecutionId É37
 * ('<batchId>--<taskId>'). Retourne undefined si l'identifiant ne porte pas
 * de préfixe batch (exécution unitaire hors batch).
 */
export function deriveBatchCorrelation(taskExecutionId: string): {
  batchExecutionId?: string | undefined;
} {
  const separatorIndex = taskExecutionId.indexOf('--');
  if (separatorIndex <= 0) {
    return {};
  }
  return {
    batchExecutionId: taskExecutionId.slice(0, separatorIndex)
  };
}

// ---------------------------------------------------------------------------
// Projections pures
// ---------------------------------------------------------------------------

function artifactSummaries(outcome: AgentExecutionOutcome): {
  artifactCount: number;
  artifacts: readonly ExecutionTraceArtifactSummary[];
} {
  return {
    artifactCount: outcome.artifacts.length,
    artifacts: outcome.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      targetFiles: [...artifact.targetFiles],
      hash: artifact.hash
    }))
  };
}

function verificationSummary(outcome: AgentExecutionOutcome): ExecutionTraceVerificationSummary {
  return {
    performed: outcome.verification.performed,
    passed: outcome.verification.passed,
    checkCount: outcome.verification.checks.length,
    ...(outcome.verification.error !== undefined ? { error: outcome.verification.error } : {})
  };
}

/**
 * Projection pure d'un outcome de TÂCHE (É32→É36) vers ExecutionTrace.
 * Aucun champ fabriqué : tout vient de l'outcome ; les absences restent
 * absentes.
 */
export function buildTaskTrace(params: {
  readonly outcome: AgentExecutionOutcome;
  readonly tenantId: string;
  readonly projectId: string;
}): ExecutionTrace {
  const { outcome, tenantId, projectId } = params;
  const correlation = deriveBatchCorrelation(outcome.executionId);

  return deepFreeze({
    executionId: outcome.executionId,
    kind: 'TASK' as const,
    ...correlation,
    ...(correlation.batchExecutionId !== undefined ? { parentExecutionId: correlation.batchExecutionId } : {}),
    // taskId réel porté par le résultat de l'agent (AgentResult.taskId)
    taskId: outcome.result.taskId,
    agentId: outcome.agentId,
    tenantId,
    projectId,
    status: outcome.status,
    startedAt: outcome.startedAt,
    endedAt: outcome.completedAt,
    durationMs: outcome.durationMs,
    phases: outcome.phases.map((p) => ({ ...p })),
    ...artifactSummaries(outcome),
    mutation: outcome.mutation,
    verification: verificationSummary(outcome),
    ...(outcome.gate !== undefined ? { gate: outcome.gate } : {}),
    ...(outcome.repair !== undefined ? { repair: outcome.repair } : {}),
    rollback: outcome.rollback,
    cancellation: outcome.cancellation,
    ...(outcome.error !== undefined ? { error: outcome.error } : {})
  });
}

/**
 * Projection pure d'un outcome de BATCH (É37) vers ExecutionTrace.
 * La corrélation batch → tâches reprend exactement les enregistrements réels
 * du scheduler (taskExecutionId, statuts, outcomes référencés).
 */
export function buildBatchTrace(params: {
  readonly outcome: MultiAgentSchedulerOutcome;
  readonly tenantId: string;
  readonly projectId: string;
}): ExecutionTrace {
  const { outcome, tenantId, projectId } = params;

  return deepFreeze({
    executionId: outcome.executionId,
    kind: 'BATCH' as const,
    agentId: undefined,
    tenantId,
    projectId,
    status: outcome.status,
    startedAt: outcome.startedAt,
    endedAt: outcome.completedAt,
    durationMs: outcome.durationMs,
    phases: outcome.phases.map((p) => ({ ...p })),
    counts: outcome.counts,
    tasks: outcome.tasks.map((record) => ({
      taskId: record.spec.taskId,
      agentId: record.spec.agentId,
      taskExecutionId: record.taskExecutionId ?? `${outcome.executionId}--${record.spec.taskId}`,
      status: record.status,
      executionStatus: record.outcome?.status,
      ...(record.blockedReason !== undefined ? { blockedReason: record.blockedReason } : {})
    })),
    ...(outcome.tasks.some((t) => t.outcome?.error !== undefined)
      ? { error: outcome.tasks.find((t) => t.outcome?.error !== undefined)?.outcome?.error }
      : {})
  });
}
