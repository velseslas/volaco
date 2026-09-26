/**
 * VibeCode Core - Intelligence Pool
 * Shared utilities : canonical (deepFreeze + sha256 hash)
 *
 * Phase 9.5 : UNE implémentation partagée au lieu de 12 canonical.ts
 * redondants dans strategy/evolution/feature-intelligence/etc.
 */

import { createHash } from 'node:crypto';

/**
 * Gèle récursivement un objet. Aucune mutation possible après.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return Object.freeze(value);
}

/**
 * Calcule un hash SHA-256 stable d'un objet sérialisable.
 * Le hash est déterministe : même structure + mêmes valeurs → même hash.
 */
export function computeHash(value: unknown): string {
  const serialized = canonicalStringify(value);
  return createHash('sha256').update(serialized, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Sérialisation canonique : clés triées pour garantir la stabilité du hash.
 */
function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort((a, b) => a[0].localeCompare(b[0]));
    return '{' + entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`).join(',') + '}';
  }
  return JSON.stringify(String(value));
}

/**
 * Crée un objet gelé avec un hash précalculé. Pour utiliser dans les caches.
 */
export function canonicalize<T>(value: T): T & { readonly __hash: string } {
  const hash = computeHash(value);
  return deepFreeze({ ...(value as Record<string, unknown>), __hash: hash }) as T & { readonly __hash: string };
}
