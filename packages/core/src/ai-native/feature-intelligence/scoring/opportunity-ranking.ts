/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Opportunity Ranking - Stable Multi-Criteria Deterministic Sorter
 */

import type { FeatureCandidate } from '../types.js';
import { compareFeatureCandidates } from '../canonical.js';

export class OpportunityRanking {
  /**
   * Trie une liste d'opportunités de manière stable et déterministe
   */
  public rankOpportunities(candidates: readonly FeatureCandidate[]): readonly FeatureCandidate[] {
    return [...candidates].sort(compareFeatureCandidates);
  }
}
