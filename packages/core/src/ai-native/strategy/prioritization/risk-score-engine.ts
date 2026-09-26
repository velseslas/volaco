/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Risk Score Engine - Multi-factor risk assessment and scoring
 */

export interface RiskCalculationParameters {
  blastRadiusScore: number; // 0-100
  architecturalComplexityScore: number; // 0-100
  dependencyDepth: number; // count
  stateMutationRiskScore: number; // 0-100
}

export class RiskScoreEngine {
  /**
   * Computes composite risk score (0-100).
   */
  public computeRiskScore(params: RiskCalculationParameters): number {
    const depRisk = Math.min(100, params.dependencyDepth * 15);
    const weighted = 
      0.40 * params.blastRadiusScore +
      0.30 * params.architecturalComplexityScore +
      0.20 * params.stateMutationRiskScore +
      0.10 * depRisk;

    return Math.min(100, Math.max(0, Math.round(weighted)));
  }
}
