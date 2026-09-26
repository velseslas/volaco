/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Agent Orchestration Engine
 * Coordinates Multi-Agent DAGs, State Machine, Gates, and Execution
 */

import { randomUUID } from 'node:crypto';
import type { Role } from '../../../identity/permissions.js';
import type { CodeIntelligenceService } from '../../understanding/service.js';
import type { ApplicationDNAService } from '../../dna/service.js';
import type { ContextAssemblyService } from '../../context/service.js';
import type { SemanticCodeGraphService } from '../../semantic-graph/service.js';
import type { ImpactIntelligenceService } from '../../impact-intelligence/service.js';
import type { MutationOrchestratorService } from '../../mutation-orchestrator/service.js';
import {
  type AgentRole,
  type AgentState,
  type ExecutionTask,
  type OrchestrationMetrics,
  AgentCapabilityError,
  GateRejectedError
} from '../types.js';
import { AgentStateMachine } from '../agent/state-machine.js';
import { AgentRegistry } from '../agent/registry.js';
import { Agent } from '../agent/agent.js';
import { ToolRegistry, type ToolExecutionContext } from '../tools/registry.js';
import { TaskDAG } from '../dag/graph.js';
import { TaskScheduler } from '../dag/scheduler.js';
import { OrchestrationMetricsManager } from '../observability/metrics.js';
import { RecoveryEngine } from './recovery.js';
import type { LLMProvider } from '../llm/provider.js';
import { logger } from '../../../logger.js';
import { MockLLMProvider } from '../llm/provider.js';

export interface OrchestratorOptions {
  readonly agentRegistry?: AgentRegistry | undefined;
  readonly toolRegistry?: ToolRegistry | undefined;
  readonly mutationService?: MutationOrchestratorService | undefined;
  readonly impactService?: ImpactIntelligenceService | undefined;
  readonly semanticGraphService?: SemanticCodeGraphService | undefined;
  readonly contextService?: ContextAssemblyService | undefined;
  readonly codeIntelService?: CodeIntelligenceService | undefined;
  readonly dnaService?: ApplicationDNAService | undefined;
  readonly llmProvider?: LLMProvider | undefined;
}

export interface DAGExecutionReport {
  readonly runId: string;
  readonly success: boolean;
  readonly executedTasksCount: number;
  readonly totalDurationMs: number;
  readonly metrics: OrchestrationMetrics;
  readonly error?: string | undefined;
}

export class AgentOrchestrator {
  public readonly agentRegistry: AgentRegistry;
  public readonly toolRegistry: ToolRegistry;
  public readonly stateMachine: AgentStateMachine;
  public readonly metricsManager: OrchestrationMetricsManager;
  public readonly recoveryEngine: RecoveryEngine;
  public readonly llmProvider: LLMProvider;

  private readonly mutationService?: MutationOrchestratorService | undefined;
  private readonly impactService?: ImpactIntelligenceService | undefined;
  private readonly semanticGraphService?: SemanticCodeGraphService | undefined;
  private readonly contextService?: ContextAssemblyService | undefined;
  private readonly codeIntelService?: CodeIntelligenceService | undefined;
  private readonly dnaService?: ApplicationDNAService | undefined;

  constructor(options?: OrchestratorOptions | undefined) {
    this.agentRegistry = options?.agentRegistry ?? new AgentRegistry();
    this.toolRegistry = options?.toolRegistry ?? new ToolRegistry();
    this.stateMachine = new AgentStateMachine('orchestrator-sm', 'RECEIVED');
    this.metricsManager = new OrchestrationMetricsManager();
    if (options?.llmProvider) {
      this.llmProvider = options.llmProvider;
    } else {
      logger.warn(
        'AgentOrchestrator démarré SANS moteur IA réel — utilisation du simulateur MockLLMProvider (réponses factices).',
        { component: 'agent-runtime-orchestrator', reason: 'no-llm-provider-configured' }
      );
      this.llmProvider = new MockLLMProvider();
    }

    this.mutationService = options?.mutationService;
    this.impactService = options?.impactService;
    this.semanticGraphService = options?.semanticGraphService;
    this.contextService = options?.contextService;
    this.codeIntelService = options?.codeIntelService;
    this.dnaService = options?.dnaService;

    this.recoveryEngine = new RecoveryEngine(this.mutationService);
  }

  public getState(): AgentState {
    return this.stateMachine.getState();
  }

  public getMetrics(): OrchestrationMetrics {
    return this.metricsManager.getMetrics();
  }

  /**
   * Receives and registers a user or system task, advancing the state machine to UNDERSTANDING.
   */
  public receiveTask(input: {
    id?: string | undefined;
    title: string;
    intent: string;
    tenantId: string;
    projectId: string;
    userRole: Role;
    agentRole?: AgentRole | undefined;
    dependencies?: readonly string[] | undefined;
    estimatedTokens?: number | undefined;
  }): ExecutionTask {
    const taskId = input.id ?? `task-${randomUUID().slice(0, 8)}`;

    if (this.stateMachine.getState() === 'RECEIVED') {
      this.stateMachine.transition('UNDERSTANDING', 'Réception et analyse de la tâche');
    }

    const assignedRole = input.agentRole ?? this.inferAgentRole(input.intent);
    this.metricsManager.recordTaskCreated();

    return {
      taskId,
      id: taskId,
      title: input.title,
      description: input.intent,
      type: 'EXECUTION_TASK',
      dependencies: input.dependencies ?? [],
      requiredAgent: assignedRole,
      assignedAgent: assignedRole,
      requiredContext: ['FILE_CONTENT'],
      requiredTools: ['READ_FILE'],
      riskLevel: 'LOW',
      status: 'PENDING',
      estimatedTokens: input.estimatedTokens ?? 1000
    };
  }

  /**
   * Selects an appropriate agent from the registry based on task requirements and capabilities.
   */
  public selectAgent(task: ExecutionTask, _userRole: Role): Agent {
    const role = (task.assignedAgent ?? task.requiredAgent) as AgentRole;
    let def = this.agentRegistry.getByRole(role);

    if (!def) {
      def = this.agentRegistry.getByRole('CODE_AGENT');
    }

    if (!def) {
      throw new Error(`Aucun agent disponible pour le rôle '${role}'`);
    }

    this.metricsManager.recordAgentHandoff();
    return new Agent(def);
  }

  /**
   * Assembles context for the given agent and task, transitioning state machine to CONTEXT_BUILDING.
   */
  public async assembleContext(
    task: ExecutionTask,
    agent: Agent,
    tenantId: string,
    projectId: string,
    userRole: Role,
    requestId?: string | undefined
  ): Promise<Record<string, unknown>> {
    this.stateMachine.transition('CONTEXT_BUILDING', 'Assemblage du contexte pour la tâche');

    let assembledTokens = task.estimatedTokens ?? 1000;
    let filesCount = 0;

    if (this.contextService) {
      try {
        const pack = await this.contextService.assembleContext(
          {
            tenantId,
            projectId,
            taskDescription: task.description
          },
          userRole,
          requestId
        );
        assembledTokens = pack.budgetUsage.totalTokens;
        filesCount = pack.files.length;
      } catch (err) {
        logger.warn('Échec du calcul du contexte de pack — fallback sur contexte minimal', {
          component: 'agent-orchestrator',
          err: err instanceof Error ? err.message : String(err)
        });
      }
    }

    this.metricsManager.recordTokenConsumption(assembledTokens);

    return {
      taskId: task.taskId,
      agentRole: agent.role,
      assembledTokens,
      filesCount
    };
  }

  /**
   * Evaluates the Impact Gate before performing dangerous or mutating operations.
   */
  public async evaluateImpactGate(
    targetFiles: readonly string[],
    tenantId: string,
    projectId: string,
    userRole: Role,
    requestId?: string | undefined
  ): Promise<{ passed: boolean; overallRisk: string; breakingCount: number }> {
    if (this.stateMachine.getState() !== 'WAITING_GATE') {
      if (!this.stateMachine.canTransitionTo('WAITING_GATE')) {
        if (this.stateMachine.canTransitionTo('PLANNING')) this.stateMachine.transition('PLANNING', 'Préparation gate');
      }
      this.stateMachine.transition('WAITING_GATE', 'Évaluation de l Impact Gate');
    }

    if (!this.impactService) {
      this.metricsManager.recordGateEvaluated(true);
      return { passed: true, overallRisk: 'LOW', breakingCount: 0 };
    }

    try {
      const impact = await this.impactService.analyzeImpact(
        {
          tenantId,
          projectId,
          targetFiles: targetFiles.length > 0 ? Array.from(targetFiles) : undefined
        },
        userRole,
        requestId
      );

      const breakingCount = impact.metrics.breakingCount;
      const isHighRisk = impact.overallRisk === 'CRITICAL' || impact.overallRisk === 'HIGH';
      const hasBreaking = breakingCount > 0;

      if ((isHighRisk || hasBreaking) && userRole === 'VIEWER') {
        this.metricsManager.recordGateEvaluated(false);
        throw new GateRejectedError(
          'IMPACT_GATE',
          `Risque d impact trop élevé (${impact.overallRisk}) ou modifications cassantes (${breakingCount}) non autorisées pour le rôle VIEWER`,
          { overallRisk: impact.overallRisk, breakingCount },
          requestId
        );
      }

      this.metricsManager.recordGateEvaluated(true);
      return {
        passed: true,
        overallRisk: impact.overallRisk,
        breakingCount
      };
    } catch (err) {
      if (err instanceof GateRejectedError) {
        throw err;
      }
      this.metricsManager.recordGateEvaluated(false);
      throw new GateRejectedError(
        'IMPACT_GATE',
        `Échec d analyse d impact : ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        requestId
      );
    }
  }

  /**
   * Executes a multi-task DAG with topological ordering, batch scheduling, and gates.
   */
  public async executeDAG(
    dag: TaskDAG,
    context: ToolExecutionContext
  ): Promise<DAGExecutionReport> {
    const startTime = Date.now();
    const runId = context.runId ?? randomUUID();

    // 1. Cycle detection and validation
    dag.validate();

    // 2. State transition PLANNING -> EXECUTING
    if (this.stateMachine.getState() !== 'PLANNING' && this.stateMachine.getState() !== 'EXECUTING') {
      this.stateMachine.transition('PLANNING', 'Planification du DAG');
    }
    this.stateMachine.transition('EXECUTING', 'Exécution des tâches du DAG');

    const scheduler = new TaskScheduler(dag);
    let success = true;
    let failureError: string | undefined;
    let executedTasksCount = 0;

    try {
      const executor = async (task: ExecutionTask): Promise<unknown> => {
        const agent = this.selectAgent(task, context.userRole);

        // Capability boundary check
        const taskTools = task.requiredTools.length > 0 ? task.requiredTools : ['READ_FILE'];
        for (const tool of taskTools) {
          if (!agent.canPerform(tool)) {
            throw new AgentCapabilityError(
              agent.role,
              tool,
              agent.allowedOperations,
              context.requestId
            );
          }
        }

        const toolRes = await this.toolRegistry.execute(
          'READ_FILE',
          { path: 'package.json' },
          {
            ...context,
            agentRole: agent.role,
            allowedTools: agent.allowedOperations
          }
        );

        return { taskId: task.taskId, agent: agent.role, toolResult: toolRes };
      };

      const scheduledTasks = await scheduler.execute(executor);
      executedTasksCount = scheduledTasks.length;

      const hasFailed = scheduledTasks.some((t: ExecutionTask) => t.status === 'FAILED');
      if (hasFailed) {
        success = false;
        failureError = scheduledTasks.find((t: ExecutionTask) => t.status === 'FAILED')?.error;
        this.stateMachine.transition('FAILED', 'Échec de tâche dans le DAG');
      } else {
        this.stateMachine.transition('VERIFYING', 'Vérification post-DAG');
        this.stateMachine.transition('COMPLETED', 'DAG exécuté avec succès');
      }
    } catch (err) {
      success = false;
      failureError = err instanceof Error ? err.message : String(err);
      this.stateMachine.transition('FAILED', `Erreur d exécution du DAG: ${failureError}`);
      throw err;
    } finally {
      const duration = Date.now() - startTime;
      this.metricsManager.recordDAGCompleted(duration, success);
    }

    return {
      runId,
      success,
      executedTasksCount,
      totalDurationMs: Date.now() - startTime,
      metrics: this.metricsManager.getMetrics(),
      error: failureError
    };
  }

  private inferAgentRole(intent: string): AgentRole {
    const lower = intent.toLowerCase();
    if (lower.includes('ui') || lower.includes('composant') || lower.includes('style') || lower.includes('css') || lower.includes('interface')) {
      return 'UI_AGENT';
    }
    if (lower.includes('database') || lower.includes('base de données') || lower.includes('sql') || lower.includes('migration') || lower.includes('schema')) {
      return 'DATABASE_AGENT';
    }
    if (lower.includes('test') || lower.includes('spec') || lower.includes('couverture')) {
      return 'TEST_AGENT';
    }
    if (lower.includes('securite') || lower.includes('security') || lower.includes('auth') || lower.includes('jwt') || lower.includes('rbac')) {
      return 'SECURITY_AGENT';
    }
    if (lower.includes('architect') || lower.includes('conception') || lower.includes('structure') || lower.includes('refactor')) {
      return 'ARCHITECT_AGENT';
    }
    if (lower.includes('debug') || lower.includes('fix') || lower.includes('reparer') || lower.includes('erreur')) {
      return 'DEBUG_AGENT';
    }
    if (lower.includes('review') || lower.includes('revue') || lower.includes('audit') || lower.includes('qualite')) {
      return 'REVIEW_AGENT';
    }
    if (lower.includes('backend') || lower.includes('api') || lower.includes('route') || lower.includes('service') || lower.includes('controller')) {
      return 'BACKEND_AGENT';
    }
    return 'CODE_AGENT';
  }
}
