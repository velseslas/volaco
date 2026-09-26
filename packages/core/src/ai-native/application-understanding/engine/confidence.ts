/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * Quantified Confidence & Certainty Classification Engine
 */

import type { CertaintyLevel, UnderstandingEvidence, UnderstandingEvidenceKind } from '../types.js';

const KIND_WEIGHTS: Readonly<Record<UnderstandingEvidenceKind, number>> = {
  AST_SYMBOL: 0.15,
  AST_IMPORT: 0.10,
  AST_EXPORT: 0.10,
  SYMBOL_REFERENCE: 0.12,
  ROUTE_DECLARATION: 0.20,
  COMPONENT_PROFILE: 0.15,
  MODULE_MEMBERSHIP: 0.10,
  LAYER_MEMBERSHIP: 0.10,
  DNA_STACK: 0.12,
  DNA_LAYER: 0.10,
  GRAPH_EDGE: 0.15,
  IMPACT_PATH: 0.10,
  HEURISTIC: 0.05
};

/**
 * Calculates a bounded confidence score (0.0 - 1.0) based on accumulated evidence.
 * Strongly rewards diverse, corroborated evidence kinds.
 */
export function calculateConfidence(
  evidenceList: readonly UnderstandingEvidence[],
  baseWeight = 0.40
): number {
  if (!evidenceList || evidenceList.length === 0) {
    return 0.10;
  }

  let score = baseWeight;
  const kindsSeen = new Set<UnderstandingEvidenceKind>();

  for (const ev of evidenceList) {
    const weight = KIND_WEIGHTS[ev.kind] ?? 0.05;
    score += weight * Math.max(0.2, Math.min(1.0, ev.confidence));
    kindsSeen.add(ev.kind);
  }

  // Corroboration bonus: multi-source confirmation yields higher certainty
  if (kindsSeen.size >= 4) {
    score += 0.20;
  } else if (kindsSeen.size >= 3) {
    score += 0.12;
  } else if (kindsSeen.size >= 2) {
    score += 0.06;
  }

  // Bound to [0.10, 0.98]
  const clamped = Math.max(0.10, Math.min(0.98, score));
  return Math.round(clamped * 10000) / 10000;
}

/**
 * Classifies confidence score into discrete certainty levels.
 * OBSERVED: >= 0.80
 * INFERRED: >= 0.55
 * HYPOTHESIZED: < 0.55
 */
export function determineCertainty(confidence: number): CertaintyLevel {
  if (confidence >= 0.80) {
    return 'OBSERVED';
  }
  if (confidence >= 0.55) {
    return 'INFERRED';
  }
  return 'HYPOTHESIZED';
}
