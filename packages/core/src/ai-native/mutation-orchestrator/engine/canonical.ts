/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-006)
 * Deterministic Hashing & Comparators
 */

import { createHash } from 'node:crypto';
import { canonicalObject, deepFreeze } from '../../context/engine/base.js';
import type { SingleMutation } from '../types.js';

export { canonicalObject, deepFreeze };

/**
 * Deterministic comparator for SingleMutation.
 * Sorts by target path, then kind, then mutationId.
 */
export function compareMutations(a: SingleMutation, b: SingleMutation): number {
  const pathA = a.operation.path;
  const pathB = b.operation.path;
  if (pathA !== pathB) {
    return pathA.localeCompare(pathB);
  }
  if (a.kind !== b.kind) {
    return a.kind.localeCompare(b.kind);
  }
  return a.mutationId.localeCompare(b.mutationId);
}

/**
 * Computes deterministic SHA-256 hash for a MutationPlan.
 * Strips volatile execution fields (createdAt, planHash).
 */
export function computePlanHash(planPayload: Record<string, unknown>): string {
  const {
    createdAt: _discarded1,
    planHash: _discarded2,
    requestId: _discarded3,
    planId: _discarded4,
    ...stableData
  } = planPayload;

  const canonical = canonicalObject(stableData);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Computes deterministic SHA-256 hash for a MutationTransaction.
 * Strips volatile execution fields (createdAt, durationMs, transactionHash).
 */
export function computeTransactionHash(txPayload: Record<string, unknown>): string {
  const {
    createdAt: _discarded1,
    durationMs: _discarded2,
    transactionHash: _discarded3,
    transactionId: _discarded4,
    ...stableData
  } = txPayload;

  const canonical = canonicalObject(stableData);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
