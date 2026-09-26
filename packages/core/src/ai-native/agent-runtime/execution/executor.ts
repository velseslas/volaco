/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Plan Executor
 */

import { logger } from '../../../logger.js';
import type { AgentPlan, AgentStep } from '../types.js';
import type { ToolRegistry, ToolExecutionContext } from '../tools/registry.js';
import type { MutationOrchestratorService } from '../../mutation-orchestrator/service.js';
import type { MutationPlan } from '../../mutation-orchestrator/types.js';
import type { VerificationEngine, VerificationResult } from './verification.js';
import type { RepairEngine } from './repair.js';
import type { BudgetTracker } from '../reasoning/budget.js';

export interface PlanExecutionSummary {
  readonly success: boolean;
  readonly executedSteps: readonly AgentStep[];
  readonly transactionId?: string | undefined;
  readonly verification?: VerificationResult | undefined;
  readonly error?: string | undefined;
}

import type { SemanticCodeGraphService } from '../../semantic-graph/service.js';

export class PlanExecutor {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly verificationEngine: VerificationEngine,
    private readonly repairEngine: RepairEngine,
    private readonly mutationService?: MutationOrchestratorService | undefined,
    private readonly semanticGraphService?: SemanticCodeGraphService | undefined
  ) {}

  public async executePlan(
    plan: AgentPlan,
    budgetTracker: BudgetTracker,
    context: ToolExecutionContext
  ): Promise<PlanExecutionSummary> {
    const executedSteps: AgentStep[] = [];
    let transactionId: string | undefined;
    const modifiedFiles: string[] = [];

    for (const step of plan.steps) {
      budgetTracker.recordToolCall();

      if (step.tool === 'execute_mutation') {
        // STRICT RULE 2 & 3: Delegate mutation exclusively to AINT-006 Mutation Orchestrator
        if (!this.mutationService) {
          const failedStep: AgentStep = {
            id: step.id,
            index: step.index,
            description: step.description,
            tool: step.tool,
            parameters: step.parameters,
            expectedOutput: step.expectedOutput,
            status: 'FAILED',
            error: 'Service de mutation (AINT-006) non configure dans le runtime'
          };
          executedSteps.push(failedStep);
          return {
            success: false,
            executedSteps,
            error: failedStep.error
          };
        }

        try {
          let planPayload = step.parameters.plan as MutationPlan | undefined;
          if (!planPayload || !planPayload.mutations) {
            let baseGraphHash = 'mock-graph-hash';
            if (this.semanticGraphService) {
              try {
                const g = this.semanticGraphService.buildGraph(
                  { tenantId: context.tenantId, projectId: context.projectId },
                  context.userRole,
                  context.requestId
                );
                baseGraphHash = g.graphHash;
              } catch (err) {
                logger.warn('Échec du calcul du hash du graphe de plan — fallback sur valeur par défaut', {
                  component: 'plan-executor',
                  err: err instanceof Error ? err.message : String(err)
                });
              }
            }

            const isDelete = plan.goal.toLowerCase().includes('supprimer') || plan.goal.toLowerCase().includes('delete') || plan.risks.some((r) => r.includes('Perte') || r.includes('Suppression'));
            const kind = isDelete ? ('DELETE_FILE' as const) : ('UPDATE_FILE' as const);

            planPayload = this.mutationService.createPlan({
              tenantId: context.tenantId,
              projectId: context.projectId,
              baseGraphHash,
              mutations: plan.expectedChanges.map((path, idx) => ({
                mutationId: `mut-${idx + 1}`,
                kind,
                target: path,
                preconditions: [],
                operation: { path, content: isDelete ? undefined : '// updated by agent runtime\n' },
                expectedOutcome: isDelete ? `Delete ${path}` : `Update ${path}`,
                evidence: []
              }))
            }, context.userRole, context.requestId);
          }

          const mutResult = await this.mutationService.executePlan(
            planPayload,
            { dryRun: false, allowBreaking: true, allowHighRisk: true },
            context.userRole,
            context.requestId
          );

          transactionId = mutResult.transaction.transactionId;
          modifiedFiles.push(...plan.expectedChanges);

          const completedStep: AgentStep = {
            id: step.id,
            index: step.index,
            description: step.description,
            tool: step.tool,
            parameters: step.parameters,
            expectedOutput: step.expectedOutput,
            status: 'COMPLETED',
            result: mutResult
          };
          executedSteps.push(completedStep);
        } catch (mutErr) {
          const msg = mutErr instanceof Error ? mutErr.message : String(mutErr);
          const failedStep: AgentStep = {
            id: step.id,
            index: step.index,
            description: step.description,
            tool: step.tool,
            parameters: step.parameters,
            expectedOutput: step.expectedOutput,
            status: 'FAILED',
            error: msg
          };
          executedSteps.push(failedStep);
          return {
            success: false,
            executedSteps,
            error: msg
          };
        }
      } else {
        // Standard tool execution
        const toolRes = await this.toolRegistry.execute(step.tool, step.parameters, context);
        if (!toolRes.success) {
          const failedStep: AgentStep = {
            id: step.id,
            index: step.index,
            description: step.description,
            tool: step.tool,
            parameters: step.parameters,
            expectedOutput: step.expectedOutput,
            status: 'FAILED',
            error: toolRes.error
          };
          executedSteps.push(failedStep);
          return {
            success: false,
            executedSteps,
            error: toolRes.error
          };
        }

        const completedStep: AgentStep = {
          id: step.id,
          index: step.index,
          description: step.description,
          tool: step.tool,
          parameters: step.parameters,
          expectedOutput: step.expectedOutput,
          status: 'COMPLETED',
          result: toolRes.output
        };
        executedSteps.push(completedStep);
      }
    }

    // Post-execution verification
    let verification: VerificationResult = { passed: true, errors: [], diagnostics: [] };
    if (modifiedFiles.length > 0) {
      verification = await this.verificationEngine.verifyProject(
        context.tenantId,
        context.projectId,
        modifiedFiles,
        context.userRole
      );

      if (!verification.passed) {
        // Attempt autonomous repair loop
        const repairOutcome = await this.repairEngine.attemptRepair(
          verification,
          transactionId,
          budgetTracker,
          context.userRole
        );

        if (!repairOutcome.repaired) {
          return {
            success: false,
            executedSteps,
            transactionId,
            verification,
            error: repairOutcome.error ?? 'La verification post-mutation a echoue'
          };
        }
      }
    }

    return {
      success: true,
      executedSteps,
      transactionId,
      verification
    };
  }
}
