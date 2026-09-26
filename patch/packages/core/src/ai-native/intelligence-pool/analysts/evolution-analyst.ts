/**
 * VibeCode Core - Intelligence Pool
 * EvolutionAnalyst — refactor du package `evolution` en analyst consultatif.
 *
 * Détecte les propositions d'évolution : migrations, refontes,
 * opportunités d'amélioration à long terme.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../../../logger.js';
import type { PriorityScorerInput } from '../priority-scorer.js';
import { PriorityScorer, createScorer } from '../priority-scorer.js';
import type { IntelligenceAnalyst, IntelligenceRecommendation, AnalystContext, Evidence } from '../types.js';

const SCORER: PriorityScorer = createScorer({
  userValue: 0.25,
  strategicAlignment: 0.25,
  evidenceConfidence: 0.20,
  expectedValue: 0.20,
  urgency: 0.05,
  riskReduction: 0.05
});

const LEGACY_PATTERNS: Array<{ pattern: RegExp; label: string; migration: string; risk: number }> = [
  { pattern: /require\(['"][^'"]+['"]\)/g, label: 'CommonJS require()', migration: 'ESM import', risk: 60 },
  { pattern: /var\s+\w+/g, label: 'var declarations', migration: 'let/const', risk: 30 },
  { pattern: /function\s+\w+\s*\([^)]*\)\s*:\s*\w+/g, label: 'Old function syntax', migration: 'arrow function', risk: 20 },
  { pattern: /componentWillMount|componentWillReceiveProps/g, label: 'Deprecated React lifecycle', migration: 'useEffect', risk: 50 }
];

export class EvolutionAnalyst implements IntelligenceAnalyst {
  readonly id = 'evolution' as const;
  readonly displayName = 'Evolution Analyst';

  async analyze(context: AnalystContext): Promise<readonly IntelligenceRecommendation[]> {
    logger.debug('EvolutionAnalyst.analyze', { projectId: context.projectId, fileCount: context.files.length });
    const recs: IntelligenceRecommendation[] = [];

    // 1. Détection de patterns legacy
    for (const file of context.files) {
      for (const { pattern, label, migration, risk } of LEGACY_PATTERNS) {
        const matches = file.content.match(pattern);
        if (!matches || matches.length === 0) continue;

        const evidence: Evidence[] = matches.slice(0, 5).map((m, i) => ({
          id: randomUUID().slice(0, 8),
          source: file.path,
          description: `Occurrence #${i + 1}: "${m}" → migrate to ${migration}`,
          type: 'FACT',
          confidence: 0.9,
          authorityWeight: 0.85
        }));

        const breakdown = SCORER.score({
          userValue: 50,
          strategicAlignment: 70,
          evidence,
          expectedValue: 60,
          urgency: matches.length > 5 ? 70 : 40,
          riskReduction: 80 - Math.min(risk, 80)
        });

        recs.push({
          id: 'rec-evolution-' + randomUUID().slice(0, 8),
          source: this.id,
          title: `Migrate "${label}" → ${migration} in ${file.path}`,
          description: `${matches.length} occurrence(s) of deprecated pattern "${label}". Migrate to ${migration} for future-proofing.`,
          score: breakdown.total,
          scoreBreakdown: breakdown,
          evidence,
          targetFiles: [file.path],
          proposedActions: ['REFACTOR', 'MODIFY'],
          reversible: true,
          riskScore: risk,
          estimatedEffort: matches.length > 5 ? 'HIGH' : 'MEDIUM',
          metadata: { pattern: label, occurrences: matches.length, migration }
        });
      }
    }

    // 2. Si le projet grossit (>50 fichiers), recommander une architecture
    if (context.files.length > 50) {
      const evidence: Evidence[] = [
        {
          id: randomUUID().slice(0, 8),
          source: 'file-count',
          description: `${context.files.length} files in project — above 50 file threshold for monolith`,
          type: 'FACT',
          confidence: 0.95,
          authorityWeight: 0.9
        }
      ];
      const breakdown = SCORER.score({
        userValue: 40,
        strategicAlignment: 85,
        evidence,
        expectedValue: 60,
        urgency: 30,
        riskReduction: 70
      });
      recs.push({
        id: 'rec-evolution-arch-' + randomUUID().slice(0, 8),
        source: this.id,
        title: 'Consider splitting project into packages',
        description: `Project has ${context.files.length} files. Consider adopting a modular monolith or multi-package architecture for maintainability.`,
        score: breakdown.total,
        scoreBreakdown: breakdown,
        evidence,
        targetFiles: [],
        proposedActions: ['ANALYZE', 'REFACTOR'],
        reversible: true,
        riskScore: 55,
        estimatedEffort: 'HIGH'
      });
    }

    return Object.freeze(recs);
  }
}
