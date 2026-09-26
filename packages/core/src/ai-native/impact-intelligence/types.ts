/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-005)
 * Impact Intelligence Engine Data Contracts & Types
 */

import type {
  SemanticEdgeKind,
  SemanticEvidence,
  SemanticNode,
  SemanticNodeKind
} from '../semantic-graph/types.js';

export type ImpactDirection =
  | 'UPSTREAM_DEPENDENTS'
  | 'DOWNSTREAM_DEPENDENCIES'
  | 'BIDIRECTIONAL';

export type ImpactClassification =
  | 'BREAKING'
  | 'BEHAVIORAL'
  | 'REGRESSION_RISK'
  | 'INFORMATIONAL';

export type ImpactRiskLevel =
  | 'CRITICAL'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW';

export type ChangeType =
  | 'MODIFY'
  | 'DELETE'
  | 'ADD';

export type TargetMatchKind =
  | 'NODE_ID'
  | 'FILE_PATH'
  | 'SYMBOL_NAME';

export interface ImpactPathStep {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly edgeKind: SemanticEdgeKind;
  readonly edgeEvidence: readonly SemanticEvidence[];
}

export interface ImpactPath {
  readonly steps: readonly ImpactPathStep[];
  readonly length: number;
}

export interface ResolvedTarget {
  readonly targetNode: SemanticNode;
  readonly matchedBy: TargetMatchKind;
  readonly query: string;
}

export interface ImpactedNode {
  readonly node: SemanticNode;
  readonly depth: number;
  readonly isDirect: boolean;
  readonly classification: ImpactClassification;
  readonly riskLevel: ImpactRiskLevel;
  readonly confidence: number;
  readonly shortestPath: ImpactPath;
  readonly allPaths: readonly ImpactPath[];
  readonly reason: string;
  readonly evidence: readonly SemanticEvidence[];
}

export interface ImpactSubgraph {
  readonly nodes: readonly SemanticNode[];
  readonly edges: readonly {
    readonly id: string;
    readonly kind: SemanticEdgeKind;
    readonly sourceId: string;
    readonly targetId: string;
    readonly evidence: readonly SemanticEvidence[];
    readonly metadata: Readonly<Record<string, unknown>>;
  }[];
}

export interface ImpactRiskFactor {
  readonly code: string;
  readonly message: string;
  readonly severity: ImpactRiskLevel;
}

export interface ImpactAnalysisMetrics {
  readonly totalImpactedNodes: number;
  readonly directImpactCount: number;
  readonly transitiveImpactCount: number;
  readonly breakingCount: number;
  readonly behavioralCount: number;
  readonly regressionRiskCount: number;
  readonly informationalCount: number;
  readonly routesAffectedCount: number;
  readonly layersCrossedCount: number;
  readonly maxDepthReached: number;
  readonly circularDependenciesDetected: number;
  readonly overallScore: number;
}

export interface ImpactAnalysis {
  readonly schemaVersion: '1.0.0';
  readonly analyzerVersion: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly graphHash: string;
  readonly impactHash: string;
  readonly createdAt: string;
  readonly durationMs: number;
  readonly direction: ImpactDirection;
  readonly maxDepth: number;
  readonly changeType: ChangeType;
  readonly resolvedTargets: readonly ResolvedTarget[];
  readonly impactedNodes: readonly ImpactedNode[];
  readonly impactSubgraph: ImpactSubgraph;
  readonly overallRisk: ImpactRiskLevel;
  readonly overallConfidence: number;
  readonly riskFactors: readonly ImpactRiskFactor[];
  readonly metrics: ImpactAnalysisMetrics;
}

export interface ImpactAnalysisRequest {
  readonly tenantId: string;
  readonly projectId: string;
  readonly targetNodeIds?: readonly string[] | undefined;
  readonly targetFiles?: readonly string[] | undefined;
  readonly targetSymbols?: readonly string[] | undefined;
  readonly direction?: ImpactDirection | undefined;
  readonly maxDepth?: number | undefined;
  readonly changeType?: ChangeType | undefined;
  readonly includeInformational?: boolean | undefined;
}

export interface ImpactIntelligenceConfig {
  readonly analyzerVersion: string;
  readonly defaultMaxDepth: number;
  readonly maxAllowedDepth: number;
  readonly cacheMaxEntries: number;
}

export interface ImpactCacheMetrics {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly entryCount: number;
  readonly maxEntries: number;
}
