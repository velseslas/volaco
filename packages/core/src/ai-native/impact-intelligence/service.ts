/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-005)
 * Impact Intelligence Engine Facade Service
 */

import { ValidationError } from '../../errors.js';
import { assertPermission, type Role } from '../../identity/permissions.js';
import { auditStore } from '../../observability/audit.js';
import type { SemanticCodeGraph } from '../semantic-graph/types.js';
import type { SemanticCodeGraphService } from '../semantic-graph/service.js';
import { ImpactLruCache } from './cache.js';
import { DEFAULT_IMPACT_CONFIG, runImpactAnalysis } from './engine/impact-analyzer.js';
import type {
  ImpactAnalysis,
  ImpactAnalysisRequest,
  ImpactCacheMetrics,
  ImpactIntelligenceConfig
} from './types.js';

export class ImpactIntelligenceService {
  private readonly config: ImpactIntelligenceConfig;
  private readonly cache: ImpactLruCache;

  constructor(
    private readonly semanticGraphService: SemanticCodeGraphService,
    config?: Partial<ImpactIntelligenceConfig> | undefined
  ) {
    this.config = {
      ...DEFAULT_IMPACT_CONFIG,
      ...config
    };
    this.cache = new ImpactLruCache(this.config.cacheMaxEntries);
  }

  /**
   * Analyzes the blast radius, ripple effects, and risk of code changes on a project.
   */
  public analyzeImpact(
    request: ImpactAnalysisRequest,
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): ImpactAnalysis {
    const startTime = Date.now();

    // 1. Mandatory Input Validation
    if (!request.tenantId || typeof request.tenantId !== 'string' || request.tenantId.trim().length === 0) {
      throw new ValidationError('tenantId est obligatoire pour l\'analyse d\'impact');
    }
    if (!request.projectId || typeof request.projectId !== 'string' || request.projectId.trim().length === 0) {
      throw new ValidationError('projectId est obligatoire pour l\'analyse d\'impact');
    }

    const hasNodeIds = Boolean(request.targetNodeIds && request.targetNodeIds.length > 0);
    const hasFiles = Boolean(request.targetFiles && request.targetFiles.length > 0);
    const hasSymbols = Boolean(request.targetSymbols && request.targetSymbols.length > 0);

    if (!hasNodeIds && !hasFiles && !hasSymbols) {
      throw new ValidationError(
        'Au moins une cible (targetNodeIds, targetFiles ou targetSymbols) est requise pour l\'analyse d\'impact'
      );
    }

    // 2. Strict RBAC Enforcement
    assertPermission(userRole, 'PROJECT_READ', requestId);

    const tenantId = request.tenantId.trim();
    const projectId = request.projectId.trim();

    // 3. Obtain SemanticCodeGraph from AINT-004
    const graph = this.semanticGraphService.buildGraph(
      { tenantId, projectId },
      userRole,
      requestId
    );

    // 4. Check LRU Cache (isolated by tenantId, projectId, graphHash, and request payload)
    const normalizedRequest = {
      targetNodeIds: request.targetNodeIds ? [...request.targetNodeIds].sort() : [],
      targetFiles: request.targetFiles ? [...request.targetFiles].sort() : [],
      targetSymbols: request.targetSymbols ? [...request.targetSymbols].sort() : [],
      direction: request.direction ?? 'UPSTREAM_DEPENDENTS',
      maxDepth: request.maxDepth ?? this.config.defaultMaxDepth,
      changeType: request.changeType ?? 'MODIFY',
      includeInformational: request.includeInformational ?? false
    };

    const cacheKey = this.cache.computeCacheKey(
      tenantId,
      projectId,
      graph.graphHash,
      this.config.analyzerVersion,
      normalizedRequest
    );

    const cachedAnalysis = this.cache.get(cacheKey);
    if (cachedAnalysis) {
      return cachedAnalysis;
    }

    // 5. Run Impact Analysis
    const analysis = runImpactAnalysis(graph, request, {
      config: this.config,
      startTime
    });

    // 6. Cache Result
    this.cache.set(cacheKey, analysis);

    // 7. Audit Logging
    if (requestId) {
      try {
        auditStore.record({
          tenantId,
          userId: 'system',
          action: 'IMPACT_ANALYSIS_COMPLETED',
          resourceType: 'project',
          resourceId: projectId,
          status: 'SUCCESS',
          metadata: {
            impactHash: analysis.impactHash,
            graphHash: analysis.graphHash,
            totalImpactedNodes: analysis.metrics.totalImpactedNodes,
            overallRisk: analysis.overallRisk,
            overallScore: analysis.metrics.overallScore,
            durationMs: analysis.durationMs
          },
          requestId
        });
      } catch {
        // Observability failure must not disrupt analysis response
      }
    }

    return analysis;
  }

  /**
   * Direct execution of impact analysis on an already built SemanticCodeGraph.
   */
  public analyzeImpactOnGraph(
    graph: SemanticCodeGraph,
    request: Omit<ImpactAnalysisRequest, 'tenantId' | 'projectId'>,
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): ImpactAnalysis {
    const startTime = Date.now();

    // 1. Strict RBAC Enforcement
    assertPermission(userRole, 'PROJECT_READ', requestId);

    // 2. Mandatory Target Validation
    const hasNodeIds = Boolean(request.targetNodeIds && request.targetNodeIds.length > 0);
    const hasFiles = Boolean(request.targetFiles && request.targetFiles.length > 0);
    const hasSymbols = Boolean(request.targetSymbols && request.targetSymbols.length > 0);

    if (!hasNodeIds && !hasFiles && !hasSymbols) {
      throw new ValidationError(
        'Au moins une cible (targetNodeIds, targetFiles ou targetSymbols) est requise pour l\'analyse d\'impact'
      );
    }

    const fullRequest: ImpactAnalysisRequest = {
      ...request,
      tenantId: graph.tenantId,
      projectId: graph.projectId
    };

    const analysis = runImpactAnalysis(graph, fullRequest, {
      config: this.config,
      startTime
    });

    // Audit Logging
    if (requestId) {
      try {
        auditStore.record({
          tenantId: graph.tenantId,
          userId: 'system',
          action: 'IMPACT_ANALYSIS_COMPLETED',
          resourceType: 'project',
          resourceId: graph.projectId,
          status: 'SUCCESS',
          metadata: {
            impactHash: analysis.impactHash,
            graphHash: analysis.graphHash,
            totalImpactedNodes: analysis.metrics.totalImpactedNodes,
            overallRisk: analysis.overallRisk,
            overallScore: analysis.metrics.overallScore,
            durationMs: analysis.durationMs
          },
          requestId
        });
      } catch {
        // Ignore audit error
      }
    }

    return analysis;
  }

  public getCacheMetrics(): ImpactCacheMetrics {
    return this.cache.getMetrics();
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
