/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Evolution Priority Engine (EPS) - Deterministic 0-100 proposal priority scoring
 *
 * EXACT formula (0 Math.random(), 0 LLM hallucination):
 *
 * Base = 0.20 × userValue
 *      + 0.20 × strategicAlignmentScore (HIGH=100, MEDIUM=66, LOW=33, CONFLICTING=0, UNKNOWN=50)
 *      + 0.15 × evidenceConfidence × 100
 *      + 0.15 × expectedValue
 *      + 0.10 × urgencyScore (NOW=100, NEXT=66, LATER=33, WATCH=10)
 *      + 0.10 × riskReduction (= 100 - risk)
 *      + 0.10 × businessValue
 *
 * Penalty = 0.10 × effort + 0.05 × complexity + 0.05 × risk
 *
 * EPS = clamp(0, 100, Base - Penalty)
 */

import type {
  EvolutionProposal,
  EvolutionUrgency,
  StrategicAlignmentLevel,
} from '../types.js';

// ---------------------------------------------------------------------------
// Score lookup tables
// ---------------------------------------------------------------------------

const URGENCY_SCORE: Record<EvolutionUrgency, number> = {
  NOW: 100,
  NEXT: 66,
  LATER: 33,
  WATCH: 10,
};

const ALIGNMENT_SCORE: Record<StrategicAlignmentLevel, number> = {
  HIGH: 100,
  MEDIUM: 66,
  LOW: 33,
  CONFLICTING: 0,
  UNKNOWN: 50,
};

// ---------------------------------------------------------------------------
// Weight constants
// ---------------------------------------------------------------------------

// Base weights (must sum to 1.0)
const W_USER_VALUE: number = 0.20;
const W_STRATEGIC_ALIGNMENT: number = 0.20;
const W_EVIDENCE_CONFIDENCE: number = 0.15;
const W_EXPECTED_VALUE: number = 0.15;
const W_URGENCY: number = 0.10;
const W_RISK_REDUCTION: number = 0.10;
const W_BUSINESS_VALUE: number = 0.10;

// Penalty weights
const P_EFFORT: number = 0.10;
const P_COMPLEXITY: number = 0.05;
const P_RISK: number = 0.05;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// EvolutionPriorityEngine
// ---------------------------------------------------------------------------

/**
 * Computes the Evolution Priority Score (EPS) for a proposal.
 *
 * EPS is a deterministic 0-100 score with no randomness.
 * The formula is fully documented in the file header.
 */
export class EvolutionPriorityEngine {
  /**
   * Computes EPS (0..100) for a proposal without its priorityScore field.
   *
   * All inputs are taken from the proposal struct — no external state.
   */
  public computeEPS(
    proposal: Omit<EvolutionProposal, 'priorityScore'>,
  ): number {
    const urgencyScore = URGENCY_SCORE[proposal.urgency];
    const alignmentScore = ALIGNMENT_SCORE[proposal.strategicAlignmentLevel];
    const confidenceScore = clamp(proposal.evidenceConfidence * 100, 0, 100);
    const riskReduction = clamp(100 - proposal.risk, 0, 100);

    const base =
      W_USER_VALUE * proposal.userValue +
      W_STRATEGIC_ALIGNMENT * alignmentScore +
      W_EVIDENCE_CONFIDENCE * confidenceScore +
      W_EXPECTED_VALUE * proposal.expectedValue +
      W_URGENCY * urgencyScore +
      W_RISK_REDUCTION * riskReduction +
      W_BUSINESS_VALUE * proposal.businessValue;

    const penalty =
      P_EFFORT * proposal.effort +
      P_COMPLEXITY * proposal.complexity +
      P_RISK * proposal.risk;

    const eps = clamp(base - penalty, 0, 100);

    return Math.round(eps);
  }
}
