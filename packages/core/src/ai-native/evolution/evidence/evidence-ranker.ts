/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Evidence Ranker - Deterministic ranking and confidence aggregation
 *
 * Ranking order: FACT > CORRELATION > HYPOTHESIS, then confidence DESC.
 * Aggregate confidence = weighted average of evidence confidence values.
 */

import type { EvolutionEvidence, EvidenceType } from '../types.js';

// ---------------------------------------------------------------------------
// Type rank lookup (deterministic, no mutation)
// ---------------------------------------------------------------------------

const EVIDENCE_TYPE_RANK: Record<EvidenceType, number> = {
  FACT: 3,
  CORRELATION: 2,
  HYPOTHESIS: 1,
};

function getTypeRank(type: EvidenceType): number {
  return EVIDENCE_TYPE_RANK[type];
}

function compareEvidence(a: EvolutionEvidence, b: EvolutionEvidence): number {
  const rankDiff = getTypeRank(b.type) - getTypeRank(a.type);
  if (rankDiff !== 0) return rankDiff;
  // Secondary sort: confidence DESC
  return b.confidence - a.confidence;
}

/**
 * Ranks and aggregates evidence deterministically.
 *
 * - rank(): FACT > CORRELATION > HYPOTHESIS, then confidence DESC
 * - computeAggregateConfidence(): weighted average by evidence.weight
 */
export class EvidenceRanker {
  /**
   * Returns evidence sorted by type rank (FACT first) then confidence DESC.
   * Does not mutate the input array.
   */
  public rank(evidence: EvolutionEvidence[]): EvolutionEvidence[] {
    return [...evidence].sort(compareEvidence);
  }

  /**
   * Computes an aggregate confidence score (0..1) as a weighted average.
   * Returns 0 if the evidence array is empty.
   */
  public computeAggregateConfidence(evidence: EvolutionEvidence[]): number {
    if (evidence.length === 0) return 0;

    let weightedSum = 0;
    let totalWeight = 0;

    for (const e of evidence) {
      weightedSum += e.confidence * e.weight;
      totalWeight += e.weight;
    }

    if (totalWeight === 0) return 0;

    return Math.min(1.0, Math.max(0.0, weightedSum / totalWeight));
  }
}
