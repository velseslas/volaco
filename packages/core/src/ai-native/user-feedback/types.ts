/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * User Feedback & Bug Intelligence Engine - Data Contracts
 */

import type { Role } from '../../identity/permissions.js';
import type { ApplicationDNA } from '../dna/types.js';
import type { ApplicationAuditReport } from '../application-audit/types.js';
import type { ConversationTurn, ArchitecturalDecisionRecord } from '../conversation-intelligence/types.js';
import type { AgentDomain, EngineeringTaskGraph } from '../ai-orchestrator/types.js';

export type { Role };
export type { ApplicationDNA };
export type { ApplicationAuditReport, ApplicationAuditFinding } from '../application-audit/types.js';
export type { ConversationTurn, ArchitecturalDecisionRecord } from '../conversation-intelligence/types.js';
export type { AgentDomain, EngineeringTaskGraph };

export type SignalSource =
  | 'user_report'
  | 'error_runtime'
  | 'conversation'
  | 'telemetry'
  | 'audit_finding';

export type FeedbackCategory =
  | 'BUG'
  | 'FEATURE_REQUEST'
  | 'UX_PROBLEM'
  | 'CONFUSION'
  | 'PERFORMANCE'
  | 'ACCESSIBILITY'
  | 'CONTRADICTION';

export type BugSubtype =
  | 'CRASH'
  | 'FUNCTIONAL'
  | 'RENDERING'
  | 'REGRESSION'
  | 'NETWORK'
  | 'STATE_CORRUPTION';

export type UserSentiment =
  | 'FRUSTRATED'
  | 'ANNOYED'
  | 'NEUTRAL'
  | 'SATISFIED'
  | 'ENTHUSIASTIC';

export type EvidenceProofLevel = 'FACT' | 'CORRELATION' | 'HYPOTHESIS';

export type ProblemStatus =
  | 'DETECTED'
  | 'CLASSIFIED'
  | 'CORRELATED'
  | 'CONFIRMED'
  | 'PRIORITIZED'
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'DUPLICATE'
  | 'CONTRADICTORY'
  | 'DEFERRED'
  | 'WONT_FIX';

export type ProblemSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type ProblemUrgency = 'IMMEDIATE' | 'HIGH' | 'NORMAL' | 'LOW';

export type RegressionStatus = 'CONFIRMED' | 'PROBABLE' | 'SUSPECTED' | 'NONE';

export type TrendStatus = 'EMERGING' | 'GROWING' | 'STABLE' | 'DECLINING' | 'RESOLVED';

export interface UserSignal {
  readonly id: string;
  readonly source: SignalSource;
  readonly category: FeedbackCategory;
  readonly rawText: string;
  readonly normalizedText: string;
  readonly sentiment: UserSentiment;
  readonly userId?: string | undefined;
  readonly userRole?: Role | undefined;
  readonly sessionId?: string | undefined;
  readonly url?: string | undefined;
  readonly componentId?: string | undefined;
  readonly timestamp: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface ProblemEvidence {
  readonly id: string;
  readonly signalId?: string | undefined;
  readonly source: SignalSource;
  readonly proofLevel: EvidenceProofLevel;
  readonly description: string;
  readonly confidence: number; // 0.0 - 1.0
  readonly filePath?: string | undefined;
  readonly line?: number | undefined;
  readonly selector?: string | undefined;
  readonly observedValue?: string | number | undefined;
  readonly expectedValue?: string | number | undefined;
  readonly timestamp: string;
}

export interface ProblemImpact {
  readonly affectedUsersCount: number;
  readonly affectedSessionsCount: number;
  readonly affectedRoles: readonly Role[];
  readonly affectedFeatures: readonly string[];
  readonly affectedFiles: readonly string[];
  readonly userImpactRatio: number; // 0.0 - 1.0
  readonly isBlockingCoreFlow: boolean;
  readonly blastRadiusScore: number; // 0 - 100
}

export interface ProblemScores {
  readonly severityScore: number;       // 0 - 100 (weight: 20%)
  readonly confidenceScore: number;     // 0 - 100 (weight: 10%)
  readonly userImpactScore: number;     // 0 - 100 (weight: 20%)
  readonly frequencyScore: number;      // 0 - 100 (weight: 20%)
  readonly scopeScore: number;          // 0 - 100 (weight: 15%)
  readonly regressionBonus: number;     // 0 or 15
  readonly blockingBonus: number;       // 0 or 15
  readonly contradictionPenalty: number;// 0 or 10
  readonly priorityScore: number;       // 0 - 100 (normalized & clamped)
}

export interface ProblemStateTransition {
  readonly fromStatus: ProblemStatus;
  readonly toStatus: ProblemStatus;
  readonly timestamp: string;
  readonly reason?: string | undefined;
  readonly userId?: string | undefined;
}

export interface ContradictoryFeedbackCluster {
  readonly id: string;
  readonly topic: string;
  readonly positiveCount: number;
  readonly negativeCount: number;
  readonly positiveRoles: readonly Role[];
  readonly negativeRoles: readonly Role[];
  readonly positiveSignals: readonly string[];
  readonly negativeSignals: readonly string[];
  readonly analysis: string;
  readonly recommendation: string;
}

export interface AggregatedProblem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: FeedbackCategory;
  readonly subtype?: BugSubtype | undefined;
  readonly status: ProblemStatus;
  readonly severity: ProblemSeverity;
  readonly urgency: ProblemUrgency;
  readonly regressionStatus: RegressionStatus;
  readonly trend: TrendStatus;
  readonly signals: readonly UserSignal[];
  readonly evidence: readonly ProblemEvidence[];
  readonly impact: ProblemImpact;
  readonly scores: ProblemScores;
  readonly rootCauseHypothesis?: string | undefined;
  readonly suggestedRemediation?: string | undefined;
  readonly problemHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly history: readonly ProblemStateTransition[];
}

export interface ProblemGraphNode {
  readonly id: string;
  readonly title: string;
  readonly category: FeedbackCategory;
  readonly severity: ProblemSeverity;
  readonly status: ProblemStatus;
  readonly priorityScore: number;
  readonly isRootProblem: boolean;
}

export type ProblemGraphEdgeKind = 'CAUSED_BY' | 'DUPLICATES' | 'RELATES_TO' | 'CONTRADICTS' | 'BLOCKS';

export interface ProblemGraphEdge {
  readonly fromProblemId: string;
  readonly toProblemId: string;
  readonly kind: ProblemGraphEdgeKind;
  readonly reason: string;
}

export interface ProblemGraph {
  readonly nodes: readonly ProblemGraphNode[];
  readonly edges: readonly ProblemGraphEdge[];
  readonly rootProblemIds: readonly string[];
  readonly topologicalOrder: readonly string[];
  readonly hasCycles: boolean;
}

export interface FeedbackGraphNode {
  readonly id: string;
  readonly category: FeedbackCategory;
  readonly sentiment: UserSentiment;
  readonly timestamp: string;
}

export interface FeedbackGraphEdge {
  readonly fromSignalId: string;
  readonly toSignalId: string;
  readonly similarity: number; // 0.0 - 1.0
  readonly reason: string;
}

export interface FeedbackGraph {
  readonly nodes: readonly FeedbackGraphNode[];
  readonly edges: readonly FeedbackGraphEdge[];
}

export interface FeedbackFeatureBridgeNode {
  readonly featureId: string;
  readonly problemCount: number;
  readonly bugCount: number;
  readonly requestCount: number;
  readonly highestPriorityScore: number;
}

export interface FeedbackFeatureBridgeEdge {
  readonly problemId: string;
  readonly featureId: string;
  readonly relationship: 'REPORTED_ON' | 'FEATURE_REQUESTED' | 'UX_FLAW';
}

export interface FeedbackFeatureGraph {
  readonly features: readonly FeedbackFeatureBridgeNode[];
  readonly links: readonly FeedbackFeatureBridgeEdge[];
}

export interface UserFeedbackSummary {
  readonly totalSignals: number;
  readonly totalProblems: number;
  readonly criticalBugsCount: number;
  readonly confirmedRegressionsCount: number;
  readonly featureRequestsCount: number;
  readonly contradictionClustersCount: number;
  readonly avgPriorityScore: number;
  readonly topProblems: readonly AggregatedProblem[];
}

export interface UserFeedbackReport {
  readonly reportId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly problems: readonly AggregatedProblem[];
  readonly contradictions: readonly ContradictoryFeedbackCluster[];
  readonly summary: UserFeedbackSummary;
  readonly problemGraph: ProblemGraph;
  readonly reportHash: string;
  readonly createdAt: string;
  readonly durationMs: number;
}

export interface UserFeedbackComparison {
  readonly previousReportId: string;
  readonly currentReportId: string;
  readonly newProblems: readonly string[];
  readonly resolvedProblems: readonly string[];
  readonly priorityScoreDelta: number;
}

export interface UserFeedbackConfig {
  readonly minConfidenceThreshold: number; // default 0.30
  readonly enableDeduplication: boolean;    // default true
  readonly enableContradictionDetection: boolean; // default true
  readonly enableRegressionDetection: boolean;    // default true
  readonly enableAuditBridge: boolean;     // default true
  readonly enableFeatureBridge: boolean;   // default true
  readonly strictEvidenceCheck: boolean;  // default true (NO EVIDENCE -> NO CLAIM)
}

export interface RawErrorSignal {
  readonly message: string;
  readonly stack?: string | undefined;
  readonly component?: string | undefined;
  readonly url?: string | undefined;
  readonly timestamp?: string | undefined;
}

export interface FeedbackAnalysisRequest {
  readonly tenantId: string;
  readonly projectId: string;
  readonly signals?: readonly UserSignal[] | undefined;
  readonly rawFeedbacks?: readonly string[] | undefined;
  readonly errors?: readonly RawErrorSignal[] | undefined;
  readonly conversationTurns?: readonly ConversationTurn[] | undefined;
  readonly dna?: ApplicationDNA | undefined;
  readonly auditReport?: ApplicationAuditReport | undefined;
  readonly existingDecisions?: readonly ArchitecturalDecisionRecord[] | undefined;
  readonly config?: Partial<UserFeedbackConfig> | undefined;
  readonly callerRole?: Role | undefined;
}

export interface ProposedRemediationPlan {
  readonly problemId: string;
  readonly taskGraph: EngineeringTaskGraph;
  readonly recommendedDomain: AgentDomain;
  readonly estimatedTokens: number;
  readonly prerequisiteTasks: readonly string[];
}
