/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Strategy Dependency Analyzer - Analyzes prerequisite relationships and topological dependencies
 */

import type { RecommendationType } from '../types.js';

export interface CandidateDependencyRef {
  id: string;
  type: RecommendationType;
  title: string;
  supportingFindings?: string[];
  supportingProblems?: string[];
  supportingOpportunities?: string[];
}

export class StrategyDependencyAnalyzer {
  /**
   * Infers logical dependencies between candidate recommendations:
   * 1. Critical problems & regressions precede new features in the same domain.
   * 2. Security fixes precede feature extensions.
   * 3. Architectural fixes precede refactors.
   */
  public inferDependencies(candidates: CandidateDependencyRef[]): Map<string, string[]> {
    const dependencyMap = new Map<string, string[]>();

    // Index candidates by type
    const criticalProblems = candidates.filter(
      c => c.type === 'FIX_CRITICAL_PROBLEM' || c.type === 'FIX_REGRESSION' || c.type === 'FIX_SECURITY_RISK'
    );
    const archFixes = candidates.filter(c => c.type === 'FIX_ARCHITECTURAL_RISK');

    for (const cand of candidates) {
      const deps: string[] = [];

      // If this is a feature, check if there are blocking problems that must come first
      if (cand.type === 'BUILD_FEATURE' || cand.type === 'EXTEND_FEATURE') {
        // If there are critical regressions, the top critical regression becomes a soft dependency
        if (criticalProblems.length > 0) {
          const blocker = criticalProblems[0];
          if (blocker && blocker.id !== cand.id) {
            deps.push(blocker.id);
          }
        }
      }

      // If this is a refactor, architectural fixes must come first
      if (cand.type === 'REFACTOR') {
        for (const arch of archFixes) {
          if (arch.id !== cand.id && !deps.includes(arch.id)) {
            deps.push(arch.id);
          }
        }
      }

      dependencyMap.set(cand.id, deps);
    }

    return dependencyMap;
  }

  /**
   * Detects circular dependencies and returns whether the graph is acyclic.
   */
  public isAcyclic(dependencyMap: Map<string, string[]>): boolean {
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      inStack.add(nodeId);

      const neighbors = dependencyMap.get(nodeId) || [];
      for (const next of neighbors) {
        if (!visited.has(next)) {
          if (dfs(next)) return true; // cycle found
        } else if (inStack.has(next)) {
          return true; // cycle found
        }
      }

      inStack.delete(nodeId);
      return false;
    };

    for (const nodeId of dependencyMap.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) return false; // has cycle
      }
    }

    return true;
  }
}
