/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-005)
 * Impact Analyzer Core Engine
 */

import { ValidationError } from '../../../errors.js';
import type { SemanticCodeGraph, SemanticNode } from '../../semantic-graph/types.js';
import {
  canonicalObject,
  compareImpactNodes,
  computeImpactHash,
  deepFreeze
} from './canonical.js';
import { aggregatePathEvidence } from './evidence.js';
import {
  buildImpactReason,
  classifyImpact,
  evaluateNodeRisk,
  identifyRiskFactors,
  type CriticalityContext
} from './criticality.js';
import {
  computeConfidence,
  computeImpactScore,
  evaluateOverallRisk
} from './scoring.js';
import { resolveTargets } from './propagation.js';
import { traverseImpactGraph } from '../graph/traversal.js';
import { extractImpactSubgraph } from '../graph/impact-graph.js';
import type {
  ChangeType,
  ImpactAnalysis,
  ImpactAnalysisMetrics,
  ImpactAnalysisRequest,
  ImpactDirection,
  ImpactIntelligenceConfig,
  ImpactedNode
} from '../types.js';

export const DEFAULT_IMPACT_CONFIG: ImpactIntelligenceConfig = {
  analyzerVersion: '1.0.0',
  defaultMaxDepth: 5,
  maxAllowedDepth: 10,
  cacheMaxEntries: 150
};

export interface AnalyzeImpactOptions {
  readonly config?: Partial<ImpactIntelligenceConfig> | undefined;
  readonly startTime?: number | undefined;
}

/**
 * Runs a deterministic, evidence-backed impact analysis on a SemanticCodeGraph.
 */
export function runImpactAnalysis(
  graph: SemanticCodeGraph,
  request: ImpactAnalysisRequest,
  options?: AnalyzeImpactOptions | undefined
): ImpactAnalysis {
  const startTime = options?.startTime ?? Date.now();
  const createdAt = new Date().toISOString();

  const config: ImpactIntelligenceConfig = {
    ...DEFAULT_IMPACT_CONFIG,
    ...options?.config
  };

  // 1. Resolve Targets
  const resolvedTargets = resolveTargets(request, graph);
  const targetIds = resolvedTargets.map((t) => t.targetNode.id);
  const firstTargetName = resolvedTargets[0]?.targetNode.name ?? 'Target';

  // 2. Validate & Normalize Traversal Parameters
  const direction: ImpactDirection = request.direction ?? 'UPSTREAM_DEPENDENTS';
  const requestedDepth = request.maxDepth ?? config.defaultMaxDepth;
  if (requestedDepth < 1) {
    throw new ValidationError('maxDepth doit être supérieur ou égal à 1');
  }
  const maxDepth = Math.min(requestedDepth, config.maxAllowedDepth);
  const changeType: ChangeType = request.changeType ?? 'MODIFY';
  const includeInformational = request.includeInformational ?? false;

  // 3. Execute Bounded Deterministic Traversal
  const traversalResult = traverseImpactGraph(targetIds, direction, maxDepth, graph);

  // 4. Transform Traversal Results into Enriched Impacted Nodes
  const impactedList: ImpactedNode[] = [];
  const routesAffected: SemanticNode[] = [];
  const entryPointsAffected: SemanticNode[] = [];
  const layersInvolved = new Set<string>();

  // Include target layers
  for (const t of resolvedTargets) {
    const layer = (t.targetNode.metadata['layer'] as string) || (t.targetNode.metadata['architecturalLayer'] as string);
    if (layer) {
      layersInvolved.add(layer);
    }
  }

  for (const [nodeId, data] of traversalResult.impactedNodeMap.entries()) {
    const node = data.node;
    const depth = data.depth;
    const isDirect = depth === 1;
    const primaryEdgeKind = data.shortestPath.steps[0]?.edgeKind ?? 'UNKNOWN';

    const classification = classifyImpact(node, depth, primaryEdgeKind, changeType);

    // Filter out INFORMATIONAL if requested
    if (classification === 'INFORMATIONAL' && !includeInformational) {
      continue;
    }

    const riskLevel = evaluateNodeRisk(node, depth, classification, changeType);
    const evidence = aggregatePathEvidence(data.shortestPath.steps);
    const reason = buildImpactReason(node, depth, classification, primaryEdgeKind, firstTargetName);

    // Path confidence
    const stepRatio = data.shortestPath.steps.length > 0 ? 1.0 : 0.5;
    const confidence = Math.max(0.5, Math.min(1.0, Math.round((stepRatio / (1 + 0.05 * (depth - 1))) * 100) / 100));

    impactedList.push({
      node,
      depth,
      isDirect,
      classification,
      riskLevel,
      confidence,
      shortestPath: data.shortestPath,
      allPaths: data.allPaths,
      reason,
      evidence
    });

    if (node.kind === 'ROUTE') {
      routesAffected.push(node);
    }
    if (node.kind === 'ENTRY_POINT') {
      entryPointsAffected.push(node);
    }

    const nodeLayer = (node.metadata['layer'] as string) || (node.metadata['architecturalLayer'] as string);
    if (nodeLayer) {
      layersInvolved.add(nodeLayer);
    }
  }

  // Deterministically sort impacted nodes
  const impactedNodes = impactedList.sort(compareImpactNodes);

  // 5. Compile Metrics
  const directImpactCount = impactedNodes.filter((n) => n.isDirect).length;
  const transitiveImpactCount = impactedNodes.filter((n) => !n.isDirect).length;
  const breakingCount = impactedNodes.filter((n) => n.classification === 'BREAKING').length;
  const behavioralCount = impactedNodes.filter((n) => n.classification === 'BEHAVIORAL').length;
  const regressionRiskCount = impactedNodes.filter((n) => n.classification === 'REGRESSION_RISK').length;
  const informationalCount = impactedNodes.filter((n) => n.classification === 'INFORMATIONAL').length;

  const baseMetrics = {
    totalImpactedNodes: impactedNodes.length,
    directImpactCount,
    transitiveImpactCount,
    breakingCount,
    behavioralCount,
    regressionRiskCount,
    informationalCount,
    routesAffectedCount: routesAffected.length,
    layersCrossedCount: layersInvolved.size,
    maxDepthReached: traversalResult.maxDepthReached,
    circularDependenciesDetected: traversalResult.circularDependenciesDetected
  };

  // 6. Identify Risk Factors & Calculate Scores
  const criticalityContext: CriticalityContext = {
    changeType,
    directDependentCount: directImpactCount,
    totalDependentCount: impactedNodes.length,
    layersInvolved,
    hasCircularDependency: traversalResult.circularDependenciesDetected > 0,
    routesAffected,
    entryPointsAffected
  };

  const riskFactors = identifyRiskFactors(criticalityContext, impactedNodes);
  const overallScore = computeImpactScore({
    metrics: baseMetrics,
    riskFactors,
    impactedNodes
  });

  const overallRisk = evaluateOverallRisk(overallScore, riskFactors);
  const overallConfidence = computeConfidence(impactedNodes, traversalResult.maxDepthReached);

  const metrics: ImpactAnalysisMetrics = {
    ...baseMetrics,
    overallScore
  };

  // 7. Extract Minimal Subgraph
  const impactSubgraph = extractImpactSubgraph(
    resolvedTargets,
    impactedNodes,
    traversalResult.traversedEdges
  );

  const durationMs = Math.max(0, Date.now() - startTime);

  // 8. Compute Deterministic Impact Hash (excluding volatile createdAt, durationMs, and impactHash)
  const unsignedPayload = {
    schemaVersion: '1.0.0' as const,
    analyzerVersion: config.analyzerVersion,
    tenantId: request.tenantId.trim(),
    projectId: request.projectId.trim(),
    graphHash: graph.graphHash,
    direction,
    maxDepth,
    changeType,
    resolvedTargets,
    impactedNodes,
    impactSubgraph,
    overallRisk,
    overallConfidence,
    riskFactors,
    metrics
  };

  const impactHash = computeImpactHash(unsignedPayload);

  const analysis: ImpactAnalysis = {
    ...unsignedPayload,
    impactHash,
    createdAt,
    durationMs
  };

  return deepFreeze(analysis);
}
