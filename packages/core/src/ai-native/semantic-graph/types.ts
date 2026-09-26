/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-004)
 * Semantic Code Graph Engine Data Contracts
 */

export type SemanticNodeKind =
  | 'FILE'
  | 'SYMBOL'
  | 'COMPONENT'
  | 'FUNCTION'
  | 'CLASS'
  | 'INTERFACE'
  | 'TYPE'
  | 'MODULE'
  | 'LAYER'
  | 'ROUTE'
  | 'ENTRY_POINT';

export type SemanticEdgeKind =
  | 'IMPORTS'
  | 'IMPORTED_BY'
  | 'EXPORTS'
  | 'EXPORTED_BY'
  | 'REFERENCES'
  | 'DEPENDS_ON'
  | 'USED_BY'
  | 'CONTAINS'
  | 'MEMBER_OF_MODULE'
  | 'MEMBER_OF_LAYER'
  | 'IMPLEMENTS'
  | 'EXTENDS'
  | 'COMPOSES'
  | 'ROUTES_TO'
  | 'ENTRY_POINT_FOR';

export type SemanticEvidenceKind =
  | 'AST_IMPORT'
  | 'AST_EXPORT'
  | 'AST_SYMBOL'
  | 'SYMBOL_REFERENCE'
  | 'COMPONENT_PROPS'
  | 'COMPONENT_HOOK'
  | 'ROUTE_DECLARATION'
  | 'MODULE_MEMBERSHIP'
  | 'LAYER_MEMBERSHIP'
  | 'ENTRY_POINT'
  | 'DNA_DEPENDENCY'
  | 'CONTEXT_PROVENANCE';

export interface SemanticEvidence {
  readonly kind: SemanticEvidenceKind;
  readonly source: string;
  readonly detail: string;
  readonly filePath?: string | undefined;
  readonly lineStart?: number | undefined;
  readonly lineEnd?: number | undefined;
}

export interface SemanticNode {
  readonly id: string;
  readonly kind: SemanticNodeKind;
  readonly name: string;
  readonly filePath?: string | undefined;
  readonly lineStart?: number | undefined;
  readonly lineEnd?: number | undefined;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly evidence: readonly SemanticEvidence[];
}

export interface SemanticEdge {
  readonly id: string;
  readonly kind: SemanticEdgeKind;
  readonly sourceId: string;
  readonly targetId: string;
  readonly evidence: readonly SemanticEvidence[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface SemanticGraphIndexes {
  readonly nodeById: Readonly<Record<string, string>>;
  readonly nodesByKind: Readonly<Record<SemanticNodeKind, readonly string[]>>;
  readonly nodesByFile: Readonly<Record<string, readonly string[]>>;
  readonly outgoingEdgesByNode: Readonly<Record<string, readonly string[]>>;
  readonly incomingEdgesByNode: Readonly<Record<string, readonly string[]>>;
}

export interface SemanticGraphMetrics {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly nodesByKind: Readonly<Record<string, number>>;
  readonly edgesByKind: Readonly<Record<string, number>>;
  readonly isolatedNodeCount: number;
  readonly maxOutDegree: number;
  readonly maxInDegree: number;
  readonly fileNodeCount: number;
  readonly symbolNodeCount: number;
  readonly moduleNodeCount: number;
  readonly layerNodeCount: number;
  readonly routeNodeCount: number;
  readonly componentNodeCount: number;
  readonly importEdgeCount: number;
  readonly referenceEdgeCount: number;
  readonly compositionEdgeCount: number;
  readonly moduleMembershipCount: number;
  readonly layerMembershipCount: number;
}

export interface SemanticCodeGraph {
  readonly schemaVersion: '1.0.0';
  readonly assemblerVersion: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly treeHash: string;
  readonly graphHash: string;
  readonly createdAt: string;
  readonly durationMs: number;
  readonly nodes: readonly SemanticNode[];
  readonly edges: readonly SemanticEdge[];
  readonly indexes: SemanticGraphIndexes;
  readonly metrics: SemanticGraphMetrics;
}

export interface SemanticGraphRequest {
  readonly tenantId: string;
  readonly projectId: string;
  readonly includeTests?: boolean | undefined;
  readonly targetFiles?: readonly string[] | undefined;
  readonly targetLayers?: readonly string[] | undefined;
}

export interface SemanticGraphConfig {
  readonly assemblerVersion: string;
  readonly cacheMaxEntries: number;
}

export interface SemanticGraphCacheMetrics {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly entryCount: number;
  readonly maxEntries: number;
}
