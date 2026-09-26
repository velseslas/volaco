/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Dependency Planner - Validates and enforces prerequisite integrity
 */

import type { StrategicRecommendation } from '../types.js';

export interface DependencyValidationResult {
  isValid: boolean;
  cyclesDetected: string[][];
  missingDependencies: Array<{ recommendationId: string; missingDependencyId: string }>;
}

export class DependencyPlanner {
  /**
   * Validates dependency integrity across a set of recommendations.
   */
  public validate(recommendations: StrategicRecommendation[]): DependencyValidationResult {
    const idSet = new Set(recommendations.map(r => r.id));
    const missing: Array<{ recommendationId: string; missingDependencyId: string }> = [];

    const graph = new Map<string, string[]>();

    for (const rec of recommendations) {
      const validDeps: string[] = [];
      for (const depId of rec.dependencies) {
        if (!idSet.has(depId)) {
          missing.push({ recommendationId: rec.id, missingDependencyId: depId });
        } else {
          validDeps.push(depId);
        }
      }
      graph.set(rec.id, validDeps);
    }

    // Cycle detection
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recStack: string[] = [];

    const findCycles = (node: string) => {
      visited.add(node);
      recStack.push(node);

      const neighbors = graph.get(node) || [];
      for (const next of neighbors) {
        if (!visited.has(next)) {
          findCycles(next);
        } else {
          const cycleStart = recStack.indexOf(next);
          if (cycleStart !== -1) {
            cycles.push(recStack.slice(cycleStart));
          }
        }
      }

      recStack.pop();
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        findCycles(node);
      }
    }

    return {
      isValid: missing.length === 0 && cycles.length === 0,
      cyclesDetected: cycles,
      missingDependencies: missing
    };
  }
}
