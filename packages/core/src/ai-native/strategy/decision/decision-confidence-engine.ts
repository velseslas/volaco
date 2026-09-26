/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Decision Confidence Engine - Computes evidence-backed confidence (0.0 to 1.0)
 * 
 * Strict Invariant: NO EVIDENCE → NO CLAIM.
 */

import type { StrategyEvidence } from '../types.js';

export class StrategicConfidenceEngine {
  /**
   * Computes confidence score between 0.0 and 1.0 based on evidence strength.
   */
  public computeConfidence(evidence: StrategyEvidence[]): number {
    if (!evidence || evidence.length === 0) {
      return 0.1; // Insufficient evidence
    }

    let factCount = 0;
    let correlationCount = 0;
    let hypothesisCount = 0;
    let totalConfidenceSum = 0;

    for (const ev of evidence) {
      totalConfidenceSum += Math.min(1.0, Math.max(0.0, ev.confidence || 0.5));
      if (ev.provenanceType === 'FACT') factCount++;
      else if (ev.provenanceType === 'CORRELATION') correlationCount++;
      else if (ev.provenanceType === 'HYPOTHESIS') hypothesisCount++;
    }

    const avgConfidence = totalConfidenceSum / evidence.length;

    // Weight by provenance quality
    // FACTS boost confidence, HYPOTHESIS cap confidence
    let provenanceFactor = 0.7;
    if (factCount > 0) {
      provenanceFactor = 0.95;
    } else if (correlationCount > 0) {
      provenanceFactor = 0.8;
    } else if (hypothesisCount > 0) {
      provenanceFactor = 0.4;
    }

    const finalConfidence = Math.min(1.0, Math.max(0.0, avgConfidence * provenanceFactor));
    return Number(finalConfidence.toFixed(2));
  }
}
