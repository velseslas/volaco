/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-002)
 * Graph Metrics Extractor (Topological Sort, Formal Cycle Detection, Centrality)
 */

import type { ProjectAnalysisSummary } from '../../understanding/types.js';
import type { GraphMetrics } from '../types.js';
import { canonicalSort } from './base.js';

/**
 * Resolves a module import specifier relative to the importing file.
 * Handles TypeScript/ESM conventions:
 * - relative paths (./ and ../)
 * - extension mapping (.js -> .ts / .tsx / .js / .jsx)
 * - directory index resolution (/index.ts, /index.js)
 */
export function resolveImportTarget(
  importingFile: string,
  specifier: string,
  projectFiles: Set<string>
): string | null {
  // If exact match already exists in project files
  if (projectFiles.has(specifier) && specifier !== importingFile) {
    return specifier;
  }

  // Handle relative imports
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    // Non-relative imports (packages or path aliases)
    return null;
  }

  const fromParts = importingFile.split('/');
  fromParts.pop(); // discard file name, keep directory parts

  const specParts = specifier.split('/');
  for (const part of specParts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      fromParts.pop();
    } else {
      fromParts.push(part);
    }
  }

  const resolvedPath = fromParts.join('/');

  // Direct match
  if (projectFiles.has(resolvedPath) && resolvedPath !== importingFile) {
    return resolvedPath;
  }

  // Strip extension
  const withoutExt = resolvedPath.replace(/\.[^/.]+$/, '');

  const candidates = [
    `${withoutExt}.ts`,
    `${withoutExt}.tsx`,
    `${withoutExt}.js`,
    `${withoutExt}.jsx`,
    `${withoutExt}.d.ts`,
    `${withoutExt}/index.ts`,
    `${withoutExt}/index.tsx`,
    `${withoutExt}/index.js`,
    `${withoutExt}/index.jsx`,
    `${resolvedPath}/index.ts`,
    `${resolvedPath}/index.js`
  ];

  for (const cand of candidates) {
    if (projectFiles.has(cand) && cand !== importingFile) {
      return cand;
    }
  }

  return null;
}

export class GraphMetricsExtractor {
  public extract(summary: ProjectAnalysisSummary): GraphMetrics {
    const fileAnalyses = summary.fileAnalyses;
    const allPaths = Object.keys(fileAnalyses).sort();
    const nodeCount = allPaths.length;
    const pathSet = new Set(allPaths);

    // 1. Build directDependencies map with resolved project file targets
    const directDependencies: Record<string, string[]> = {};
    const reverseDependencies: Record<string, string[]> = {};

    for (const p of allPaths) {
      directDependencies[p] = [];
      reverseDependencies[p] = [];
    }

    let edgeCount = 0;
    for (const p of allPaths) {
      const rawDeps = summary.dependencyGraph[p] ?? [];
      const validDeps = new Set<string>();

      for (const rawDep of rawDeps) {
        const resolved = resolveImportTarget(p, rawDep, pathSet);
        if (resolved && resolved !== p) {
          validDeps.add(resolved);
        }
      }

      const sortedDeps = Array.from(validDeps).sort();
      directDependencies[p] = sortedDeps;
      edgeCount += sortedDeps.length;

      for (const dep of sortedDeps) {
        reverseDependencies[dep]!.push(p);
      }
    }

    for (const p of allPaths) {
      reverseDependencies[p]!.sort();
    }

    // 2. Identify isolated files (0 direct & 0 reverse)
    const isolatedFiles = allPaths.filter(
      p => directDependencies[p]!.length === 0 && reverseDependencies[p]!.length === 0
    );

    // 3. Most depended on files (centrality)
    const mostDependedList = allPaths.map(p => ({
      path: p,
      dependentsCount: reverseDependencies[p]!.length
    }));

    mostDependedList.sort((a, b) => {
      if (b.dependentsCount !== a.dependentsCount) {
        return b.dependentsCount - a.dependentsCount;
      }
      return a.path.localeCompare(b.path);
    });

    // 4. Formal Cycle Detection (Iterative Tarjan's Strongly Connected Components)
    const circularDependencies = this.detectCycles(allPaths, directDependencies);

    // 5. Deterministic Topological Order (Kahn's Algorithm with lexicographical priority)
    const topologicalOrder = this.computeTopologicalOrder(allPaths, directDependencies, reverseDependencies);

    return {
      nodeCount,
      edgeCount,
      directDependencies,
      reverseDependencies,
      topologicalOrder,
      circularDependencies,
      isolatedFiles,
      mostDependedOnFiles: mostDependedList
    };
  }

  /**
   * Detects simple directed cycles deterministically using iterative DFS cycle tracking.
   */
  private detectCycles(nodes: string[], adj: Record<string, string[]>): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack: string[] = [];
    const inStack = new Set<string>();
    const seenCycleSignatures = new Set<string>();

    const dfs = (startNode: string) => {
      interface Frame {
        node: string;
        neighborIndex: number;
      }

      const stack: Frame[] = [{ node: startNode, neighborIndex: 0 }];
      visited.add(startNode);
      recursionStack.push(startNode);
      inStack.add(startNode);

      while (stack.length > 0) {
        const top = stack[stack.length - 1]!;
        const neighbors = adj[top.node] ?? [];

        if (top.neighborIndex < neighbors.length) {
          const next = neighbors[top.neighborIndex]!;
          top.neighborIndex++;

          if (inStack.has(next)) {
            // Cycle detected!
            const cycleStartIndex = recursionStack.indexOf(next);
            if (cycleStartIndex !== -1) {
              const rawCycle = recursionStack.slice(cycleStartIndex);
              const normalized = this.normalizeCycle(rawCycle);
              const sig = normalized.join(' -> ');
              if (!seenCycleSignatures.has(sig)) {
                seenCycleSignatures.add(sig);
                cycles.push(normalized);
              }
            }
          } else if (!visited.has(next)) {
            visited.add(next);
            recursionStack.push(next);
            inStack.add(next);
            stack.push({ node: next, neighborIndex: 0 });
          }
        } else {
          stack.pop();
          recursionStack.pop();
          inStack.delete(top.node);
        }
      }
    };

    for (const node of nodes) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return canonicalSort(cycles, c => c.join('->'));
  }

  private normalizeCycle(cycle: string[]): string[] {
    if (cycle.length <= 1) return cycle;
    let minIdx = 0;
    for (let i = 1; i < cycle.length; i++) {
      if (cycle[i]!.localeCompare(cycle[minIdx]!) < 0) {
        minIdx = i;
      }
    }
    return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
  }

  /**
   * Kahn's algorithm for deterministic topological order (dependencies first).
   */
  private computeTopologicalOrder(
    nodes: string[],
    directAdj: Record<string, string[]>,
    reverseAdj: Record<string, string[]>
  ): string[] {
    // In-degree: how many directDependencies this node has
    const inDegree = new Map<string, number>();
    for (const n of nodes) {
      inDegree.set(n, (directAdj[n] ?? []).length);
    }

    const readyQueue: string[] = nodes.filter(n => inDegree.get(n) === 0).sort();
    const result: string[] = [];
    const processed = new Set<string>();

    while (readyQueue.length > 0) {
      const current = readyQueue.shift()!;
      result.push(current);
      processed.add(current);

      const dependents = reverseAdj[current] ?? [];
      const newReady: string[] = [];

      for (const dep of dependents) {
        const curDeg = inDegree.get(dep) ?? 0;
        if (curDeg > 0) {
          const nextDeg = curDeg - 1;
          inDegree.set(dep, nextDeg);
          if (nextDeg === 0 && !processed.has(dep) && !readyQueue.includes(dep)) {
            newReady.push(dep);
          }
        }
      }

      if (newReady.length > 0) {
        readyQueue.push(...newReady);
        readyQueue.sort();
      }
    }

    const remaining = nodes.filter(n => !processed.has(n)).sort();
    result.push(...remaining);

    return result;
  }
}
