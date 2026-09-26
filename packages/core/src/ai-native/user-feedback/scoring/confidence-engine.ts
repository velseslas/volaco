/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Confidence Engine: Global Confidence Scoring for Aggregated Problems
 */

import type { ProblemEvidence, UserSignal } from '../types.js';
import { EvidenceConfidenceEngine } from '../evidence/evidence-confidence-engine.js';

export class ConfidenceEngine {
  private readonly evidenceConfidenceEngine = new EvidenceConfidenceEngine();

  public computeOverallConfidence(
    signals: readonly UserSignal[],
    evidence: readonly ProblemEvidence[]
  ): number {
    const evidenceScore = this.evidenceConfidenceEngine.computeConfidenceScore(evidence);

    // Pondération volume de signaux : +5 points par signal supplémentaire (max 20)
    const volumeBonus = Math.min(20, Math.max(0, (signals.length - 1) * 5));

    const finalScore = Math.max(0, Math.min(100, evidenceScore + volumeBonus));
    return Math.round(finalScore);
  }
}
