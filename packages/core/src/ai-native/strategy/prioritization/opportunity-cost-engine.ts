/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Opportunity Cost Engine - Evaluates forgone value and trade-offs of competing actions
 */

import type { StrategicRecommendation } from '../types.js';

export interface OpportunityCostEvaluation {
  selectedIds: string[];
  forgoneRecommendations: Array<{
    id: string;
    title: string;
    score: number;
    strategicScore: number;
    valueScore: number;
  }>;
  totalForgoneValue: number;
  opportunityCostRatio: number; // forgoneValue / selectedValue
  rationale: string;
}

export class OpportunityCostEngine {
  /**
   * Evaluates the opportunity cost of picking a subset of recommendations against all available.
   */
  public evaluate(
    selectedIds: string[],
    allRecommendations: StrategicRecommendation[]
  ): OpportunityCostEvaluation {
    const selectedSet = new Set(selectedIds);
    const selected = allRecommendations.filter(r => selectedSet.has(r.id));
    const forgone = allRecommendations.filter(r => !selectedSet.has(r.id));

    const selectedValue = selected.reduce((sum, r) => sum + r.strategicScore, 0);
    const forgoneRanked = forgone
      .sort((a, b) => b.strategicScore - a.strategicScore)
      .slice(0, 5)
      .map(r => ({
        id: r.id,
        title: r.title,
        score: r.strategicScore,
        strategicScore: r.strategicScore,
        valueScore: r.valueScore
      }));

    const totalForgoneValue = forgoneRanked.reduce((sum, r) => sum + r.strategicScore, 0);
    const ratio = selectedValue > 0 ? Number((totalForgoneValue / selectedValue).toFixed(2)) : 0;

    let rationale = 'Sélection optimale: peu de valeur stratégique concurrente différée.';
    const topForgone = forgoneRanked[0];
    if (topForgone && topForgone.strategicScore >= 80) {
      rationale = `Attention: l action ${topForgone.title} (score ${topForgone.strategicScore}) est différée au profit de cette sélection.`;
    }

    return {
      selectedIds,
      forgoneRecommendations: forgoneRanked,
      totalForgoneValue,
      opportunityCostRatio: ratio,
      rationale
    };
  }
}
