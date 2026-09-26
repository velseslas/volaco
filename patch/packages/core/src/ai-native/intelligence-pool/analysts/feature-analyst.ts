/**
 * VibeCode Core - Intelligence Pool
 * FeatureAnalyst — refactor du package `feature-intelligence` en analyst consultatif.
 *
 * Détecte les opportunités de features basées sur :
 *  - Écarts entre fichiers (TODO/FIXME, comments indicate missing features)
 *  - Patterns récurrents (un composant existe, mais manque une variante)
 *  - Feedback utilisateurs
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../../../logger.js';
import type { PriorityScorerInput } from '../priority-scorer.js';
import { PriorityScorer, createScorer } from '../priority-scorer.js';
import type { IntelligenceAnalyst, IntelligenceRecommendation, AnalystContext, Evidence } from '../types.js';

const SCORER: PriorityScorer = createScorer({
  userValue: 0.45,
  strategicAlignment: 0.20,
  evidenceConfidence: 0.10,
  expectedValue: 0.15,
  urgency: 0.05,
  riskReduction: 0.05
});

const TODO_PATTERN = /(?:TODO|FIXME|HACK|XXX|BUG)[:\s]+([^\n]+)/g;
const MISSING_FEATURE_PATTERN = /(?:missing|incomplete|stub|placeholder|not\s+implemented)[:\s]+([^\n]+)/gi;

export class FeatureAnalyst implements IntelligenceAnalyst {
  readonly id = 'feature' as const;
  readonly displayName = 'Feature Analyst';

  async analyze(context: AnalystContext): Promise<readonly IntelligenceRecommendation[]> {
    logger.debug('FeatureAnalyst.analyze', { projectId: context.projectId, fileCount: context.files.length });
    const recs: IntelligenceRecommendation[] = [];

    // 1. Détection TODO/FIXME
    for (const file of context.files) {
      const todos: Array<{ kind: string; text: string }> = [];
      let m: RegExpExecArray | null;
      const todoRe = new RegExp(TODO_PATTERN);
      while ((m = todoRe.exec(file.content)) !== null) {
        if (m[1]) todos.push({ kind: 'TODO', text: m[1].trim() });
      }
      const missingRe = new RegExp(MISSING_FEATURE_PATTERN);
      while ((m = missingRe.exec(file.content)) !== null) {
        if (m[1]) todos.push({ kind: 'MISSING', text: m[1].trim() });
      }
      if (todos.length === 0) continue;

      const evidence: Evidence[] = todos.slice(0, 5).map((t, i) => ({
        id: randomUUID().slice(0, 8),
        source: file.path,
        description: `${t.kind}: ${t.text}`,
        type: 'FACT',
        confidence: 0.85,
        authorityWeight: 0.8
      }));

      const breakdown = SCORER.score({
        userValue: 75,
        strategicAlignment: 50,
        evidence,
        expectedValue: 65,
        urgency: todos.length > 5 ? 65 : 40,
        riskReduction: 30
      });

      recs.push({
        id: 'rec-feature-todo-' + randomUUID().slice(0, 8),
        source: this.id,
        title: `Implement ${todos.length} TODO/missing items in ${file.path}`,
        description: `${todos.length} unfinished feature(s) detected. Top: "${todos[0]?.text.slice(0, 100) ?? 'n/a'}"`,
        score: breakdown.total,
        scoreBreakdown: breakdown,
        evidence,
        targetFiles: [file.path],
        proposedActions: ['CREATE', 'MODIFY'],
        reversible: true,
        riskScore: 25,
        estimatedEffort: todos.length > 5 ? 'HIGH' : 'MEDIUM',
        metadata: { items: todos }
      });
    }

    // 2. Détection de features manquantes par inférence (un composant a variantes manquantes)
    const componentNames = new Set<string>();
    for (const file of context.files) {
      const compMatches = file.content.match(/(?:function|const|export\s+default)\s+([A-Z]\w+)/g) || [];
      for (const compMatch of compMatches) {
        const name = compMatch.replace(/(?:function|const|export\s+default)\s+/, '').trim();
        if (name) componentNames.add(name);
      }
    }
    // Heuristique : si on a "Button" mais pas "SubmitButton", proposer
    for (const baseName of componentNames) {
      const variant = `Submit${baseName}`;
      if (componentNames.has(variant)) continue;
      if (baseName.length < 3 || baseName.length > 30) continue;
      // Limit to top 5 to avoid noise
      if (recs.filter((r) => r.source === this.id).length >= 10) break;

      const evidence: Evidence[] = [
        {
          id: randomUUID().slice(0, 8),
          source: 'component-inference',
          description: `Component "${baseName}" exists; variant "${variant}" is missing`,
          type: 'HYPOTHESIS',
          confidence: 0.5,
          authorityWeight: 0.5
        }
      ];
      const breakdown = SCORER.score({
        userValue: 40,
        strategicAlignment: 30,
        evidence,
        expectedValue: 40,
        urgency: 20,
        riskReduction: 20
      });
      recs.push({
        id: 'rec-feature-variant-' + randomUUID().slice(0, 8),
        source: this.id,
        title: `Add component variant: ${variant}`,
        description: `Component "${baseName}" exists but no "${variant}" variant detected. Consider adding for consistency.`,
        score: breakdown.total,
        scoreBreakdown: breakdown,
        evidence,
        targetFiles: [],
        proposedActions: ['CREATE'],
        reversible: true,
        riskScore: 15,
        estimatedEffort: 'LOW',
        metadata: { baseName, variant }
      });
    }

    return Object.freeze(recs);
  }
}
