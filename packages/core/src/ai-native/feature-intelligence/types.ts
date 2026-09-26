/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature Intelligence & Product Evolution Engine - Data Contracts
 */

import type { Role } from '../../identity/permissions.js';
import type { ApplicationDNA } from '../dna/types.js';
import type { ApplicationAuditReport } from '../application-audit/types.js';
import type { ConversationTurn, ArchitecturalDecisionRecord } from '../conversation-intelligence/types.js';
import type { AgentDomain, AgentTask, EngineeringTaskGraph } from '../ai-orchestrator/types.js';

export type FeatureOpportunityStatus =
  | 'DETECTED'
  | 'VALIDATING'
  | 'CANDIDATE'
  | 'PROPOSED'
  | 'USER_REVIEW'
  | 'ACCEPTED'
  | 'PLANNED'
  | 'IMPLEMENTED'
  | 'VALIDATED'
  | 'MEASURED'
  | 'REJECTED'
  | 'DEFERRED'
  | 'SUPERSEDED';

export type EvidenceSource =
  | 'conversation'
  | 'application'
  | 'audit'
  | 'ux'
  | 'design'
  | 'architecture'
  | 'usage'
  | 'feedback'
  | 'decision';

export type FeatureCategory =
  | 'FUNCTIONAL_GAP'
  | 'USER_NEED'
  | 'UX_IMPROVEMENT'
  | 'DESIGN_HARMONY'
  | 'ARCHITECTURE'
  | 'PRODUCT_EXPANSION';

export type FeatureComplexity = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

export type FeatureEffort = 'XS' | 'S' | 'M' | 'L' | 'XL';

export interface EvidenceReference {
  readonly sourceId: string;
  readonly filePath?: string | undefined;
  readonly line?: number | undefined;
  readonly selector?: string | undefined;
  readonly detail: string;
  readonly metricName?: string | undefined;
  readonly observedValue?: string | number | undefined;
  readonly thresholdValue?: string | number | undefined;
}

export interface FeatureEvidence {
  readonly id: string;
  readonly source: EvidenceSource;
  readonly description: string;
  readonly confidence: number; // 0.0 - 1.0
  readonly references: readonly EvidenceReference[];
}

export interface FeatureAlternative {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly tradeOffs: string;
  readonly estimatedEffort: FeatureEffort;
  readonly isRecommended: boolean;
}

export interface FeatureSpecification {
  readonly problem: string;
  readonly proposedSolution: string;
  readonly scope: readonly string[];
  readonly outOfScope: readonly string[];
  readonly successCriteria: readonly string[];
  readonly alternatives: readonly FeatureAlternative[];
}

export interface FeatureImpactAnalysis {
  readonly affectedModules: readonly string[];
  readonly affectedFiles: readonly string[];
  readonly affectedLayers: readonly string[];
  readonly dependencies: readonly string[];
  readonly conflicts: readonly string[];
  readonly risks: readonly string[];
  readonly blastRadiusScore: number; // 0 - 100
  readonly isBreaking: boolean;
  readonly estimatedComplexity: FeatureComplexity;
  readonly estimatedEffort: FeatureEffort;
}

export interface FeatureScores {
  readonly businessValue: number;            // 0 - 100 (weight: 25%)
  readonly evidenceConfidence: number;        // 0 - 100 (weight: 20%)
  readonly userImpact: number;                // 0 - 100 (weight: 20%)
  readonly strategicAlignment: number;        // 0 - 100 (weight: 15%)
  readonly architecturalFeasibility: number;  // 0 - 100 (weight: 10%)
  readonly riskMinimization: number;          // 0 - 100 (weight: 10%)
  readonly priorityScore: number;             // 0 - 100 (normalized & clamped)
}

export interface FeatureStateTransition {
  readonly fromStatus: FeatureOpportunityStatus;
  readonly toStatus: FeatureOpportunityStatus;
  readonly timestamp: string;
  readonly reason?: string | undefined;
  readonly userId?: string | undefined;
}

export interface FeatureCandidate {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: FeatureCategory;
  readonly status: FeatureOpportunityStatus;
  readonly specification: FeatureSpecification;
  readonly evidence: readonly FeatureEvidence[];
  readonly impact: FeatureImpactAnalysis;
  readonly scores: FeatureScores;
  readonly candidateHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly history: readonly FeatureStateTransition[];
}

export interface FeatureGraphNode {
  readonly id: string;
  readonly title: string;
  readonly category: FeatureCategory;
  readonly status: FeatureOpportunityStatus;
  readonly priorityScore: number;
  readonly isFoundational: boolean;
  readonly depth: number;
}

export type FeatureGraphEdgeKind = 'DEPENDS_ON' | 'ENHANCES' | 'CONFLICTS_WITH' | 'SUPERSEDES';

export interface FeatureGraphEdge {
  readonly fromFeatureId: string;
  readonly toFeatureId: string;
  readonly kind: FeatureGraphEdgeKind;
  readonly reason: string;
}

export interface FeatureGraph {
  readonly nodes: readonly FeatureGraphNode[];
  readonly edges: readonly FeatureGraphEdge[];
  readonly foundationalFeatureIds: readonly string[];
  readonly topologicalOrder: readonly string[];
  readonly hasCycles: boolean;
}

export interface FeatureIntelligenceSummary {
  readonly totalDetected: number;
  readonly candidateCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly deferredCount: number;
  readonly avgPriorityScore: number;
  readonly topOpportunities: readonly FeatureCandidate[];
}

export interface FeatureIntelligenceReport {
  readonly reportId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly opportunities: readonly FeatureCandidate[];
  readonly summary: FeatureIntelligenceSummary;
  readonly featureGraph: FeatureGraph;
  readonly reportHash: string;
  readonly createdAt: string;
  readonly durationMs: number;
}

export interface FeatureComparison {
  readonly previousReportId: string;
  readonly currentReportId: string;
  readonly newOpportunities: readonly string[];
  readonly resolvedOpportunities: readonly string[];
  readonly priorityScoreDelta: number;
}

export interface FeatureFileEntry {
  readonly path: string;
  readonly content: string;
}

export interface FeatureIntelligenceConfig {
  readonly minConfidenceThreshold: number; // default 0.40
  readonly maxCandidates: number;          // default 20
  readonly enableGapDetection: boolean;     // default true
  readonly enableAuditBridge: boolean;      // default true
  readonly enableConversationBridge: boolean; // default true
  readonly strictEvidenceCheck: boolean;   // default true (NO EVIDENCE -> NO CLAIM)
}

export interface FeatureDiscoveryRequest {
  readonly tenantId: string;
  readonly projectId: string;
  readonly files?: readonly FeatureFileEntry[] | undefined;
  readonly dna?: ApplicationDNA | undefined;
  readonly auditReport?: ApplicationAuditReport | undefined;
  readonly conversationHistory?: readonly ConversationTurn[] | undefined;
  readonly existingDecisions?: readonly ArchitecturalDecisionRecord[] | undefined;
  readonly config?: Partial<FeatureIntelligenceConfig> | undefined;
  readonly callerRole?: Role | undefined;
}

export interface ProposedFeaturePlan {
  readonly featureId: string;
  readonly taskGraph: EngineeringTaskGraph;
  readonly estimatedTokens: number;
  readonly recommendedDomain: AgentDomain;
  readonly prerequisiteTasks: readonly string[];
}
