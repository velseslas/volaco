/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Execution Bridge (AINT-007 / AINT-006 Delegation)
 */

import { ValidationError } from '../../../errors.js';
import type { Role } from '../../../identity/permissions.js';
import type { AgentRuntimeService } from '../../agent-runtime/service.js';
import type { MutationOrchestratorService } from '../../mutation-orchestrator/service.js';
import type { ConversationSession, ConversationState, EngineeringPlan } from '../types.js';

export interface ExecutionResult {
  readonly success: boolean;
  readonly executedSteps: number;
  readonly message: string;
  readonly error?: string | undefined;
}

export class ExecutionBridge {
  constructor(
    private readonly agentRuntime?: AgentRuntimeService | undefined,
    private readonly mutationService?: MutationOrchestratorService | undefined
  ) {}

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
        if (runState === 'COMPLETED') {
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

    return {
      success: true,
      executedSteps: plan.steps.length,
      message: `Plan '${plan.planId}' validé et préparé pour exécution (${plan.steps.length} étapes).`
    };
  }
}
