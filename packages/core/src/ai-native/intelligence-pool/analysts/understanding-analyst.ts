/**
 * VibeCode Core - Intelligence Pool
 * UnderstandingAnalyst — refactor du package `application-understanding`.
 *
 * Analyse la structure actuelle de l'app pour fournir des insights
 * sur l'architecture, les conventions, les patterns en place.
 *
 * Sortie : des IntelligenceRecommendation de type "documentation/insight"
 * qui aident le DecisionEngine à comprendre le contexte.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../../../logger.js';
import type { PriorityScorerInput } from '../priority-scorer.js';
import { PriorityScorer, createScorer } from '../priority-scorer.js';
import type { IntelligenceAnalyst, IntelligenceRecommendation, AnalystContext, Evidence } from '../types.js';

const SCORER: PriorityScorer = createScorer({
  userValue: 0.30,
  strategicAlignment: 0.30,
  evidenceConfidence: 0.20,
  expectedValue: 0.10,
  urgency: 0.05,
  riskReduction: 0.05
});

export class UnderstandingAnalyst implements IntelligenceAnalyst {
  readonly id = 'understanding' as const;
  readonly displayName = 'Understanding Analyst';

  async analyze(context: AnalystContext): Promise<readonly IntelligenceRecommendation[]> {
    logger.debug('UnderstandingAnalyst.analyze', { projectId: context.projectId, fileCount: context.files.length });
    const recs: IntelligenceRecommendation[] = [];

    // 1. Détection de la stack
    const stackCounts = new Map<string, number>();
    const stackPatterns: Array<{ name: string; regex: RegExp }> = [
      { name: 'React', regex: /from\s+['"]react['"]/g },
      { name: 'Vue', regex: /from\s+['"]vue['"]/g },
      { name: 'Next.js', regex: /from\s+['"]next\/[\w/-]+['"]/g },
      { name: 'Express', regex: /from\s+['"]express['"]/g },
      { name: 'TypeScript', regex: /:\s*(string|number|boolean|void|any|unknown)\b/g },
      { name: 'CSS Modules', regex: /\.module\.css/g },
      { name: 'Tailwind', regex: /className=.*?(flex|grid|p-\d|m-\d|text-\w+)/g },
      { name: 'Zod', regex: /from\s+['"]zod['"]/g }
    ];

    for (const file of context.files) {
      for (const { name, regex } of stackPatterns) {
        const matches = file.content.match(regex);
        if (matches && matches.length > 0) {
          stackCounts.set(name, (stackCounts.get(name) || 0) + matches.length);
        }
      }
    }

    const topStack = Array.from(stackCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (topStack.length > 0) {
      const evidence: Evidence[] = topStack.map(([name, count]) => ({
        id: randomUUID().slice(0, 8),
        source: 'stack-detection',
        description: `${name}: ${count} occurrences`,
        type: 'FACT',
        confidence: 0.9,
        authorityWeight: 0.85
      }));
      const breakdown = SCORER.score({
        userValue: 60,
        strategicAlignment: 75,
        evidence,
        expectedValue: 50,
        urgency: 25,
        riskReduction: 40
      });
      recs.push({
        id: 'rec-understanding-stack-' + randomUUID().slice(0, 8),
        source: this.id,
        title: `Detected stack: ${topStack.map((s) => s[0]).join(', ')}`,
        description: `Primary stack detected. New features should align with these conventions: ${topStack.map(([n, c]) => `${n} (${c})`).join('; ')}.`,
        score: breakdown.total,
        scoreBreakdown: breakdown,
        evidence,
        targetFiles: [],
        proposedActions: ['ANALYZE'],
        reversible: true,
        riskScore: 0,
        estimatedEffort: 'LOW',
        metadata: { stack: topStack.map(([n, c]) => ({ name: n, count: c })) }
      });
    }

    // 2. Détection de la structure de dossiers
    const dirCounts = new Map<string, number>();
    for (const file of context.files) {
      const parts = file.path.split('/');
      if (parts.length > 1) {
        const topDir = parts[0] ?? 'unknown';
        dirCounts.set(topDir, (dirCounts.get(topDir) || 0) + 1);
      }
    }
    const topDirs = Array.from(dirCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topDirs.length > 0) {
      const evidence: Evidence[] = topDirs.map(([dir, count]) => ({
        id: randomUUID().slice(0, 8),
        source: 'directory-structure',
        description: `/${dir}/ contains ${count} files`,
        type: 'FACT',
        confidence: 0.95,
        authorityWeight: 0.9
      }));
      const breakdown = SCORER.score({
        userValue: 40,
        strategicAlignment: 65,
        evidence,
        expectedValue: 45,
        urgency: 20,
        riskReduction: 30
      });
      recs.push({
        id: 'rec-understanding-structure-' + randomUUID().slice(0, 8),
        source: this.id,
        title: `Directory structure: ${topDirs.map((d) => d[0]).join(', ')}`,
        description: `Top directories: ${topDirs.map(([d, c]) => `/${d}/ (${c})`).join('; ')}. Use these as the canonical locations for new files.`,
        score: breakdown.total,
        scoreBreakdown: breakdown,
        evidence,
        targetFiles: [],
        proposedActions: ['ANALYZE'],
        reversible: true,
        riskScore: 0,
        estimatedEffort: 'LOW',
        metadata: { directories: topDirs }
      });
    }

    // 3. Détection des conventions de nommage
    const namingPatterns = {
      camelCase: 0,
      kebabCase: 0,
      PascalCase: 0,
      snake_case: 0
    };
    for (const file of context.files.slice(0, 50)) {
      const basename = file.path.split('/').pop() || '';
      if (/^[a-z][a-zA-Z0-9]+$/.test(basename)) namingPatterns.camelCase++;
      if (/^[a-z]+(-[a-z0-9]+)+/.test(basename)) namingPatterns.kebabCase++;
      if (/^[A-Z][a-zA-Z0-9]+$/.test(basename)) namingPatterns.PascalCase++;
      if (/^[a-z]+_[a-z0-9_]+/.test(basename)) namingPatterns.snake_case++;
    }
    const dominantNaming = Object.entries(namingPatterns).sort((a, b) => b[1] - a[1])[0];
    if (dominantNaming && dominantNaming[1] > 0) {
      const evidence: Evidence[] = [
        {
          id: randomUUID().slice(0, 8),
          source: 'naming-convention',
          description: `Dominant naming: ${dominantNaming[0]} (${dominantNaming[1]} files)`,
          type: 'FACT',
          confidence: 0.8,
          authorityWeight: 0.7
        }
      ];
      const breakdown = SCORER.score({
        userValue: 30,
        strategicAlignment: 60,
        evidence,
        expectedValue: 40,
        urgency: 15,
        riskReduction: 50
      });
      recs.push({
        id: 'rec-understanding-naming-' + randomUUID().slice(0, 8),
        source: this.id,
        title: `Naming convention: ${dominantNaming[0]}`,
        description: `Project primarily uses ${dominantNaming[0]} for file names (${dominantNaming[1]} files). New files should follow this convention.`,
        score: breakdown.total,
        scoreBreakdown: breakdown,
        evidence,
        targetFiles: [],
        proposedActions: ['ANALYZE'],
        reversible: true,
        riskScore: 0,
        estimatedEffort: 'LOW',
        metadata: namingPatterns
      });
    }

    return Object.freeze(recs);
  }
}
