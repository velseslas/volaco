/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Strategy Graph - Directed graph representation of recommendations and dependencies
 */

import type { StrategicRecommendation } from '../types.js';

export interface StrategyGraphNode {
  id: string;
  type: StrategicRecommendation['type'];
  title: string;
  score: number;
  horizon: StrategicRecommendation['recommendedHorizon'];
}

export interface StrategyGraphEdge {
  from: string; // Prerequisite
  to: string;   // Dependent
  relation: 'REQUIRES' | 'BLOCKS' | 'MITIGATES';
}

export interface StrategyGraphExport {
  nodes: StrategyGraphNode[];
  edges: StrategyGraphEdge[];
  criticalPath: string[];
}

export class StrategyGraph {
  /**
   * Builds an exportable directed graph from recommendations.
   */
  public buildGraph(recommendations: StrategicRecommendation[]): StrategyGraphExport {
    const nodes: StrategyGraphNode[] = recommendations.map(r => ({
      id: r.id,
      type: r.type,
      title: r.title,
      score: r.strategicScore,
      horizon: r.recommendedHorizon
    }));

    const edges: StrategyGraphEdge[] = [];
    const idSet = new Set(recommendations.map(r => r.id));

    for (const r of recommendations) {
      for (const depId of r.dependencies) {
        if (idSet.has(depId)) {
          edges.push({
            from: depId,
            to: r.id,
            relation: 'REQUIRES'
          });
        }
      }
    }

    // Critical Path: chain of highest-score dependent recommendations
    const criticalPath: string[] = [];
    const rootNodes = recommendations.filter(r => r.dependencies.length === 0);
    if (rootNodes.length > 0) {
      rootNodes.sort((a, b) => b.strategicScore - a.strategicScore);
      let curr: StrategicRecommendation | undefined = rootNodes[0];
      if (curr) {
        criticalPath.push(curr.id);

        while (curr) {
          const currentId: string = curr.id;
          const children = recommendations.filter(r => r.dependencies.includes(currentId));
          if (children.length === 0) break;
          children.sort((a, b) => b.strategicScore - a.strategicScore);
          curr = children[0];
          if (curr) {
            criticalPath.push(curr.id);
          }
        }
      }
    }

    return { nodes, edges, criticalPath };
  }
}
