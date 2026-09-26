/**
 * VibeCode Core - Intelligence Pool
 * PriorityScorer : 1 seul scorer paramétrable au lieu de 3
 * (strategic-score-engine, evolution-priority-engine, feature-value-engine).
 *
 * Le scorer prend des weights (permet à chaque analyst de pondérer différemment)
 * et produit un PriorityScoreBreakdown qui explique le score.
 */

import type { PriorityWeights, PriorityScoreBreakdown, Evidence } from './types.js';
import { EvidenceRanker } from './evidence-ranker.js';

export const DEFAULT_WEIGHTS: PriorityWeights = {
  userValue: 0.35,
  strategicAlignment: 0.20,
  evidenceConfidence: 0.15,
  expectedValue: 0.15,
  urgency: 0.10,
  riskReduction: 0.05
};

export interface PriorityScorerInput {
  readonly userValue: number;             // 0-100
  readonly strategicAlignment: number;  // 0-100
  readonly evidence: readonly Evidence[];
  readonly expectedValue: number;        // 0-100
  readonly urgency: number;             // 0-100
  readonly riskReduction: number;       // 0-100
}

const ranker = new EvidenceRanker();

export class PriorityScorer {
  constructor(private readonly weights: PriorityWeights = DEFAULT_WEIGHTS) {}

  public score(input: PriorityScorerInput): PriorityScoreBreakdown {
    const evidenceConfidence = ranker.weightedConfidence(input.evidence) * 100;
    const userValueContrib = Math.round(input.userValue * this.weights.userValue);
    const strategicContrib = Math.round(input.strategicAlignment * this.weights.strategicAlignment);
    const evidenceContrib = Math.round(evidenceConfidence * this.weights.evidenceConfidence);
    const expectedContrib = Math.round(input.expectedValue * this.weights.expectedValue);
    const urgencyContrib = Math.round(input.urgency * this.weights.urgency);
    const riskContrib = Math.round(input.riskReduction * this.weights.riskReduction);

    const total = Math.min(
      100,
      Math.max(
        0,
        userValueContrib + strategicContrib + evidenceContrib + expectedContrib + urgencyContrib + riskContrib
      )
    );

    return Object.freeze({
      total,
      userValue: userValueContrib,
      strategicAlignment: strategicContrib,
      evidenceConfidence: evidenceContrib,
      expectedValue: expectedContrib,
      urgency: urgencyContrib,
      riskReduction: riskContrib,
      rationale: `total=${total} = user(${userValueContrib}) + strategy(${strategicContrib}) + evidence(${evidenceContrib}) + expected(${expectedContrib}) + urgency(${urgencyContrib}) + risk(${riskContrib})`
    });
  }

  public getWeights(): PriorityWeights {
    return this.weights;
  }
}

/**
 * Factory : créer un scorer avec des weights personnalisés.
 * Exemple : new PriorityScorer({ ...DEFAULT_WEIGHTS, urgency: 0.30 }).
 */
export function createScorer(weights?: Partial<PriorityWeights>): PriorityScorer {
  return new PriorityScorer({ ...DEFAULT_WEIGHTS, ...weights });
}
