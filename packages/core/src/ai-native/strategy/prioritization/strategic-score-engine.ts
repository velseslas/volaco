/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Strategic Score Engine - Deterministic Mathematical Priority Scoring (0-100)
 * 
 * Strict Invariants:
 * - NO Math.random()
 * - NO LLM scoring hallucinations
 * - Explicit mathematical factors and explanation
 * - Regression bonus (+15) and Blocker bonus (+15) to prevent bias towards new features
 */

import type { StrategicScoreBreakdown, ScoreFactorBreakdown } from '../types.js';

export interface ScoreInput {
  valueScore: number; // 0-100
  urgencyScore: number; // 0-100
  riskScore: number; // 0-100
  effortPoints: number; // 1 to 8
  confidence: number; // 0.0 to 1.0
  isRegression: boolean;
  isBlocker: boolean;
  severityOrGapScore: number; // 0-100
}

export class StrategicScoreEngine {
  /**
   * Computes deterministic StrategicScoreBreakdown (0 to 100).
   */
  public computeScore(input: ScoreInput): StrategicScoreBreakdown {
    const factors: ScoreFactorBreakdown[] = [];

    // Factor 1: Value Contribution (weight 0.35)
    const valContrib = Math.round(input.valueScore * 0.35);
    factors.push({
      name: 'Valeur Produit & Utilisateur',
      weight: 0.35,
      rawScore: input.valueScore,
      weightedContribution: valContrib,
      explanation: `Apport stratégique évalué à ${input.valueScore}/100.`
    });

    // Factor 2: Urgence Opérationnelle (weight 0.25)
    const urgContrib = Math.round(input.urgencyScore * 0.25);
    factors.push({
      name: 'Urgence Opérationnelle',
      weight: 0.25,
      rawScore: input.urgencyScore,
      weightedContribution: urgContrib,
      explanation: `Niveau d urgence constaté à ${input.urgencyScore}/100.`
    });

    // Factor 3: Gravité du Problème / Lacune (weight 0.20)
    const sevContrib = Math.round(input.severityOrGapScore * 0.20);
    factors.push({
      name: 'Gravité / Ampleur de Lacune',
      weight: 0.20,
      rawScore: input.severityOrGapScore,
      weightedContribution: sevContrib,
      explanation: `Gravité ou criticité de la lacune évaluée à ${input.severityOrGapScore}/100.`
    });

    // Factor 4: Confiance des Preuves (weight 0.10)
    const confScore = Math.round(input.confidence * 100);
    const confContrib = Math.round(confScore * 0.10);
    factors.push({
      name: 'Confiance des Preuves',
      weight: 0.10,
      rawScore: confScore,
      weightedContribution: confContrib,
      explanation: `Confiance basée sur les faits vérifiables: ${confScore}%.`
    });

    // Factor 5: Pénalité de Risque (weight -0.10)
    const riskDeduction = Math.round(input.riskScore * 0.10);
    factors.push({
      name: 'Pénalité de Risque Technique',
      weight: -0.10,
      rawScore: input.riskScore,
      weightedContribution: -riskDeduction,
      explanation: `Risque d instabilité ou blast radius: déduction de ${riskDeduction} pts.`
    });

    // Factor 6: Pénalité d Effort (points 1..8 mapped to 0..20 deduction)
    const effortPenalty = Math.round((input.effortPoints / 8) * 15);
    const effortScore = Math.max(0, 100 - Math.round((input.effortPoints / 8) * 100));
    factors.push({
      name: 'Coût / Effort Estimé',
      weight: -0.05,
      rawScore: effortScore,
      weightedContribution: -effortPenalty,
      explanation: `Effort de ${input.effortPoints} pts: ajustement de -${effortPenalty} pts.`
    });

    // Bonuses for Regressions and Critical Blockers
    let bonusTotal = 0;
    if (input.isRegression) {
      bonusTotal += 15;
      factors.push({
        name: 'Bonus Régression Confirmée',
        weight: 0.15,
        rawScore: 100,
        weightedContribution: 15,
        explanation: 'Bonus automatique de +15 pts: les régressions priment sur les nouvelles fonctionnalités.'
      });
    }

    if (input.isBlocker) {
      bonusTotal += 15;
      factors.push({
        name: 'Bonus Blocage Critique',
        weight: 0.15,
        rawScore: 100,
        weightedContribution: 15,
        explanation: 'Bonus de +15 pts: problème bloquant pour les utilisateurs.'
      });
    }

    const rawTotal = valContrib + urgContrib + sevContrib + confContrib - riskDeduction - effortPenalty + bonusTotal;
    const finalScore = Math.min(100, Math.max(0, rawTotal));

    const mathematicalExplanation = 
      `Score Final = clamp(Valeur(${valContrib}) + Urgence(${urgContrib}) + Gravité(${sevContrib}) + Confiance(${confContrib}) - Risque(${riskDeduction}) - Effort(${effortPenalty}) + Bonus(${bonusTotal}), 0, 100) = ${finalScore}/100`;

    return {
      strategicScore: finalScore,
      valueScore: input.valueScore,
      riskScore: input.riskScore,
      effortScore,
      urgencyScore: input.urgencyScore,
      confidenceScore: confScore,
      factors,
      mathematicalExplanation
    };
  }
}
