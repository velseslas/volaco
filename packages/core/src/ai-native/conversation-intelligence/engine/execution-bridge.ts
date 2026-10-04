/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Execution Bridge (AINT-007 / AINT-006 Delegation)
 */

import { ValidationError } from '../../../errors.js';
import type { Role } from '../../../identity/permissions.js';
import type { AgentRuntimeService } from '../../agent-runtime/service.js';
import type { MutationOrchestratorService } from '../../mutation-orchestrator/service.js';
import type { ConversationSession, ConversationState, EngineeringPlan } from '../types.js';
import { routeIntentToAgent } from './intent-router.js';

/**
 * ÉTAPE 33 — exécuteur d'agent (contrat É32) injectable. Type structurel
 * minimal : le serveur attache l'AgentExecutionService de l'orchestrateur
 * (source unique — aucun deuxième runtime ni registry).
 */
export interface ConversationAgentExecutor {
  /** ÉTAPE 34 — accès au Registry (source unique de résolution des agents). */
  getRegistry(): import('../../ai-orchestrator/registry/agent-registry.js').AgentRegistryService;
  execute(request: {
    executionId: string;
    agentId: string;
    task: import('../../ai-orchestrator/types.js').AgentTask;
    context: import('../../ai-orchestrator/types.js').TaskContextPayload;
    tenantId: string;
    projectId: string;
    userRole?: Role | undefined;
    requestId?: string | undefined;
  }): Promise<import('../../ai-orchestrator/execution/agent-execution.js').AgentExecutionOutcome>;
}

export interface ExecutionResult {
  readonly success: boolean;
  readonly executedSteps: number;
  readonly message: string;
  readonly error?: string | undefined;
}

export class ExecutionBridge {
  private agentExecutor?: ConversationAgentExecutor | undefined;

  constructor(
    private readonly agentRuntime?: AgentRuntimeService | undefined,
    private readonly mutationService?: MutationOrchestratorService | undefined
  ) {}

  /**
   * ÉTAPE 33 — attache l'exécuteur d'agents (AgentExecutionService É32).
   * Une fois attaché, l'exécution d'un plan approuvé passe par le routage
   * déterministe intention → agent ; sans exécuteur, le chemin historique
   * (Agent Runtime, contrat É29/É31) est conservé à l'identique.
   */
  public setAgentExecutor(executor: ConversationAgentExecutor): void {
    this.agentExecutor = executor;
  }

  public canExecute(plan: EngineeringPlan, state: ConversationState): boolean {
    if (plan.status === 'REJECTED' || plan.status === 'FAILED') {
      return false;
    }
    const validStates: ConversationState[] = ['PLANNING', 'WAITING_CONFIRMATION', 'EXECUTING'];
    return validStates.includes(state);
  }

  public async executePlan(
    plan: EngineeringPlan,
    session: ConversationSession,
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): Promise<ExecutionResult> {
    if (!this.canExecute(plan, session.currentState)) {
      throw new ValidationError(
        `Impossible d'exécuter le plan '${plan.planId}' dans l'état '${session.currentState}' (Statut plan: '${plan.status}')`
      );
    }

    // ÉTAPE 33 — chemin ROUTÉ : intention → agentId → AgentExecutionService
    // (contrat É32 honnête). Utilisé UNIQUEMENT quand un exécuteur est
    // attaché (serveur / tests dédiés) ; sinon chemin legacy ci-dessous.
    if (this.agentExecutor) {
      const lastTurn = session.turns[session.turns.length - 1];
      const route = routeIntentToAgent({
        intent: session.activeIntent,
        userMessage: lastTurn?.userMessage.content ?? '',
        sessionId: session.sessionId,
        planId: plan.planId,
        registry: this.agentExecutor.getRegistry()
      });

      if (!route.supported) {
        return {
          success: false,
          executedSteps: 0,
          message: route.reason ?? 'UNSUPPORTED_INTENT',
          error: route.reason ?? 'UNSUPPORTED_INTENT: intention non routable vers un agent'
        };
      }

      try {
        const outcome = await this.agentExecutor.execute({
          executionId: route.executionId,
          agentId: route.agentId!,
          task: route.task!,
          context: route.context!,
          tenantId: session.tenantId,
          projectId: session.projectId,
          userRole,
          requestId
        });

        if (outcome.status === 'SUCCESS' || outcome.status === 'DEGRADED') {
          // Le contrat É32 garantit : mutation réellement COMMITTED (ou tâche
          // sans mutation), artifacts réels. Le statut DEGRADED reste marqué.
          return {
            success: true,
            executedSteps: 1,
            message:
              `Plan exécuté via l'agent '${outcome.agentId}' (executionId: ${outcome.executionId}, ` +
              `mutation: ${outcome.mutation.executed ? `COMMITTED tx=${outcome.mutation.transactionId ?? 'n/a'} applied=${outcome.mutation.appliedCount}` : 'non requise'}` +
              `${outcome.status === 'DEGRADED' ? ', contenu dégradé' : ''}).`
          };
        }
        return {
          success: false,
          executedSteps: 0,
          message: `L'agent '${outcome.agentId}' a échoué (executionId: ${outcome.executionId}).`,
          error: outcome.error ?? `AGENT_EXECUTION_${outcome.status}`
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          executedSteps: 0,
          message: `Échec de l'exécution de l'agent (executionId: ${route.executionId}).`,
          error: msg
        };
      }
    }

    if (this.agentRuntime) {
      // P2 — EXÉCUTION RÉELLE (fin de la délégation simulée) : le plan est
      // exécuté par le runtime (autoExecutePlan), et le résultat rapporté
      // EST celui du run — plus jamais un succès déclaratif. Un run non
      // COMPLETED = success:false avec la raison du run.
      try {
        const run = await this.agentRuntime.startRun({
          tenantId: session.tenantId,
          projectId: session.projectId,
          userInput: plan.summary,
          userRole,
          requestId,
          autoExecutePlan: true
        });
        const runState = run.state;
        const executed = run.plan?.steps.length ?? 0;

        // É29/PROBLÈME B — le statut du run ne vaut succès du plan que si les
        // opérations sur fichiers demandées par le plan ont RÉELLEMENT été
        // exécutées. Un run « COMPLETED » qui n'a exécuté aucune mutation
        // alors que le plan demande des créations/modifications/suppressions
        // de fichiers est un faux succès (le runtime a replanifié son propre
        // plan template, sans les écritures demandées) → échec explicite.
        const planRequiresFileOps = plan.steps.some(
          (s) => s.operation !== 'ANALYZE' && Array.isArray(s.targetFiles) && s.targetFiles.length > 0
        );
        const mutationExecuted = (run.plan?.steps ?? []).some(
          (st) => st.tool === 'execute_mutation' && st.status === 'COMPLETED'
        );

        if (runState === 'COMPLETED') {
          if (planRequiresFileOps && !mutationExecuted) {
            const requestedOps = plan.steps.filter(
              (s) => s.operation !== 'ANALYZE' && Array.isArray(s.targetFiles) && s.targetFiles.length > 0
            ).length;
            return {
              success: false,
              executedSteps: executed,
              message: `MUTATION_UNSUPPORTED: le run '${run.id}' s'est terminé sans exécuter la moindre mutation de fichier alors que le plan '${plan.planId}' en demande ${requestedOps} — aucune écriture effectuée.`,
              error: 'MUTATION_UNSUPPORTED: opérations sur fichiers demandées par le plan non exécutées (aucune mutation exécutée par le run)'
            };
          }
          return {
            success: true,
            executedSteps: executed,
            message: `Plan exécuté par l'Agent Runtime (${executed} étape(s), Run ID: ${run.id}).`
          };
        }
        return {
          success: false,
          executedSteps: executed,
          message: `Le run de l'Agent Runtime s'est arrêté à l'état ${runState}.`,
          error: run.error
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          executedSteps: 0,
          message: `Échec de l'exécution du plan via Agent Runtime.`,
          error: msg
        };
      }
    }

    // É29/PROBLÈME B — plus de succès déclaratif : sans Agent Runtime, rien
    // n'a été exécuté → échec explicite (unsupported).
    return {
      success: false,
      executedSteps: 0,
      message: `MUTATION_UNSUPPORTED: Agent Runtime non configuré — le plan '${plan.planId}' n'a pas été exécuté.`,
      error: 'MUTATION_UNSUPPORTED: Agent Runtime non configuré'
    };
  }
}
