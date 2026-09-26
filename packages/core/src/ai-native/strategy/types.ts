/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * AI Strategy Optimizer Engine - Domain Types & Data Contracts
 * 
 * Strict Invariants:
 * - NO EVIDENCE → NO CLAIM (every recommendation must link to verifiable evidence)
 * - HUMAN CONTROL (recommendations are advisory, never mutate code directly)
 * - DETERMINISTIC SCORING (0-100 pure mathematical formulas, no Math.random())
 * - HERMETIC MULTI-TENANCY (isolated by tenantId)
 */

import type { Role } from '../../identity/permissions.js';
import type { ApplicationDNA } from '../dna/types.js';
import type { ApplicationAuditReport, ApplicationAuditFinding } from '../application-audit/types.js';
import type { FeatureCandidate, FeatureIntelligenceReport } from '../feature-intelligence/types.js';
import type { AggregatedProblem, UserFeedbackReport } from '../user-feedback/types.js';
import type { SemanticCodeGraph } from '../semantic-graph/types.js';
import type { ImpactAnalysis } from '../impact-intelligence/types.js';
import type { EngineeringTaskGraph } from '../ai-orchestrator/types.js';

export type RecommendationType =
  | 'FIX_CRITICAL_PROBLEM'
  | 'FIX_REGRESSION'
  | 'FIX_SECURITY_RISK'
  | 'FIX_ARCHITECTURAL_RISK'
  | 'REDUCE_TECHNICAL_DEBT'
  | 'IMPROVE_UX'
  | 'IMPROVE_ACCESSIBILITY'
  | 'IMPROVE_PERFORMANCE'
  | 'IMPROVE_DESIGN_HARMONY'
  | 'BUILD_FEATURE'
  | 'EXTEND_FEATURE'
  | 'REMOVE_FEATURE'
  | 'REFACTOR'
  | 'DEFER'
  | 'MONITOR'
  | 'INVESTIGATE';

export type RecommendationStatus =
  | 'RECOMMENDED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PLANNED'
  | 'EXECUTING'
  | 'COMPLETED';

export type ProvenanceClassification =
  | 'FACT'
  | 'CORRELATION'
  | 'HYPOTHESIS'
  | 'UNKNOWN';

export type RoadmapHorizon =
  | 'NOW'
  | 'NEXT'
  | 'LATER'
  | 'DEFERRED';

export type EffortLevel = 'XS' | 'S' | 'M' | 'L' | 'XL';

export interface StrategyEvidence {
  id: string;
  source: 'AUDIT' | 'FEEDBACK' | 'FEATURE' | 'DNA' | 'SEMANTIC_GRAPH' | 'IMPACT' | 'HISTORIC_DECISION' | 'USER_SIGNAL';
  description: string;
  confidence: number; // 0.0 to 1.0
  provenanceType: ProvenanceClassification;
  verifiableReference: string;
  dataPayload?: Record<string, unknown>;
}

export interface ScoreFactorBreakdown {
  name: string;
  weight: number;
  rawScore: number;
  weightedContribution: number;
  explanation: string;
}

export interface StrategicScoreBreakdown {
  strategicScore: number; // 0 to 100
  valueScore: number; // 0 to 100
  riskScore: number; // 0 to 100
  effortScore: number; // 0 to 100
  urgencyScore: number; // 0 to 100
  confidenceScore: number; // 0 to 100
  factors: ScoreFactorBreakdown[];
  mathematicalExplanation: string;
}

export interface StrategicAlternative {
  id: string;
  title: string;
  description: string;
  tradeOffs: {
    pros: string[];
    cons: string[];
    riskImpact: string;
    effortDelta: string;
  };
  scoreDelta: number; // e.g. -15 vs primary recommendation
}

export interface StrategicRecommendation {
  id: string;
  tenantId: string;
  projectId: string;
  type: RecommendationType;
  title: string;
  description: string;

  // Scores
  strategicScore: number; // 0 to 100
  valueScore: number; // 0 to 100
  riskScore: number; // 0 to 100
  effortScore: number; // 0 to 100
  urgencyScore: number; // 0 to 100
  confidence: number; // 0.0 to 1.0
  scoreBreakdown: StrategicScoreBreakdown;

  // Impact Assessments
  expectedValue: string;
  userImpact: string;
  technicalImpact: string;
  businessImpact: string;
  risk: {
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    blastRadius: number; // 0 to 100
    mitigation: string;
  };
  effort: {
    level: EffortLevel;
    points: number; // 1, 2, 3, 5, 8
    estimatedHours: number;
  };
  dependencies: string[]; // IDs of other recommendations required first

  // Strict Evidence Tracking
  evidence: StrategyEvidence[];
  evidenceStatus: 'VERIFIED' | 'INSUFFICIENT_EVIDENCE' | 'CORRELATED';
  supportingProblems: string[]; // problem IDs from AINT-015
  supportingOpportunities: string[]; // opportunity/feature IDs from AINT-014
  supportingFindings: string[]; // finding IDs from AINT-013

  // Justification & What-if
  rationale: string;
  alternatives: StrategicAlternative[];
  consequencesIfIgnored: string[];

  // Planning & Execution State
  recommendedHorizon: RoadmapHorizon;
  recommendedSequence: number; // 1, 2, 3...
  status: RecommendationStatus;

  // Provenance & Audit
  provenance: {
    origin: string;
    ruleSet: string;
    hash: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface StrategyContext {
  tenantId: string;
  projectId: string;
  inputHash: string;
  dna?: ApplicationDNA | undefined;
  auditReport?: ApplicationAuditReport | undefined;
  featureReport?: FeatureIntelligenceReport | undefined;
  feedbackReport?: UserFeedbackReport | undefined;
  semanticGraph?: SemanticCodeGraph | undefined;
  impactReport?: ImpactAnalysis | undefined;
  priorDecisions?: StrategicMemoryEntry[] | undefined;
  collectedAt: string;
}

export interface StrategicMemoryEntry {
  id: string;
  tenantId: string;
  projectId: string;
  recommendationId: string;
  action: 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'COMPLETED';
  reason: string;
  contextHash: string;
  timestamp: string;
  recordedByRole: Role;
}

export interface StrategicActionItem {
  recommendationId: string;
  type: RecommendationType;
  title: string;
  strategicScore: number;
  horizon: RoadmapHorizon;
  sequenceOrder: number;
  dependencies: string[];
  effortLevel: EffortLevel;
  riskSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface StrategicRoadmap {
  id: string;
  tenantId: string;
  projectId: string;
  horizons: {
    now: StrategicActionItem[];
    next: StrategicActionItem[];
    later: StrategicActionItem[];
    deferred: StrategicActionItem[];
  };
  topologicalOrder: string[];
  totalActionsCount: number;
  estimatedTotalEffortPoints: number;
  generatedAt: string;
  roadmapHash: string;
}

export interface WhatIfScenario {
  id: string;
  name: string;
  description: string;
  selectedRecommendationIds: string[];
  projectedStrategicValue: number; // 0-100 composite
  projectedRiskScore: number; // 0-100 composite
  projectedEffortPoints: number;
  opportunityCost: {
    forgoneRecommendations: { id: string; title: string; score: number; valueScore?: number }[];
    totalForgoneValue: number;
    rationale: string;
  };
  pros: string[];
  cons: string[];
}

export interface WhatIfComparison {
  baseStrategy: WhatIfScenario;
  alternativeScenarios: WhatIfScenario[];
  recommendedScenarioId: string;
  recommendationRationale: string;
  comparisonMatrix: Array<{
    scenarioId: string;
    scenarioName: string;
    score: number;
    value: number;
    risk: number;
    effort: number;
    verdict: string;
  }>;
}

export interface StrategyOptimizationRequest {
  tenantId: string;
  projectId: string;
  dna?: ApplicationDNA | undefined;
  auditReport?: ApplicationAuditReport | undefined;
  featureReport?: FeatureIntelligenceReport | undefined;
  feedbackReport?: UserFeedbackReport | undefined;
  semanticGraph?: SemanticCodeGraph | undefined;
  impactReport?: ImpactAnalysis | undefined;
  priorDecisions?: StrategicMemoryEntry[] | undefined;
  options?: {
    forceRecompute?: boolean | undefined;
    maxRecommendations?: number | undefined;
    targetHorizon?: RoadmapHorizon | undefined;
  } | undefined;
  callerRole: Role;
}

export interface StrategyOptimizationReport {
  id: string;
  tenantId: string;
  projectId: string;
  overallStrategicScore: number; // 0-100 application health & strategy score
  topPriorities: StrategicRecommendation[];
  allRecommendations: StrategicRecommendation[];
  roadmap: StrategicRoadmap;
  whatIfAnalysis: WhatIfComparison;
  contextSummary: {
    auditFindingsCount: number;
    featureOpportunitiesCount: number;
    userProblemsCount: number;
    regressionsCount: number;
    criticalDefectsCount: number;
  };
  metrics: {
    analysisDurationMs: number;
    totalEvidenceEvaluated: number;
    rulesTriggeredCount: number;
  };
  createdAt: string;
  reportHash: string;
}

export interface StrategyApprovalResult {
  success: boolean;
  recommendationId: string;
  previousStatus: RecommendationStatus;
  newStatus: RecommendationStatus;
  generatedTaskGraph?: EngineeringTaskGraph | undefined;
  recordedMemoryEntry: StrategicMemoryEntry;
  timestamp: string;
}
