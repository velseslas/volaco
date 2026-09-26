/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Roadmap Graph - Multi-horizon swimlane graph representation
 */

import type { StrategicRoadmap, RoadmapHorizon } from '../types.js';

export interface HorizonLane {
  horizon: RoadmapHorizon;
  items: Array<{ id: string; title: string; score: number; sequence: number }>;
}

export interface RoadmapGraphStructure {
  lanes: HorizonLane[];
  crossHorizonEdges: Array<{ fromId: string; fromHorizon: RoadmapHorizon; toId: string; toHorizon: RoadmapHorizon }>;
}

export class RoadmapGraph {
  /**
   * Generates a multi-horizon swimlane representation from a StrategicRoadmap.
   */
  public generateSwimlanes(roadmap: StrategicRoadmap): RoadmapGraphStructure {
    const horizonOrder: RoadmapHorizon[] = ['NOW', 'NEXT', 'LATER', 'DEFERRED'];
    const itemHorizonMap = new Map<string, RoadmapHorizon>();

    const lanes: HorizonLane[] = [
      {
        horizon: 'NOW',
        items: roadmap.horizons.now.map(a => {
          itemHorizonMap.set(a.recommendationId, 'NOW');
          return { id: a.recommendationId, title: a.title, score: a.strategicScore, sequence: a.sequenceOrder };
        })
      },
      {
        horizon: 'NEXT',
        items: roadmap.horizons.next.map(a => {
          itemHorizonMap.set(a.recommendationId, 'NEXT');
          return { id: a.recommendationId, title: a.title, score: a.strategicScore, sequence: a.sequenceOrder };
        })
      },
      {
        horizon: 'LATER',
        items: roadmap.horizons.later.map(a => {
          itemHorizonMap.set(a.recommendationId, 'LATER');
          return { id: a.recommendationId, title: a.title, score: a.strategicScore, sequence: a.sequenceOrder };
        })
      },
      {
        horizon: 'DEFERRED',
        items: roadmap.horizons.deferred.map(a => {
          itemHorizonMap.set(a.recommendationId, 'DEFERRED');
          return { id: a.recommendationId, title: a.title, score: a.strategicScore, sequence: a.sequenceOrder };
        })
      }
    ];

    const crossHorizonEdges: Array<{ fromId: string; fromHorizon: RoadmapHorizon; toId: string; toHorizon: RoadmapHorizon }> = [];

    const allActions = [
      ...roadmap.horizons.now,
      ...roadmap.horizons.next,
      ...roadmap.horizons.later,
      ...roadmap.horizons.deferred
    ];

    for (const act of allActions) {
      const toHorizon = act.horizon;
      for (const depId of act.dependencies) {
        const fromHorizon = itemHorizonMap.get(depId);
        if (fromHorizon) {
          crossHorizonEdges.push({
            fromId: depId,
            fromHorizon,
            toId: act.recommendationId,
            toHorizon
          });
        }
      }
    }

    return { lanes, crossHorizonEdges };
  }
}
