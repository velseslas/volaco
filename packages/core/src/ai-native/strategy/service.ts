/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Strategy Optimizer Service - Master Strategic Intelligence Service
 * 
 * Strict Invariants:
 * - NO EVIDENCE → NO CLAIM (all recommendations verified with provenance)
 * - HUMAN CONTROL (recommendations are strictly advisory, no direct code mutation)
 * - DETERMINISTIC SCORING (0-100 pure mathematical formulas, no Math.random())
 * - MULTI-TENANT ISOLATION (strict tenancy checks)
 * - RBAC ENFORCEMENT (assertPermission on all actions)
 */

import { assertPermission, type Role } from '../../identity/permissions.js';
import { auditStore } from '../../observability/audit.js';
import { NotFoundError, ValidationError } from '../../errors.js';
import { StrategyLruCache } from './cache.js';
import { computeStrategyReportHash } from './canonical.js';
import type {
  StrategyOptimizationRequest,
  StrategyOptimizationReport,
  StrategicRecommendation,
  StrategicRoadmap,
  WhatIfComparison,
  StrategyApprovalResult,
  StrategicMemoryEntry,
  RecommendationStatus
} from './types.js';

import { StrategyContextBuilder } from './intelligence/strategy-context-builder.js';
import { StrategicSignalAggregator } from './intelligence/strategic-signal-aggregator.js';
import { StrategicRecommendationEngine } from './decision/recommendation-engine.js';
import { DecisionEngine } from './decision/decision-engine.js';
import { PriorityRankingEngine } from './prioritization/priority-ranking-engine.js';
import { StrategicRoadmapEngine } from './planning/strategic-roadmap-engine.js';
import { AlternativePlanner } from './planning/alternative-planner.js';
import { StrategyStateMachine } from './lifecycle/strategy-state-machine.js';
import { RecommendationLifecycleManager } from './lifecycle/recommendation-lifecycle.js';
import { StrategyOrchestratorBridge } from './bridge/orchestrator-bridge.js';

export class StrategyOptimizerService {
  private readonly cache: StrategyLruCache;
  private readonly contextBuilder = new StrategyContextBuilder();
  private readonly signalAggregator = new StrategicSignalAggregator();
  private readonly recommendationEngine = new StrategicRecommendationEngine();
  private readonly decisionEngine = new DecisionEngine();
  private readonly rankingEngine = new PriorityRankingEngine();
  private readonly roadmapEngine = new StrategicRoadmapEngine();
  private readonly alternativePlanner = new AlternativePlanner();
  private readonly lifecycleManager = new RecommendationLifecycleManager();
  private readonly orchestratorBridge = new StrategyOrchestratorBridge();

  // Multi-tenant Strategic Memory Store: tenantId -> projectId -> memory entries
  private readonly memoryStore = new Map<string, Map<string, StrategicMemoryEntry[]>>();

  constructor(cacheSize = 100) {
    this.cache = new StrategyLruCache(cacheSize);
  }

  private getProjectMemory(tenantId: string, projectId: string): StrategicMemoryEntry[] {
    const tenantMap = this.memoryStore.get(tenantId);
    if (!tenantMap) return [];
    return tenantMap.get(projectId) || [];
  }

  private saveMemoryEntry(entry: StrategicMemoryEntry): void {
    let tenantMap = this.memoryStore.get(entry.tenantId);
    if (!tenantMap) {
      tenantMap = new Map();
      this.memoryStore.set(entry.tenantId, tenantMap);
    }
    let projectList = tenantMap.get(entry.projectId);
    if (!projectList) {
      projectList = [];
      tenantMap.set(entry.projectId, projectList);
    }
    projectList.push(entry);
  }

  /**
   * Runs the full strategic optimization pipeline and returns a StrategyOptimizationReport.
   */
  public async optimizeStrategy(
    request: StrategyOptimizationRequest,
    requestId: string
  ): Promise<StrategyOptimizationReport> {
    const startTime = performance.now();

    // 1. RBAC Validation: PROJECT_READ required to optimize/view strategy
    assertPermission(request.callerRole, 'PROJECT_READ', requestId);

    if (!request.tenantId || !request.projectId) {
      throw new ValidationError('tenantId et projectId sont obligatoires', undefined, requestId);
    }

    const stateMachine = new StrategyStateMachine();
    stateMachine.transitionTo('AGGREGATING');

    // 2. Load Strategic Memory
    const existingMemory = this.getProjectMemory(request.tenantId, request.projectId);
    const contextRequest: StrategyOptimizationRequest = {
      ...request,
      priorDecisions: [...existingMemory, ...(request.priorDecisions || [])]
    };

    // 3. Build Deterministic Strategic Context
    const context = this.contextBuilder.buildContext(contextRequest);

    // 4. Check LRU Cache
    if (!request.options?.forceRecompute) {
      const cached = this.cache.get(request.tenantId, request.projectId, context.inputHash);
      if (cached) {
        return cached;
      }
    }

    // 5. Aggregate Strategic Signals from all AINT milestones
    const rawCandidates = this.signalAggregator.aggregateCandidates(context);

    // 6. Build Recommendations with Evidence Verification (NO EVIDENCE → NO CLAIM)
    stateMachine.transitionTo('PRIORITIZING');
    const rawRecommendations = this.recommendationEngine.buildRecommendations(rawCandidates, context);

    // 7. Apply Memory & Prior Decisions
    const memoryFiltered = this.decisionEngine.applyMemoryAndDecisions(rawRecommendations, context);

    // 8. Deterministic Ranking
    const rankedRecommendations = this.rankingEngine.rank(memoryFiltered);

    // 9. Plan Horizons & Roadmap
    stateMachine.transitionTo('PLANNING');
    const roadmap = this.roadmapEngine.generateRoadmap(
      request.tenantId,
      request.projectId,
      rankedRecommendations
    );

    // 10. Generate What-If Comparative Matrix
    const whatIfAnalysis = this.alternativePlanner.generateAlternatives(rankedRecommendations);

    // 11. Calculate Overall Application Strategic Health Score (0-100)
    let overallScore = 100;
    const criticalBugs = rankedRecommendations.filter(r => r.type === 'FIX_CRITICAL_PROBLEM').length;
    const regressions = rankedRecommendations.filter(r => r.type === 'FIX_REGRESSION').length;
    const securityRisks = rankedRecommendations.filter(r => r.type === 'FIX_SECURITY_RISK').length;

    overallScore -= criticalBugs * 15;
    overallScore -= regressions * 15;
    overallScore -= securityRisks * 10;
    if (context.auditReport?.overallScore) {
      overallScore = Math.round(0.6 * overallScore + 0.4 * context.auditReport.overallScore);
    }
    overallScore = Math.min(100, Math.max(0, overallScore));

    stateMachine.transitionTo('OPTIMIZED');

    const durationMs = Math.round(performance.now() - startTime);

    const reportId = `strat-rep-${request.projectId}-${Date.now()}`;
    const reportHash = computeStrategyReportHash({
      tenantId: request.tenantId,
      projectId: request.projectId,
      overallStrategicScore: overallScore,
      recommendationIds: rankedRecommendations.map(r => r.id)
    });

    const report: StrategyOptimizationReport = {
      id: reportId,
      tenantId: request.tenantId,
      projectId: request.projectId,
      overallStrategicScore: overallScore,
      topPriorities: rankedRecommendations.slice(0, 5),
      allRecommendations: rankedRecommendations,
      roadmap,
      whatIfAnalysis,
      contextSummary: {
        auditFindingsCount: context.auditReport?.findings?.length || 0,
        featureOpportunitiesCount: context.featureReport?.opportunities?.length || 0,
        userProblemsCount: context.feedbackReport?.problems?.length || 0,
        regressionsCount: regressions,
        criticalDefectsCount: criticalBugs
      },
      metrics: {
        analysisDurationMs: durationMs,
        totalEvidenceEvaluated: rankedRecommendations.reduce((sum, r) => sum + r.evidence.length, 0),
        rulesTriggeredCount: rawCandidates.length
      },
      createdAt: new Date().toISOString(),
      reportHash
    };

    // Store in LRU Cache
    this.cache.set(request.tenantId, request.projectId, context.inputHash, report);

    // Record Audit Trail
    auditStore.record({
      tenantId: request.tenantId,
      userId: request.callerRole,
      action: 'STRATEGY_OPTIMIZED',
      resourceType: 'PROJECT',
      resourceId: request.projectId,
      status: 'SUCCESS',
      requestId,
      metadata: {
        reportId,
        score: overallScore,
        recommendationsCount: rankedRecommendations.length
      }
    });

    return report;
  }

  /**
   * Retrieves an existing strategy report from cache if available.
   */
  public getReport(
    tenantId: string,
    projectId: string,
    role: Role,
    requestId: string
  ): StrategyOptimizationReport | undefined {
    assertPermission(role, 'PROJECT_READ', requestId);
    const internalCache = (this.cache as unknown as { cache: Map<string, StrategyOptimizationReport> }).cache;
    for (const report of internalCache.values()) {
      if (report.tenantId === tenantId && report.projectId === projectId) {
        return report;
      }
    }
    return undefined;
  }

  /**
   * Approves a recommendation and projects an EngineeringTaskGraph for AINT-010 without mutating code.
   */
  public async approveRecommendation(
    tenantId: string,
    projectId: string,
    recommendationId: string,
    role: Role,
    reason = 'Approuvé par ingénieur',
    requestId: string
  ): Promise<StrategyApprovalResult> {
    assertPermission(role, 'PROJECT_UPDATE', requestId);

    const report = this.getReport(tenantId, projectId, role, requestId);
    if (!report) {
      throw new NotFoundError(`Rapport de stratégie pour le projet ${projectId}`, requestId);
    }

    const rec = report.allRecommendations.find(r => r.id === recommendationId);
    if (!rec) {
      throw new NotFoundError(`Recommandation ${recommendationId}`, requestId);
    }

    // Enforce state transition
    const { updatedRecommendation, memoryEntry } = this.lifecycleManager.transition(
      rec,
      'APPROVED',
      role,
      reason,
      requestId
    );

    // Update in-memory reference
    const idx = report.allRecommendations.findIndex(r => r.id === recommendationId);
    if (idx !== -1) {
      report.allRecommendations[idx] = updatedRecommendation;
    }

    // Save into Strategic Memory
    this.saveMemoryEntry(memoryEntry);

    // Project EngineeringTaskGraph (ANALYZE -> MODIFY -> VERIFY)
    const taskGraph = this.orchestratorBridge.projectTaskGraph(updatedRecommendation);

    // Record Audit
    auditStore.record({
      tenantId,
      userId: role,
      action: 'STRATEGY_RECOMMENDATION_APPROVED',
      resourceType: 'PROJECT',
      resourceId: projectId,
      status: 'SUCCESS',
      requestId,
      metadata: {
        recommendationId,
        taskGraphId: taskGraph.graphId
      }
    });

    return {
      success: true,
      recommendationId,
      previousStatus: rec.status,
      newStatus: 'APPROVED',
      generatedTaskGraph: taskGraph,
      recordedMemoryEntry: memoryEntry,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Rejects a recommendation and records the rejection in Strategic Memory.
   */
  public async rejectRecommendation(
    tenantId: string,
    projectId: string,
    recommendationId: string,
    role: Role,
    reason = 'Rejeté par l utilisateur',
    requestId: string
  ): Promise<StrategyApprovalResult> {
    assertPermission(role, 'PROJECT_UPDATE', requestId);

    const report = this.getReport(tenantId, projectId, role, requestId);
    if (!report) {
      throw new NotFoundError(`Rapport de stratégie pour le projet ${projectId}`, requestId);
    }

    const rec = report.allRecommendations.find(r => r.id === recommendationId);
    if (!rec) {
      throw new NotFoundError(`Recommandation ${recommendationId}`, requestId);
    }

    const { updatedRecommendation, memoryEntry } = this.lifecycleManager.transition(
      rec,
      'REJECTED',
      role,
      reason,
      requestId
    );

    const idx = report.allRecommendations.findIndex(r => r.id === recommendationId);
    if (idx !== -1) {
      report.allRecommendations[idx] = updatedRecommendation;
    }

    this.saveMemoryEntry(memoryEntry);

    auditStore.record({
      tenantId,
      userId: role,
      action: 'STRATEGY_RECOMMENDATION_REJECTED',
      resourceType: 'PROJECT',
      resourceId: projectId,
      status: 'SUCCESS',
      requestId,
      metadata: {
        recommendationId,
        reason
      }
    });

    return {
      success: true,
      recommendationId,
      previousStatus: rec.status,
      newStatus: 'REJECTED',
      recordedMemoryEntry: memoryEntry,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Retrieves memory entries for a project.
   */
  public getMemory(tenantId: string, projectId: string, role: Role, requestId: string): StrategicMemoryEntry[] {
    assertPermission(role, 'PROJECT_READ', requestId);
    return this.getProjectMemory(tenantId, projectId);
  }

  /**
   * Returns cache metrics.
   */
  public getCacheMetrics() {
    return this.cache.getMetrics();
  }
}
