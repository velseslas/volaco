/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-004)
 * Semantic Code Graph Engine Facade Service
 */

import { logger } from '../../logger.js';
import { ForbiddenError, ValidationError } from '../../errors.js';
import { assertPermission, hasPermission, type Role } from '../../identity/permissions.js';
import { auditStore } from '../../observability/audit.js';
import type { CodeIntelligenceService } from '../understanding/service.js';
import type { IReadOnlyFileSource } from '../understanding/types.js';
import type { ApplicationDNAService } from '../dna/service.js';
import { computeRequestHash } from '../context/index.js';
import type {
  SemanticCodeGraph,
  SemanticGraphCacheMetrics,
  SemanticGraphConfig,
  SemanticGraphRequest
} from './types.js';
import { SemanticGraphLruCache } from './cache.js';
import { assembleSemanticGraph } from './graph.js';
import { buildSemanticNodes } from './engine/nodes.js';
import { buildSemanticEdges } from './engine/edges.js';

export const DEFAULT_SEMANTIC_GRAPH_CONFIG: SemanticGraphConfig = {
  assemblerVersion: '1.0.0',
  cacheMaxEntries: 150
};

export class SemanticCodeGraphService {
  private readonly config: SemanticGraphConfig;
  private readonly cache: SemanticGraphLruCache;

  constructor(
    private readonly codeIntelligenceService: CodeIntelligenceService,
    private readonly applicationDnaService: ApplicationDNAService,
    private readonly fileSource?: IReadOnlyFileSource | undefined,
    config?: Partial<SemanticGraphConfig> | undefined
  ) {
    this.config = {
      ...DEFAULT_SEMANTIC_GRAPH_CONFIG,
      ...config
    };
    this.cache = new SemanticGraphLruCache(this.config.cacheMaxEntries);
  }

  /**
   * Builds an immutable, deterministic, evidence-backed SemanticCodeGraph for a project.
   */
  public buildGraph(
    request: SemanticGraphRequest,
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): SemanticCodeGraph {
    // 1. Mandatory Input Validation
    if (!request.tenantId || typeof request.tenantId !== 'string' || request.tenantId.trim().length === 0) {
      throw new ValidationError('tenantId est obligatoire pour construire le graphe sémantique');
    }
    if (!request.projectId || typeof request.projectId !== 'string' || request.projectId.trim().length === 0) {
      throw new ValidationError('projectId est obligatoire pour construire le graphe sémantique');
    }

    // 2. Strict RBAC Enforcement
    assertPermission(userRole, 'PROJECT_READ', requestId);

    // 3. Compute Normalized Request Hash
    const normalizedRequest = {
      tenantId: request.tenantId.trim(),
      projectId: request.projectId.trim(),
      includeTests: request.includeTests ?? false,
      targetFiles: request.targetFiles ? [...request.targetFiles].sort() : [],
      targetLayers: request.targetLayers ? [...request.targetLayers].sort() : []
    };
    const requestHash = computeRequestHash(normalizedRequest as unknown as Record<string, unknown>);

    // 4. Extract Project Analysis Summary & Application DNA (pure consumers of AINT-001 & AINT-002)
    const summary = this.codeIntelligenceService.analyzeProject(
      normalizedRequest.tenantId,
      normalizedRequest.projectId,
      userRole,
      requestId
    );

    const dna = this.applicationDnaService.extractFromSummary(summary);
    const treeHash = summary.treeHash;

    // 5. Check Cache (Tenant & Project Isolated)
    const cacheKey = this.cache.computeCacheKey(
      normalizedRequest.tenantId,
      normalizedRequest.projectId,
      treeHash,
      requestHash,
      this.config.assemblerVersion
    );

    const cachedGraph = this.cache.get(cacheKey);
    if (cachedGraph) {
      return cachedGraph;
    }

    // 6. Build Deterministic Graph (Timing volatile metadata isolated from hash)
    const startTime = Date.now();
    const createdAt = new Date().toISOString();

    const { nodes, nodeMap } = buildSemanticNodes(summary, dna, request);
    const edges = buildSemanticEdges(summary, dna, nodeMap);

    const durationMs = Math.max(0, Date.now() - startTime);

    const graph = assembleSemanticGraph({
      tenantId: normalizedRequest.tenantId,
      projectId: normalizedRequest.projectId,
      treeHash,
      assemblerVersion: this.config.assemblerVersion,
      nodes,
      edges,
      createdAt,
      durationMs
    });

    // 7. Store in LRU Cache
    this.cache.set(cacheKey, graph);

    // 8. Audit Logging
    if (requestId) {
      try {
        auditStore.record({
          tenantId: normalizedRequest.tenantId,
          userId: 'system',
          action: 'SEMANTIC_GRAPH_BUILT',
          resourceType: 'project',
          resourceId: normalizedRequest.projectId,
          status: 'SUCCESS',
          metadata: {
            graphHash: graph.graphHash,
            nodeCount: graph.metrics.nodeCount,
            edgeCount: graph.metrics.edgeCount,
            durationMs
          },
          requestId
        });
      } catch (err) {
        logger.warn('Échec d\'observabilité lors de la livraison du graphe sémantique — ignoré, graphe quand même renvoyé', {
          component: 'semantic-graph',
          tenantId: normalizedRequest.tenantId,
          projectId: normalizedRequest.projectId,
          err: err instanceof Error ? err.message : String(err)
        });
      }
    }

    return graph;
  }

  public getCacheMetrics(): SemanticGraphCacheMetrics {
    return this.cache.getMetrics();
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
