/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Evidence Confidence Engine: Mathematical Confidence Score [0 - 100]
 */

import type { ProblemEvidence } from '../types.js';

export class EvidenceConfidenceEngine {
  /**
   * Calcule un score global de confiance (0 - 100) déterministe pour un ensemble de preuves
   */
  public computeConfidenceScore(evidence: readonly ProblemEvidence[]): number {
    if (!evidence || evidence.length === 0) {
      return 0;
    }

    let factCount = 0;
    let correlationCount = 0;
    let hypothesisCount = 0;
    const uniqueSources = new Set<string>();

    for (const e of evidence) {
      uniqueSources.add(e.source);
      if (e.proofLevel === 'FACT') factCount++;
      else if (e.proofLevel === 'CORRELATION') correlationCount++;
      else hypothesisCount++;
    }

    // Base mathématique pondérée
    let score = (factCount * 25) + (correlationCount * 12) + (hypothesisCount * 5);

    // Bonus de corroboration multi-source (+15 points si au moins 2 sources distinctes)
    if (uniqueSources.size >= 2) {
      score += 15;
    }

    // Bonus si confirmation matérielle absolue (runtime error ou audit)
    if (uniqueSources.has('error_runtime') || uniqueSources.has('audit_finding')) {
      score += 10;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }
}
