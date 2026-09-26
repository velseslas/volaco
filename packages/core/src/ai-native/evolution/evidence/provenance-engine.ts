/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Provenance Engine - Evidence traceability and human-readable explanations
 *
 * Strict Invariant: NO EVIDENCE → explicit UNSUPPORTED declaration.
 * formatWhyExplanation lists each piece of evidence with source, type, confidence.
 */

import type { EvolutionEvidence, EvolutionProposal } from '../types.js';

// ---------------------------------------------------------------------------
// ProvenanceEngine
// ---------------------------------------------------------------------------

/**
 * Builds traceable provenance information and human-readable explanations
 * for evolution proposals.
 *
 * - buildProvenance(): list of traceable source references
 * - formatWhyExplanation(): natural-language explanation of evidence chain
 */
export class ProvenanceEngine {
  /**
   * Builds a list of traceable source references from proposal evidence.
   * Each entry is formatted as: `<source>:<type>:<verifiableReference>`.
   * Returns an empty array if no evidence is present.
   */
  public buildProvenance(proposal: EvolutionProposal): string[] {
    return proposal.evidence.map(
      (e: EvolutionEvidence) =>
        `${e.source}:${e.type}:${e.verifiableReference}`,
    );
  }

  /**
   * Formats a human-readable explanation of why this proposal exists.
   *
   * Lists each piece of evidence with its source, type, and confidence.
   * Returns 'UNSUPPORTED: Aucune preuve disponible.' when evidence is empty.
   */
  public formatWhyExplanation(proposal: EvolutionProposal): string {
    if (proposal.evidence.length === 0) {
      return 'UNSUPPORTED: Aucune preuve disponible.';
    }

    const lines: string[] = [
      `Proposition "${proposal.title}" supportée par ${proposal.evidence.length} preuve(s) :`,
    ];

    for (const e of proposal.evidence) {
      const confidencePct = Math.round(e.confidence * 100);
      lines.push(
        `  • [${e.type}] Source: ${e.source} — "${e.description}" ` +
        `(réf: ${e.verifiableReference}, confiance: ${confidencePct}%)`,
      );
    }

    lines.push(
      `Confiance agrégée de la proposition : ${Math.round(proposal.evidenceConfidence * 100)}%.`,
    );

    return lines.join('\n');
  }
}
