/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-004)
 * Canonicalization, Deterministic Comparators, and Graph Hashing
 */

import { createHash } from 'node:crypto';
import { canonicalObject, canonicalSort, deepFreeze } from '../../context/engine/base.js';
import type { SemanticEdge, SemanticNode } from '../types.js';

export { canonicalObject, canonicalSort, deepFreeze };

/**
 * Deterministic node comparator.
 * Sorts by kind ascending, then id ascending.
 */
export function compareNodes(a: SemanticNode, b: SemanticNode): number {
  if (a.kind !== b.kind) {
    return a.kind.localeCompare(b.kind);
  }
  return a.id.localeCompare(b.id);
}

/**
 * Deterministic edge comparator.
 * Sorts by sourceId, kind, targetId, then id.
 */
export function compareEdges(a: SemanticEdge, b: SemanticEdge): number {
  if (a.sourceId !== b.sourceId) {
    return a.sourceId.localeCompare(b.sourceId);
  }
  if (a.kind !== b.kind) {
    return a.kind.localeCompare(b.kind);
  }
  if (a.targetId !== b.targetId) {
    return a.targetId.localeCompare(b.targetId);
  }
  return a.id.localeCompare(b.id);
}

/**
 * Computes a deterministic SHA-256 hash over a SemanticCodeGraph payload.
 * EXCLUDES volatile execution metadata: createdAt, durationMs, and graphHash.
 */
export function computeGraphHash(graphPayload: Record<string, unknown>): string {
  const {
    createdAt: _discarded1,
    durationMs: _discarded2,
    graphHash: _discarded3,
    ...stableData
  } = graphPayload;

  const canonical = canonicalObject(stableData);
  const jsonStr = JSON.stringify(canonical);
  return createHash('sha256').update(jsonStr).digest('hex');
}
