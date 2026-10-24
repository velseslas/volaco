/**
 * V7 — Signaux mémoire pour le Decision Engine.
 *
 * La mémoire projet contient des contraintes, des risques et des décisions
 * exprimés en langage naturel. Ce module les relie à l'intent courant par
 * recouvrement de tokens significatifs. C'est une heuristique explicite :
 * elle ne prétend pas comprendre la sémantique, elle évite seulement de
 * prendre une décision « mémoire vide » alors que le projet a déjà exprimé
 * des contraintes.
 */

import type { IntentResult, ProjectMemory } from '../conversation-intelligence/types.js';

/**
 * Mots trop génériques : les compter produirait des faux positifs massifs
 * (toute demande parle de page, code, fichier ou données).
 */
const STOPWORDS = new Set([
  'page', 'pages', 'code', 'test', 'tests', 'file', 'files', 'data', 'html', 'css',
  'dans', 'pour', 'avec', 'sans', 'plus', 'doit', 'doivent', 'etre', 'cette',
  'leur', 'leurs', 'nous', 'vous', 'elle', 'elles', 'ils', 'tout', 'toute',
  'that', 'this', 'with', 'from', 'have', 'will', 'your', 'their', 'them',
  'then', 'than', 'when', 'what', 'where', 'which', 'while', 'user', 'users',
  'into', 'onto', 'over', 'under', 'about', 'after', 'before', 'should',
  'could', 'would', 'must', 'make', 'made', 'using', 'use', 'used'
]);

function tokenize(value: string): Set<string> {
  const normalized = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const tokens = normalized.split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !STOPWORDS.has(token));
  return new Set(tokens);
}

function matchEntries(entries: readonly string[], intentTokens: ReadonlySet<string>): string[] {
  return entries.filter((entry) => {
    for (const token of tokenize(entry)) {
      if (intentTokens.has(token)) return true;
    }
    return false;
  });
}

export interface MemorySignals {
  /** Risques connus dont au moins un token significatif apparaît dans l'intent. */
  readonly matchedRisks: readonly string[];
  /** Contraintes connues dont au moins un token significatif apparaît dans l'intent. */
  readonly matchedConstraints: readonly string[];
  /** Décisions projet encore actives (compteur, pas de matching sémantique). */
  readonly activeDecisions: number;
}

export function matchMemorySignals(intent: IntentResult, memory: ProjectMemory): MemorySignals {
  const intentTokens = tokenize(
    `${intent.goal} ${intent.requestedAction} ${intent.entities.join(' ')}`
  );
  return {
    matchedRisks: matchEntries(memory.knownRisks, intentTokens),
    matchedConstraints: matchEntries(memory.knownConstraints, intentTokens),
    activeDecisions: memory.architecturalDecisions.filter(
      (decision) => decision.status === 'ACTIVE'
    ).length
  };
}
