/**
 * C3.2-B1 — Sérialisation JSON canonique déterministe des charges MCP distants.
 *
 * Unique usage : produire les EMPREINTES (SHA-256) qui lient une approbation
 * d'outil à son schéma déclaré, et une confirmation anti-rejeu à ses arguments
 * EXACTS. Ce module ne transporte aucune donnée réseau et ne journalise rien.
 *
 * Garanties :
 * - déterministe : les clés d'objet sont triées par unités de code UTF-16
 *   (ordre natif de String#sort — stable de run en run sur ce serveur, qui est
 *   le seul producteur ET consommateur des empreintes) ; l'ordre des TABLEAUX
 *   est significatif et préservé (sémantique JSON) ;
 * - fail-closed : tout élément hors du modèle JSON est REFUSÉ par une erreur
 *   explicite (undefined, function, symbol, bigint, NaN/±Infinity, Map/Set/
 *   Date/RegExp/classe, cycles, profondeur > 64) — aucune coercition silencieuse ;
 * - scalaires canoniques : -0 → "0", nombres au format ECMAScript
 *   (JSON.stringify), chaînes échappées JSON (guillemets, caractères de
 *   contrôle, paires UTF-16) ;
 * - ne JAMAIS accepter d'emprunter la sérialisation d'un autre module
 *   (aucune dépendance npm) : zéro ajout de dépendance.
 *
 * Limite documentée : deux structures JSON distinctes peuvent produire des
 * arbres canoniques identiques ("a" trié) — c'est le but (identité sémantique),
 * pas une collision : l'empreinte identifie la charge, pas sa représentation
 * d'origine. Le hash est calculé côté serveur UNIQUEMENT (url-policy/keys
 * jamais exposées) ; les clients Studio reçoivent les empreintes, jamais le
 * rôle de les produire.
 */

import { sha256Hex } from './crypto.js';
import type { RemoteMcpSha256Hex } from './types.js';

export type RemoteMcpCanonicalErrorCode = 'CANONICAL_INVALID';

export class RemoteMcpCanonicalError extends Error {
  readonly code: RemoteMcpCanonicalErrorCode;

  constructor(message: string) {
    super(message);
    this.name = 'RemoteMcpCanonicalError';
    this.code = 'CANONICAL_INVALID';
  }
}

/**
 * Profondeur d'imbrication maximale acceptée (niveaux de conteneurs). Audelà :
 * refus explicite — borne anti-DoS (une charge hostile profondément imbriquée
 * ne doit jamais atteindre un stack overflow avant le refus).
 */
export const REMOTE_MCP_CANONICAL_MAX_DEPTH = 64;

function typeLabel(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function serialize(value: unknown, depth: number, ancestry: WeakSet<object>): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value as string);
  if (t === 'number') {
    const num = value as number;
    if (!Number.isFinite(num)) {
      throw new RemoteMcpCanonicalError('nombre non fini (NaN/±Infinity) non sérialisable');
    }
    // JSON.stringify(-0) === '0' : -0 et 0 produisent la même empreinte (choix documenté).
    return JSON.stringify(num);
  }
  if (t === 'boolean') return value === true ? 'true' : 'false';
  if (t === 'bigint' || t === 'symbol' || t === 'undefined' || t === 'function') {
    throw new RemoteMcpCanonicalError(`type ${t} non sérialisable en JSON canonique`);
  }
  // Conteneurs.
  if (depth >= REMOTE_MCP_CANONICAL_MAX_DEPTH) {
    throw new RemoteMcpCanonicalError(
      `profondeur d'imbrication > ${REMOTE_MCP_CANONICAL_MAX_DEPTH} refusée`
    );
  }
  const obj = value as object;
  if (ancestry.has(obj)) {
    throw new RemoteMcpCanonicalError('cycle détecté (référence récursive)');
  }
  // WeakSet muté en profondeur (add avant la récursion, delete après) :
  // un WeakSet n'est pas itérable, la copie ne peut pas être utilisée.
  ancestry.add(obj);
  try {
    if (Array.isArray(obj)) {
      const items: string[] = [];
      for (const item of obj) {
        items.push(serialize(item, depth + 1, ancestry));
      }
      return `[${items.join(',')}]`;
    }
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      throw new RemoteMcpCanonicalError(
        `objet non-JSON (prototype ${typeLabel(obj)}) refusé — Map/Set/Date/classe non supportés`
      );
    }
    const record = obj as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
      parts.push(`${JSON.stringify(key)}:${serialize(record[key], depth + 1, ancestry)}`);
    }
    return `{${parts.join(',')}}`;
  } finally {
    ancestry.delete(obj);
  }
}

/**
 * Sérialisation canonique d'une charge JSON pure. Lève RemoteMcpCanonicalError
 * sur toute entrée hors modèle (fail-closed, aucune coercition).
 */
export function stableStringifyCanonical(value: unknown): string {
  return serialize(value, 0, new WeakSet());
}

/**
 * Empreinte SHA-256 (hexadécimal minuscule 64 car.) de la charge canonique.
 * Utilisée pour les politiques d'approbation et les confirmations anti-rejeu.
 */
export function remoteMcpCanonicalSha256(value: unknown): RemoteMcpSha256Hex {
  return sha256Hex(stableStringifyCanonical(value));
}
