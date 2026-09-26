/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-002)
 * DNA Extractor Base Utilities (Determinism, Immutability, Hashing)
 */

import { createHash } from 'node:crypto';

/**
 * Sorts an array canonicaly based on a string key.
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

  // Freeze properties first
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }

  return Object.freeze(obj);
}

/**
 * Computes a deterministic SHA-256 hash over an ApplicationDNA payload.
 * EXCLUDES volatile execution metadata: extractedAt and durationMs.
 */
export function computeDnaHash(dnaPayload: Record<string, unknown>): string {
  const { extractedAt: _discarded1, durationMs: _discarded2, dnaHash: _discarded3, ...stableData } = dnaPayload;
  const canonical = canonicalObject(stableData);
  const jsonStr = JSON.stringify(canonical);
  return createHash('sha256').update(jsonStr).digest('hex');
}
