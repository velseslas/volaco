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
import { CodeAgent } from './agents/code-agent.js';
import { AgentExecutionService, NULL_FILE_OBSERVER, type AgentExecutionRequest, type AgentExecutionOutcome } from './execution/agent-execution.js';
import { AgentRegistryService } from './registry/agent-registry.js';
import { MultiAgentScheduler, type MultiAgentSchedulerRequest, type MultiAgentSchedulerOutcome } from './execution/multi-agent-scheduler.js';
import type { BaseSpecializedAgent } from './agents/base-agent.js';
import type {
  AgentArtifact,
  AgentDomain,
  AgentTask,
  AIOrchestratorConfig,
  OrchestratePlanParams,
  OrchestrationExecutionApplyOutcome,
  OrchestrationExecutionFunctionalTests,
  OrchestrationExecutionOptions,
  OrchestrationExecutionPreflight,
  OrchestrationExecutionPreviewOutcome,
  OrchestrationExecutionRefusal,
  OrchestrationExecutionRefusalCode,
  OrchestrationExecutionRuntime,
  OrchestrationExecutionTransaction,
  OrchestrationExecutionValidation,
  OrchestrationRun,
  OrchestrationState,
  OrchestrationTrace,
  ProposedFileChangePayload,
  TaskContextPayload
} from './types.js';
import type { ApplicationUnderstandingService } from '../application-understanding/service.js';
import type { ImpactIntelligenceService } from '../impact-intelligence/service.js';
import type { MutationOrchestratorService } from '../mutation-orchestrator/service.js';
import type { MutationTransaction } from '../mutation-orchestrator/types.js';
import { assertSafeMutationPath } from '../mutation-orchestrator/engine/security.js';
import { runEngineeringPreflight } from '../validation/engineering-preflight.js';
import {
  ChromiumBrowserSandbox,
  type BrowserSandboxReport,
  type BrowserSandboxRunner
} from '../validation/browser-sandbox.js';
import type { ValidationGateResult } from './engine/validation-gate.js';
import type { ApplicationDNAService } from '../dna/service.js';
import type { SemanticCodeGraphService } from '../semantic-graph/service.js';
import type { AIProviderRegistry } from '../../ai/providers/registry.js';
import type { IReadOnlyFileSource } from '../understanding/types.js';
import { aiProviderRegistry } from '../../ai/providers/registry.js';

export const DEFAULT_ORCHESTRATOR_CONFIG: AIOrchestratorConfig = {
  maxConcurrentTasks: 4,
  maxSelfRepairCycles: 3,
  defaultTaskTimeoutMs: 15000,
  tokenBudgetPerOrchestration: 50000,
  strictConflictGate: true,
  cacheMaxEntries: 100
};

/**
 * V7-LOT6 — résultat interne de l'audit d'un run avant sandbox/apply.
 * Les refus sont des valeurs (pas des exceptions) pour que la route HTTP
 * distingue précisément 404 / 409 / 422 / 500.
 */
interface RunExecutionAssessment {
  readonly validation: ValidationGateResult;
  readonly preflight: readonly OrchestrationExecutionPreflight[];
  readonly runtime: readonly OrchestrationExecutionRuntime[];
  readonly runtimeSkipped: number;
  readonly functionalTests: OrchestrationExecutionFunctionalTests;
  readonly fileChanges: readonly AgentArtifact[];
  readonly breakingCount: number;
}

/** Borne le coût du sandbox : au-delà, les pages suivantes ne sont pas jouées. */
const MAX_RUNTIME_DOCUMENTS = 3;

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
  // ÉTAPE 34 — source unique du roster (le scheduler et l exécuteur en dérivent).
  private readonly agentRegistry: AgentRegistryService;
  // ÉTAPE 37 — scheduler multi-agents (couche au-dessus de agentExecution).
  private readonly multiAgentScheduler: MultiAgentScheduler;
  private readonly specializedAgents: Map<AgentDomain, BaseSpecializedAgent>;
  // V7-LOT7 — exécution réelle du HTML candidat (réseau coupé, timeout, captures).
  private readonly browserSandbox: BrowserSandboxRunner;

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
    config?: Partial<AIOrchestratorConfig> | undefined,
    // ÉTAPE 35 — observateur read-only de la source de vérité (vérification/rollback).
    fileObserver?: IReadOnlyFileSource | undefined,
    // V7-LOT7 — injectable pour les tests ; Chromium réel par défaut.
    browserSandbox?: BrowserSandboxRunner | undefined
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

    // ÉTAPE 34 — le Registry est LA source unique du roster : les 5 agents
    // de domaine + le reference-agent y sont enregistrés UNE fois. La vue
    // par domaine du scheduler et la résolution de l'exécuteur en dérivent
    // (mêmes instances, aucune duplication).
    this.agentRegistry = new AgentRegistryService();
    this.agentRegistry.register(new UiAgent(registry));
    this.agentRegistry.register(new BackendAgent(registry));
    this.agentRegistry.register(new DataAgent(registry));
    this.agentRegistry.register(new SecurityAgent(registry));
    this.agentRegistry.register(new TestAgent(registry));
    this.agentRegistry.register(new CodeAgent(registry));
    this.agentRegistry.register(new ReferenceAgent(registry));

    this.specializedAgents = this.agentRegistry.domainMap();

    this.agentScheduler = new AgentScheduler(
      this.specializedAgents,
      this.contextOrchestrator,
      this.config.maxConcurrentTasks
    );

    // ÉTAPE 32/34 — contrat d'exécution unitaire d'agent : la résolution passe
    // par le Registry (source unique) + le bridge de mutation existant
    // (single writer).
    // Sans source réelle fournie, l'observateur nul rend toute vérification
    // impossible → aucun SUCCESS de mutation ne peut être déclaré.
    this.agentExecution = new AgentExecutionService(this.agentRegistry, this.mutationBridge, fileObserver ?? NULL_FILE_OBSERVER);
    this.multiAgentScheduler = new MultiAgentScheduler(this.agentExecution);
    this.browserSandbox = browserSandbox ?? new ChromiumBrowserSandbox();
  }

  /**
   * PAGE CLÉS API — roster sérialisable des agents (id/name/domain/description/
   * capabilities). L'INSTANCE d'exécution n'est jamais exposée ; c'est la vue
   * du même Registry (source unique) sans duplication de données.
   */
  public agentRoster(): readonly {
    id: string;
    name: string;
    domain: string;
    description: string;
    capabilities: readonly string[];
    requiresProviderCapabilities: readonly string[];
  }[] {
    return this.agentRegistry.list().map((entry) => ({
      id: entry.id,
      name: entry.name,
      domain: entry.domain,
      description: entry.description,
      capabilities: [...entry.capabilities] as readonly string[],
      requiresProviderCapabilities: [...entry.requiresProviderCapabilities]
    }));
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

    // P0-PROD — compteur de repair déclaré avant les contrôles
    // budget/timeout (les finalizeRun d'échec ci-dessous le référencent).
    let repairCycles = 0;

    // 2. Schedule & Execute Agent Graph
    // P0-PROD — timeout global borné (defaultTaskTimeoutMs × nb de tâches) :
    // avant, executeGraph sans signal pouvait pendre indéfiniment sur un
    // provider bloqué (seul le timeout 15 s par appel LLM existait).
    const graphTimeoutMs = this.config.defaultTaskTimeoutMs * Math.max(1, taskGraph.tasks.length);
    let executionResult: Awaited<ReturnType<AgentScheduler['executeGraph']>>;
    let graphTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      executionResult = await Promise.race([
        this.agentScheduler.executeGraph({
          taskGraph,
          tenantId,
          projectId,
          userRole,
          requestId
        }),
        new Promise<never>((_, reject) => {
          graphTimer = setTimeout(() => reject(new Error(
            `ORCHESTRATION_TIMEOUT: graphe non terminé en ${graphTimeoutMs} ms (${taskGraph.tasks.length} tâches)`
          )), graphTimeoutMs);
        })
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordTrace('FAILED', `Timeout global du graphe : ${message}`);
      return this.finalizeRun({
        orchestrationId,
        tenantId,
        projectId,
        conversationId,
        planId: plan.planId,
        state: 'FAILED',
        taskGraph,
        completedTaskIds: [],
        artifacts: [],
        conflicts: [],
        traces,
        totalCostUsd: 0,
        totalTokens: 0,
        degradedCount: 0,
        repairCycles,
        error: message,
        startedAt,
        completedAt: new Date().toISOString()
      });
    } finally {
      // P0-PROD — le timer de garde ne doit pas garder le process en vie
      // (30 s × nb de tâches après la fin réelle du graphe).
      if (graphTimer) clearTimeout(graphTimer);
    }
    recordTrace('CORRELATING_ARTIFACTS', `Exécution du graphe terminée (${executionResult.artifacts.length} artefacts produits)`, {
      totalTokens: executionResult.totalTokens,
      hasFailures: executionResult.hasFailures
    });

    // P0-PROD — budget tokens appliqué (tokenBudgetPerOrchestration,
    // jusqu'ici déclaré mais jamais lu) : au-delà, pas de mutation.
    if (executionResult.totalTokens > this.config.tokenBudgetPerOrchestration) {
      const budgetError = `BUDGET_EXCEEDED: ${executionResult.totalTokens} tokens > plafond ${this.config.tokenBudgetPerOrchestration} — mutation refusée`;
      recordTrace('FAILED', budgetError);
      return this.finalizeRun({
        orchestrationId,
        tenantId,
        projectId,
        conversationId,
        planId: plan.planId,
        state: 'FAILED',
        taskGraph: executionResult.updatedGraph,
        completedTaskIds: executionResult.updatedGraph.tasks.filter((t) => t.status === 'COMPLETED').map((t) => t.id),
        artifacts: [...executionResult.artifacts],
        conflicts: [...executionResult.conflicts],
        traces,
        totalCostUsd: executionResult.totalTokens * 0.000002,
        totalTokens: executionResult.totalTokens,
        degradedCount: executionResult.degradedCount,
        repairCycles,
        error: budgetError,
        startedAt,
        completedAt: new Date().toISOString()
      });
    }

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

    // (repairCycles est déclaré avant l'étape 2 — voir ci-dessus.)
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
    // É47 P2 (P1-1) — autoMutateIfLowRisk=false signifie AUCUNE mutation
    // automatique : l'orchestration s'arrête en WAITING_HUMAN_APPROVAL même
    // pour un plan low-risk (avant : seul le cas requiresHumanApproval
    // était bloqué, et un plan low-risk mutait malgré le flag à false).
    // P0-PROD — le gate impose AUSSI l'approbation quand le ValidationGate
    // l'exige (DELETE, HIGH, CRITICAL), même avec autoMutateIfLowRisk=true
    // (défaut) : avant, requiresHumanApproval était calculé puis ignoré.
    // Le mode autoMutateIfLowRisk=true + risque LOW/MEDIUM reste inchangé.
    if (!autoMutateIfLowRisk || validationResult.requiresHumanApproval) {
      recordTrace('WAITING_HUMAN_APPROVAL', `Validation : approbation humaine requise avant mutation (autoMutateIfLowRisk: ${autoMutateIfLowRisk}, requiresHumanApproval: ${validationResult.requiresHumanApproval}, risque: ${validationResult.riskLevel})`);
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

  // ===========================================================================
  // V7-LOT6 — Sandbox dry-run & application confirmée d'un run AINT-010.
  //
  // Le run d'analyse reste en lecture seule. L'exécution est une décision
  // HUMAINE explicite, séparée en deux temps :
  //   1. previewRun  : passe par AINT-006 en dryRun (aucune écriture) ;
  //   2. applyRun    : repasse les mêmes gardes puis écrit via AINT-006.
  //
  // Gardes non négociables : run WAITING/READY, aucun contenu dégradé, aucun
  // conflit BLOCKING, chemins sûrs, ValidationGate valide, préflight HTML
  // valide. Un changement HIGH/CRITICAL/DELETE exige acceptRisk ; un
  // changement BREAKING exige acceptBreaking. Le bridge reste le seul writer.
  // ===========================================================================

  public async previewRun(
    run: OrchestrationRun,
    options: OrchestrationExecutionOptions
  ): Promise<OrchestrationExecutionPreviewOutcome> {
    const userRole = options.userRole ?? 'VIEWER';
    assertPermission(userRole, 'PROJECT_READ', options.requestId);

    const assessment = await this.assessRunExecution(run, options);
    if ('code' in assessment) return assessment;

    const validation = this.summarizeExecutionValidation(assessment.validation, assessment.breakingCount);
    const bridgeResult = await this.mutationBridge.applyArtifacts({
      artifacts: assessment.fileChanges,
      tenantId: options.tenantId,
      projectId: options.projectId,
      userRole,
      requestId: options.requestId,
      dryRun: true,
      // Le sandbox ne mute pas : il montre les diffs même si un accord
      // HIGH/BREAKING serait nécessaire pour l'application réelle.
      allowHighRisk: true,
      allowBreaking: true
    });

    if (!bridgeResult.success || !bridgeResult.transaction) {
      return this.executionRefusal(
        'EXECUTION_FAILED',
        bridgeResult.error ?? 'Sandbox AINT-006 échoué : aucune transaction restituée.',
        {
          validation,
          preflight: assessment.preflight,
          runtime: assessment.runtime,
          runtimeSkipped: assessment.runtimeSkipped,
          functionalTests: assessment.functionalTests,
          ...(bridgeResult.transaction
            ? { transaction: this.summarizeExecutionTransaction(bridgeResult.transaction) }
            : {})
        }
      );
    }

    return {
      ok: true,
      dryRun: true,
      orchestrationId: run.orchestrationId,
      validation,
      preflight: assessment.preflight,
      runtime: assessment.runtime,
      runtimeSkipped: assessment.runtimeSkipped,
      functionalTests: assessment.functionalTests,
      transaction: this.summarizeExecutionTransaction(bridgeResult.transaction),
      diffs: bridgeResult.diffs ?? [],
      appliedCount: bridgeResult.appliedCount
    };
  }

  public async applyRun(
    run: OrchestrationRun,
    options: OrchestrationExecutionOptions
  ): Promise<OrchestrationExecutionApplyOutcome> {
    const userRole = options.userRole ?? 'VIEWER';
    assertPermission(userRole, 'PROJECT_MUTATE', options.requestId);

    if (options.confirm !== true) {
      return this.executionRefusal(
        'CONFIRMATION_REQUIRED',
        'Application refusée : confirmation humaine explicite requise (confirm: true).'
      );
    }

    const assessment = await this.assessRunExecution(run, options);
    if ('code' in assessment) return assessment;

    const validation = this.summarizeExecutionValidation(assessment.validation, assessment.breakingCount);
    if (assessment.validation.requiresHumanApproval && options.acceptRisk !== true) {
      return this.executionRefusal(
        'RISK_ACCEPTANCE_REQUIRED',
        `Application refusée : risque ${validation.riskLevel} ou suppression détectée. ` +
        'Un accord explicite (acceptRisk: true) est requis après revue du sandbox.',
        {
          validation,
          preflight: assessment.preflight,
          runtime: assessment.runtime,
          runtimeSkipped: assessment.runtimeSkipped,
          functionalTests: assessment.functionalTests
        }
      );
    }
    if (assessment.breakingCount > 0 && options.acceptBreaking !== true) {
      return this.executionRefusal(
        'BREAKING_ACCEPTANCE_REQUIRED',
        `Application refusée : ${assessment.breakingCount} changement(s) de rupture (BREAKING). ` +
        'Un accord explicite (acceptBreaking: true) est requis.',
        {
          validation,
          preflight: assessment.preflight,
          runtime: assessment.runtime,
          runtimeSkipped: assessment.runtimeSkipped,
          functionalTests: assessment.functionalTests
        }
      );
    }

    const { error: _previousError, ...runWithoutError } = run;
    const traceBase = run.traces.length;
    const traces: OrchestrationTrace[] = [
      ...run.traces,
      {
        traceId: computeOrchestrationTraceId(run.orchestrationId, traceBase + 1),
        timestamp: new Date().toISOString(),
        stateBefore: run.state,
        stateAfter: 'MUTATING',
        event: `Application confirmée (${assessment.fileChanges.length} fichier(s), risque ${validation.riskLevel})`,
        durationMs: 0,
        metadata: {
          mode: 'APPLY',
          riskLevel: validation.riskLevel,
          requiresHumanApproval: validation.requiresHumanApproval,
          breakingCount: validation.breakingCount,
          preflight: assessment.preflight.map((item) => ({
            path: item.path,
            verdict: item.report.verdict,
            contentHash: item.report.contentHash
          })),
          runtime: assessment.runtime.map((item) => ({
            path: item.path,
            verdict: item.report.verdict,
            blocking: item.report.blocking,
            durationMs: item.report.durationMs
          })),
          runtimeSkipped: assessment.runtimeSkipped,
          functionalTests: {
            verdict: assessment.functionalTests.verdict,
            blocking: assessment.functionalTests.blocking,
            total: assessment.functionalTests.total,
            passed: assessment.functionalTests.passedCount,
            failed: assessment.functionalTests.failedCount,
            warnings: assessment.functionalTests.warningCount,
            skipped: assessment.functionalTests.skippedCount
          }
        }
      }
    ];

    const bridgeResult = await this.mutationBridge.applyArtifacts({
      artifacts: assessment.fileChanges,
      tenantId: options.tenantId,
      projectId: options.projectId,
      userRole,
      requestId: options.requestId,
      dryRun: false,
      allowHighRisk: true,
      allowBreaking: options.acceptBreaking === true
    });

    const applied = bridgeResult.success && bridgeResult.transaction !== undefined;
    const failureMessage = bridgeResult.error
      ?? 'Application transactionnelle échouée : transaction non COMMITTED.';
    const finalState: OrchestrationState = applied ? 'COMPLETED' : 'FAILED';
    traces.push({
      traceId: computeOrchestrationTraceId(run.orchestrationId, traceBase + 2),
      timestamp: new Date().toISOString(),
      stateBefore: 'MUTATING',
      stateAfter: finalState,
      event: applied
        ? `Mutation appliquée via AINT-006 (${bridgeResult.appliedCount} opération(s))`
        : `Application échouée : ${failureMessage}`,
      durationMs: bridgeResult.transaction?.durationMs ?? 0,
      metadata: {
        mode: 'APPLY',
        appliedCount: bridgeResult.appliedCount,
        ...(bridgeResult.transactionId
          ? { transactionId: bridgeResult.transactionId }
          : {})
      }
    });

    const updatedRun = this.finalizeRun({
      ...runWithoutError,
      state: finalState,
      traces,
      completedAt: new Date().toISOString(),
      ...(bridgeResult.transactionId
        ? { mutationTransactionId: bridgeResult.transactionId }
        : {}),
      ...(!applied ? { error: failureMessage } : {})
    });

    if (!applied || !bridgeResult.transaction) {
      return this.executionRefusal(
        'EXECUTION_FAILED',
        failureMessage,
        {
          validation,
          preflight: assessment.preflight,
          runtime: assessment.runtime,
          runtimeSkipped: assessment.runtimeSkipped,
          functionalTests: assessment.functionalTests,
          run: updatedRun,
          ...(bridgeResult.transaction
            ? { transaction: this.summarizeExecutionTransaction(bridgeResult.transaction) }
            : {})
        }
      );
    }

    return {
      ok: true,
      dryRun: false,
      run: updatedRun,
      validation,
      preflight: assessment.preflight,
      runtime: assessment.runtime,
      runtimeSkipped: assessment.runtimeSkipped,
      functionalTests: assessment.functionalTests,
      transaction: this.summarizeExecutionTransaction(bridgeResult.transaction),
      diffs: bridgeResult.diffs ?? [],
      appliedCount: bridgeResult.appliedCount
    };
  }

  private async assessRunExecution(
    run: OrchestrationRun,
    options: OrchestrationExecutionOptions
  ): Promise<RunExecutionAssessment | OrchestrationExecutionRefusal> {
    if (run.tenantId !== options.tenantId || run.projectId !== options.projectId) {
      return this.executionRefusal(
        'RUN_NOT_FOUND',
        'Orchestration introuvable pour ce tenant et ce projet.'
      );
    }
    if (run.mutationTransactionId) {
      return this.executionRefusal(
        'RUN_ALREADY_EXECUTED',
        `Orchestration déjà appliquée (transaction ${run.mutationTransactionId}).`
      );
    }
    if (run.state !== 'WAITING_HUMAN_APPROVAL' && run.state !== 'READY_FOR_MUTATION') {
      return this.executionRefusal(
        'RUN_NOT_EXECUTABLE',
        `Orchestration non exécutable dans l'état '${run.state}'. ` +
        'Seul un run en revue humaine (WAITING_HUMAN_APPROVAL) peut être sandboxé puis appliqué.'
      );
    }
    if ((run.degradedCount ?? 0) > 0) {
      return this.executionRefusal(
        'DEGRADED_ARTIFACTS',
        `Application refusée : ${run.degradedCount} tâche(s) dégradée(s). ` +
        'Le contenu n\'a pas été produit par un provider IA et ne peut pas être écrit.'
      );
    }

    const blockingConflicts = run.conflicts.filter((conflict) => conflict.severity === 'BLOCKING');
    if (blockingConflicts.length > 0) {
      return this.executionRefusal(
        'BLOCKING_CONFLICTS',
        `Application refusée : ${blockingConflicts.length} conflit(s) BLOCKING non résolu(s).`
      );
    }

    const fileChanges = run.artifacts.filter((artifact) => artifact.kind === 'PROPOSED_FILE_CHANGE');
    if (fileChanges.length === 0) {
      return this.executionRefusal(
        'NO_FILE_CHANGES',
        'Aucun artefact PROPOSED_FILE_CHANGE : il n\'y a rien à appliquer.'
      );
    }

    for (const artifact of fileChanges) {
      const payload = artifact.payload as ProposedFileChangePayload | undefined;
      if (!payload || typeof payload.filePath !== 'string' || payload.filePath.trim().length === 0) {
        return this.executionRefusal(
          'INVALID_ARTIFACTS',
          `Artefact '${artifact.id}' invalide : filePath manquant.`
        );
      }
      if (payload.filePath !== payload.filePath.trim()) {
        return this.executionRefusal(
          'INVALID_ARTIFACTS',
          `Artefact '${artifact.id}' invalide : filePath avec espaces périphériques.`
        );
      }
      if (!['CREATE', 'UPDATE', 'DELETE', 'RENAME', 'MOVE'].includes(payload.operation)) {
        return this.executionRefusal(
          'INVALID_ARTIFACTS',
          `Artefact '${artifact.id}' invalide : opération '${String(payload.operation)}' inconnue.`
        );
      }
      try {
        assertSafeMutationPath(payload.filePath, options.requestId);
        if (payload.newPath) assertSafeMutationPath(payload.newPath, options.requestId);
      } catch (err) {
        return this.executionRefusal(
          'INVALID_ARTIFACTS',
          `Artefact '${artifact.id}' refusé : ${err instanceof Error ? err.message : String(err)}`
        );
      }
      if (payload.operation === 'CREATE' || payload.operation === 'UPDATE') {
        if (typeof payload.proposedContent !== 'string') {
          return this.executionRefusal(
            'INVALID_ARTIFACTS',
            `Artefact '${artifact.id}' invalide : proposedContent manquant pour ${payload.operation}.`
          );
        }
        if (payload.proposedContent.includes('[Mode Dégradé]')) {
          return this.executionRefusal(
            'DEGRADED_ARTIFACTS',
            `Artefact '${artifact.id}' refusé : contenu dégradé détecté.`
          );
        }
      }
    }

    const validation = await this.validationGate.validateArtifacts({
      artifacts: fileChanges,
      tenantId: options.tenantId,
      projectId: options.projectId,
      userRole: options.userRole,
      requestId: options.requestId
    });
    const breakingCount = validation.impactReport?.metrics.breakingCount ?? 0;
    const validationSummary = this.summarizeExecutionValidation(validation, breakingCount);

    if (!validation.isValid) {
      return this.executionRefusal(
        'INVALID_ARTIFACTS',
        `ValidationGate en échec : ${validation.validationErrors.join(' | ')}`,
        { validation: validationSummary }
      );
    }

    const preflight: OrchestrationExecutionPreflight[] = [];
    for (const artifact of fileChanges) {
      const payload = artifact.payload as ProposedFileChangePayload;
      if (payload.operation === 'DELETE') continue;
      if (!/\.html?$/i.test(payload.filePath)) continue;
      const report = runEngineeringPreflight(payload.proposedContent ?? '', payload.filePath);
      preflight.push({ path: payload.filePath, report });
    }
    if (preflight.some((item) => !item.report.passed)) {
      return this.executionRefusal(
        'PREFLIGHT_FAILED',
        'Préflight d\'ingénierie en échec : le contenu candidat ne peut pas être écrit.',
        { validation: validationSummary, preflight }
      );
    }

    // V7-LOT7 — après le préflight structurel, le document est RÉELLEMENT
    // exécuté dans Chromium (réseau coupé). Seul un échec dur bloque ; les
    // avertissements (CDN absent, image bloquée, overflow) restent consultatifs.
    const runtime: OrchestrationExecutionRuntime[] = [];
    const runtimeDocuments = fileChanges.filter((artifact) => {
      const payload = artifact.payload as ProposedFileChangePayload;
      return /\.html?$/i.test(payload.filePath) &&
        (payload.operation === 'CREATE' || payload.operation === 'UPDATE') &&
        typeof payload.proposedContent === 'string';
    });
    const runtimeCandidates = runtimeDocuments.slice(0, MAX_RUNTIME_DOCUMENTS);
    const runtimeSkipped = Math.max(0, runtimeDocuments.length - runtimeCandidates.length);

    for (const artifact of runtimeCandidates) {
      const payload = artifact.payload as ProposedFileChangePayload;
      let report: BrowserSandboxReport;
      try {
        report = await this.browserSandbox.run(payload.proposedContent ?? '', {
          path: payload.filePath,
          // V7-LOT8 — les scénarios fonctionnels sont générés à partir du DOM
          // réel et exécutés dans le même Chromium isolé.
          functionalTests: true
        });
      } catch (err) {
        return this.executionRefusal(
          'RUNTIME_FAILED',
          `Sandbox navigateur en erreur pour '${payload.filePath}' : ` +
          `${err instanceof Error ? err.message : String(err)}`,
          { validation: validationSummary, preflight, runtime, runtimeSkipped }
        );
      }
      runtime.push({ path: payload.filePath, report });
    }

    const failedRuntime = runtime.filter((item) => item.report.blocking);

    // Traçabilité persistante du sandbox : le rapport complet reste une
    // réponse live (capture incluse), mais le verdict et ses métriques sont
    // audités pour chaque preview/apply, y compris en cas d'échec.
    auditStore.record({
      tenantId: options.tenantId,
      userId: options.userRole ?? 'system',
      action: 'AI_ORCHESTRATION_RUNTIME_CHECKED',
      resourceType: 'ai_orchestrator',
      resourceId: run.orchestrationId,
      status: failedRuntime.length > 0 ? 'FAILURE' : 'SUCCESS',
      metadata: {
        runtimeSkipped,
        runtime: runtime.map((item) => ({
          path: item.path,
          verdict: item.report.verdict,
          blocking: item.report.blocking,
          durationMs: item.report.durationMs,
          blockers: item.report.blockers.length,
          warnings: item.report.warnings.length,
          screenshotBytes: item.report.metrics.screenshotBytes,
          screenshotSha256: item.report.metrics.screenshotSha256,
          contentHash: item.report.contentHash
        }))
      },
      requestId: options.requestId ?? 'req-orch-runtime'
    });

    if (failedRuntime.length > 0) {
      const details = failedRuntime
        .map((item) => `${item.path} : ${item.report.blockers.join(' | ')}`)
        .join(' ; ')
        .slice(0, 1200);
      return this.executionRefusal(
        'RUNTIME_FAILED',
        `Sandbox d'exécution en échec : ${details}`,
        { validation: validationSummary, preflight, runtime, runtimeSkipped }
      );
    }

    // V7-LOT8 — les tests fonctionnels générés sont agrégés et audités après
    // le runtime. Un échec déterministe bloque l'écriture ; UNAVAILABLE et
    // SKIPPED restent explicites et non bloquants.
    const functionalTests = this.summarizeFunctionalTests(runtime);
    auditStore.record({
      tenantId: options.tenantId,
      userId: options.userRole ?? 'system',
      action: 'AI_ORCHESTRATION_FUNCTIONAL_TESTS_CHECKED',
      resourceType: 'ai_orchestrator',
      resourceId: run.orchestrationId,
      status: functionalTests.blocking ? 'FAILURE' : 'SUCCESS',
      metadata: {
        verdict: functionalTests.verdict,
        blocking: functionalTests.blocking,
        total: functionalTests.total,
        passed: functionalTests.passedCount,
        failed: functionalTests.failedCount,
        warnings: functionalTests.warningCount,
        skipped: functionalTests.skippedCount,
        durationMs: functionalTests.durationMs,
        documents: functionalTests.documents.map((item) => ({
          path: item.path,
          verdict: item.report.verdict,
          blocking: item.report.blocking,
          total: item.report.total,
          failed: item.report.failedCount,
          warnings: item.report.warningCount,
          skipped: item.report.skippedCount,
          scenarios: item.report.scenarios
            .filter((scenario) => scenario.status === 'FAIL' || scenario.status === 'WARN')
            .slice(0, 8)
            .map((scenario) => ({
              id: scenario.id,
              name: scenario.name,
              status: scenario.status,
              message: scenario.message
            }))
        }))
      },
      requestId: options.requestId ?? 'req-orch-functional-tests'
    });

    if (functionalTests.blocking) {
      const details = functionalTests.documents
        .flatMap((item) => item.report.scenarios
          .filter((scenario) => scenario.status === 'FAIL')
          .map((scenario) => `${item.path} / ${scenario.name} : ${scenario.message ?? 'échec'}`))
        .join(' ; ')
        .slice(0, 1200);
      return this.executionRefusal(
        'FUNCTIONAL_TESTS_FAILED',
        `Tests fonctionnels générés en échec : ${details}`,
        { validation: validationSummary, preflight, runtime, runtimeSkipped, functionalTests }
      );
    }

    return {
      validation,
      preflight,
      runtime,
      runtimeSkipped,
      functionalTests,
      fileChanges,
      breakingCount
    };
  }

  private summarizeFunctionalTests(
    runtime: readonly OrchestrationExecutionRuntime[]
  ): OrchestrationExecutionFunctionalTests {
    const documents = runtime
      .filter((item) => item.report.functionalTests !== undefined)
      .map((item) => ({
        path: item.path,
        report: item.report.functionalTests as NonNullable<typeof item.report.functionalTests>
      }));

    if (documents.length === 0) {
      // Aucun document fonctionnel : soit le run n'a aucun HTML, soit Chromium
      // était indisponible. Dans le second cas, le dire explicitement
      // (`UNAVAILABLE`) au lieu de laisser croire à un simple skip.
      const allUnavailable = runtime.length > 0 &&
        runtime.every((item) => item.report.verdict === 'UNAVAILABLE');
      return {
        verdict: allUnavailable ? 'UNAVAILABLE' : 'SKIPPED',
        passed: false,
        blocking: false,
        total: 0,
        passedCount: 0,
        failedCount: 0,
        warningCount: 0,
        skippedCount: 0,
        durationMs: 0,
        documents: []
      };
    }

    const total = documents.reduce((sum, item) => sum + item.report.total, 0);
    const passedCount = documents.reduce((sum, item) => sum + item.report.passedCount, 0);
    const failedCount = documents.reduce((sum, item) => sum + item.report.failedCount, 0);
    const warningCount = documents.reduce((sum, item) => sum + item.report.warningCount, 0);
    const skippedCount = documents.reduce((sum, item) => sum + item.report.skippedCount, 0);
    const durationMs = documents.reduce((sum, item) => sum + item.report.durationMs, 0);
    const blocking = documents.some((item) => item.report.blocking);
    const hasPassed = documents.some((item) =>
      item.report.verdict === 'PASS' || item.report.verdict === 'PASS_WITH_WARNINGS'
    );
    const hasUnavailable = documents.some((item) => item.report.verdict === 'UNAVAILABLE');
    const allSkipped = documents.every((item) => item.report.verdict === 'SKIPPED');
    const hasWarnings = documents.some((item) =>
      item.report.verdict === 'PASS_WITH_WARNINGS' ||
      item.report.verdict === 'SKIPPED' ||
      item.report.warningCount > 0
    );

    const verdict: OrchestrationExecutionFunctionalTests['verdict'] = blocking
      ? 'FAIL'
      : hasUnavailable
        ? (hasPassed ? 'PASS_WITH_WARNINGS' : 'UNAVAILABLE')
        : allSkipped
          ? 'SKIPPED'
          : hasWarnings
            ? 'PASS_WITH_WARNINGS'
            : 'PASS';

    return {
      verdict,
      passed: verdict === 'PASS' || verdict === 'PASS_WITH_WARNINGS',
      blocking,
      total,
      passedCount,
      failedCount,
      warningCount,
      skippedCount,
      durationMs,
      documents
    };
  }

  private summarizeExecutionValidation(
    validation: ValidationGateResult,
    breakingCount: number
  ): OrchestrationExecutionValidation {
    return {
      isValid: validation.isValid,
      requiresHumanApproval: validation.requiresHumanApproval,
      riskLevel: validation.riskLevel,
      validationErrors: validation.validationErrors,
      breakingCount
    };
  }

  private summarizeExecutionTransaction(
    transaction: MutationTransaction
  ): OrchestrationExecutionTransaction {
    return {
      transactionId: transaction.transactionId,
      status: transaction.status,
      appliedCount: transaction.appliedMutations.length,
      durationMs: transaction.durationMs,
      transactionHash: transaction.transactionHash,
      createdAt: transaction.createdAt
    };
  }

  private executionRefusal(
    code: OrchestrationExecutionRefusalCode,
    message: string,
    extras?: {
      validation?: OrchestrationExecutionValidation | undefined;
      preflight?: readonly OrchestrationExecutionPreflight[] | undefined;
      runtime?: readonly OrchestrationExecutionRuntime[] | undefined;
      runtimeSkipped?: number | undefined;
      functionalTests?: OrchestrationExecutionFunctionalTests | undefined;
      run?: OrchestrationRun | undefined;
      transaction?: OrchestrationExecutionTransaction | undefined;
    }
  ): OrchestrationExecutionRefusal {
    return {
      ok: false,
      code,
      message,
      ...(extras?.validation ? { validation: extras.validation } : {}),
      ...(extras?.preflight !== undefined ? { preflight: extras.preflight } : {}),
      ...(extras?.runtime !== undefined ? { runtime: extras.runtime } : {}),
      ...(extras?.runtimeSkipped !== undefined ? { runtimeSkipped: extras.runtimeSkipped } : {}),
      ...(extras?.functionalTests ? { functionalTests: extras.functionalTests } : {}),
      ...(extras?.run ? { run: extras.run } : {}),
      ...(extras?.transaction ? { transaction: extras.transaction } : {})
    };
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

  /**
   * CDC V8 §11 — assemblage public d'un contexte de tâche selon les mêmes
   * règles que le scheduler (fichiers ciblés assainis, slice sémantique,
   * Design DNA réel quand `includeDna` est demandé). Utilisé par les routes
   * d'exécution unitaire/par lot qui ne passent pas par le scheduler.
   */
  public assembleTaskContext(params: {
    tenantId: string;
    projectId: string;
    task: AgentTask;
    rawFiles?: Record<string, string> | undefined;
    decisions?: readonly string[] | undefined;
    constraints?: readonly string[] | undefined;
    userRole?: Role | undefined;
    requestId?: string | undefined;
  }): TaskContextPayload {
    return this.contextOrchestrator.assembleTaskContext(params);
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

  /** ÉTAPE 34 — Registry unique du roster (résolution ID/capability/domaine). */
  public getExecutionAgentRegistry(): AgentRegistryService {
    return this.agentRegistry;
  }

  /** ÉTAPE 37 — scheduler multi-agents (le MÊME AgentExecutionService). */
  public async executeBatch(request: MultiAgentSchedulerRequest): Promise<MultiAgentSchedulerOutcome> {
    return this.multiAgentScheduler.execute(request);
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
