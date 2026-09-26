/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Milestone Planner - Synthesizes actionable milestones from the roadmap
 */

import type { StrategicRoadmap, StrategicRecommendation } from '../types.js';

export interface StrategicMilestone {
  id: string;
  title: string;
  description: string;
  targetHorizon: 'NOW' | 'NEXT' | 'LATER';
  actionIds: string[];
  totalEffortPoints: number;
  expectedValueScore: number;
}

export class MilestonePlanner {
  /**
   * Groups roadmap items into deliverable engineering milestones.
   */
  public planMilestones(
    roadmap: StrategicRoadmap,
    recommendations: StrategicRecommendation[]
  ): StrategicMilestone[] {
    const recMap = new Map(recommendations.map(r => [r.id, r]));
    const milestones: StrategicMilestone[] = [];

    // Milestone 1: NOW
    if (roadmap.horizons.now.length > 0) {
      const nowActions = roadmap.horizons.now;
      const totalPoints = nowActions.reduce((sum, a) => sum + (recMap.get(a.recommendationId)?.effort.points || 2), 0);
      const avgValue = Math.round(
        nowActions.reduce((sum, a) => sum + a.strategicScore, 0) / nowActions.length
      );

      milestones.push({
        id: `ms-1-immediate-stability`,
        title: 'Jalon 1 : Stabilisation Immédiate & Priorités Critiques',
        description: 'Correction des régressions, bugs bloquants et risques immédiats.',
        targetHorizon: 'NOW',
        actionIds: nowActions.map(a => a.recommendationId),
        totalEffortPoints: totalPoints,
        expectedValueScore: avgValue
      });
    }

    // Milestone 2: NEXT
    if (roadmap.horizons.next.length > 0) {
      const nextActions = roadmap.horizons.next;
      const totalPoints = nextActions.reduce((sum, a) => sum + (recMap.get(a.recommendationId)?.effort.points || 2), 0);
      const avgValue = Math.round(
        nextActions.reduce((sum, a) => sum + a.strategicScore, 0) / nextActions.length
      );

      milestones.push({
        id: `ms-2-feature-expansion`,
        title: 'Jalon 2 : Évolution Produit & Nouvelles Capacités',
        description: 'Implémentation des opportunités à forte valeur et extensions UX.',
        targetHorizon: 'NEXT',
        actionIds: nextActions.map(a => a.recommendationId),
        totalEffortPoints: totalPoints,
        expectedValueScore: avgValue
      });
    }

    // Milestone 3: LATER
    if (roadmap.horizons.later.length > 0) {
      const laterActions = roadmap.horizons.later;
      const totalPoints = laterActions.reduce((sum, a) => sum + (recMap.get(a.recommendationId)?.effort.points || 2), 0);
      const avgValue = Math.round(
        laterActions.reduce((sum, a) => sum + a.strategicScore, 0) / laterActions.length
      );

      milestones.push({
        id: `ms-3-consolidation`,
        title: 'Jalon 3 : Consolidation Architecturale & Dette',
        description: 'Optimisation de performance, refactoring et harmonie visuelle.',
        targetHorizon: 'LATER',
        actionIds: laterActions.map(a => a.recommendationId),
        totalEffortPoints: totalPoints,
        expectedValueScore: avgValue
      });
    }

    return milestones;
  }
}
