/**
 * VibeCode Core - Intelligence Pool
 * Analyst Registry : agrège les 4 analysts et fournit une API unifiée.
 */

import { logger } from '../../../logger.js';
import type { IntelligenceAnalyst, IntelligenceRecommendation, AnalystContext, AnalystId } from '../types.js';
import { StrategyAnalyst } from './strategy-analyst.js';
import { EvolutionAnalyst } from './evolution-analyst.js';
import { FeatureAnalyst } from './feature-analyst.js';
import { UnderstandingAnalyst } from './understanding-analyst.js';

export class AnalystRegistry {
  private readonly analysts = new Map<AnalystId, IntelligenceAnalyst>();

  constructor(options: { analysts?: IntelligenceAnalyst[] } = {}) {
    const defaults: IntelligenceAnalyst[] = [
      new StrategyAnalyst(),
      new EvolutionAnalyst(),
      new FeatureAnalyst(),
      new UnderstandingAnalyst()
    ];
    const list = options.analysts || defaults;
    for (const a of list) {
      this.analysts.set(a.id, a);
    }
  }

  public get(id: AnalystId): IntelligenceAnalyst | undefined {
    return this.analysts.get(id);
  }

  public list(): readonly IntelligenceAnalyst[] {
    return Array.from(this.analysts.values());
  }

  /**
   * Exécute TOUS les analysts en parallèle et agrège leurs recommendations.
   * Pour Phase 9.5 : exécution parallèle via Promise.all.
   */
  public async analyzeAll(context: AnalystContext): Promise<readonly IntelligenceRecommendation[]> {
    const results = await Promise.all(
      this.list().map(async (analyst) => {
        try {
          const recs = await analyst.analyze(context);
          return { analyst: analyst.id, recs };
        } catch (err) {
          logger.warn('AnalystRegistry.analyzeAll: analyst failed', {
            analyst: analyst.id,
            error: String(err)
          });
          return { analyst: analyst.id, recs: [] as IntelligenceRecommendation[] };
        }
      })
    );
    const all = results.flatMap((r) => r.recs);
    // Tri par score décroissant
    return Object.freeze(all.sort((a, b) => b.score - a.score));
  }

  /**
   * Exécute un seul analyst.
   */
  public async analyzeOne(id: AnalystId, context: AnalystContext): Promise<readonly IntelligenceRecommendation[]> {
    const analyst = this.analysts.get(id);
    if (!analyst) return [];
    return analyst.analyze(context);
  }
}
