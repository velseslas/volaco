/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Decision Engine - Coordinates strategic evaluation and enforces memory constraints
 * 
 * Strict Invariants:
 * - HUMAN CONTROL: Advisory only. No silent decision or execution.
 * - STRATEGIC MEMORY: Does not resurface rejected recommendations without new evidence or context shift.
 */

import type {
  StrategicRecommendation,
  StrategyContext,
  StrategicMemoryEntry
} from '../types.js';

export class DecisionEngine {
  /**
   * Applies strategic memory filtering and status updates to recommendations.
   */
  public applyMemoryAndDecisions(
    recommendations: StrategicRecommendation[],
    context: StrategyContext
  ): StrategicRecommendation[] {
    const memory = context.priorDecisions || [];
    if (memory.length === 0) {
      return recommendations;
    }

    // Index prior decisions by recommendationId
    const decisionMap = new Map<string, StrategicMemoryEntry>();
    for (const entry of memory) {
      decisionMap.set(entry.recommendationId, entry);
    }

    return recommendations.map(rec => {
      const prior = decisionMap.get(rec.id);
      if (!prior) {
        return rec;
      }

      // If previously REJECTED:
      if (prior.action === 'REJECTED') {
        // Check if context has changed or new evidence was added
        const hasNewEvidence = rec.evidence.length > 2 || prior.contextHash !== context.inputHash;
        if (!hasNewEvidence) {
          return {
            ...rec,
            status: 'REJECTED',
            rationale: `${rec.rationale} [REJETÉ PRÉCÉDEMMENT: ${prior.reason}. Maintenu rejeté car aucun nouvel élément n a été constaté.]`,
            strategicScore: Math.min(rec.strategicScore, 30) // lowered priority
          };
        }
      } else if (prior.action === 'APPROVED') {
        return {
          ...rec,
          status: 'APPROVED'
        };
      } else if (prior.action === 'COMPLETED') {
        return {
          ...rec,
          status: 'COMPLETED'
        };
      }

      return rec;
    });
  }
}
