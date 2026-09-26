/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Priority Ranking Engine - Multi-criteria stable deterministic ranking
 */

import { compareRecommendations } from '../canonical.js';
import type { StrategicRecommendation } from '../types.js';

export class PriorityRankingEngine {
  /**
   * Sorts recommendations by score, urgency, confidence, and stable identity.
   */
  public rank(recommendations: StrategicRecommendation[]): StrategicRecommendation[] {
    const sorted = [...recommendations].sort((a, b) => compareRecommendations(a, b));

    // Assign sequence numbers
    return sorted.map((rec, index) => ({
      ...rec,
      recommendedSequence: index + 1
    }));
  }
}
