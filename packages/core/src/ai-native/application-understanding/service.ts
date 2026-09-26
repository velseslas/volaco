/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * Application Understanding Service Facade
 */

import { logger } from '../../logger.js';
import { ValidationError } from '../../errors.js';
import { assertPermission, type Role } from '../../identity/permissions.js';
import { auditStore } from '../../observability/audit.js';
import type { SemanticCodeGraphService } from '../semantic-graph/service.js';
import type { ApplicationDNAService } from '../dna/service.js';
import type { ImpactIntelligenceService } from '../impact-intelligence/service.js';
import type { CodeIntelligenceService } from '../understanding/service.js';
import { UnderstandingLruCache } from './cache.js';
import { runUnderstandingAnalysis } from './engine/understanding-engine.js';
import { executeSemanticQuery } from './query/semantic-query.js';
import type {
  ApplicationSemanticModel,
  SemanticQueryRequest,
  SemanticQueryResult,
  UnderstandingCacheMetrics,
  UnderstandingConfig,
  UnderstandingMetrics,
  UnderstandingRequest
} from './types.js';

export const DEFAULT_UNDERSTANDING_CONFIG: UnderstandingConfig = {
  understandingVersion: '1.0.0',
  cacheMaxEntries: 100,
  minConfidenceThreshold: 0.30
};

export class ApplicationUnderstandingService {
  private readonly config: UnderstandingConfig;
  private readonly cache: UnderstandingLruCache;

  constructor(
    private readonly semanticGraphService: SemanticCodeGraphService,
    private readonly dnaService?: ApplicationDNAService | undefined,
    private readonly impactService?: ImpactIntelligenceService | undefined,
    private readonly codeIntelligenceService?: CodeIntelligenceService | undefined,
    config?: Partial<UnderstandingConfig> | undefined
  ) {
    this.config = {
      ...DEFAULT_UNDERSTANDING_CONFIG,
      ...config
    };
    this.cache = new UnderstandingLruCache(this.config.cacheMaxEntries);
  }

  /**
   * Builds the comprehensive Application Semantic Model for a project.
   */
  public buildUnderstanding(
    request: UnderstandingRequest,
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): ApplicationSemanticModel {
    // 1. RBAC Check (Read permission is strictly required)
    assertPermission(userRole, 'PROJECT_READ', requestId);

    // 2. Input Validation
    if (!request.tenantId || typeof request.tenantId !== 'string' || request.tenantId.trim().length === 0) {
      throw new ValidationError('tenantId est obligatoire pour la compréhension sémantique');
    }
    if (!request.projectId || typeof request.projectId !== 'string' || request.projectId.trim().length === 0) {
      throw new ValidationError('projectId est obligatoire pour la compréhension sémantique');
    }

    const tenantId = request.tenantId.trim();
    const projectId = request.projectId.trim();

    // 3. Resolve Semantic Graph
    const graph = request.targetGraph ?? this.semanticGraphService.buildGraph(
      { tenantId, projectId, includeTests: request.includeTests },
      userRole,
      requestId
    );

    // 4. Check LRU Cache
    const cacheKey = UnderstandingLruCache.buildKey(tenantId, projectId, graph.graphHash);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 5. Optional Application DNA
    let dna = undefined;
    if (this.dnaService) {
      try {
        dna = this.dnaService.extractDNA(tenantId, projectId, userRole, requestId);
      } catch (err) {
        logger.warn('Échec de l\'extraction du DNA applicatif — moteur de compréhension non bloqué', {
          component: 'application-understanding',
          tenantId,
          projectId,
          err: err instanceof Error ? err.message : String(err)
        });
      }
    }

    // 6. Execute Core Understanding Pipeline
    const model = runUnderstandingAnalysis(
      { ...request, tenantId, projectId },
      graph,
      dna,
      this.config
    );

    // 7. Store in LRU Cache
    this.cache.set(cacheKey, model);

    // 8. Record Audit Event
    if (requestId) {
      try {
        auditStore.record({
          tenantId,
          userId: 'system',
          action: 'UNDERSTANDING_BUILT',
          resourceType: 'project',
          resourceId: projectId,
          status: 'SUCCESS',
          metadata: {
            understandingHash: model.understandingHash,
            totalFeatures: model.summary.totalFeatures,
            totalDomains: model.summary.totalDomains,
            overallConfidence: model.summary.overallConfidence
          },
          requestId
        });
      } catch (err) {
        logger.warn('Échec d\'audit lors de l\'analyse de compréhension applicative — non bloquant', {
          component: 'application-understanding',
          tenantId,
          projectId,
          err: err instanceof Error ? err.message : String(err)
        });
      }
    }

    return model;
  }

  /**
   * Retrieves an existing understanding model from cache if present.
   */
  public getUnderstanding(
    tenantId: string,
    projectId: string,
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): ApplicationSemanticModel | null {
    assertPermission(userRole, 'PROJECT_READ', requestId);

    if (!tenantId || !projectId) {
      throw new ValidationError('tenantId et projectId sont obligatoires');
    }

    // Lookup latest cached for this project
    const prefix = `${tenantId}:${projectId}:`;
    for (const [key, model] of (this.cache as unknown as { cache: Map<string, ApplicationSemanticModel> }).cache.entries()) {
      if (key.startsWith(prefix)) {
        return model;
      }
    }
    return null;
  }

  /**
   * Executes a structured semantic query over the application understanding model.
   */
  public queryUnderstanding(
    request: SemanticQueryRequest,
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): SemanticQueryResult {
    assertPermission(userRole, 'PROJECT_READ', requestId);

    const model = request.model ?? this.buildUnderstanding(
      { tenantId: request.tenantId, projectId: request.projectId },
      userRole,
      requestId
    );

    return executeSemanticQuery(model, request);
  }

  /**
   * Retrieves high-level understanding metrics for a project.
   */
  public getUnderstandingMetrics(
    tenantId: string,
    projectId: string,
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): UnderstandingMetrics {
    assertPermission(userRole, 'PROJECT_READ', requestId);

    const model = this.buildUnderstanding({ tenantId, projectId }, userRole, requestId);
    return model.metrics;
  }

  /**
   * Evicts cached models for a specific project.
   */
  public invalidateProject(tenantId: string, projectId: string): number {
    return this.cache.invalidateProject(tenantId, projectId);
  }

  /**
   * Clears the entire understanding cache.
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Returns cache metrics.
   */
  public getCacheMetrics(): UnderstandingCacheMetrics {
    return this.cache.getMetrics();
  }
}
