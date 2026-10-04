/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * ÉTAPE 37 — Multi-Agent Scheduler (parallélisme réel borné)
 *
 * NOUVELLE couche au-dessus de l'AgentExecutionService (É32→É36) — ce N'EST
 * PAS un remplacement du scheduler AINT-010 (engine/agent-scheduler.ts,
 * propriétaire d'orchestratePlan, non modifié).
 *
 *   MultiAgentScheduler
 *     ↓  (UNE requête AgentExecutionRequest PAR tâche)
 *   AgentExecutionService  → Registry → agent → artifact → MutationBridge →
 *   MutationOrchestratorService → Gate É36 → Repair É36 → résultat réel
 *
 * Règles :
 * - UNE seule source de vérité d'exécution : AgentExecutionService.execute()
 *   — le scheduler n'appelle JAMAIS agent.executeTask() directement, ne
 *   mute jamais directement, ne fait JAMAIS de rollback lui-même ;
 * - DAG validé AVANT toute exécution (ids uniques, dépendances existantes,
 *   agents/capabilities, cycles) — aucune écriture pendant la validation ;
 * - parallélisme borné par vagues : Promise.all UNIQUEMENT sur le batch
 *   sélectionné (dépendances réelles satisfaites + cibles disjointes) ;
 * - conflits de cibles (requiredContext.targetFiles) → séquencement
 *   déterministe, jamais de cohérence sacrifiée au parallélisme ;
 * - fail-fast borné : un échec réel stoppe la soumission de nouvelles vagues ;
 *   les tâches en vol terminent leur cycle É36 (verdict réel conservé) ;
 * - les tâches jamais démarrées → BLOCKED (dépendance transitive en échec)
 *   ou PENDING (arrêt du scheduler) — jamais exécutées, jamais « réussies » ;
 * - le statut global est dérivé EXCLUSIVEMENT des outcomes réels É36 :
 *   Promise résolue ≠ succès, tâche soumise ≠ succès.
 */

import { deepFreeze } from '../canonical.js';
import { ValidationError } from '../../../errors.js';
import type { Role } from '../../../identity/permissions.js';
import type { AgentExecutionOutcome, AgentExecutionPhaseEntry } from './agent-execution.js';
import type { AgentTask, TaskContextPayload } from '../types.js';

// ---------------------------------------------------------------------------
// Contrats
// ---------------------------------------------------------------------------

export interface MultiAgentTaskSpec {
  readonly taskId: string;
  readonly agentId: string;
  /** Tâche existante (AgentTask) — requiredContext.targetFiles = cibles. */
  readonly task: AgentTask;
  /** Dépendances explicites (taskIds) — aucune dépendance implicite. */
  readonly dependencies: readonly string[];
  /** Ordre déclaratif déterministe (utilisé pour le tri des vagues). */
  readonly order: number;
}

export interface MultiAgentSchedulerRequest {
  readonly executionId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly tasks: readonly MultiAgentTaskSpec[];
  /** Signal transmis à CHAQUE exécution É36 (cancellation réelle). */
  readonly signal?: AbortSignal | undefined;
  readonly maxConcurrency?: number | undefined;
  readonly repairPolicy?: { readonly enabled: boolean; readonly maxAttempts?: number | undefined } | undefined;
  readonly userRole?: Role | undefined;
  readonly requestId?: string | undefined;
}

/** Statuts de tâche au niveau scheduler — dérivés des outcomes réels É36. */
export type MultiAgentTaskStatus =
  | 'COMPLETED'   // outcome réel SUCCESS ou DEGRADED (mutation vérifiée)
  | 'FAILED'      // outcome réel FAILURE / ROLLED_BACK / FAILED_ROLLBACK
  | 'CANCELLED'   // outcome réel CANCELLED (annulation réelle É36)
  | 'BLOCKED'     // jamais exécutée : dépendance transitive en échec
  | 'PENDING';    // jamais exécutée : arrêt du scheduler (fail-fast/annulation)

export interface MultiAgentTaskRecord {
  readonly spec: MultiAgentTaskSpec;
  readonly status: MultiAgentTaskStatus;
  /** executionId individuel déterministe : <batchId>--<taskId>. */
  readonly taskExecutionId?: string | undefined;
  /** Outcome RÉEL É36 (absent si la tâche n'a jamais été exécutée). */
  readonly outcome?: AgentExecutionOutcome | undefined;
  readonly blockedReason?: string | undefined;
}

export type MultiAgentBatchStatus = 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';

export interface MultiAgentSchedulerOutcome {
  readonly executionId: string;
  readonly status: MultiAgentBatchStatus;
  readonly tasks: readonly MultiAgentTaskRecord[];
  readonly counts: {
    readonly completed: number;
    readonly failed: number;
    readonly cancelled: number;
    readonly blocked: number;
    readonly pending: number;
    readonly total: number;
  };
  /** Timeline du scheduler (type É35 réutilisé — pas de second système). */
  readonly phases: readonly AgentExecutionPhaseEntry[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export const DEFAULT_MAX_CONCURRENCY = 4;
export const MAX_CONCURRENCY_CAP = 16;

interface SchedulerTaskState {
  readonly spec: MultiAgentTaskSpec;
  readonly taskExecutionId: string;
  status?: MultiAgentTaskStatus | undefined;
  outcome?: AgentExecutionOutcome | undefined;
  blockedReason?: string | undefined;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class MultiAgentScheduler {
  constructor(
    /**
     * UNE seule source de vérité d'exécution (É32→É36 complet : Gate,
     * Repair, rollback, cancellation, isolation, single-writer).
     */
    private readonly agentExecution: import('./agent-execution.js').AgentExecutionService
  ) {}

  public async execute(request: MultiAgentSchedulerRequest): Promise<MultiAgentSchedulerOutcome> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const phases: AgentExecutionPhaseEntry[] = [];
    const recordPhase = (phase: string, detail?: string): void => {
      phases.push({ phase, at: new Date().toISOString(), ...(detail !== undefined ? { detail } : {}) });
    };

    recordPhase('SCHEDULER_STARTED', `${request.tasks.length} tâche(s)`);

    // ------------------------------------------------------------------
    // PHASE 3 — Validation du DAG AVANT toute exécution (aucune écriture).
    // ------------------------------------------------------------------
    this.validate(request);

    const maxConcurrency = Math.max(
      1,
      Math.min(MAX_CONCURRENCY_CAP, request.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY)
    );

    const taskExecutionId = (spec: MultiAgentTaskSpec): string => `${request.executionId}--${spec.taskId}`;

    // Ordre déterministe : (order asc, taskId asc).
    const orderedSpecs = [...request.tasks].sort((a, b) =>
      a.order !== b.order ? a.order - b.order : a.taskId < b.taskId ? -1 : 1
    );

    const states = new Map<string, SchedulerTaskState>();
    for (const spec of orderedSpecs) {
      states.set(spec.taskId, { spec, taskExecutionId: taskExecutionId(spec) });
    }

    const isAborted = (): boolean => request.signal?.aborted === true;
    const recordStatus = (state: SchedulerTaskState, status: MultiAgentTaskStatus, detail?: string): void => {
      state.status = status;
      const phaseByStatus: Partial<Record<MultiAgentTaskStatus, string>> = {
        COMPLETED: 'TASK_COMPLETED',
        FAILED: 'TASK_FAILED',
        CANCELLED: 'TASK_CANCELLED',
        BLOCKED: 'TASK_BLOCKED'
      };
      const phase = phaseByStatus[status];
      if (phase) {
        recordPhase(
          phase,
          `taskId=${state.spec.taskId} agentId=${state.spec.agentId} executionId=${state.taskExecutionId}${detail ? ` ${detail}` : ''}`
        );
      }
    };

    const targetsOf = (spec: MultiAgentTaskSpec): readonly string[] =>
      spec.task.requiredContext.targetFiles ?? [];

    const intersects = (a: readonly string[], b: readonly string[]): boolean =>
      a.some((x) => b.includes(x));

    // ------------------------------------------------------------------
    // PHASE 4/5 — Boucle déterministe par vagues bornées.
    // ------------------------------------------------------------------
    let stopNewWaves = false;
    let cancellationObserved = false;

    const unresolvedCount = (): number =>
      Array.from(states.values()).filter((s) => s.status === undefined).length;

    while (unresolvedCount() > 0) {
      // Cancellation observée → plus aucune nouvelle vague (les tâches déjà
      // en vol ont déjà été attendues à la fin de la vague précédente).
      if (isAborted()) {
        cancellationObserved = true;
        stopNewWaves = true;
      }
      if (stopNewWaves) break;

      // 1-2. READY : toutes les dépendances sont RÉELLEMENT COMPLETED.
      const ready: SchedulerTaskState[] = [];
      for (const state of states.values()) {
        if (state.status !== undefined) continue;
        const depsDone = state.spec.dependencies.every((depId) => {
          const dep = states.get(depId);
          return dep !== undefined && dep.status === 'COMPLETED';
        });
        if (depsDone) ready.push(state);
      }
      if (ready.length === 0) break; // sécurité (ne doit pas arriver après validation)

      // 3-5. Tri déterministe (déjà trié) + capacité + conflits de cibles.
      const selected: SchedulerTaskState[] = [];
      const occupiedTargets: string[] = [];
      for (const state of ready) {
        if (selected.length >= maxConcurrency) break;
        const targets = targetsOf(state.spec);
        // Cible inconnue (aucune targetFile déclarée) → conservateur : pas de
        // parallélisme avec une autre tâche (mutable potentiellement).
        const conservative = targets.length === 0;
        const conflict =
          conservative ||
          selected.some((s) => intersects(targetsOf(s.spec), targets));
        if (conflict) continue; // reste READY → vague suivante (séquencement)
        selected.push(state);
        for (const t of targets) if (!occupiedTargets.includes(t)) occupiedTargets.push(t);
      }
      if (selected.length === 0) break; // sécurité anti-boucle

      for (const state of selected) {
        recordPhase('TASK_READY', `taskId=${state.spec.taskId}`);
      }

      // 6-7. Lancer le batch sélectionné et attendre les OUTCOMES RÉELS É36.
      recordPhase(
        'WAVE_STARTED',
        `${selected.length} tâche(s) en parallèle (max=${maxConcurrency})`
      );
      const outcomes = await Promise.all(
        selected.map(async (state) => {
          recordPhase('TASK_STARTED', `taskId=${state.spec.taskId} executionId=${state.taskExecutionId}`);
          const outcome = await this.agentExecution.execute({
            executionId: state.taskExecutionId,
            agentId: state.spec.agentId,
            task: state.spec.task,
            context: this.buildContext(state.spec.task),
            tenantId: request.tenantId,
            projectId: request.projectId,
            ...(request.userRole !== undefined ? { userRole: request.userRole } : {}),
            ...(request.requestId !== undefined ? { requestId: request.requestId } : {}),
            ...(request.signal !== undefined ? { signal: request.signal } : {}),
            ...(request.repairPolicy !== undefined ? { repairPolicy: request.repairPolicy } : {})
          });
          return { state, outcome };
        })
      );

      // 8. Intégrer les verdicts RÉELS (Promise résolue ≠ succès).
      let waveHasFailure = false;
      let waveHasCancellation = false;
      for (const { state, outcome } of outcomes) {
        state.outcome = outcome;
        if (outcome.status === 'SUCCESS' || outcome.status === 'DEGRADED') {
          recordStatus(state, 'COMPLETED', `status=${outcome.status}`);
        } else if (outcome.status === 'CANCELLED') {
          waveHasCancellation = true;
          recordStatus(state, 'CANCELLED', `status=CANCELLED point=${outcome.cancellation.at ?? '?'}`);
        } else {
          waveHasFailure = true;
          recordStatus(state, 'FAILED', `status=${outcome.status} error=${outcome.error ?? ''}`.slice(0, 240));
        }
      }
      recordPhase('WAVE_FINISHED', `${outcomes.length} outcome(s) réel(s) intégré(s)`);

      // 9-10. Fail-fast borné : un échec ou une annulation réelle stoppe la
      // soumission de nouvelles vagues (les tâches en vol ont déjà terminé).
      if (waveHasFailure || waveHasCancellation || isAborted()) {
        stopNewWaves = true;
        if (isAborted()) cancellationObserved = true;
      }
    }

    // ------------------------------------------------------------------
    // Tâches jamais démarrées → BLOCKED ou PENDING (analyse transitive).
    // ------------------------------------------------------------------
    const blockedTransitively = (state: SchedulerTaskState, seen: Set<string>): boolean => {
      if (seen.has(state.spec.taskId)) return false;
      seen.add(state.spec.taskId);
      return state.spec.dependencies.some((depId) => {
        const dep = states.get(depId);
        if (!dep) return false;
        if (dep.status === 'FAILED' || dep.status === 'CANCELLED' || dep.status === 'BLOCKED') return true;
        if (dep.status === undefined) return blockedTransitively(dep, seen);
        return false;
      });
    };

    for (const state of states.values()) {
      if (state.status !== undefined) continue;
      if (blockedTransitively(state, new Set<string>())) {
        state.blockedReason = 'dépendance en échec/annulée/bloquée — jamais exécutée';
        recordStatus(state, 'BLOCKED', state.blockedReason);
      } else {
        state.blockedReason = cancellationObserved ? 'scheduler annulé avant démarrage' : 'arrêt après échec (fail-fast)';
        recordStatus(state, 'PENDING', state.blockedReason);
      }
    }

    // ------------------------------------------------------------------
    // PHASE 11 — Verdict global dérivé EXCLUSIVEMENT des outcomes réels.
    // ------------------------------------------------------------------
    const all = Array.from(states.values());
    const counts = {
      completed: all.filter((s) => s.status === 'COMPLETED').length,
      failed: all.filter((s) => s.status === 'FAILED').length,
      cancelled: all.filter((s) => s.status === 'CANCELLED').length,
      blocked: all.filter((s) => s.status === 'BLOCKED').length,
      pending: all.filter((s) => s.status === 'PENDING').length,
      total: all.length
    };

    let status: MultiAgentBatchStatus;
    if (counts.failed > 0) {
      status = 'FAILED';
    } else if (cancellationObserved || counts.cancelled > 0) {
      status = counts.completed > 0 ? 'PARTIAL' : 'CANCELLED';
    } else if (counts.completed === counts.total) {
      status = 'COMPLETED';
    } else {
      status = 'PARTIAL';
    }

    recordPhase(
      status === 'COMPLETED' ? 'SCHEDULER_COMPLETED' : status === 'FAILED' ? 'SCHEDULER_FAILED' : 'SCHEDULER_CANCELLED',
      `completed=${counts.completed} failed=${counts.failed} cancelled=${counts.cancelled} blocked=${counts.blocked} pending=${counts.pending}`
    );

    return deepFreeze({
      executionId: request.executionId,
      status,
      tasks: all
        .map((s): MultiAgentTaskRecord => ({
          spec: s.spec,
          status: s.status as MultiAgentTaskStatus,
          ...(s.status !== undefined && s.outcome !== undefined
            ? { taskExecutionId: s.taskExecutionId, outcome: s.outcome }
            : { taskExecutionId: s.taskExecutionId }),
          ...(s.blockedReason !== undefined ? { blockedReason: s.blockedReason } : {})
        }))
        .sort((a, b) => (a.spec.order !== b.spec.order ? a.spec.order - b.spec.order : a.spec.taskId < b.spec.taskId ? -1 : 1)),
      counts,
      phases,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime
    });
  }

  /**
   * PHASE 3 — Validation complète AVANT toute exécution (aucune écriture).
   * Erreurs explicites par catégorie ; toute invalidité refuse le batch.
   */
  private validate(request: MultiAgentSchedulerRequest): void {
    if (!request.executionId || request.executionId.trim().length === 0) {
      throw new ValidationError('executionId de batch obligatoire');
    }
    if (request.tenantId.trim().length === 0 || request.projectId.trim().length === 0) {
      throw new ValidationError('tenantId et projectId obligatoires (isolation)');
    }
    if (request.tasks.length === 0) {
      throw new ValidationError('aucune tâche fournie au scheduler multi-agents');
    }

    // 1. Unicité des taskId.
    const seen = new Set<string>();
    for (const spec of request.tasks) {
      if (seen.has(spec.taskId)) {
        throw new ValidationError(`DAG_INVALID: taskId dupliqué '${spec.taskId}'`);
      }
      seen.add(spec.taskId);
    }

    // 2. Dépendances existantes.
    for (const spec of request.tasks) {
      for (const dep of spec.dependencies) {
        if (!seen.has(dep)) {
          throw new ValidationError(`DAG_INVALID: la tâche '${spec.taskId}' dépend de '${dep}' qui n'existe pas`);
        }
        if (dep === spec.taskId) {
          throw new ValidationError(`DAG_INVALID: la tâche '${spec.taskId}' dépend d'elle-même`);
        }
      }
    }

    // 3-4. Agents et capabilities (Registry É34 — même source).
    for (const spec of request.tasks) {
      const entry = this.agentExecution.registry.get(spec.agentId);
      if (!entry) {
        throw new ValidationError(`AGENT_UNKNOWN: aucun agent '${spec.agentId}' (tâche '${spec.taskId}')`);
      }
      const unsupported = spec.task.requiredCapabilities.filter(
        (capability) => !entry.capabilities.includes(capability)
      );
      if (unsupported.length > 0) {
        throw new ValidationError(
          `CAPABILITY_UNSUPPORTED: l'agent '${spec.agentId}' ne possède pas [${unsupported.join(', ')}] (tâche '${spec.taskId}')`
        );
      }
    }

    // 5-7. Cycle detection (Kahn) — rejet AVANT toute exécution.
    const indegree = new Map<string, number>();
    const children = new Map<string, string[]>();
    for (const spec of request.tasks) {
      indegree.set(spec.taskId, spec.dependencies.length);
      for (const dep of spec.dependencies) {
        const list = children.get(dep) ?? [];
        list.push(spec.taskId);
        children.set(dep, list);
      }
    }
    let queue = request.tasks.filter((t) => (indegree.get(t.taskId) ?? 0) === 0).map((t) => t.taskId);
    let visited = 0;
    while (queue.length > 0) {
      const next: string[] = [];
      for (const id of queue) {
        visited += 1;
        for (const child of children.get(id) ?? []) {
          const d = (indegree.get(child) ?? 0) - 1;
          indegree.set(child, d);
          if (d === 0) next.push(child);
        }
      }
      queue = next;
    }
    if (visited !== request.tasks.length) {
      const cyclic = request.tasks.filter((t) => (indegree.get(t.taskId) ?? 0) > 0).map((t) => t.taskId);
      throw new ValidationError(`DAG_INVALID: cycle détecté entre [${cyclic.join(', ')}] — rejet avant toute exécution`);
    }
  }

  /** Contexte minimal construit depuis requiredContext (aucune autre source). */
  private buildContext(task: AgentTask): TaskContextPayload {
    return {
      relevantFiles: {},
      relevantSymbols: [...(task.requiredContext.targetSymbols ?? [])],
      decisions: [],
      constraints: [],
      recentHistory: []
    };
  }
}
