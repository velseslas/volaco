/**
 * VibeCode Core - Intelligence Pool
 * StrategyAnalyst — refactor du package `strategy` en analyst consultatif.
 *
 * Phase 9.5 : le StrategyAnalyst ne peut PLUS émettre de EngineeringTaskGraph
 * exécutable. Il produit des IntelligenceRecommendation qui entrent dans le
 * DecisionEngine comme alternatives.
 *
 * Détecte les opportunités stratégiques : dette technique, refactors
 * prioritaires, axes d'amélioration selon le codebase + feedback.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../../../logger.js';
import type { PriorityScorerInput } from '../priority-scorer.js';
import { PriorityScorer, createScorer } from '../priority-scorer.js';
import type { IntelligenceAnalyst, IntelligenceRecommendation, AnalystContext, Evidence } from '../types.js';

const SCORER: PriorityScorer = createScorer({
  userValue: 0.30,
  strategicAlignment: 0.35,
  evidenceConfidence: 0.10,
  expectedValue: 0.10,
  urgency: 0.10,
  riskReduction: 0.05
});

export class StrategyAnalyst implements IntelligenceAnalyst {
  readonly id = 'strategy' as const;
  readonly displayName = 'Strategy Analyst';

  async analyze(context: AnalystContext): Promise<readonly IntelligenceRecommendation[]> {
    logger.debug('StrategyAnalyst.analyze', { projectId: context.projectId, fileCount: context.files.length });
    const recs: IntelligenceRecommendation[] = [];

    // 1. Détection de dette technique (fichiers trop longs)
    const longFiles = context.files.filter((f) => f.content.split('\n').length > 500);
    for (const f of longFiles) {
      const evidence: Evidence[] = [
        {
          id: randomUUID().slice(0, 8),
          source: f.path,
          description: `File has ${f.content.split('\n').length} lines — above the 500 LOC threshold`,
          type: 'FACT',
          confidence: 0.9,
          authorityWeight: 0.8
        }
      ];

      const scoreInput: PriorityScorerInput = {
        userValue: 60,
        strategicAlignment: 75,
        evidence,
        expectedValue: 65,
        urgency: 40,
        riskReduction: 70
      };
      const breakdown = SCORER.score(scoreInput);

      recs.push({
        id: 'rec-strategy-' + randomUUID().slice(0, 8),
        source: this.id,
        title: `Refactor: ${f.path} (${f.content.split('\n').length} LOC)`,
        description: `File exceeds 500 LOC threshold. Recommend splitting into smaller modules for maintainability.`,
        score: breakdown.total,
        scoreBreakdown: breakdown,
        evidence,
        targetFiles: [f.path],
        proposedActions: ['REFACTOR'],
        reversible: true,
        riskScore: 35,
        estimatedEffort: 'HIGH',
        metadata: { lines: f.content.split('\n').length }
      });
    }

    // 2. Détection de duplication (substring heuristique)
    const dupMap = new Map<string, string[]>();
    for (const f of context.files) {
      // Take first 200 chars of each function-like block
      const blocks = f.content.match(/(?:function|const|class)\s+\w+[^{]*\{[^}]{50,300}/g) || [];
      for (const block of blocks) {
        const signature = block.slice(0, 80);
        const existing = dupMap.get(signature) || [];
        existing.push(f.path);
        dupMap.set(signature, existing);
      }
    }
    for (const [signature, files] of dupMap.entries()) {
      if (files.length < 2) continue;
      const evidence: Evidence[] = files.slice(0, 5).map((p) => ({
        id: randomUUID().slice(0, 8),
        source: p,
        description: `Duplicate signature detected: ${signature}...`,
        type: 'CORRELATION',
        confidence: 0.7,
        authorityWeight: 0.7
      }));
      const breakdown = SCORER.score({
        userValue: 50,
        strategicAlignment: 80,
        evidence,
        expectedValue: 60,
        urgency: 30,
        riskReduction: 75
      });
      recs.push({
        id: 'rec-strategy-dup-' + randomUUID().slice(0, 8),
        source: this.id,
        title: `Deduplicate: ${files.length} files share signature`,
        description: `Detected ${files.length} files sharing the same code signature. Recommend extracting shared utility.`,
        score: breakdown.total,
        scoreBreakdown: breakdown,
        evidence,
        targetFiles: files.slice(0, 10),
        proposedActions: ['REFACTOR', 'CREATE'],
        reversible: true,
        riskScore: 40,
        estimatedEffort: 'MEDIUM',
        metadata: { signature }
      });
    }

    // 3. Feedback-driven strategy
    if (context.feedback && context.feedback.length > 0) {
      const negative = context.feedback.filter((f) => f.sentiment.toLowerCase().includes('neg'));
      if (negative.length > 0) {
        const evidence: Evidence[] = negative.slice(0, 5).map((f) => ({
          id: randomUUID().slice(0, 8),
          source: 'user-feedback',
          description: f.message.slice(0, 200),
          type: 'FACT',
          confidence: 0.85,
          authorityWeight: 0.9
        }));
        const breakdown = SCORER.score({
          userValue: 80,
          strategicAlignment: 60,
          evidence,
          expectedValue: 70,
          urgency: 70,
          riskReduction: 50
        });
        recs.push({
          id: 'rec-strategy-feedback-' + randomUUID().slice(0, 8),
          source: this.id,
          title: `Address ${negative.length} negative feedback items`,
          description: `${negative.length} negative feedback signals detected. Top priority: ${negative[0]?.message.slice(0, 100) ?? 'n/a'}`,
          score: breakdown.total,
          scoreBreakdown: breakdown,
          evidence,
          targetFiles: [],
          proposedActions: ['ANALYZE', 'MODIFY'],
          reversible: true,
          riskScore: 30,
          estimatedEffort: 'MEDIUM'
        });
      }
    }

    return Object.freeze(recs);
  }
}
