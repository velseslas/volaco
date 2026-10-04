/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * ÉTAPE 32 — Contrat réel d'exécution d'agent (Agent Execution Contract)
 *
 * Pipeline : sélection par agentId → vérification de capabilities → exécution
 * de l'agent (type existant BaseSpecializedAgent) → artifacts réels →
 * mutation OBLIGATOIREMENT via MutationBridge/MutationOrchestratorService
 * (single writer, jamais d'écriture directe du workspace) → statut honnête.
 *
 * Aucune réussite déclarative : SUCCESS n'est retourné que si l'agent a
 * réellement produit le résultat attendu ET que la mutation demandée a été
 * réellement exécutée (transaction COMMITTED). Tout le reste est FAILURE
 * avec l'erreur réelle propagée.
 */

import { deepFreeze } from '../canonical.js';
import { auditStore } from '../../../observability/audit.js';
import type { Role } from '../../../identity/permissions.js';
import { assertPermission } from '../../../identity/permissions.js';
import type { BaseSpecializedAgent } from '../agents/base-agent.js';
import type { MutationBridge } from '../engine/mutation-bridge.js';
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
  /** Quel agent exécute — résolu dans le roster de l'orchestrateur (par ID). */
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

export type AgentExecutionStatus = 'SUCCESS' | 'FAILURE' | 'DEGRADED';

export interface AgentExecutionOutcome {
  readonly executionId: string;
  readonly agentId: string;
  readonly taskId: string;
  /** Statut honnête de l'exécution (niveau contrat É32). */
  readonly status: AgentExecutionStatus;
  /** Résultat réel de l'agent (type existant — statuts orchestrator conservés). */
  readonly result: AgentResult;
  readonly artifacts: readonly AgentArtifact[];
  readonly mutation: AgentExecutionMutationOutcome;
  readonly error?: string | undefined;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

/** Opérations de tâche qui exigent une mutation de fichier réelle. */
const FILE_MUTATION_OPERATIONS: ReadonlySet<string> = new Set(['CREATE', 'MODIFY', 'DELETE']);

// ---------------------------------------------------------------------------
// Service d'exécution
// ---------------------------------------------------------------------------

export class AgentExecutionService {
  /**
   * Index par ID sur le roster d'agents de l'orchestrateur — les MÊMES
   * instances que le scheduler (aucun deuxième registry : ce n'est qu'une
   * vue par identifiant pour l'exécution unitaire).
   */
  private readonly agentsById = new Map<string, BaseSpecializedAgent>();

  constructor(
    agents: readonly BaseSpecializedAgent[],
    private readonly mutationBridge: MutationBridge
  ) {
    for (const agent of agents) {
      this.agentsById.set(agent.definition.id, agent);
    }
  }

  /**
   * Enregistre un agent supplémentaire dans le roster de l'orchestrateur
   * (ex : reference-agent). Prévention stricte de doublon.
   */
  public registerAgent(agent: BaseSpecializedAgent): void {
    if (this.agentsById.has(agent.definition.id)) {
      throw new Error(`Agent déjà enregistré : '${agent.definition.id}'`);
    }
    this.agentsById.set(agent.definition.id, agent);
  }

  public has(agentId: string): boolean {
    return this.agentsById.has(agentId);
  }

  public listAgentIds(): readonly string[] {
    return Array.from(this.agentsById.keys()).sort();
  }

  /**
   * Exécute UN agent sur UNE tâche selon le contrat honnête.
   */
  public async execute(request: AgentExecutionRequest): Promise<AgentExecutionOutcome> {
    assertPermission(request.userRole ?? 'OWNER', 'PROJECT_READ', request.requestId);

    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    const finish = (
      status: AgentExecutionStatus,
      result: AgentResult,
      mutation: AgentExecutionMutationOutcome,
      error?: string | undefined
    ): AgentExecutionOutcome => {
      const completedAt = new Date().toISOString();
      const outcome: AgentExecutionOutcome = {
        executionId: request.executionId,
        agentId: result.agentId,
        taskId: request.task.id,
        status,
        result,
        artifacts: result.artifacts,
        mutation,
        ...(error !== undefined ? { error } : {}),
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
        status: status === 'FAILURE' ? 'FAILURE' : 'SUCCESS',
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
          error: error ?? null
        },
        requestId: request.requestId || 'req_agent_execution'
      });
      return deepFreeze(outcome);
    };

    const failureMutation: AgentExecutionMutationOutcome = {
      requested: FILE_MUTATION_OPERATIONS.has(request.task.operation ?? ''),
      executed: false,
      appliedCount: 0
    };

    // 1. Agent inconnu → JAMAIS success.
    const agent = this.agentsById.get(request.agentId);
    if (!agent) {
      return finish(
        'FAILURE',
        {
          taskId: request.task.id,
          agentId: request.agentId,
          status: 'FAILURE',
          artifacts: [],
          conflicts: [],
          tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          durationMs: 0,
          error: `AGENT_UNKNOWN: aucun agent enregistré avec l'identifiant '${request.agentId}'`
        },
        failureMutation,
        `AGENT_UNKNOWN: aucun agent enregistré avec l'identifiant '${request.agentId}'`
      );
    }

    // 2. Capability non supportée → JAMAIS success.
    const unsupported = request.task.requiredCapabilities.filter(
      (capability) => !agent.definition.capabilities.includes(capability)
    );
    if (unsupported.length > 0) {
      const error = `CAPABILITY_UNSUPPORTED: l'agent '${agent.definition.id}' ne possède pas la/les capability(s) [${unsupported.join(', ')}]`;
      return finish(
        'FAILURE',
        {
          taskId: request.task.id,
          agentId: agent.definition.id,
          status: 'FAILURE',
          artifacts: [],
          conflicts: [],
          tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          durationMs: 0,
          error
        },
        failureMutation,
        error
      );
    }

    // 3. Exécution réelle de l'agent (exception → FAILURE + erreur propagée).
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
      const msg = err instanceof Error ? err.message : String(err);
      return finish(
        'FAILURE',
        {
          taskId: request.task.id,
          agentId: agent.definition.id,
          status: 'FAILURE',
          artifacts: [],
          conflicts: [],
          tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          durationMs: 0,
          error: msg
        },
        failureMutation,
        msg
      );
    }

    // 4. L'agent lui-même a échoué → FAILURE réel.
    if (result.status !== 'SUCCESS') {
      const error = result.error ?? `AGENT_FAILURE: l'agent '${agent.definition.id}' a retourné ${result.status}`;
      return finish('FAILURE', result, failureMutation, error);
    }

    // 5. Tâche sans mutation de fichier (ANALYZE/VERIFY) → résultat réel seul.
    const mutationRequested = FILE_MUTATION_OPERATIONS.has(request.task.operation ?? '');
    if (!mutationRequested) {
      return finish(
        result.degraded === true ? 'DEGRADED' : 'SUCCESS',
        result,
        { requested: false, executed: false, appliedCount: 0 }
      );
    }

    // 6. Tâche de mutation : l'agent DOIT avoir produit un artifact exploitable.
    const fileChanges = result.artifacts.filter((a) => a.kind === 'PROPOSED_FILE_CHANGE');
    if (fileChanges.length === 0) {
      const error = 'NO_EXPECTED_RESULT: la tâche exige une mutation de fichier mais l agent n a produit aucun artifact PROPOSED_FILE_CHANGE';
      return finish(
        'FAILURE',
        result,
        { requested: true, executed: false, appliedCount: 0 },
        error
      );
    }

    for (const artifact of fileChanges) {
      const payload = artifact.payload as { filePath?: unknown; operation?: unknown };
      if (
        !payload ||
        typeof payload.filePath !== 'string' ||
        payload.filePath.trim().length === 0 ||
        typeof payload.operation !== 'string' ||
        !['CREATE', 'UPDATE', 'DELETE'].includes(payload.operation)
      ) {
        const error = `INVALID_ARTIFACT: payload PROPOSED_FILE_CHANGE invalide (artifact '${artifact.id}')`;
        return finish(
          'FAILURE',
          result,
          { requested: true, executed: false, appliedCount: 0 },
          error
        );
      }
    }

    // 7. Mutation UNIQUEMENT via le single writer existant (MutationBridge →
    // MutationOrchestratorService). Aucune écriture directe du workspace.
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

    // 8. Mutation refusée/échouée/non exécutée → FAILURE réel (É29 conservé).
    if (!mutationResult.success) {
      return finish(
        'FAILURE',
        result,
        mutation,
        mutationResult.error ?? 'MUTATION_FAILED: la mutation n a pas été exécutée'
      );
    }

    return finish(result.degraded === true ? 'DEGRADED' : 'SUCCESS', result, mutation);
  }
}
