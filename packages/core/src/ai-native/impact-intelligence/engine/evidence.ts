/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-005)
 * Evidence Propagation, Aggregation, and Verification Engine
 *
 * Rule: NO EVIDENCE -> NO IMPACT
 */

import type { SemanticEvidence } from '../../semantic-graph/types.js';
import type { ImpactPathStep } from '../types.js';

/**
 * Builds a deterministic canonical key for an evidence item.
 */
function evidenceKey(ev: SemanticEvidence): string {
  return [
    ev.kind,
    ev.source,
    ev.detail,
    ev.filePath ?? '',
    ev.lineStart ?? 0,
    ev.lineEnd ?? 0
  ].join(':::');
}

/**
 * Deterministic comparator for SemanticEvidence.
 */
export function compareEvidence(a: SemanticEvidence, b: SemanticEvidence): number {
  if (a.kind !== b.kind) {
    return a.kind.localeCompare(b.kind);
  }
  if (a.source !== b.source) {
    return a.source.localeCompare(b.source);
  }
  const fileA = a.filePath ?? '';
  const fileB = b.filePath ?? '';
  if (fileA !== fileB) {
    return fileA.localeCompare(fileB);
  }
  const lineA = a.lineStart ?? 0;
  const lineB = b.lineStart ?? 0;
  if (lineA !== lineB) {
    return lineA - lineB;
  }
  return a.detail.localeCompare(b.detail);
}

/**
 * Deduplicates and deterministically sorts a collection of SemanticEvidence.
 */
export function deduplicateAndSortEvidence(
  evidences: readonly SemanticEvidence[]
): readonly SemanticEvidence[] {
  const seen = new Set<string>();
  const result: SemanticEvidence[] = [];

  for (const ev of evidences) {
    const key = evidenceKey(ev);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(ev);
    }
  }

  return result.sort(compareEvidence);
}

/**
 * Aggregates all evidence along an impact path of steps.
 * Enforces NO EVIDENCE -> NO IMPACT:
 * If steps have zero evidence, returns empty array.
 */
export function aggregatePathEvidence(
  steps: readonly ImpactPathStep[]
): readonly SemanticEvidence[] {
  const collected: SemanticEvidence[] = [];
  for (const step of steps) {
    for (const ev of step.edgeEvidence) {
      collected.push(ev);
    }
  }
  return deduplicateAndSortEvidence(collected);
}

/**
 * Merges multiple evidence arrays deterministically.
 */
export function mergeEvidences(
  ...arrays: readonly (readonly SemanticEvidence[])[]
): readonly SemanticEvidence[] {
  const combined: SemanticEvidence[] = [];
  for (const arr of arrays) {
    for (const ev of arr) {
      combined.push(ev);
    }
  }
  return deduplicateAndSortEvidence(combined);
}
