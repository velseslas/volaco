/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-004)
 * Semantic Code Graph Assembler, Indexes, and Metrics
 */

import type {
  SemanticCodeGraph,
  SemanticEdge,
  SemanticGraphIndexes,
  SemanticGraphMetrics,
  SemanticNode,
  SemanticNodeKind
} from './types.js';
import { computeGraphHash, deepFreeze } from './engine/canonical.js';

export interface AssembleGraphInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly treeHash: string;
  readonly assemblerVersion: string;
  readonly nodes: readonly SemanticNode[];
  readonly edges: readonly SemanticEdge[];
  readonly createdAt: string;
  readonly durationMs: number;
}

export function assembleSemanticGraph(input: AssembleGraphInput): SemanticCodeGraph {
  const { nodes, edges, tenantId, projectId, treeHash, assemblerVersion, createdAt, durationMs } = input;

  // 1. Build Deterministic Indexes
  const nodeById: Record<string, string> = {};
  const nodesByKindRecord: Record<SemanticNodeKind, string[]> = {
    FILE: [],
    SYMBOL: [],
    COMPONENT: [],
    FUNCTION: [],
    CLASS: [],
    INTERFACE: [],
    TYPE: [],
    MODULE: [],
    LAYER: [],
    ROUTE: [],
    ENTRY_POINT: []
  };
  const nodesByFileRecord: Record<string, string[]> = {};
  const outgoingEdgesRecord: Record<string, string[]> = {};
  const incomingEdgesRecord: Record<string, string[]> = {};

  for (const node of nodes) {
    nodeById[node.id] = node.name;
    const kindArr = nodesByKindRecord[node.kind];
    if (kindArr) {
      kindArr.push(node.id);
    }

    if (node.filePath) {
      const fileArr = nodesByFileRecord[node.filePath] ?? [];
      fileArr.push(node.id);
      nodesByFileRecord[node.filePath] = fileArr;
    }
  }

  // Sort node index arrays canonically
  for (const kind of Object.keys(nodesByKindRecord) as SemanticNodeKind[]) {
    nodesByKindRecord[kind]?.sort();
  }
  for (const fp of Object.keys(nodesByFileRecord)) {
    nodesByFileRecord[fp]?.sort();
  }

  // Edge indexes
  const inDegreeMap = new Map<string, number>();
  const outDegreeMap = new Map<string, number>();

  for (const edge of edges) {
    // Outgoing
    const outArr = outgoingEdgesRecord[edge.sourceId] ?? [];
    outArr.push(edge.id);
    outgoingEdgesRecord[edge.sourceId] = outArr;
    outDegreeMap.set(edge.sourceId, (outDegreeMap.get(edge.sourceId) ?? 0) + 1);

    // Incoming
    const inArr = incomingEdgesRecord[edge.targetId] ?? [];
    inArr.push(edge.id);
    incomingEdgesRecord[edge.targetId] = inArr;
    inDegreeMap.set(edge.targetId, (inDegreeMap.get(edge.targetId) ?? 0) + 1);
  }

  for (const src of Object.keys(outgoingEdgesRecord)) {
    outgoingEdgesRecord[src]?.sort();
  }
  for (const tgt of Object.keys(incomingEdgesRecord)) {
    incomingEdgesRecord[tgt]?.sort();
  }

  const indexes: SemanticGraphIndexes = {
    nodeById,
    nodesByKind: nodesByKindRecord,
    nodesByFile: nodesByFileRecord,
    outgoingEdgesByNode: outgoingEdgesRecord,
    incomingEdgesByNode: incomingEdgesRecord
  };

  // 2. Build Metrics
  const nodesByKindCount: Record<string, number> = {};
  for (const [k, arr] of Object.entries(nodesByKindRecord)) {
    nodesByKindCount[k] = arr.length;
  }

  const edgesByKindCount: Record<string, number> = {};
  for (const edge of edges) {
    edgesByKindCount[edge.kind] = (edgesByKindCount[edge.kind] ?? 0) + 1;
  }

  let isolatedNodeCount = 0;
  for (const node of nodes) {
    const inDeg = inDegreeMap.get(node.id) ?? 0;
    const outDeg = outDegreeMap.get(node.id) ?? 0;
    if (inDeg === 0 && outDeg === 0) {
      isolatedNodeCount++;
    }
  }

  let maxOutDegree = 0;
  for (const outCount of outDegreeMap.values()) {
    if (outCount > maxOutDegree) maxOutDegree = outCount;
  }

  let maxInDegree = 0;
  for (const inCount of inDegreeMap.values()) {
    if (inCount > maxInDegree) maxInDegree = inCount;
  }

  const metrics: SemanticGraphMetrics = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodesByKind: nodesByKindCount,
    edgesByKind: edgesByKindCount,
    isolatedNodeCount,
    maxOutDegree,
    maxInDegree,
    fileNodeCount: nodesByKindRecord.FILE?.length ?? 0,
    symbolNodeCount:
      (nodesByKindRecord.SYMBOL?.length ?? 0) +
      (nodesByKindRecord.FUNCTION?.length ?? 0) +
      (nodesByKindRecord.CLASS?.length ?? 0) +
      (nodesByKindRecord.INTERFACE?.length ?? 0) +
      (nodesByKindRecord.TYPE?.length ?? 0),
    moduleNodeCount: nodesByKindRecord.MODULE?.length ?? 0,
    layerNodeCount: nodesByKindRecord.LAYER?.length ?? 0,
    routeNodeCount: nodesByKindRecord.ROUTE?.length ?? 0,
    componentNodeCount: nodesByKindRecord.COMPONENT?.length ?? 0,
    importEdgeCount: edgesByKindCount.IMPORTS ?? 0,
    referenceEdgeCount: edgesByKindCount.REFERENCES ?? 0,
    compositionEdgeCount: edgesByKindCount.COMPOSES ?? 0,
    moduleMembershipCount: edgesByKindCount.MEMBER_OF_MODULE ?? 0,
    layerMembershipCount: edgesByKindCount.MEMBER_OF_LAYER ?? 0
  };

  // 3. Compute Deterministic graphHash
  const stablePayload: Record<string, unknown> = {
    schemaVersion: '1.0.0',
    assemblerVersion,
    tenantId,
    projectId,
    treeHash,
    nodes,
    edges,
    indexes,
    metrics
  };

  const graphHash = computeGraphHash(stablePayload);

  const graph: SemanticCodeGraph = {
    schemaVersion: '1.0.0',
    assemblerVersion,
    tenantId,
    projectId,
    treeHash,
    graphHash,
    createdAt,
    durationMs,
    nodes,
    edges,
    indexes,
    metrics
  };

  // 4. Guarantee Complete Immutability via deepFreeze
  return deepFreeze(graph);
}
