/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * Application Understanding & Semantic Reasoning Engine Data Contracts
 */

import type { SemanticCodeGraph } from '../semantic-graph/types.js';

export type CertaintyLevel = 'OBSERVED' | 'INFERRED' | 'HYPOTHESIZED';

export type BusinessRuleType =
  | 'VALIDATION'
  | 'AUTHORIZATION'
  | 'STATE_TRANSITION'
  | 'RATE_LIMIT'
  | 'CALCULATION'
  | 'INVARIANT';

export type UnderstandingEvidenceKind =
  | 'AST_IMPORT'
  | 'AST_EXPORT'
  | 'AST_SYMBOL'
  | 'SYMBOL_REFERENCE'
  | 'ROUTE_DECLARATION'
  | 'COMPONENT_PROFILE'
  | 'MODULE_MEMBERSHIP'
  | 'LAYER_MEMBERSHIP'
  | 'DNA_STACK'
  | 'DNA_LAYER'
  | 'GRAPH_EDGE'
  | 'IMPACT_PATH'
  | 'HEURISTIC';

export interface UnderstandingEvidence {
  readonly kind: UnderstandingEvidenceKind;
  readonly source: string;
  readonly detail: string;
  readonly filePath?: string | undefined;
  readonly lineStart?: number | undefined;
  readonly lineEnd?: number | undefined;
  readonly confidence: number;
}

export interface SemanticFeature {
  readonly featureId: string;
  readonly name: string;
  readonly description: string;
  readonly domainId: string;
  readonly certainty: CertaintyLevel;
  readonly confidence: number;
  readonly relatedNodes: readonly string[];
  readonly relatedFiles: readonly string[];
  readonly entryPoints: readonly string[];
  readonly routes: readonly string[];
  readonly dataSources: readonly string[];
  readonly dependencies: readonly string[];
  readonly components: readonly string[];
  readonly services: readonly string[];
  readonly evidence: readonly UnderstandingEvidence[];
}

export interface SemanticDomain {
  readonly domainId: string;
  readonly name: string;
  readonly description: string;
  readonly features: readonly string[];
  readonly relatedFiles: readonly string[];
  readonly certainty: CertaintyLevel;
  readonly confidence: number;
  readonly evidence: readonly UnderstandingEvidence[];
}

export interface WorkflowStep {
  readonly stepIndex: number;
  readonly name: string;
  readonly actor: string;
  readonly nodeId?: string | undefined;
  readonly filePath?: string | undefined;
  readonly operation: string;
  readonly dependencies: readonly string[];
}

export interface SemanticWorkflow {
  readonly workflowId: string;
  readonly name: string;
  readonly description: string;
  readonly trigger: string;
  readonly actors: readonly string[];
  readonly entryPoints: readonly string[];
  readonly steps: readonly WorkflowStep[];
  readonly outputs: readonly string[];
  readonly dependencies: readonly string[];
  readonly failurePoints: readonly string[];
  readonly certainty: CertaintyLevel;
  readonly confidence: number;
  readonly evidence: readonly UnderstandingEvidence[];
}

export interface DataFlowStep {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly transformation?: string | undefined;
  readonly edgeKind: string;
  readonly evidence: readonly UnderstandingEvidence[];
}

export interface SemanticDataFlow {
  readonly flowId: string;
  readonly name: string;
  readonly sources: readonly string[];
  readonly destinations: readonly string[];
  readonly apis: readonly string[];
  readonly services: readonly string[];
  readonly repositories: readonly string[];
  readonly components: readonly string[];
  readonly steps: readonly DataFlowStep[];
  readonly potentialRisks: readonly string[];
  readonly certainty: CertaintyLevel;
  readonly confidence: number;
  readonly evidence: readonly UnderstandingEvidence[];
}

export interface BusinessRuleLocation {
  readonly filePath: string;
  readonly lineStart?: number | undefined;
  readonly lineEnd?: number | undefined;
  readonly symbol?: string | undefined;
}

export interface SemanticBusinessRule {
  readonly ruleId: string;
  readonly name: string;
  readonly description: string;
  readonly location: BusinessRuleLocation;
  readonly type: BusinessRuleType;
  readonly conditions: readonly string[];
  readonly effects: readonly string[];
  readonly certainty: CertaintyLevel;
  readonly confidence: number;
  readonly evidence: readonly UnderstandingEvidence[];
}

export interface UserJourneyStep {
  readonly stepIndex: number;
  readonly pageOrRoute: string;
  readonly action: string;
  readonly targetComponent?: string | undefined;
  readonly resultingState?: string | undefined;
}

export interface SemanticUserJourney {
  readonly journeyId: string;
  readonly name: string;
  readonly actor: string;
  readonly steps: readonly UserJourneyStep[];
  readonly entryPoints: readonly string[];
  readonly terminalStates: readonly string[];
  readonly certainty: CertaintyLevel;
  readonly confidence: number;
  readonly evidence: readonly UnderstandingEvidence[];
}

export interface SemanticComponent {
  readonly id: string;
  readonly name: string;
  readonly filePath: string;
  readonly domainId?: string | undefined;
  readonly featureId?: string | undefined;
  readonly isCritical: boolean;
  readonly dependentsCount: number;
  readonly confidence: number;
}

export interface SemanticService {
  readonly id: string;
  readonly name: string;
  readonly filePath: string;
  readonly domainId?: string | undefined;
  readonly featureId?: string | undefined;
  readonly methods: readonly string[];
  readonly confidence: number;
}

export interface SemanticApi {
  readonly id: string;
  readonly path: string;
  readonly method: string;
  readonly handlerSymbol?: string | undefined;
  readonly filePath: string;
  readonly domainId?: string | undefined;
  readonly featureId?: string | undefined;
  readonly confidence: number;
}

export interface SemanticEntryPoint {
  readonly path: string;
  readonly role: string;
  readonly targetComponentOrHandler?: string | undefined;
  readonly confidence: number;
}

export interface ArchitecturalBoundary {
  readonly name: string;
  readonly rootPath: string;
  readonly layer: string;
  readonly files: readonly string[];
  readonly publicExports: readonly string[];
  readonly allowedDependencies: readonly string[];
}

export interface CriticalComponentInfo {
  readonly name: string;
  readonly filePath: string;
  readonly reason: string;
  readonly dependentsCount: number;
}

export interface ApplicationCapabilities {
  readonly summary: string;
  readonly primaryStack: {
    readonly language: string;
    readonly framework: string;
    readonly runtime: string;
  };
  readonly architecturalPattern: string;
  readonly criticalComponents: readonly CriticalComponentInfo[];
  readonly dataStores: readonly string[];
  readonly externalIntegrations: readonly string[];
  readonly entryPointsCount: number;
  readonly capabilitiesList: readonly string[];
}

export interface ApplicationSemanticSummary {
  readonly totalDomains: number;
  readonly totalFeatures: number;
  readonly totalWorkflows: number;
  readonly totalJourneys: number;
  readonly totalBusinessRules: number;
  readonly totalDataFlows: number;
  readonly overallConfidence: number;
  readonly highestRiskAreas: readonly string[];
}

export interface UnderstandingMetrics {
  readonly observedCount: number;
  readonly inferredCount: number;
  readonly hypothesizedCount: number;
  readonly domainCount: number;
  readonly featureCount: number;
  readonly workflowCount: number;
  readonly dataFlowCount: number;
  readonly businessRuleCount: number;
  readonly userJourneyCount: number;
  readonly durationMs: number;
}

export interface ApplicationSemanticModel {
  readonly schemaVersion: '1.0.0';
  readonly understandingVersion: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly treeHash: string;
  readonly graphHash: string;
  readonly understandingHash: string;
  readonly createdAt: string;
  readonly durationMs: number;
  readonly summary: ApplicationSemanticSummary;
  readonly capabilities: ApplicationCapabilities;
  readonly domains: readonly SemanticDomain[];
  readonly features: readonly SemanticFeature[];
  readonly workflows: readonly SemanticWorkflow[];
  readonly userJourneys: readonly SemanticUserJourney[];
  readonly dataFlows: readonly SemanticDataFlow[];
  readonly businessRules: readonly SemanticBusinessRule[];
  readonly components: readonly SemanticComponent[];
  readonly services: readonly SemanticService[];
  readonly apis: readonly SemanticApi[];
  readonly entryPoints: readonly SemanticEntryPoint[];
  readonly boundaries: readonly ArchitecturalBoundary[];
  readonly metrics: UnderstandingMetrics;
}

export interface UnderstandingRequest {
  readonly tenantId: string;
  readonly projectId: string;
  readonly targetGraph?: SemanticCodeGraph | undefined;
  readonly includeTests?: boolean | undefined;
  readonly options?: {
    readonly minConfidence?: number | undefined;
    readonly analyzeBusinessRules?: boolean | undefined;
    readonly traceWorkflows?: boolean | undefined;
  } | undefined;
}

export interface FeatureQueryFilter {
  readonly domainId?: string | undefined;
  readonly certainty?: CertaintyLevel | undefined;
  readonly minConfidence?: number | undefined;
  readonly nameContains?: string | undefined;
  readonly includesFile?: string | undefined;
}

export interface DomainQueryFilter {
  readonly certainty?: CertaintyLevel | undefined;
  readonly minConfidence?: number | undefined;
  readonly nameContains?: string | undefined;
}

export interface WorkflowQueryFilter {
  readonly actor?: string | undefined;
  readonly triggerContains?: string | undefined;
  readonly minConfidence?: number | undefined;
}

export interface JourneyQueryFilter {
  readonly actor?: string | undefined;
  readonly minConfidence?: number | undefined;
}

export interface BusinessRuleQueryFilter {
  readonly type?: BusinessRuleType | undefined;
  readonly filePath?: string | undefined;
  readonly certainty?: CertaintyLevel | undefined;
}

export interface DataFlowQueryFilter {
  readonly hasRisk?: boolean | undefined;
  readonly touchesFile?: string | undefined;
}

export interface SemanticQueryRequest {
  readonly tenantId: string;
  readonly projectId: string;
  readonly model?: ApplicationSemanticModel | undefined;
  readonly query: {
    readonly kind: 'FEATURES' | 'DOMAINS' | 'WORKFLOWS' | 'JOURNEYS' | 'RULES' | 'DATA_FLOWS' | 'CAPABILITIES';
    readonly filter?: Record<string, unknown> | undefined;
    readonly limit?: number | undefined;
    readonly offset?: number | undefined;
  };
}

export interface SemanticQueryResult<T = unknown> {
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly items: readonly T[];
}

export interface UnderstandingConfig {
  readonly understandingVersion: string;
  readonly cacheMaxEntries: number;
  readonly minConfidenceThreshold: number;
}

export interface UnderstandingCacheMetrics {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly entryCount: number;
  readonly maxEntries: number;
}
