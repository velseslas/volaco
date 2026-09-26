/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-005)
 * Deterministic Bounded Graph Traversal with Cycle Detection
 */

import type {
  SemanticCodeGraph,
  SemanticEdge,
  SemanticNode
} from '../../semantic-graph/types.js';
import { compareEdges, compareNodes } from '../../semantic-graph/engine/canonical.js';
import { compareImpactPaths } from '../engine/canonical.js';
import type {
  ImpactDirection,
  ImpactPath,
  ImpactPathStep
} from '../types.js';

export interface TraversalTransition {
  readonly neighborId: string;
  readonly edge: SemanticEdge;
  readonly step: ImpactPathStep;
}

export interface TraversalResult {
  readonly impactedNodeMap: ReadonlyMap<string, {
    readonly node: SemanticNode;
    readonly depth: number;
    readonly shortestPath: ImpactPath;
    readonly allPaths: readonly ImpactPath[];
  }>;
  readonly traversedEdges: readonly SemanticEdge[];
  readonly circularDependenciesDetected: number;
  readonly maxDepthReached: number;
}

/**
 * Gets candidate neighbor transitions for a given node based on impact direction.
 * Returns deterministically sorted transitions.
 */
export function getTransitions(
  nodeId: string,
  direction: ImpactDirection,
  graph: SemanticCodeGraph,
  edgeMap: ReadonlyMap<string, SemanticEdge>
): readonly TraversalTransition[] {
  const transitions: TraversalTransition[] = [];

  const incomingEdgeIds = graph.indexes.incomingEdgesByNode[nodeId] ?? [];
  const outgoingEdgeIds = graph.indexes.outgoingEdgesByNode[nodeId] ?? [];

  // Helper to safely fetch an edge
  const getEdge = (id: string): SemanticEdge | undefined => edgeMap.get(id);

  if (direction === 'UPSTREAM_DEPENDENTS' || direction === 'BIDIRECTIONAL') {
    // 1. Incoming edges to nodeId where source depends on nodeId
    for (const edgeId of incomingEdgeIds) {
      const edge = getEdge(edgeId);
      if (!edge || edge.evidence.length === 0) continue; // NO EVIDENCE -> NO IMPACT

      const k = edge.kind;
      if (
        k === 'IMPORTS' ||
        k === 'REFERENCES' ||
        k === 'COMPOSES' ||
        k === 'ROUTES_TO' ||
        k === 'ENTRY_POINT_FOR' ||
        k === 'IMPLEMENTS' ||
        k === 'EXTENDS' ||
        k === 'DEPENDS_ON' ||
        k === 'CONTAINS'
      ) {
        transitions.push({
          neighborId: edge.sourceId,
          edge,
          step: {
            fromNodeId: nodeId,
            toNodeId: edge.sourceId,
            edgeKind: edge.kind,
            edgeEvidence: edge.evidence
          }
        });
      }
    }

    // 2. Outgoing edges from nodeId that point to dependents (inverted relations)
    for (const edgeId of outgoingEdgeIds) {
      const edge = getEdge(edgeId);
      if (!edge || edge.evidence.length === 0) continue;

      const k = edge.kind;
      if (
        k === 'IMPORTED_BY' ||
        k === 'USED_BY' ||
        k === 'EXPORTED_BY' ||
        k === 'CONTAINS'
      ) {
        transitions.push({
          neighborId: edge.targetId,
          edge,
          step: {
            fromNodeId: nodeId,
            toNodeId: edge.targetId,
            edgeKind: edge.kind,
            edgeEvidence: edge.evidence
          }
        });
      }
    }
  }

  if (direction === 'DOWNSTREAM_DEPENDENCIES' || direction === 'BIDIRECTIONAL') {
    // 1. Outgoing edges where nodeId depends on target
    for (const edgeId of outgoingEdgeIds) {
      const edge = getEdge(edgeId);
      if (!edge || edge.evidence.length === 0) continue;

      const k = edge.kind;
      if (
        k === 'IMPORTS' ||
        k === 'REFERENCES' ||
        k === 'COMPOSES' ||
        k === 'ROUTES_TO' ||
        k === 'ENTRY_POINT_FOR' ||
        k === 'IMPLEMENTS' ||
        k === 'EXTENDS' ||
        k === 'DEPENDS_ON' ||
        k === 'CONTAINS'
      ) {
        transitions.push({
          neighborId: edge.targetId,
          edge,
          step: {
            fromNodeId: nodeId,
            toNodeId: edge.targetId,
            edgeKind: edge.kind,
            edgeEvidence: edge.evidence
          }
        });
      }
    }

    // 2. Incoming inverted edges
    for (const edgeId of incomingEdgeIds) {
      const edge = getEdge(edgeId);
      if (!edge || edge.evidence.length === 0) continue;

      const k = edge.kind;
      if (
        k === 'IMPORTED_BY' ||
        k === 'USED_BY' ||
        k === 'EXPORTED_BY'
      ) {
        transitions.push({
          neighborId: edge.sourceId,
          edge,
          step: {
            fromNodeId: nodeId,
            toNodeId: edge.sourceId,
            edgeKind: edge.kind,
            edgeEvidence: edge.evidence
          }
        });
      }
    }
  }

  // Deduplicate transitions by neighborId + edge.id
  const seen = new Set<string>();
  const uniqueTransitions: TraversalTransition[] = [];
  for (const t of transitions) {
    const key = `${t.neighborId}:${t.edge.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueTransitions.push(t);
    }
  }

  // Deterministic sorting of transitions
  return uniqueTransitions.sort((a, b) => compareEdges(a.edge, b.edge));
}

/**
 * Executes a deterministic bounded BFS traversal from the given target nodes.
 */
export function traverseImpactGraph(
  targetNodeIds: readonly string[],
  direction: ImpactDirection,
  maxDepth: number,
  graph: SemanticCodeGraph
): TraversalResult {
  // Fast node and edge indexes
  const nodeMap = new Map<string, SemanticNode>();
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
  }

  const edgeMap = new Map<string, SemanticEdge>();
  for (const edge of graph.edges) {
    edgeMap.set(edge.id, edge);
  }

  const initialTargetSet = new Set<string>(targetNodeIds);

  // Result accumulators
  const impactedData = new Map<string, {
    node: SemanticNode;
    depth: number;
    paths: ImpactPath[];
  }>();

  const traversedEdgesMap = new Map<string, SemanticEdge>();
  let circularDependenciesDetected = 0;
  let maxDepthReached = 0;

  // Track the minimum depth at which each node was visited
  const minVisitedDepth = new Map<string, number>();
  for (const targetId of targetNodeIds) {
    minVisitedDepth.set(targetId, 0);
  }

  // BFS Queue: { currentId, currentPath, depth }
  interface QueueItem {
    currentId: string;
    currentPath: ImpactPathStep[];
    depth: number;
  }

  const queue: QueueItem[] = [];

  for (const targetId of [...targetNodeIds].sort()) {
    queue.push({
      currentId: targetId,
      currentPath: [],
      depth: 0
    });
  }

  while (queue.length > 0) {
    const item = queue.shift()!;
    const { currentId, currentPath, depth } = item;

    if (depth >= maxDepth) {
      continue;
    }

    const nextDepth = depth + 1;
    const transitions = getTransitions(currentId, direction, graph, edgeMap);

    for (const transition of transitions) {
      const { neighborId, edge, step } = transition;
      const neighborNode = nodeMap.get(neighborId);
      if (!neighborNode) {
        continue;
      }

      // Check for cycles in the current path
      const isCycle = currentPath.some((s) => s.fromNodeId === neighborId) || neighborId === currentId;
      if (isCycle) {
        circularDependenciesDetected++;
        continue;
      }

      const nextSteps = [...currentPath, step];
      const newPath: ImpactPath = {
        steps: nextSteps,
        length: nextSteps.length
      };

      // Record traversed edge
      traversedEdgesMap.set(edge.id, edge);

      // Do not count the initial target node itself as an impacted node if reached at depth > 0
      if (!initialTargetSet.has(neighborId)) {
        if (!impactedData.has(neighborId)) {
          impactedData.set(neighborId, {
            node: neighborNode,
            depth: nextDepth,
            paths: [newPath]
          });
        } else {
          const entry = impactedData.get(neighborId)!;
          if (nextDepth < entry.depth) {
            entry.depth = nextDepth;
          }
          entry.paths.push(newPath);
        }

        if (nextDepth > maxDepthReached) {
          maxDepthReached = nextDepth;
        }
      }

      // Prune deeper exploration if already visited at a shallower or equal depth
      const existingDepth = minVisitedDepth.get(neighborId);
      if (existingDepth === undefined || nextDepth < existingDepth) {
        minVisitedDepth.set(neighborId, nextDepth);
        queue.push({
          currentId: neighborId,
          currentPath: nextSteps,
          depth: nextDepth
        });
      }
    }
  }

  // Format and sort paths for each impacted node
  const impactedNodeMap = new Map<string, {
    readonly node: SemanticNode;
    readonly depth: number;
    readonly shortestPath: ImpactPath;
    readonly allPaths: readonly ImpactPath[];
  }>();

  for (const [nodeId, data] of impactedData.entries()) {
    const sortedPaths = [...data.paths].sort(compareImpactPaths);
    const shortestPath = sortedPaths[0]!;

    impactedNodeMap.set(nodeId, {
      node: data.node,
      depth: data.depth,
      shortestPath,
      allPaths: sortedPaths
    });
  }

  const traversedEdges = Array.from(traversedEdgesMap.values()).sort(compareEdges);

  return {
    impactedNodeMap,
    traversedEdges,
    circularDependenciesDetected,
    maxDepthReached
  };
}
