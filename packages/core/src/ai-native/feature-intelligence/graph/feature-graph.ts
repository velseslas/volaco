/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature Graph - Full Graph Construction & Foundational Feature Analysis
 */

import type { FeatureCandidate, FeatureGraph, FeatureGraphNode } from '../types.js';
import { FeatureDependencyGraph } from './feature-dependency-graph.js';

export class FeatureGraphBuilder {
  private readonly depGraph = new FeatureDependencyGraph();

  public buildGraph(candidates: readonly FeatureCandidate[]): FeatureGraph {
    const edges = this.depGraph.buildEdges(candidates);

    // Identifier les dépendances entrantes pour marquer les briques fondatrices
    const incomingDepCounts = new Map<string, number>();
    const outgoingDepCounts = new Map<string, number>();

    for (const c of candidates) {
      incomingDepCounts.set(c.id, 0);
      outgoingDepCounts.set(c.id, 0);
    }

    for (const e of edges) {
      if (e.kind === 'DEPENDS_ON') {
        const outVal = outgoingDepCounts.get(e.fromFeatureId) ?? 0;
        outgoingDepCounts.set(e.fromFeatureId, outVal + 1);

        const inVal = incomingDepCounts.get(e.toFeatureId) ?? 0;
        incomingDepCounts.set(e.toFeatureId, inVal + 1);
      }
    }

    // Un nœud est fondateur s'il alimente au moins une autre fonctionnalité ou n'a aucune dépendance requise
    const nodes: FeatureGraphNode[] = candidates.map((c) => {
      const isDependedOn = (outgoingDepCounts.get(c.id) ?? 0) > 0;
      const hasNoPrerequisites = (incomingDepCounts.get(c.id) ?? 0) === 0;
      const isFoundational = isDependedOn || hasNoPrerequisites;
      const depth = incomingDepCounts.get(c.id) ?? 0;

      return {
        id: c.id,
        title: c.title,
        category: c.category,
        status: c.status,
        priorityScore: c.scores.priorityScore,
        isFoundational,
        depth
      };
    });

    const { order: topologicalOrder, hasCycles } = this.depGraph.topologicalSort(nodes, edges);

    const foundationalFeatureIds = nodes
      .filter((n) => n.isFoundational && (outgoingDepCounts.get(n.id) ?? 0) > 0)
      .map((n) => n.id);

    return {
      nodes,
      edges,
      foundationalFeatureIds,
      topologicalOrder,
      hasCycles
    };
  }
}
