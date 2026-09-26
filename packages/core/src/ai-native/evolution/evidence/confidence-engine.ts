/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Confidence Engine - Deterministic evidence confidence computation
 *
 * Formula: min(evidenceCount / 5.0, 1.0) × weightedAvgConfidence, bounded 0..1
 * hasMinimumEvidence: false when evidence.length === 0
 */

import type { EvolutionEvidence } from '../types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of evidence items required for full confidence saturation. */
const EVIDENCE_SATURATION_COUNT: number = 5;

// ---------------------------------------------------------------------------
// ConfidenceEngine
// ---------------------------------------------------------------------------

/**
 * Computes deterministic confidence scores from evidence arrays.
 *
 * - compute(): `min(count/5, 1) × weightedAvgConfidence`, bounded 0..1
 * - hasMinimumEvidence(): false when evidence.length === 0
 */
export class ConfidenceEngine {
  /**
   * Computes a combined confidence score (0..1).
   *
   * The score combines:
   * 1. Volume factor: saturates at 5 evidence items (min(count/5, 1))
   * 2. Quality factor: weighted average confidence of each evidence item
   *
   * Returns 0 for empty arrays.
   */
  public compute(evidence: EvolutionEvidence[]): number {
    if (evidence.length === 0) return 0;

    const volumeFactor = Math.min(evidence.length / EVIDENCE_SATURATION_COUNT, 1.0);

    let weightedSum = 0;
    let totalWeight = 0;

    for (const e of evidence) {
      weightedSum += e.confidence * e.weight;
      totalWeight += e.weight;
    }

    const weightedAvg = totalWeight > 0 ? weightedSum / totalWeight : 0;

    return Math.min(1.0, Math.max(0.0, volumeFactor * weightedAvg));
  }

  /**
   * Returns false if the evidence array is empty (no provable basis).
   * Returns true only when at least one piece of evidence is present.
   */
  public hasMinimumEvidence(evidence: EvolutionEvidence[]): boolean {
    return evidence.length > 0;
  }
}
