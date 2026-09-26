/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Action Sequencer - Topological ordering respecting prerequisite dependencies
 */

import type { StrategicRecommendation } from '../types.js';

export class ActionSequencer {
  /**
   * Performs Kahn's topological sort on recommendations, with priority-score tie-breaking.
   */
  public sequence(recommendations: StrategicRecommendation[]): StrategicRecommendation[] {
    if (recommendations.length === 0) return [];

    const idMap = new Map(recommendations.map(r => [r.id, r]));
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const r of recommendations) {
      inDegree.set(r.id, 0);
      adj.set(r.id, []);
    }

    for (const r of recommendations) {
      for (const depId of r.dependencies) {
        if (idMap.has(depId)) {
          adj.get(depId)!.push(r.id);
          inDegree.set(r.id, (inDegree.get(r.id) || 0) + 1);
        }
      }
    }

    // Queue of nodes with 0 in-degree, sorted by strategic score descending
    const queue: StrategicRecommendation[] = recommendations
      .filter(r => (inDegree.get(r.id) || 0) === 0)
      .sort((a, b) => b.strategicScore - a.strategicScore);

    const result: StrategicRecommendation[] = [];

    while (queue.length > 0) {
      // Pick highest score among currently unblocked actions
      queue.sort((a, b) => b.strategicScore - a.strategicScore);
      const current = queue.shift()!;
      result.push(current);

      const neighbors = adj.get(current.id) || [];
      for (const nextId of neighbors) {
        const currentDeg = (inDegree.get(nextId) || 1) - 1;
        inDegree.set(nextId, currentDeg);
        if (currentDeg === 0) {
          const nextRec = idMap.get(nextId);
          if (nextRec) queue.push(nextRec);
        }
      }
    }

    // If there were cycles, append remaining unvisited nodes ordered by score
    if (result.length < recommendations.length) {
      const visited = new Set(result.map(r => r.id));
      const remaining = recommendations
        .filter(r => !visited.has(r.id))
        .sort((a, b) => b.strategicScore - a.strategicScore);
      result.push(...remaining);
    }

    // Re-index sequence numbers
    return result.map((r, idx) => ({
      ...r,
      recommendedSequence: idx + 1
    }));
  }
}
