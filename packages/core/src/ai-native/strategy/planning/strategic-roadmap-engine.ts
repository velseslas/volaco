/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Strategic Roadmap Engine - Groups prioritized actions into sequenced horizons (NOW / NEXT / LATER / DEFERRED)
 */

import { computeRoadmapHash } from '../canonical.js';
import type {
  StrategicRoadmap,
  StrategicRecommendation,
  StrategicActionItem,
  RoadmapHorizon
} from '../types.js';
import { ActionSequencer } from './action-sequencer.js';

export class StrategicRoadmapEngine {
  private readonly sequencer = new ActionSequencer();

  /**
   * Generates a fully sequenced multi-horizon strategic roadmap.
   */
  public generateRoadmap(
    tenantId: string,
    projectId: string,
    recommendations: StrategicRecommendation[]
  ): StrategicRoadmap {
    // 1. Order actions topologically
    const sequenced = this.sequencer.sequence(recommendations);

    const nowItems: StrategicActionItem[] = [];
    const nextItems: StrategicActionItem[] = [];
    const laterItems: StrategicActionItem[] = [];
    const deferredItems: StrategicActionItem[] = [];

    const nowIds = new Set<string>();

    for (const rec of sequenced) {
      let horizon: RoadmapHorizon = 'LATER';

      // Check if item has unfulfilled dependencies not in NOW
      const hasUnfulfilledDeps = rec.dependencies.length > 0 && !rec.dependencies.every(d => nowIds.has(d));

      const firstDep = rec.dependencies[0];
      const hasFirstDepInNow = Boolean(firstDep && nowIds.has(firstDep));

      if (rec.status === 'REJECTED' || rec.strategicScore < 35) {
        horizon = 'DEFERRED';
      } else if ((rec.strategicScore >= 75 || rec.type === 'FIX_REGRESSION' || rec.type === 'FIX_CRITICAL_PROBLEM') && !hasUnfulfilledDeps) {
        horizon = 'NOW';
        nowIds.add(rec.id);
      } else if (rec.strategicScore >= 50 || (hasUnfulfilledDeps && hasFirstDepInNow)) {
        horizon = 'NEXT';
      } else {
        horizon = 'LATER';
      }

      rec.recommendedHorizon = horizon;

      const actionItem: StrategicActionItem = {
        recommendationId: rec.id,
        type: rec.type,
        title: rec.title,
        strategicScore: rec.strategicScore,
        horizon,
        sequenceOrder: rec.recommendedSequence,
        dependencies: rec.dependencies,
        effortLevel: rec.effort.level,
        riskSeverity: rec.risk.severity
      };

      if (horizon === 'NOW') nowItems.push(actionItem);
      else if (horizon === 'NEXT') nextItems.push(actionItem);
      else if (horizon === 'LATER') laterItems.push(actionItem);
      else deferredItems.push(actionItem);
    }

    const topologicalOrder = sequenced.map(s => s.id);
    const roadmapId = `rdm-${projectId}-${Date.now()}`;
    const roadmapHash = computeRoadmapHash({ tenantId, projectId, topologicalOrder });

    const totalEffortPoints = sequenced.reduce((acc, r) => acc + r.effort.points, 0);

    return {
      id: roadmapId,
      tenantId,
      projectId,
      horizons: {
        now: nowItems,
        next: nextItems,
        later: laterItems,
        deferred: deferredItems
      },
      topologicalOrder,
      totalActionsCount: sequenced.length,
      estimatedTotalEffortPoints: totalEffortPoints,
      generatedAt: new Date().toISOString(),
      roadmapHash
    };
  }
}
