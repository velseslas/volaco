/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-003)
 * Context Base Utilities (Determinism, Immutability, Hashing)
 */

import { createHash } from 'node:crypto';

/**
 * Sorts an array canonically based on a string key.
 */
export function canonicalSort<T>(items: readonly T[], keyExtractor: (item: T) => string): T[] {
  return [...items].sort((a, b) => keyExtractor(a).localeCompare(keyExtractor(b)));
}

/**
 * Recursively orders object keys alphabetically to guarantee deterministic JSON serialization.
 */
export function canonicalObject(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalObject);
  }

  const sortedObj: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>).sort();

  for (const key of keys) {
    sortedObj[key] = canonicalObject((value as Record<string, unknown>)[key]);
  }

  return sortedObj;
}

/**
 * Recursively freezes an object and all nested properties to guarantee complete immutability.
 */
export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }

  return Object.freeze(obj);
}

/**
 * Computes a deterministic SHA-256 hash over a ContextPack payload.
 * EXCLUDES volatile execution metadata: assembledAt, durationMs, and contextHash.
 */
export function computeContextHash(packPayload: Record<string, unknown>): string {
  const {
    assembledAt: _discarded1,
    durationMs: _discarded2,
    contextHash: _discarded3,
    ...stableData
  } = packPayload;

  const canonical = canonicalObject(stableData);
  const jsonStr = JSON.stringify(canonical);
  return createHash('sha256').update(jsonStr).digest('hex');
}

/**
 * Computes a deterministic SHA-256 hash over a ContextRequest.
 */
export function computeRequestHash(request: Record<string, unknown>): string {
  const canonical = canonicalObject(request);
  const jsonStr = JSON.stringify(canonical);
  return createHash('sha256').update(jsonStr).digest('hex');
}
