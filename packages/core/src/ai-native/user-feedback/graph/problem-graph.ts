/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Problem Graph: Dependency, Root-Cause and Conflict Graph for Problems
 */

import type { AggregatedProblem, ProblemGraph, ProblemGraphEdge, ProblemGraphNode } from '../types.js';

export class ProblemGraphBuilder {
  public buildGraph(problems: readonly AggregatedProblem[]): ProblemGraph {
    const nodes: ProblemGraphNode[] = problems.map(p => ({
      id: p.id,
      title: p.title,
      category: p.category,
      severity: p.severity,
      status: p.status,
      priorityScore: p.scores.priorityScore,
      isRootProblem: true
    }));

    const edges: ProblemGraphEdge[] = [];
    const childIds = new Set<string>();

    for (let i = 0; i < problems.length; i++) {
      for (let j = 0; j < problems.length; j++) {
        if (i === j) continue;
        const a = problems[i];
        const b = problems[j];
        if (!a || !b) continue;

        const commonFile = a.impact.affectedFiles.some(f => b.impact.affectedFiles.includes(f));
        const commonFeature = a.impact.affectedFeatures.some(f => b.impact.affectedFeatures.includes(f));

        if (a.severity === 'CRITICAL' && b.severity !== 'CRITICAL' && (commonFile || commonFeature)) {
          edges.push({
            fromProblemId: a.id,
            toProblemId: b.id,
            kind: 'BLOCKS',
            reason: `L'anomalie critique ${a.id} bloque ou impacte la résolution de ${b.id}`
          });
          childIds.add(b.id);
        } else if (commonFile || commonFeature) {
          if (a.scores.priorityScore > b.scores.priorityScore && !edges.some(e => (e.fromProblemId === b.id && e.toProblemId === a.id))) {
            edges.push({
              fromProblemId: a.id,
              toProblemId: b.id,
              kind: 'RELATES_TO',
              reason: `Même composant ou fichier affecté (${commonFeature ? 'composant' : 'fichier'})`
            });
          }
        }
      }
    }

    const rootProblemIds = problems
      .filter(p => !childIds.has(p.id))
      .map(p => p.id);

    const finalNodes = nodes.map(n => ({
      ...n,
      isRootProblem: rootProblemIds.includes(n.id)
    }));

    const inDegree = new Map<string, number>();
    for (const p of problems) inDegree.set(p.id, 0);
    for (const edge of edges) {
      inDegree.set(edge.toProblemId, (inDegree.get(edge.toProblemId) || 0) + 1);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }
    queue.sort();

    const topologicalOrder: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      topologicalOrder.push(current);

      for (const edge of edges.filter(e => e.fromProblemId === current)) {
        const next = edge.toProblemId;
        const newDeg = (inDegree.get(next) || 1) - 1;
        inDegree.set(next, newDeg);
        if (newDeg === 0) {
          queue.push(next);
          queue.sort();
        }
      }
    }

    const hasCycles = topologicalOrder.length < problems.length;

    return {
      nodes: finalNodes,
      edges,
      rootProblemIds,
      topologicalOrder: hasCycles ? problems.map(p => p.id) : topologicalOrder,
      hasCycles
    };
  }
}
