/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Application Evolution Engine - Domain Types & Data Contracts
 *
 * Strict Invariants:
 * - NO EVIDENCE → NO CLAIM (every proposal must link to verifiable evidence)
 * - HUMAN CONTROL (proposals are advisory, never mutate code directly)
 * - DETERMINISTIC SCORING (0-100 pure mathematical formulas, no Math.random())
 * - HERMETIC MULTI-TENANCY (isolated by tenantId)
 */

import type { Role } from '../../identity/permissions.js';

// ---------------------------------------------------------------------------
// Primitive enumerations
// ---------------------------------------------------------------------------

export type EvolutionCategory =
  | 'BUG_REMEDIATION'
  | 'NEW_FEATURE'
  | 'FEATURE_IMPROVEMENT'
  | 'ARCHITECTURE_IMPROVEMENT'
  | 'TECH_DEBT_REDUCTION'
  | 'SECURITY_HARDENING'
  | 'PERFORMANCE_OPTIMIZATION'
  | 'UX_IMPROVEMENT'
  | 'ACCESSIBILITY'
  | 'OBSERVABILITY'
  | 'DEPENDENCY_UPDATE'
  | 'DOCUMENTATION'
  | 'REMOVE_FEATURE'
  | 'INVESTIGATE'
  | 'DEFER';

export type EvolutionStatus =
  | 'PROPOSED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'DEFERRED'
  | 'UNSUPPORTED'
  | 'BLOCKED';

export type EvolutionReadinessStatus =
  | 'READY'
  | 'READY_WITH_RISK'
  | 'BLOCKED'
  | 'NOT_READY'
  | 'UNKNOWN';

export type EvidenceType = 'FACT' | 'CORRELATION' | 'HYPOTHESIS';

export type EvidenceSource =
  | 'AUDIT'
  | 'FEATURE'
  | 'FEEDBACK'
  | 'STRATEGY'
  | 'DNA'
  | 'CONVERSATION'
  | 'UNKNOWN';

export type StrategicAlignmentLevel =
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'CONFLICTING'
  | 'UNKNOWN';

export type EvolutionUrgency = 'NOW' | 'NEXT' | 'LATER' | 'WATCH';

export type ValueEffortQuadrant =
  | 'QUICK_WIN'
  | 'STRATEGIC_BET'
  | 'FILL_IN'
  | 'AVOID';

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export interface EvolutionEvidence {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly type: EvidenceType;
  readonly source: EvidenceSource;
  readonly description: string;
  readonly confidence: number; // 0.0 to 1.0
  readonly weight: number; // 0.0 to 1.0
  readonly verifiableReference: string;
  readonly dataPayload?: Readonly<Record<string, unknown>> | undefined;
  readonly collectedAt: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface StateDimension {
  readonly value: number; // 0-100
  readonly source: EvidenceSource;
  readonly collectedAt: string;
}

export interface ApplicationEvolutionState {
  readonly tenantId: string;
  readonly projectId: string;
  readonly stateHash: string;
  readonly reliability: StateDimension;
  readonly security: StateDimension;
  readonly ux: StateDimension;
  readonly performance: StateDimension;
  readonly architecture: StateDimension;
  readonly codeQuality: StateDimension;
  readonly featureHealth: StateDimension;
  readonly userSatisfaction: StateDimension;
  readonly strategicAlignment: StateDimension;
  readonly collectedAt: string;
}

export interface ProductHealthScore {
  readonly overall: number; // 0-100
  readonly reliability: number;
  readonly security: number;
  readonly ux: number;
  readonly performance: number;
  readonly architecture: number;
  readonly codeQuality: number;
  readonly featureHealth: number;
  readonly userSatisfaction: number;
  readonly strategicAlignment: number;
  readonly mathematicalExplanation: string;
}

// ---------------------------------------------------------------------------
// DNA alignment
// ---------------------------------------------------------------------------

export interface DNAAlignmentResult {
  readonly aligned: boolean;
  readonly alignmentScore: number; // 0-100
  readonly violations: string[];
  readonly explanation: string;
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export interface EvolutionProposal {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly category: EvolutionCategory;
  readonly title: string;
  readonly description: string;
  readonly rationale: string;

  // Scores
  readonly priorityScore: number; // 0-100 (EPS)
  readonly userValue: number; // 0-100
  readonly businessValue: number; // 0-100
  readonly technicalValue: number; // 0-100
  readonly effort: number; // 0-100
  readonly complexity: number; // 0-100
  readonly risk: number; // 0-100
  readonly expectedValue: number; // 0-100 impact
  readonly urgency: EvolutionUrgency;
  readonly strategicAlignmentLevel: StrategicAlignmentLevel;

  // Evidence tracing
  readonly evidence: EvolutionEvidence[];
  readonly evidenceConfidence: number; // 0.0 to 1.0

  // Scope
  readonly affectedComponents: string[];
  readonly blastRadius: number; // 0-100
  readonly dependencies: string[]; // proposal IDs

  // Planning
  readonly status: EvolutionStatus;
  readonly valueEffortQuadrant: ValueEffortQuadrant;
  readonly strategicAlignmentScore: number; // 0-100 numeric

  // Provenance
  readonly provenance: {
    readonly origin: string;
    readonly ruleSet: string;
    readonly hash: string;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Requests & Reports
// ---------------------------------------------------------------------------

export interface EvolutionAnalysisRequest {
  readonly tenantId: string;
  readonly projectId: string;
  readonly callerRole: Role;
  readonly sources: Readonly<Record<string, unknown>>;
  readonly options?: {
    readonly forceRecompute?: boolean | undefined;
    readonly maxProposals?: number | undefined;
  } | undefined;
}

export interface EvolutionAnalysisReport {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly applicationState: ApplicationEvolutionState;
  readonly healthScore: ProductHealthScore;
  readonly readinessStatus: EvolutionReadinessStatus;
  readonly proposals: EvolutionProposal[];
  readonly totalEvidenceEvaluated: number;
  readonly overallConfidence: number; // 0.0 to 1.0
  readonly reportHash: string;
  readonly createdAt: string;
  readonly analysisDurationMs: number;
}

export interface EvolutionDecisionResult {
  readonly success: boolean;
  readonly proposalId: string;
  readonly previousStatus: EvolutionStatus;
  readonly newStatus: EvolutionStatus;
  readonly decidedByRole: Role;
  readonly reason: string;
  readonly timestamp: string;
}
