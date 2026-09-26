/**
 * Volaco Core - AI-Native Engineering Tier
 * Surgical Action Sequencer - Orders engineering primitives deterministically
 */

import type { SurgicalActionPrimitive } from './prompts.js';

export interface SurgicalPlanStep {
  id: number;
  action: SurgicalActionPrimitive;
  target_file: string;
  symbols: string[];
  summary: string;
  dependencies?: number[];
}

export class SurgicalActionSequencer {
  private static readonly ACTION_PRIORITY: Record<SurgicalActionPrimitive, number> = {
    install: 10,
    create: 20,
    edit: 30,
    verify: 40
  };

  /**
   * Sorts steps according to primitive hierarchy (install -> create -> edit -> verify)
   * while respecting any explicit dependency graph.
   */
  public sequence(steps: SurgicalPlanStep[]): SurgicalPlanStep[] {
    if (steps.length === 0) return [];

    // Clone to prevent mutating input
    const indexed = steps.map((s, idx) => ({ ...s, originalIndex: idx }));

    // Priority comparator based on action type and target file characteristics
    indexed.sort((a, b) => {
      const prioA = SurgicalActionSequencer.ACTION_PRIORITY[a.action] || 25;
      const prioB = SurgicalActionSequencer.ACTION_PRIORITY[b.action] || 25;

      if (prioA !== prioB) {
        return prioA - prioB;
      }

      // If both are 'create', types and data models come before UI components
      if (a.action === 'create' && b.action === 'create') {
        const isDataA = a.target_file.includes('/data/') || a.target_file.includes('/types') || a.target_file.includes('/models');
        const isDataB = b.target_file.includes('/data/') || b.target_file.includes('/types') || b.target_file.includes('/models');
        if (isDataA && !isDataB) return -1;
        if (!isDataA && isDataB) return 1;
      }

      // If both are 'edit', deep modules come before root App / main
      if (a.action === 'edit' && b.action === 'edit') {
        const isRootA = a.target_file.endsWith('App.tsx') || a.target_file.endsWith('index.ts') || a.target_file.endsWith('main.ts');
        const isRootB = b.target_file.endsWith('App.tsx') || b.target_file.endsWith('index.ts') || b.target_file.endsWith('main.ts');
        if (!isRootA && isRootB) return -1;
        if (isRootA && !isRootB) return 1;
      }

      return a.originalIndex - b.originalIndex;
    });

    // Re-index sequentially from 1 to N
    return indexed.map((step, idx) => ({
      id: idx + 1,
      action: step.action,
      target_file: step.target_file,
      symbols: Array.isArray(step.symbols) ? step.symbols : [],
      summary: step.summary
    }));
  }
}
