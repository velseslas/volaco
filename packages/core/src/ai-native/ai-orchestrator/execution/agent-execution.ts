/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * ÉTAPE 32/35 — Contrat réel d'exécution d'agent + cycle transactionnel
 * contrôlé (vérification réelle, rollback réel, cancellation réelle).
 *
 * Pipeline : sélection par agentId (Registry É34) → vérification de
 * capabilities → exécution de l'agent → artifacts réels → SNAPSHOT AVANT →
 * mutation OBLIGATOIREMENT via MutationBridge/MutationOrchestratorService
 * (single writer) → VÉRIFICATION RÉELLE de la source (jamais un booléen du
 * composant qui a muté) → SUCCESS uniquement si la vérification réussit →
 * ROLLBACK réel + vérification de restauration sinon → CANCELLED si un
 * AbortSignal a réellement interrompu le cycle.
 *
 * Aucune réussite déclarative : tout statut non-SUCCESS est un échec ou une
 * annulation réelle, avec l'erreur propagée et la timeline observable.
 */

import { deepFreeze } from '../canonical.js';
import { auditStore } from '../../../observability/audit.js';
import { agentTraceStore } from '../../../observability/agent-trace-store.js';
import { buildTaskTrace } from './trace.js';
import type { Role } from '../../../identity/permissions.js';
import { assertPermission } from '../../../identity/permissions.js';
import type { IReadOnlyFileSource } from '../../understanding/types.js';
import type { AgentRegistryService } from '../registry/agent-registry.js';
import type { BaseSpecializedAgent } from '../agents/base-agent.js';
import type { MutationBridge } from '../engine/mutation-bridge.js';
import { evaluateFileMutationGate, type GateResult } from './gate.js';
import { buildRepairPlan, classifyGateFailure, FileRepairService, isRepairSupported, type RepairOutcome } from './repair.js';
import type {
  AgentArtifact,
  AgentResult,
  AgentTask,
  TaskContextPayload
} from '../types.js';

// ---------------------------------------------------------------------------
// Contrat
// ---------------------------------------------------------------------------

export interface AgentExecutionRequest {
  /** Identifiant de traçage de l'exécution (conservé du début à la fin). */
  readonly executionId: string;
  /** Quel agent exécute — résolu dans le Registry (É34, par ID). */
  readonly agentId: string;
  /** Quelle tâche lui est demandée (type existant). */
  readonly task: AgentTask;
  /** Quel contexte lui est fourni (type existant). */
  readonly context: TaskContextPayload;
  readonly tenantId: string;
  readonly projectId: string;
  readonly userRole?: Role | undefined;
  readonly requestId?: string | undefined;
  readonly dryRun?: boolean | undefined;
  /**
   * ÉTAPE 35 — signal de cancellation RÉEL. Observé aux points de contrôle
   * du cycle : avant l'agent, entre artifact et mutation, après mutation.
   */
  readonly signal?: AbortSignal | undefined;
  /**
   * ÉTAPE 36 — politique de réparation (OPT-IN, désactivée par défaut pour
   * préserver le comportement É35 : divergence → ROLLED_BACK). Quand elle
   * est activée, une vérification échouée déclenche UNE tentative bornée
   * (maxAttempts=1 par défaut) : rollback réel → réapplication → re-Gate.
   */
  readonly repairPolicy?: { readonly enabled: boolean; readonly maxAttempts?: number | undefined } | undefined;
}

export interface AgentExecutionMutationOutcome {
  /** Une mutation de fichier était-elle demandée par la tâche ? */
  readonly requested: boolean;
  /** La mutation a-t-elle été RÉELLEMENT exécutée (transaction COMMITTED) ? */
  readonly executed: boolean;
  readonly transactionId?: string | undefined;
  readonly appliedCount: number;
  readonly error?: string | undefined;
}

/** ÉTAPE 35 — vérification RÉELLE de la source après mutation. */
export interface AgentExecutionVerificationCheck {
  readonly check: string;
  readonly passed: boolean;
  readonly detail?: string | undefined;
}

export interface AgentExecutionVerification {
  readonly performed: boolean;
  readonly passed: boolean;
  readonly checks: readonly AgentExecutionVerificationCheck[];
  readonly error?: string | undefined;
}

/** ÉTAPE 35 — rollback réel (via MutationOrchestratorService) + restauration vérifiée. */
export interface AgentExecutionRollback {
  readonly performed: boolean;
  readonly verified: boolean;
  readonly restoredFiles: readonly string[];
  readonly error?: string | undefined;
}

/** ÉTAPE 35 — cancellation réelle (point du cycle où elle a été observée). */
export interface AgentExecutionCancellation {
  readonly requested: boolean;
  readonly at?: 'BEFORE_AGENT' | 'BEFORE_MUTATION' | 'AFTER_MUTATION' | undefined;
}

export interface AgentExecutionPhaseEntry {
  readonly phase: string;
  readonly at: string;
  readonly detail?: string | undefined;
}

export type AgentExecutionStatus =
  | 'SUCCESS'
  | 'FAILURE'
  | 'DEGRADED'
  | 'ROLLED_BACK'
  | 'CANCELLED'
  | 'FAILED_ROLLBACK';

export interface AgentExecutionOutcome {
  readonly executionId: string;
  readonly agentId: string;
  readonly taskId: string;
  /** Statut honnête de l'exécution (niveau contrat É32/É35). */
  readonly status: AgentExecutionStatus;
  /** Résultat réel de l'agent (type existant — statuts orchestrator conservés). */
  readonly result: AgentResult;
  readonly artifacts: readonly AgentArtifact[];
  readonly mutation: AgentExecutionMutationOutcome;
  /** ÉTAPE 35 — vérification réelle de la source (observée, pas déclarée). */
  readonly verification: AgentExecutionVerification;
  /** ÉTAPE 35 — rollback réel éventuel + restauration vérifiée. */
  readonly rollback: AgentExecutionRollback;
  /** ÉTAPE 35 — cancellation réelle éventuelle. */
  readonly cancellation: AgentExecutionCancellation;
  /** ÉTAPE 35 — timeline observable du cycle. */
  readonly phases: readonly AgentExecutionPhaseEntry[];
  /** ÉTAPE 36 — résultat du gate (évalué sur la source réelle). */
  readonly gate?: GateResult | undefined;
  /** ÉTAPE 36 — réparation bornée éventuelle (opt-in). */
  readonly repair?: {
    readonly planned: boolean;
    readonly reason?: string | undefined;
    readonly repairId?: string | undefined;
    readonly attempted: boolean;
    readonly attemptsUsed: number;
    readonly gateAfterPassed?: boolean | undefined;
    readonly rolledBack: boolean;
    readonly rollbackVerified: boolean;
    readonly cancelled: boolean;
    readonly error?: string | undefined;
  } | undefined;
  readonly error?: string | undefined;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

/** Opérations de tâche qui exigent une mutation de fichier réelle. */
const FILE_MUTATION_OPERATIONS: ReadonlySet<string> = new Set(['CREATE', 'MODIFY', 'DELETE']);

/**
 * ÉTAPE 35 — observateur nul : utilisé UNIQUEMENT quand aucune source réelle
 * n'a été fournie. Toute vérification via cet observateur échoue (fichier
 * jamais observable) → aucun SUCCESS ne peut être déclaré sans source réelle.
 */
export const NULL_FILE_OBSERVER: IReadOnlyFileSource = deepFreeze({
  getFile: () => null,
  getAllProjectFiles: () => ({})
});

interface BeforeSnapshotEntry {
  readonly path: string;
  readonly existed: boolean;
  readonly content: string | undefined;
}

// ---------------------------------------------------------------------------
// Service d'exécution
// ---------------------------------------------------------------------------

export class AgentExecutionService {
  /**
   * ÉTAPE 34 — le Registry est LA source unique de résolution : les agents
   * sont décrits et référencés (mêmes instances que le scheduler), jamais
   * copiés.
   */
  public readonly registry: AgentRegistryService;

  constructor(
    registry: AgentRegistryService,
    private readonly mutationBridge: MutationBridge,
    /**
     * ÉTAPE 35 — observateur READ-ONLY de la source de vérité (LA même
     * source que le MutationOrchestratorService). La vérification observe
     * réellement le store ; elle ne fait jamais confiance au retour du
     * composant qui a muté.
     */
    private readonly fileObserver: IReadOnlyFileSource
  ) {
    this.registry = registry;
  }

  /**
   * Enregistre un agent dans le Registry (prévention stricte de doublon).
   */
  public registerAgent(agent: BaseSpecializedAgent): void {
    this.registry.register(agent);
  }

  public has(agentId: string): boolean {
    return this.registry.has(agentId);
  }

  public listAgentIds(): readonly string[] {
    return this.registry.list().map((entry) => entry.id);
  }

  /** ÉTAPE 34 — accès au Registry (le routeur conversationnel l'utilise). */
  public getRegistry(): AgentRegistryService {
    return this.registry;
  }

  /**
   * Exécute UN agent sur UNE tâche selon le contrat honnête + cycle
   * transactionnel É35 (vérification/rollback/cancellation réels).
   */
  public async execute(request: AgentExecutionRequest): Promise<AgentExecutionOutcome> {
    assertPermission(request.userRole ?? 'OWNER', 'PROJECT_READ', request.requestId);

    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const phases: AgentExecutionPhaseEntry[] = [];
    const recordPhase = (phase: string, detail?: string): void => {
      phases.push({ phase, at: new Date().toISOString(), ...(detail !== undefined ? { detail } : {}) });
    };

    const noVerification: AgentExecutionVerification = { performed: false, passed: false, checks: [] };
    const noRollback: AgentExecutionRollback = { performed: false, verified: false, restoredFiles: [] };
    const noCancellation: AgentExecutionCancellation = { requested: false };
    // ÉTAPE 35 — observation du signal via fonction (évite le narrowing TS sur
    // la propriété readonly aborted entre les points de contrôle du cycle).
    const isAborted = (): boolean => request.signal?.aborted === true;

    const finish = (
      status: AgentExecutionStatus,
      result: AgentResult,
      mutation: AgentExecutionMutationOutcome,
      verification: AgentExecutionVerification,
      rollback: AgentExecutionRollback,
      cancellation: AgentExecutionCancellation,
      error?: string | undefined,
      extra?: { readonly gate?: GateResult | undefined; readonly repair?: AgentExecutionOutcome['repair'] | undefined }
    ): AgentExecutionOutcome => {
      const completedAt = new Date().toISOString();
      recordPhase(`FINAL_${status}`);
      const outcome: AgentExecutionOutcome = {
        executionId: request.executionId,
        agentId: result.agentId,
        taskId: request.task.id,
        status,
        result,
        artifacts: result.artifacts,
        mutation,
        verification,
        rollback,
        cancellation,
        phases,
        ...(error !== undefined ? { error } : {}),
        ...(extra && Object.keys(extra).length > 0 ? extra : {}),
        startedAt,
        completedAt,
        durationMs: Date.now() - startTime
      };
      auditStore.record({
        tenantId: request.tenantId,
        userId: request.userRole ?? 'OWNER',
        action: 'AGENT_EXECUTED',
        resourceType: 'AGENT_EXECUTION',
        resourceId: request.executionId,
        status: status === 'FAILURE' || status === 'FAILED_ROLLBACK' ? 'FAILURE' : 'SUCCESS',
        metadata: {
          agentId: result.agentId,
          taskId: request.task.id,
          executionStatus: status,
          agentStatus: result.status,
          degraded: result.degraded === true,
          mutationRequested: mutation.requested,
          mutationExecuted: mutation.executed,
          appliedCount: mutation.appliedCount,
          artifacts: result.artifacts.length,
          verificationPerformed: verification.performed,
          verificationPassed: verification.performed ? verification.passed : null,
          rollbackPerformed: rollback.performed,
          rollbackVerified: rollback.performed ? rollback.verified : null,
          cancelled: cancellation.requested,
          cancellationPoint: cancellation.at ?? null,
          phases: phases.map((p) => p.phase),
          error: error ?? null
        },
        requestId: request.requestId || 'req_agent_execution'
      });

      // ÉTAPE 38 Phase 4 — la trace est une PROJECTION de l'outcome réel
      // (verdict déjà déterminé ci-dessus) : buildTaskTrace n'invente rien et
      // l'enregistrement est FAILURE-SAFE — un échec du store ne peut ni
      // modifier l'outcome/le verdict, ni faire échouer l'exécution.
      try {
        agentTraceStore.record(
          buildTaskTrace({ outcome, tenantId: request.tenantId, projectId: request.projectId })
        );
      } catch {
        // L'observabilité ne doit jamais transformer un verdict ni faire
        // échouer la requête métier.
      }

      return deepFreeze(outcome);
    };

    const stubResult = (agentId: string, error: string): AgentResult => ({
      taskId: request.task.id,
      agentId,
      status: 'FAILURE',
      artifacts: [],
      conflicts: [],
      tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      durationMs: 0,
      error
    });

    // --- Point de cancellation A : AVANT l'agent ----------------------------
    if (request.signal?.aborted === true) {
      recordPhase('CANCELLED_BEFORE_AGENT');
      return finish(
        'CANCELLED',
        stubResult(request.agentId, 'CANCELLED_BEFORE_AGENT: aucune exécution, aucune mutation'),
        { requested: FILE_MUTATION_OPERATIONS.has(request.task.operation ?? ''), executed: false, appliedCount: 0 },
        noVerification,
        noRollback,
        { requested: true, at: 'BEFORE_AGENT' },
        'CANCELLED_BEFORE_AGENT: l exécution a été annulée avant le démarrage de l agent — aucune mutation'
      );
    }

    // 1. Agent inconnu → JAMAIS success.
    const registered = this.registry.get(request.agentId);
    const agent = registered ? registered.agent : undefined;
    if (!agent) {
      recordPhase('AGENT_RESOLUTION_FAILED');
      const error = `AGENT_UNKNOWN: aucun agent enregistré avec l'identifiant '${request.agentId}'`;
      return finish(
        'FAILURE',
        stubResult(request.agentId, error),
        { requested: FILE_MUTATION_OPERATIONS.has(request.task.operation ?? ''), executed: false, appliedCount: 0 },
        noVerification,
        noRollback,
        noCancellation,
        error
      );
    }

    // 2. Capability non supportée → JAMAIS success.
    const unsupported = request.task.requiredCapabilities.filter(
      (capability) => !agent.definition.capabilities.includes(capability)
    );
    if (unsupported.length > 0) {
      recordPhase('CAPABILITY_CHECK_FAILED');
      const error = `CAPABILITY_UNSUPPORTED: l'agent '${agent.definition.id}' ne possède pas la/les capability(s) [${unsupported.join(', ')}]`;
      return finish(
        'FAILURE',
        stubResult(agent.definition.id, error),
        { requested: FILE_MUTATION_OPERATIONS.has(request.task.operation ?? ''), executed: false, appliedCount: 0 },
        noVerification,
        noRollback,
        noCancellation,
        error
      );
    }

    // 3. Exécution réelle de l'agent (exception → FAILURE + erreur propagée).
    recordPhase('AGENT_STARTED', agent.definition.id);
    let result: AgentResult;
    try {
      result = await agent.executeTask({
        task: request.task,
        context: request.context,
        tenantId: request.tenantId,
        projectId: request.projectId,
        requestId: request.requestId
      });
    } catch (err: unknown) {
      recordPhase('AGENT_EXCEPTION');
      const msg = err instanceof Error ? err.message : String(err);
      return finish(
        'FAILURE',
        stubResult(agent.definition.id, msg),
        { requested: FILE_MUTATION_OPERATIONS.has(request.task.operation ?? ''), executed: false, appliedCount: 0 },
        noVerification,
        noRollback,
        noCancellation,
        msg
      );
    }
    recordPhase('AGENT_FINISHED', result.status);

    // 4. L'agent lui-même a échoué → FAILURE réel.
    if (result.status !== 'SUCCESS') {
      const error = result.error ?? `AGENT_FAILURE: l'agent '${agent.definition.id}' a retourné ${result.status}`;
      return finish(
        'FAILURE',
        result,
        { requested: FILE_MUTATION_OPERATIONS.has(request.task.operation ?? ''), executed: false, appliedCount: 0 },
        noVerification,
        noRollback,
        noCancellation,
        error
      );
    }
    if (result.artifacts.length > 0) {
      recordPhase('ARTIFACT_PRODUCED', `${result.artifacts.length} artifact(s)`);
    }

    // 5. Tâche sans mutation de fichier (ANALYZE/VERIFY) → résultat réel seul.
    const mutationRequested = FILE_MUTATION_OPERATIONS.has(request.task.operation ?? '');
    if (!mutationRequested) {
      return finish(
        result.degraded === true ? 'DEGRADED' : 'SUCCESS',
        result,
        { requested: false, executed: false, appliedCount: 0 },
        noVerification,
        noRollback,
        noCancellation
      );
    }

    // 6. Tâche de mutation : l'agent DOIT avoir produit un artifact exploitable.
    const fileChanges = result.artifacts.filter((a) => a.kind === 'PROPOSED_FILE_CHANGE');
    if (fileChanges.length === 0) {
      recordPhase('MISSING_EXPECTED_ARTIFACT');
      const error = 'NO_EXPECTED_RESULT: la tâche exige une mutation de fichier mais l agent n a produit aucun artifact PROPOSED_FILE_CHANGE';
      return finish(
        'FAILURE',
        result,
        { requested: true, executed: false, appliedCount: 0 },
        noVerification,
        noRollback,
        noCancellation,
        error
      );
    }

    for (const artifact of fileChanges) {
      const payload = artifact.payload as { filePath?: unknown; operation?: unknown; newPath?: unknown };
      const op = payload?.operation;
      const needsNewPath = op === 'RENAME' || op === 'MOVE';
      if (
        !payload ||
        typeof payload.filePath !== 'string' ||
        payload.filePath.trim().length === 0 ||
        (typeof op !== 'string' || !['CREATE', 'UPDATE', 'DELETE', 'RENAME', 'MOVE'].includes(op)) ||
        (needsNewPath && (typeof payload.newPath !== 'string' || payload.newPath.trim().length === 0))
      ) {
        recordPhase('INVALID_ARTIFACT', artifact.id);
        const error = `INVALID_ARTIFACT: payload PROPOSED_FILE_CHANGE invalide (artifact '${artifact.id}')`;
        return finish(
          'FAILURE',
          result,
          { requested: true, executed: false, appliedCount: 0 },
          noVerification,
          noRollback,
          noCancellation,
          error
        );
      }
    }

    // 7. ÉTAPE 35 — SNAPSHOT AVANT (observé sur la source réelle).
    const affectedPaths: string[] = [];
    for (const artifact of fileChanges) {
      const payload = artifact.payload as { filePath: string; newPath?: string };
      if (!affectedPaths.includes(payload.filePath)) affectedPaths.push(payload.filePath);
      if (payload.newPath && !affectedPaths.includes(payload.newPath)) affectedPaths.push(payload.newPath);
    }
    const beforeSnapshot: BeforeSnapshotEntry[] = affectedPaths.map((path) => {
      const current = this.fileObserver.getFile(request.tenantId, request.projectId, path);
      return {
        path,
        existed: current !== null,
        ...(current !== null ? { content: current.content } : { content: undefined })
      };
    });
    recordPhase('SNAPSHOT_TAKEN', `${beforeSnapshot.length} chemin(s)`);

    // --- Point de cancellation C : entre artifact et mutation ---------------
    if (isAborted()) {
      recordPhase('CANCELLED_BEFORE_MUTATION');
      return finish(
        'CANCELLED',
        result,
        { requested: true, executed: false, appliedCount: 0 },
        noVerification,
        noRollback,
        { requested: true, at: 'BEFORE_MUTATION' },
        'CANCELLED_BEFORE_MUTATION: artifact(s) produit(s) mais annulé avant toute mutation — aucune écriture'
      );
    }

    // 8. Mutation UNIQUEMENT via le single writer existant (MutationBridge →
    // MutationOrchestratorService). Aucune écriture directe du workspace.
    recordPhase('MUTATION_STARTED');
    const mutationResult = await this.mutationBridge.applyArtifacts({
      artifacts: fileChanges,
      tenantId: request.tenantId,
      projectId: request.projectId,
      userRole: request.userRole ?? 'OWNER',
      requestId: request.requestId,
      dryRun: request.dryRun === true
    });

    const mutation: AgentExecutionMutationOutcome = {
      requested: true,
      executed: mutationResult.success,
      ...(mutationResult.transactionId !== undefined ? { transactionId: mutationResult.transactionId } : {}),
      appliedCount: mutationResult.appliedCount,
      ...(mutationResult.error !== undefined ? { error: mutationResult.error } : {})
    };

    // 9. Mutation refusée/échouée/non exécutée → FAILURE réel (É29 conservé).
    if (!mutationResult.success) {
      recordPhase('MUTATION_FAILED', mutationResult.error);
      return finish(
        'FAILURE',
        result,
        mutation,
        noVerification,
        noRollback,
        noCancellation,
        mutationResult.error ?? 'MUTATION_FAILED: la mutation n a pas été exécutée'
      );
    }
    recordPhase('MUTATION_APPLIED', `tx=${mutationResult.transactionId ?? 'n/a'} applied=${mutationResult.appliedCount}`);

    // 10. ÉTAPE 35 — VÉRIFICATION RÉELLE : observation de la source de vérité.
    recordPhase('VERIFICATION_STARTED');
    const { verification, gate: gateEvaluated } = this.verifyAgainstSource(fileChanges, beforeSnapshot, request);
    recordPhase(
      verification.passed ? 'VERIFICATION_PASSED' : 'VERIFICATION_FAILED',
      `${verification.checks.filter((c) => c.passed).length}/${verification.checks.length} contrôle(s)`
    );

    // --- Point de cancellation D : après mutation ---------------------------
    if (isAborted()) {
      // Comportement déterministe : la mutation a RÉELLEMENT eu lieu → on ne
      // prétend jamais l'annuler : rollback réel + restauration vérifiée.
      recordPhase('CANCELLED_AFTER_MUTATION');
      const afterMutationRollback = await this.rollbackAndVerify(
        request,
        mutationResult.transactionId,
        beforeSnapshot
      );
      if (afterMutationRollback.verified) {
        return finish(
          'CANCELLED',
          result,
          mutation,
          verification,
          afterMutationRollback,
          { requested: true, at: 'AFTER_MUTATION' },
          'CANCELLED_AFTER_MUTATION: mutation réellement appliquée puis ROLLBACK réel vérifié — état initial restauré'
        );
      }
      return finish(
        'FAILED_ROLLBACK',
        result,
        mutation,
        verification,
        afterMutationRollback,
        { requested: true, at: 'AFTER_MUTATION' },
        afterMutationRollback.error ?? 'FAILED_ROLLBACK: restauration impossible après cancellation'
      );
    }

    // 11. Vérification réussie → commit final effectif (SUCCESS honnête).
    if (verification.passed) {
      return finish(
        result.degraded === true ? 'DEGRADED' : 'SUCCESS',
        result,
        mutation,
        verification,
        noRollback,
        noCancellation,
        undefined,
        { gate: gateEvaluated }
      );
    }

    // 12. ÉTAPE 36 — GATE_FAILED : le gate a échoué. Selon la politique
    // (OPT-IN, désactivée par défaut → comportement É35 conservé) :
    // classification → RepairPlan → safety checks → UNE tentative bornée
    // (rollback réel → réapplication → re-Gate) → verdict final.
    const gateFailed: GateResult = gateEvaluated;
    recordPhase('GATE_FAILED', verification.error);

    const repairPolicy = request.repairPolicy;
    if (repairPolicy?.enabled !== true) {
      // Comportement É35 inchangé (aucune politique de réparation).
      const rollbackOutcome = await this.rollbackAndVerify(request, mutationResult.transactionId, beforeSnapshot);
      if (rollbackOutcome.verified) {
        return finish(
          'ROLLED_BACK',
          result,
          mutation,
          verification,
          rollbackOutcome,
          noCancellation,
          `VERIFICATION_FAILED_ROLLED_BACK: ${verification.error ?? 'la source ne correspond pas a l artifact'} — rollback réel vérifié`,
          { gate: gateFailed }
        );
      }
      return finish(
        'FAILED_ROLLBACK',
        result,
        mutation,
        verification,
        rollbackOutcome,
        noCancellation,
        `FAILED_ROLLBACK: vérification échouée ET restauration impossible — ${rollbackOutcome.error ?? 'raison inconnue'}`,
        { gate: gateFailed }
      );
    }

    // --- Cycle de réparation borné (maxAttempts = 1 par défaut) -------------
    const maxAttempts = repairPolicy.maxAttempts ?? 1;
    const attempt = 0;
    const reason = classifyGateFailure({
      gate: gateFailed,
      mutationExecuted: mutationResult.success,
      ...(mutationResult.error !== undefined ? { mutationError: mutationResult.error } : {}),
      cancelled: false
    });
    const plan = buildRepairPlan({
      executionId: request.executionId,
      attempt: attempt + 1,
      reason,
      detail: verification.error ?? 'gate échoué',
      targetPaths: fileChanges.map((a) => (a.payload as { filePath: string }).filePath),
      maxAttempts
    });

    if (!isRepairSupported({ reason, fileChanges })) {
      recordPhase('REPAIR_UNSUPPORTED', reason);
      const rollbackOutcome = await this.rollbackAndVerify(request, mutationResult.transactionId, beforeSnapshot);
      const repairSummary = {
        planned: true,
        reason,
        repairId: plan.repairId,
        attempted: false,
        attemptsUsed: 0,
        rolledBack: rollbackOutcome.verified,
        rollbackVerified: rollbackOutcome.verified,
        cancelled: false,
        error: 'REPAIR_UNSUPPORTED: cas de réparation non supporté'
      };
      if (rollbackOutcome.verified) {
        return finish(
          'ROLLED_BACK',
          result,
          mutation,
          verification,
          rollbackOutcome,
          noCancellation,
          'REPAIR_UNSUPPORTED: cas non supporté — rollback réel de sécurité, aucun faux succès',
          { gate: gateFailed, repair: repairSummary }
        );
      }
      return finish(
        'FAILED_ROLLBACK',
        result,
        mutation,
        verification,
        rollbackOutcome,
        noCancellation,
        'REPAIR_UNSUPPORTED + restauration impossible — état non garanti',
        { gate: gateFailed, repair: repairSummary }
      );
    }

    recordPhase('REPAIR_PLANNED', plan.repairId + ' (' + reason + ')');
    const repairService = new FileRepairService(this.mutationBridge);
    const agentCapabilities = registered ? registered.capabilities : undefined;

    // Safety checks AVANT toute action.
    const refusal = repairService.safetyCheck({
      plan,
      executionId: request.executionId,
      tenantId: request.tenantId,
      projectId: request.projectId,
      attempt,
      fileChanges,
      resolvedAgentCapabilities: agentCapabilities
    });
    if (refusal) {
      recordPhase('REPAIR_REFUSED', refusal);
      const rollbackOutcome = await this.rollbackAndVerify(request, mutationResult.transactionId, beforeSnapshot);
      const repairSummary = {
        planned: true,
        reason,
        repairId: plan.repairId,
        attempted: false,
        attemptsUsed: 0,
        rolledBack: rollbackOutcome.verified,
        rollbackVerified: rollbackOutcome.verified,
        cancelled: false,
        error: refusal
      };
      if (rollbackOutcome.verified) {
        return finish('ROLLED_BACK', result, mutation, verification, rollbackOutcome, noCancellation, refusal, { gate: gateFailed, repair: repairSummary });
      }
      return finish('FAILED_ROLLBACK', result, mutation, verification, rollbackOutcome, noCancellation, refusal + ' + restauration impossible', { gate: gateFailed, repair: repairSummary });
    }

    // Réparation bornée : rollback réel → réapplication unique → re-Gate.
    recordPhase('REPAIR_STARTED', plan.repairId);
    const repairOutcome: RepairOutcome = await repairService.execute({
      plan,
      context: {
        executionId: request.executionId,
        tenantId: request.tenantId,
        projectId: request.projectId,
        ...(request.userRole !== undefined ? { userRole: request.userRole } : {}),
        ...(request.requestId !== undefined ? { requestId: request.requestId } : {}),
        fileChanges,
        beforeSnapshot,
        ...(mutationResult.transactionId !== undefined ? { transactionId: mutationResult.transactionId } : {}),
        failedGate: gateFailed,
        fileObserver: this.fileObserver,
        isAborted
      },
      bridge: this.mutationBridge,
      ...(request.userRole !== undefined ? { userRole: request.userRole } : {}),
      ...(request.requestId !== undefined ? { requestId: request.requestId } : {})
    });

    // Cancellation pendant la réparation → état restauré + CANCELLED honnête.
    if (repairOutcome.cancelled) {
      recordPhase('REPAIR_CANCELLED', repairOutcome.error);
      return finish(
        'CANCELLED',
        result,
        mutation,
        verification,
        {
          performed: repairOutcome.rolledBack,
          verified: repairOutcome.rollbackVerified,
          restoredFiles: [],
          ...(repairOutcome.error !== undefined ? { error: repairOutcome.error } : {})
        },
        { requested: true, at: 'AFTER_MUTATION' },
        repairOutcome.error ?? 'REPAIR_CANCELLED',
        {
          gate: gateFailed,
          repair: {
            planned: true, reason, repairId: plan.repairId, attempted: repairOutcome.performed,
            attemptsUsed: repairOutcome.attemptsUsed, rolledBack: repairOutcome.rolledBack,
            rollbackVerified: repairOutcome.rollbackVerified, cancelled: true,
            ...(repairOutcome.error !== undefined ? { error: repairOutcome.error } : {})
          }
        }
      );
    }

    // Re-Gate : PASS → COMMITTED effectif (SUCCESS honnête, fait réel vérifié).
    if (repairOutcome.gateAfter?.passed === true) {
      recordPhase('REPAIR_COMPLETED', 'gateAfter=PASS');
      return finish(
        result.degraded === true ? 'DEGRADED' : 'SUCCESS',
        result,
        mutation,
        {
          performed: true,
          passed: true,
          checks: repairOutcome.gateAfter.checks
        },
        noRollback,
        noCancellation,
        undefined,
        {
          gate: repairOutcome.gateAfter,
          repair: {
            planned: true, reason, repairId: plan.repairId, attempted: true,
            attemptsUsed: repairOutcome.attemptsUsed, gateAfterPassed: true,
            rolledBack: repairOutcome.rolledBack, rollbackVerified: repairOutcome.rollbackVerified,
            cancelled: false
          }
        }
      );
    }

    // Re-Gate FAIL ou réapplication échouée → verdict final honnête
    // (rollback final + vérification). AUCUN second repair (anti-boucle).
    recordPhase('REPAIR_FAILED', repairOutcome.error ?? repairOutcome.gateAfter?.reason);
    const finalRollback = await this.rollbackAndVerify(request, mutationResult.transactionId, beforeSnapshot);
    const repairSummaryFailed = {
      planned: true, reason, repairId: plan.repairId, attempted: repairOutcome.performed,
      attemptsUsed: repairOutcome.attemptsUsed,
      ...(repairOutcome.gateAfter !== undefined ? { gateAfterPassed: repairOutcome.gateAfter.passed } : {}),
      rolledBack: finalRollback.verified || repairOutcome.rollbackVerified,
      rollbackVerified: finalRollback.verified,
      cancelled: false,
      ...(repairOutcome.error !== undefined ? { error: repairOutcome.error } : {})
    };
    if (finalRollback.verified) {
      return finish(
        'ROLLED_BACK',
        result,
        mutation,
        verification,
        finalRollback,
        noCancellation,
        `REPAIR_THEN_ROLLED_BACK: la réparation n a pas rétabli un état conforme — rollback réel vérifié`,
        { gate: gateFailed, repair: repairSummaryFailed }
      );
    }
    return finish(
      'FAILED_ROLLBACK',
      result,
      mutation,
      verification,
      finalRollback,
      noCancellation,
      `FAILED_ROLLBACK: réparation échouée ET restauration impossible — ${finalRollback.error ?? 'raison inconnue'}`,
      { gate: gateFailed, repair: repairSummaryFailed }
    );
  }

  /**
   * ÉTAPE 35/36 — vérification RÉELLE déléguée au gate unique
   * (FILE_MUTATION_GATE) : UNE seule implémentation des contrôles, utilisée
   * par la première vérification ET par le re-Gate de la réparation.
   */
  private evaluateGate(
    fileChanges: readonly AgentArtifact[],
    beforeSnapshot: readonly BeforeSnapshotEntry[],
    request: AgentExecutionRequest
  ): GateResult {
    return evaluateFileMutationGate({
      executionId: request.executionId,
      tenantId: request.tenantId,
      projectId: request.projectId,
      fileChanges,
      beforeSnapshot,
      fileObserver: this.fileObserver
    });
  }

  private verifyAgainstSource(
    fileChanges: readonly AgentArtifact[],
    beforeSnapshot: readonly BeforeSnapshotEntry[],
    request: AgentExecutionRequest
  ): { verification: AgentExecutionVerification; gate: GateResult } {
    const gate = this.evaluateGate(fileChanges, beforeSnapshot, request);
    return {
      gate,
      verification: {
        performed: true,
        passed: gate.passed,
        checks: gate.checks,
        ...(gate.reason !== undefined ? { error: gate.reason } : {})
      }
    };
  }

  /**
   * ÉTAPE 35 — rollback RÉEL via le single writer + VÉRIFICATION de la
   * restauration contre le snapshot avant-mutation.
   */
  private async rollbackAndVerify(
    request: AgentExecutionRequest,
    transactionId: string | undefined,
    beforeSnapshot: readonly BeforeSnapshotEntry[]
  ): Promise<AgentExecutionRollback> {
    if (!transactionId) {
      return {
        performed: false,
        verified: false,
        restoredFiles: [],
        error: 'ROLLBACK_IMPOSSIBLE: aucun identifiant de transaction'
      };
    }

    const rollbackResult = this.mutationBridge.rollbackTransaction({
      transactionId,
      tenantId: request.tenantId,
      projectId: request.projectId,
      userRole: request.userRole ?? 'OWNER',
      requestId: request.requestId
    });

    if (!rollbackResult.success) {
      return {
        performed: true,
        verified: false,
        restoredFiles: rollbackResult.restoredFiles,
        error: rollbackResult.error ?? 'ROLLBACK_FAILED: la restauration a échoué'
      };
    }

    // Vérification RÉELLE de la restauration : la source doit correspondre
    // EXACTEMENT au snapshot avant-mutation.
    const mismatches: string[] = [];
    for (const entry of beforeSnapshot) {
      const current = this.fileObserver.getFile(request.tenantId, request.projectId, entry.path);
      if (entry.existed) {
        if (current === null || current.content !== entry.content) {
          mismatches.push(`${entry.path} (contenu d'origine non restauré)`);
        }
      } else if (current !== null) {
        mismatches.push(`${entry.path} (devrait être absent)`);
      }
    }

    if (mismatches.length > 0) {
      return {
        performed: true,
        verified: false,
        restoredFiles: rollbackResult.restoredFiles,
        error: `ROLLBACK_NOT_VERIFIED: état restauré différent de l'état initial — ${mismatches.join(', ')}`
      };
    }

    return {
      performed: true,
      verified: true,
      restoredFiles: rollbackResult.restoredFiles
    };
  }
}
