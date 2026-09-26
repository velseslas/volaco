/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Value Score Engine - Mathematical calculation of composite business and user value
 */

export interface ValueScoreParameters {
  userImpactScore: number; // 0-100
  businessRelevanceScore: number; // 0-100
  technicalDebtReductionScore: number; // 0-100
  strategicAlignmentScore: number; // 0-100
}

export class ValueScoreEngine {
  /**
   * Computes a weighted value score (0-100).
   */
  public computeValueScore(params: ValueScoreParameters): number {
    const weighted = 
      0.35 * params.userImpactScore +
      0.30 * params.businessRelevanceScore +
      0.20 * params.strategicAlignmentScore +
      0.15 * params.technicalDebtReductionScore;

    return Math.min(100, Math.max(0, Math.round(weighted)));
  }
}
