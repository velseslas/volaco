/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * AI Orchestrator Service Facade & Central Control Plane
 */

import { randomUUID } from 'node:crypto';
import { assertPermission, type Role } from '../../identity/permissions.js';
import { auditStore } from '../../observability/audit.js';
import { NotFoundError } from '../../errors.js';
import { aiUsageTracker } from '../../ai/usage.js';
import { computeOrchestrationTraceId, deepFreeze } from './canonical.js';
import { AIOrchestratorLruCache } from './cache.js';
import { TaskDecomposer } from './engine/task-decomposer.js';
import { ContextOrchestrator } from './engine/context-orchestrator.js';
import { AgentScheduler } from './engine/agent-scheduler.js';
import { ConflictDetector } from './engine/conflict-detector.js';
import { ValidationGate } from './engine/validation-gate.js';
import { MutationBridge } from './engine/mutation-bridge.js';
import { RepairOrchestrator } from './engine/repair-orchestrator.js';
import { UiAgent } from './agents/ui-agent.js';
import { BackendAgent } from './agents/backend-agent.js';
import { DataAgent } from './agents/data-agent.js';
import { SecurityAgent } from './agents/security-agent.js';
import { TestAgent } from './agents/test-agent.js';
import { ReferenceAgent } from './agents/reference-agent.js';
import { AgentExecutionService, type AgentExecutionRequest, type AgentExecutionOutcome } from './execution/agent-execution.js';
import type { BaseSpecializedAgent } from './agents/base-agent.js';
import type {
  AgentDomain,
  AIOrchestratorConfig,
  OrchestratePlanParams,
  OrchestrationRun,
  OrchestrationState,
  OrchestrationTrace
} from './types.js';
import type { ApplicationUnderstandingService } from '../application-understanding/service.js';
import type { ImpactIntelligenceService } from '../impact-intelligence/service.js';
import type { MutationOrchestratorService } from '../mutation-orchestrator/service.js';
import type { ApplicationDNAService } from '../dna/service.js';
import type { SemanticCodeGraphService } from '../semantic-graph/service.js';
import type { AIProviderRegistry } from '../../ai/providers/registry.js';
import { aiProviderRegistry } from '../../ai/providers/registry.js';

export const DEFAULT_ORCHESTRATOR_CONFIG: AIOrchestratorConfig = {
  maxConcurrentTasks: 4,
  maxSelfRepairCycles: 3,
  defaultTaskTimeoutMs: 15000,
  tokenBudgetPerOrchestration: 50000,
  strictConflictGate: true,
  cacheMaxEntries: 100
};

export class AIOrchestratorService {
  private readonly config: AIOrchestratorConfig;
  private readonly cache: AIOrchestratorLruCache;
  private readonly taskDecomposer: TaskDecomposer;
  private readonly contextOrchestrator: ContextOrchestrator;
  private readonly conflictDetector: ConflictDetector;
  private readonly validationGate: ValidationGate;
  private readonly mutationBridge: MutationBridge;
  private readonly repairOrchestrator: RepairOrchestrator;
  private readonly agentScheduler: AgentScheduler;
  // ÉTAPE 32 — contrat d exécution unitaire d agent (source unique : mêmes agents + même bridge de mutation).
  private readonly agentExecution: AgentExecutionService;
  private readonly specializedAgents: Map<AgentDomain, BaseSpecializedAgent>;

  constructor(
    private readonly understandingService?: ApplicationUnderstandingService | undefined,
    private readonly impactService?: ImpactIntelligenceService | undefined,
    private readonly mutationService?: MutationOrchestratorService | undefined,
    // NB : un paramètre "agentRuntime" existait ici auparavant mais n'était jamais
    // utilisé nulle part dans le service (ni en production, ni dans les tests) — il a
    // été retiré. AIOrchestratorService (agents spécialisés + DNA + audit/design/strategy)
    // et AgentRuntimeService (exécution générique de plans conversationnels, utilisé
    // par conversation-intelligence) sont deux moteurs volontairement distincts qui ne
    // se délèguent pas de travail entre eux aujourd'hui.
    private readonly dnaService?: ApplicationDNAService | undefined,
    private readonly graphService?: SemanticCodeGraphService | undefined,
    private readonly providerRegistry?: AIProviderRegistry | undefined,
    config?: Partial<AIOrchestratorConfig> | undefined
  ) {
    this.config = {
      ...DEFAULT_ORCHESTRATOR_CONFIG,
      ...config
    };

    const registry = providerRegistry ?? aiProviderRegistry;

    this.cache = new AIOrchestratorLruCache(this.config.cacheMaxEntries);
    this.taskDecomposer = new TaskDecomposer();
    this.contextOrchestrator = new ContextOrchestrator(
      this.understandingService,
      this.dnaService,
      this.graphService
    );
    this.conflictDetector = new ConflictDetector();
    this.validationGate = new ValidationGate(this.impactService);
    this.mutationBridge = new MutationBridge(this.mutationService);
    this.repairOrchestrator = new RepairOrchestrator(this.config.maxSelfRepairCycles);

    // Instantiate standard 5 specialized domain agents
    this.specializedAgents = new Map<AgentDomain, BaseSpecializedAgent>();
    this.specializedAgents.set('UI', new UiAgent(registry));
    this.specializedAgents.set('BACKEND', new BackendAgent(registry));
    this.specializedAgents.set('DATA', new DataAgent(registry));
    this.specializedAgents.set('SECURITY', new SecurityAgent(registry));
    this.specializedAgents.set('TEST', new TestAgent(registry));

    this.agentScheduler = new AgentScheduler(
      this.specializedAgents,
      this.contextOrchestrator,
      this.config.maxConcurrentTasks
    );

    // ÉTAPE 32 — contrat d'exécution unitaire d'agent : vue par ID sur les
    // MÊMES instances d'agents (aucun deuxième registry) + le bridge de
    // mutation existant (single writer). L'agent de référence déterministe
    // est enregistré ici pour tester/exécuter le contrat.
    this.agentExecution = new AgentExecutionService(
      Array.from(this.specializedAgents.values()),
      this.mutationBridge
    );
    this.agentExecution.registerAgent(new ReferenceAgent(registry));
  }

  public async orchestratePlan(params: OrchestratePlanParams): Promise<OrchestrationRun> {
    const {
      tenantId,
      projectId,
      plan,
      intent,
      conversationId,
      userRole = 'OWNER',
      requestId,
      autoMutateIfLowRisk = true
    } = params;

    assertPermission(userRole, 'PROJECT_READ', requestId);

    const startedAt = new Date().toISOString();
    const orchestrationId = `orch-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const traces: OrchestrationTrace[] = [];
    let state: OrchestrationState = 'INITIALIZING';
    let traceIndex = 0;

    const recordTrace = (nextState: OrchestrationState, event: string, metadata?: Record<string, unknown>) => {
      const trace: OrchestrationTrace = {
        traceId: computeOrchestrationTraceId(orchestrationId, ++traceIndex),
        timestamp: new Date().toISOString(),
        stateBefore: state,
        stateAfter: nextState,
        event,
        durationMs: 0,
        metadata
      };
      traces.push(trace);
      state = nextState;
    };

    recordTrace('DECOMPOSING', `Décomposition du plan '${plan.planId}'`);

    // 1. Task Decomposition
    const taskGraph = this.taskDecomposer.decomposePlan(plan, intent);
    recordTrace('EXECUTING_GRAPH', `Graphe de tâches DAG généré (${taskGraph.tasks.length} tâches)`, {
      graphHash: taskGraph.graphHash,
      isAcyclic: taskGraph.isAcyclic
    });

    // 2. Schedule & Execute Agent Graph
    const executionResult = await this.agentScheduler.executeGraph({
      taskGraph,
      tenantId,
      projectId,
      userRole,
      requestId
    });

    recordTrace('CORRELATING_ARTIFACTS', `Exécution du graphe terminée (${executionResult.artifacts.length} artefacts produits)`, {
      totalTokens: executionResult.totalTokens,
      hasFailures: executionResult.hasFailures
    });

    // 3. Conflict Detection
    const detectedConflicts = this.conflictDetector.detectConflicts(executionResult.artifacts);
    recordTrace('VALIDATING', `Analyse des conflits inter-agents (${detectedConflicts.length} conflits)`, {
      conflictCount: detectedConflicts.length
    });

    // 4. Pre-Mutation Validation Gate
    const validationResult = await this.validationGate.validateArtifacts({
      artifacts: executionResult.artifacts,
      tenantId,
      projectId,
      userRole,
      requestId
    });

    let repairCycles = 0;
    let finalArtifacts = [...executionResult.artifacts];
    let finalConflicts = [...detectedConflicts, ...executionResult.conflicts];
    let mutationTxId: string | undefined;

    // 5. Evaluate Self-Repair if failures or blocking conflicts
    const failedTasks = executionResult.updatedGraph.tasks.filter((t) => t.status === 'FAILED');
    if (failedTasks.length > 0 || finalConflicts.some((c) => c.severity === 'BLOCKING')) {
      const repairDecision = this.repairOrchestrator.evaluateRepair({
        currentCycles: repairCycles,
        failedTasks,
        conflicts: finalConflicts
      });

      if (repairDecision.escalatedToHuman) {
        recordTrace('WAITING_HUMAN_APPROVAL', `Escalade vers le Control Plane humain : ${repairDecision.reason}`);
        const escalatedRun = this.finalizeRun({
          orchestrationId,
          tenantId,
          projectId,
          conversationId,
          planId: plan.planId,
          state: 'WAITING_HUMAN_APPROVAL',
          taskGraph: executionResult.updatedGraph,
          completedTaskIds: executionResult.updatedGraph.tasks.filter((t) => t.status === 'COMPLETED').map((t) => t.id),
          artifacts: finalArtifacts,
          conflicts: finalConflicts,
          traces,
          totalCostUsd: executionResult.totalTokens * 0.000002,
          totalTokens: executionResult.totalTokens,
        degradedCount: executionResult.degradedCount,
          repairCycles,
          impactReport: validationResult.impactReport,
          error: repairDecision.reason,
          startedAt,
          completedAt: new Date().toISOString()
        });
        return escalatedRun;
      }
    }

    // 6. Check if Human Approval is required
    if (validationResult.requiresHumanApproval && !autoMutateIfLowRisk) {
      recordTrace('WAITING_HUMAN_APPROVAL', `Validation de sécurité : approbation humaine requise (Risque: ${validationResult.riskLevel})`);
      const waitingRun = this.finalizeRun({
        orchestrationId,
        tenantId,
        projectId,
        conversationId,
        planId: plan.planId,
        state: 'WAITING_HUMAN_APPROVAL',
        taskGraph: executionResult.updatedGraph,
        completedTaskIds: executionResult.updatedGraph.tasks.filter((t) => t.status === 'COMPLETED').map((t) => t.id),
        artifacts: finalArtifacts,
        conflicts: finalConflicts,
        traces,
        totalCostUsd: executionResult.totalTokens * 0.000002,
        totalTokens: executionResult.totalTokens,
        degradedCount: executionResult.degradedCount,
        repairCycles,
        impactReport: validationResult.impactReport,
        startedAt,
        completedAt: new Date().toISOString()
      });
      return waitingRun;
    }

    // 7. Apply mutations through AINT-006 (Single Writer)
    recordTrace('MUTATING', 'Application des artefacts via AINT-006 MutationOrchestratorService');
    const mutationResult = await this.mutationBridge.applyArtifacts({
      artifacts: finalArtifacts,
      tenantId,
      projectId,
      userRole,
      requestId
    });

    mutationTxId = mutationResult.transactionId;

    if (mutationResult.success) {
      recordTrace('COMPLETED', `Orchestration finalisée avec succès (${mutationResult.appliedCount} mutations appliquées)`, {
        transactionId: mutationTxId
      });
    } else {
      recordTrace('FAILED', `Échec de l'application transactionnelle : ${mutationResult.error}`);
    }

    const finalRun = this.finalizeRun({
      orchestrationId,
      tenantId,
      projectId,
      conversationId,
      planId: plan.planId,
      state: mutationResult.success ? 'COMPLETED' : 'FAILED',
      taskGraph: executionResult.updatedGraph,
      completedTaskIds: executionResult.updatedGraph.tasks.filter((t) => t.status === 'COMPLETED').map((t) => t.id),
      artifacts: finalArtifacts,
      conflicts: finalConflicts,
      traces,
      totalCostUsd: executionResult.totalTokens * 0.000002,
      totalTokens: executionResult.totalTokens,
      degradedCount: executionResult.degradedCount,
      repairCycles,
      mutationTransactionId: mutationTxId,
      impactReport: validationResult.impactReport,
      error: mutationResult.error,
      startedAt,
      completedAt: new Date().toISOString()
    });

    return finalRun;
  }

  public getOrchestration(
    orchestrationId: string,
    tenantId: string,
    userRole: Role = 'VIEWER',
    requestId?: string | undefined
  ): OrchestrationRun | undefined {
    assertPermission(userRole, 'PROJECT_READ', requestId);
    const run = this.cache.get(orchestrationId);
    if (!run) return undefined;

    // Strict Multi-Tenant isolation
    if (run.tenantId !== tenantId) {
      throw new NotFoundError(`Orchestration '${orchestrationId}' introuvable.`);
    }

    return run;
  }

  public cancelOrchestration(
    orchestrationId: string,
    tenantId: string,
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): boolean {
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);
    const run = this.getOrchestration(orchestrationId, tenantId, userRole, requestId);
    if (!run) return false;

    if (run.state === 'COMPLETED' || run.state === 'FAILED') {
      return false;
    }

    const cancelledRun: OrchestrationRun = deepFreeze({
      ...run,
      state: 'FAILED',
      error: 'Orchestration annulée par l utilisateur.'
    });

    this.cache.set(cancelledRun);
    return true;
  }

  public getSpecializedAgent(domain: AgentDomain): BaseSpecializedAgent | undefined {
    return this.specializedAgents.get(domain);
  }

  // ===========================================================================
  // ÉTAPE 32 — Contrat réel d'exécution d'agent (par ID, statut honnête)
  // ===========================================================================

  /** Liste les agents exécutables unitairement (roster orchestrateur, par ID). */
  public listExecutionAgents(): readonly string[] {
    return this.agentExecution.listAgentIds();
  }

  /** Vérifie la présence d'un agent exécutable par identifiant. */
  public hasExecutionAgent(agentId: string): boolean {
    return this.agentExecution.has(agentId);
  }

  /**
   * Exécute UN agent sur UNE tâche selon le contrat É32 : sélection par ID,
   * capabilities vérifiées, résultat réel, artifacts, mutation OBLIGATOIREMENT
   * via MutationOrchestratorService, statut honnête (aucun faux succès).
   */
  public async executeAgent(request: AgentExecutionRequest): Promise<AgentExecutionOutcome> {
    return this.agentExecution.execute(request);
  }

  private finalizeRun(data: OrchestrationRun): OrchestrationRun {
    const frozen = deepFreeze(data);
    this.cache.set(frozen);

    // Record audit event in central audit store
    auditStore.record({
      tenantId: data.tenantId,
      userId: 'system',
      action: 'AI_ORCHESTRATION_COMPLETED',
      resourceType: 'ai_orchestrator',
      resourceId: data.orchestrationId,
      status: data.state === 'FAILED' ? 'FAILURE' : 'SUCCESS',
      metadata: {
        state: data.state,
        planId: data.planId,
        artifactsCount: data.artifacts.length,
        conflictsCount: data.conflicts.length,
        totalTokens: data.totalTokens,
        transactionId: data.mutationTransactionId
      },
      requestId: 'req-orch'
    });

    return frozen;
  }
}
