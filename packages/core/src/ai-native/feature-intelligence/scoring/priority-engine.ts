/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Priority Engine - Deterministic Mathematical Priority Scoring (0-100)
 */

import type { FeatureScores } from '../types.js';

export class PriorityEngine {
  /**
   * Calcule le score de priorité global (0 - 100)
   * Formule :
   * - Business Value : 25%
   * - Evidence Confidence : 20%
   * - User Impact : 20%
   * - Strategic Alignment : 15%
   * - Architectural Feasibility : 10%
   * - Risk Minimization : 10%
   * Moins les pénalités déterministes.
   */
  public computePriorityScore(components: {
    readonly businessValue: number;
    readonly evidenceConfidence: number;
    readonly userImpact: number;
    readonly strategicAlignment: number;
    readonly architecturalFeasibility: number;
    readonly riskMinimization: number;
    readonly penalties?: number;
  }): FeatureScores {
    const rawScore =
      components.businessValue * 0.25 +
      components.evidenceConfidence * 0.20 +
      components.userImpact * 0.20 +
      components.strategicAlignment * 0.15 +
      components.architecturalFeasibility * 0.10 +
      components.riskMinimization * 0.10 -
      (components.penalties ?? 0);

    const priorityScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    return {
      businessValue: Math.round(components.businessValue),
      evidenceConfidence: Math.round(components.evidenceConfidence),
      userImpact: Math.round(components.userImpact),
      strategicAlignment: Math.round(components.strategicAlignment),
      architecturalFeasibility: Math.round(components.architecturalFeasibility),
      riskMinimization: Math.round(components.riskMinimization),
      priorityScore
    };
  }
}
