/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Confidence Engine - Deterministic Confidence Metric Calculation
 */

import type { FeatureEvidence } from '../types.js';
import { EvidenceRanker } from './evidence-ranker.js';

export class ConfidenceEngine {
  private readonly ranker = new EvidenceRanker();

  /**
   * Calcule le score agrégé de confiance déterministe [0 - 100]
   * Prend en compte :
   * 1. La moyenne pondérée de la confiance des évidences
   * 2. La diversité des sources de preuves (bonus si multi-sources : conversation + audit + app)
   * 3. Le volume de références matérielles
   */
  public computeConfidenceScore(evidenceList: readonly FeatureEvidence[]): number {
    if (!evidenceList || evidenceList.length === 0) {
      return 0;
    }

    let weightedSum = 0;
    let totalWeight = 0;
    let totalReferences = 0;
    const sources = new Set<string>();

    for (const ev of evidenceList) {
      const weight = this.ranker.getSourceWeight(ev.source);
      weightedSum += ev.confidence * weight;
      totalWeight += weight;
      sources.add(ev.source);
      totalReferences += ev.references ? ev.references.length : 0;
    }

    const baseConfidence = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0;

    // Bonus de diversité des sources (jusqu'à +15 points si 3+ sources différentes)
    let diversityBonus = 0;
    if (sources.size >= 3) {
      diversityBonus = 15;
    } else if (sources.size === 2) {
      diversityBonus = 10;
    }

    // Bonus de volume de références concrètes (jusqu'à +10 points si >= 4 références vérifiables)
    const refBonus = Math.min(10, totalReferences * 2.5);

    const rawScore = baseConfidence * 0.75 + diversityBonus + refBonus;
    return Math.max(0, Math.min(100, Math.round(rawScore)));
  }
}
