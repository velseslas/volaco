/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Evidence Ranker: Hierarchical Ranking of Evidence by Authority & Proof Level
 */

import type { EvidenceProofLevel, ProblemEvidence, SignalSource } from '../types.js';

const SOURCE_AUTHORITY: Record<SignalSource, number> = {
  error_runtime: 1.0,
  audit_finding: 0.95,
  telemetry: 0.85,
  user_report: 0.75,
  conversation: 0.70
};

const PROOF_LEVEL_WEIGHT: Record<EvidenceProofLevel, number> = {
  FACT: 1.0,
  CORRELATION: 0.70,
  HYPOTHESIS: 0.40
};

export class EvidenceRanker {
  /**
   * Trie et ordonne les preuves de manière déterministe
   */
  public rank(evidence: readonly ProblemEvidence[]): readonly ProblemEvidence[] {
    const list = [...evidence];

    list.sort((a, b) => {
      const scoreA = (SOURCE_AUTHORITY[a.source] ?? 0.5) * (PROOF_LEVEL_WEIGHT[a.proofLevel] ?? 0.5) * a.confidence;
      const scoreB = (SOURCE_AUTHORITY[b.source] ?? 0.5) * (PROOF_LEVEL_WEIGHT[b.proofLevel] ?? 0.5) * b.confidence;

      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }

      // Tie-breaker stable
      return a.id.localeCompare(b.id);
    });

    return list;
  }
}
