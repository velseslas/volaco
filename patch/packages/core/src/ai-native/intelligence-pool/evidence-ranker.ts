/**
 * VibeCode Core - Intelligence Pool
 * Shared Evidence Ranker — remplace les 3 rankers redondants
 * (evolution/evidence/evidence-ranker, feature-intelligence/evidence/evidence-ranker,
 *  user-feedback/evidence/evidence-ranker).
 *
 * Trie les evidence par : authorityWeight * confidence
 */

import type { Evidence } from './types.js';

export class EvidenceRanker {
  /**
   * Trie les evidence par score décroissant = authorityWeight × confidence.
   */
  public rank(evidence: readonly Evidence[]): readonly Evidence[] {
    return [...evidence].sort((a, b) => {
      const scoreA = a.authorityWeight * a.confidence;
      const scoreB = b.authorityWeight * b.confidence;
      return scoreB - scoreA;
    });
  }

  /**
   * Top-N evidence par score.
   */
  public topN(evidence: readonly Evidence[], n: number): readonly Evidence[] {
    return this.rank(evidence).slice(0, n);
  }

  /**
   * Score moyen pondéré de confiance = Σ(authority × confidence) / Σ(authority).
   */
  public weightedConfidence(evidence: readonly Evidence[]): number {
    if (evidence.length === 0) return 0;
    let sumWeighted = 0;
    let sumAuthority = 0;
    for (const e of evidence) {
      sumWeighted += e.authorityWeight * e.confidence;
      sumAuthority += e.authorityWeight;
    }
    if (sumAuthority === 0) return 0;
    return sumWeighted / sumAuthority;
  }
}
