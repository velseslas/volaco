/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Strategy Risk Analyzer - Assesses architectural, security, and blast radius risks
 */

import type { StrategyContext, RecommendationType } from '../types.js';

export interface EvaluatedRisk {
  riskScore: number; // 0-100
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  blastRadius: number; // 0-100
  mitigation: string;
}

export class StrategyRiskAnalyzer {
  /**
   * Assesses risk for a specific recommendation type and context.
   */
  public assessRisk(
    type: RecommendationType,
    effortPoints: number,
    dependenciesCount: number,
    context: StrategyContext
  ): EvaluatedRisk {
    let baseRisk = 20;

    // Architectural changes or refactoring carry higher base risk
    if (type === 'FIX_ARCHITECTURAL_RISK' || type === 'REFACTOR') {
      baseRisk = 50;
    } else if (type === 'FIX_SECURITY_RISK') {
      baseRisk = 30;
    } else if (type === 'BUILD_FEATURE' || type === 'EXTEND_FEATURE') {
      baseRisk = 35;
    } else if (type === 'FIX_REGRESSION' || type === 'FIX_CRITICAL_PROBLEM') {
      baseRisk = 25; // targeted fixes
    } else if (type === 'DEFER' || type === 'MONITOR') {
      baseRisk = 10;
    }

    // Adjust by blast radius from impact report if available
    let blastRadius = 25;
    if (context.impactReport && typeof (context.impactReport as unknown as { overallScore?: number }).overallScore === 'number') {
      blastRadius = Math.min(100, Math.max(0, (context.impactReport as unknown as { overallScore: number }).overallScore));
    } else {
      blastRadius = Math.min(100, 15 + effortPoints * 8);
    }

    // Dependencies add structural risk
    const depRisk = Math.min(25, dependenciesCount * 8);
    const effortRisk = Math.min(25, effortPoints * 4);

    const totalRiskScore = Math.min(100, Math.max(0, Math.round(0.4 * baseRisk + 0.3 * blastRadius + 0.15 * depRisk + 0.15 * effortRisk)));

    let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (totalRiskScore >= 75) severity = 'CRITICAL';
    else if (totalRiskScore >= 55) severity = 'HIGH';
    else if (totalRiskScore >= 35) severity = 'MEDIUM';

    let mitigation = 'Valider via tests automatisés et inspection AST.';
    if (severity === 'CRITICAL' || severity === 'HIGH') {
      mitigation = 'Isoler dans un worktree dédié, exécuter la suite de non-régression complète et demander approbation humaine explicite.';
    } else if (dependenciesCount > 0) {
      mitigation = 'Vérifier la complétion préalable des dépendances en amont.';
    }

    return {
      riskScore: totalRiskScore,
      severity,
      blastRadius,
      mitigation
    };
  }
}
