/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Problem Priority Engine: Deterministic Mathematical Priority Scoring (0 - 100)
 */

import type { ProblemScores, RegressionStatus } from '../types.js';

export interface PriorityCalculationInput {
  readonly severityScore: number;       // 0 - 100
  readonly confidenceScore: number;     // 0 - 100
  readonly userImpactScore: number;     // 0 - 100
  readonly frequencyScore: number;      // 0 - 100
  readonly blastRadiusScore: number;    // 0 - 100
  readonly regressionStatus: RegressionStatus;
  readonly isBlockingCoreFlow: boolean;
  readonly hasContradiction: boolean;
}

export class ProblemPriorityEngine {
  /**
   * Calcule le Problem Priority Score (0-100) selon la formule déterministe certifiée AINT-015
   */
  public computeScores(input: PriorityCalculationInput): ProblemScores {
    const sev = Math.max(0, Math.min(100, input.severityScore));
    const conf = Math.max(0, Math.min(100, input.confidenceScore));
    const uImp = Math.max(0, Math.min(100, input.userImpactScore));
    const freq = Math.max(0, Math.min(100, input.frequencyScore));
    const scope = Math.max(0, Math.min(100, input.blastRadiusScore));

    // Évaluation du facteur de régression intrinsèque (0 - 100)
    let regressionFactor = 0;
    if (input.regressionStatus === 'CONFIRMED') {
      regressionFactor = 100;
    } else if (input.regressionStatus === 'PROBABLE') {
      regressionFactor = 70;
    } else if (input.regressionStatus === 'SUSPECTED') {
      regressionFactor = 40;
    }

    // Calcul de la base pondérée (100% au total)
    // User Impact: 20%, Frequency: 20%, Severity: 20%, Regression Evidence: 15%, Scope: 15%, Confidence: 10%
    const weightedBase =
      (uImp * 0.20) +
      (freq * 0.20) +
      (sev * 0.20) +
      (regressionFactor * 0.15) +
      (scope * 0.15) +
      (conf * 0.10);

    // Bonus et pénalités
    const regressionBonus = input.regressionStatus === 'CONFIRMED' ? 15 : 0;
    const blockingBonus = input.isBlockingCoreFlow ? 15 : 0;
    const contradictionPenalty = input.hasContradiction ? 10 : 0;

    const rawTotal = weightedBase + regressionBonus + blockingBonus - contradictionPenalty;
    const priorityScore = Math.max(0, Math.min(100, Math.round(rawTotal)));

    return {
      severityScore: sev,
      confidenceScore: conf,
      userImpactScore: uImp,
      frequencyScore: freq,
      scopeScore: scope,
      regressionBonus,
      blockingBonus,
      contradictionPenalty,
      priorityScore
    };
  }
}
