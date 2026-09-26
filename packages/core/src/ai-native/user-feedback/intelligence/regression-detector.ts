/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Regression Detector: Identification of Post-Mutation Defects & Breakages
 */

import type { ArchitecturalDecisionRecord, RegressionStatus, UserSignal } from '../types.js';

export interface RegressionAnalysis {
  readonly status: RegressionStatus;
  readonly confidence: number;
  readonly correlatedDecisionId?: string | undefined;
  readonly reasoning: string;
}

export class RegressionDetector {
  /**
   * Analyse si les signaux constituent une régression par rapport aux décisions récentes ou retours explicites
   */
  public detectRegression(
    signals: readonly UserSignal[],
    recentDecisions?: readonly ArchitecturalDecisionRecord[]
  ): RegressionAnalysis {
    if (!signals || signals.length === 0) {
      return {
        status: 'NONE',
        confidence: 1.0,
        reasoning: 'Aucun signal pour analyse de régression.'
      };
    }

    // 1. Recherche d'expressions explicites de régression
    let explicitRegressionCount = 0;
    for (const sig of signals) {
      const text = (sig.normalizedText || sig.rawText).toLowerCase();
      if (
        text.includes('régression') ||
        text.includes('regression') ||
        text.includes('depuis la mise à jour') ||
        text.includes('avant ça marchait') ||
        text.includes('depuis le dernier déploiement') ||
        text.includes('ne marche plus') ||
        text.includes('cassé après')
      ) {
        explicitRegressionCount++;
      }
    }

    if (explicitRegressionCount >= 2) {
      return {
        status: 'CONFIRMED',
        confidence: 0.95,
        reasoning: `Régression confirmée: ${explicitRegressionCount} retours attestent explicitement d'une régression post-mise à jour.`
      };
    }

    if (explicitRegressionCount === 1) {
      return {
        status: 'PROBABLE',
        confidence: 0.80,
        reasoning: 'Régression très probable signalée explicitement par un utilisateur.'
      };
    }

    // 2. Corrélation avec les décisions architecturales récentes
    if (recentDecisions && recentDecisions.length > 0) {
      for (const dec of recentDecisions) {
        const stmtLower = (dec.statement || '').toLowerCase();
        const reasonLower = (dec.reason || '').toLowerCase();
        const stmtWords = stmtLower.split(/\s+/).filter(w => w.length >= 4);

        for (const sig of signals) {
          const text = (sig.normalizedText || sig.rawText).toLowerCase();
          const matchesStmt = stmtWords.some(w => text.includes(w));
          const matchesUrl = Boolean(sig.url && reasonLower.includes(sig.url.toLowerCase()));

          if (sig.category === 'BUG' && (matchesStmt || matchesUrl)) {
            return {
              status: 'SUSPECTED',
              confidence: 0.70,
              correlatedDecisionId: dec.decisionId,
              reasoning: `Régression suspectée suite à la décision d'architecture récente: "${dec.statement}".`
            };
          }
        }
      }
    }

    return {
      status: 'NONE',
      confidence: 0.80,
      reasoning: 'Aucun indice de régression post-mutation détecté.'
    };
  }
}
