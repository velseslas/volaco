/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-005)
 * Minimal Impact Subgraph Extractor
 */

import type {
  SemanticEdge,
  SemanticNode
} from '../../semantic-graph/types.js';
import { compareEdges, compareNodes } from '../../semantic-graph/engine/canonical.js';
import type { ImpactSubgraph, ImpactedNode, ResolvedTarget } from '../types.js';

/**
 * Extracts a minimal, coherent subgraph containing all target nodes,
 * impacted nodes, and the traversed edges connecting them.
 */
export function extractImpactSubgraph(
  resolvedTargets: readonly ResolvedTarget[],
  impactedNodes: readonly ImpactedNode[],
  traversedEdges: readonly SemanticEdge[]
): ImpactSubgraph {
  const nodeMap = new Map<string, SemanticNode>();

  for (const target of resolvedTargets) {
    nodeMap.set(target.targetNode.id, target.targetNode);
  }

  for (const item of impactedNodes) {
    nodeMap.set(item.node.id, item.node);
  }

  const nodes = Array.from(nodeMap.values()).sort(compareNodes);

  // Filter traversed edges to only include those whose endpoints exist in the node set
  const edgeMap = new Map<string, SemanticEdge>();
  for (const edge of traversedEdges) {
    if (nodeMap.has(edge.sourceId) && nodeMap.has(edge.targetId)) {
      edgeMap.set(edge.id, edge);
    }
  }

  const edges = Array.from(edgeMap.values()).sort(compareEdges);

  return {
    nodes,
    edges
  };
}
