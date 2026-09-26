/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-003)
 * Deterministic Context Ranker & Lexical Tokenizer
 */

import type { ContextRelevanceReason } from '../types.js';

/**
 * Tokenizes arbitrary text into a normalized, canonical list of keywords.
 */
export function tokenizeText(text: string): readonly string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const rawTokens = text
    .toLowerCase()
    .replace(/[^a-z0-9_/-]/g, ' ')
    .split(/\s+/);

  const tokenSet = new Set<string>();
  for (const t of rawTokens) {
    if (t.length >= 2) {
      tokenSet.add(t);
    }
  }

  return Array.from(tokenSet).sort();
}

/**
 * Computes the lexical match score [0.0, 0.40] between query tokens and target text.
 */
export function computeLexicalScore(
  queryTokens: readonly string[],
  targetText: string
): { score: number; matchedTokens: readonly string[] } {
  if (queryTokens.length === 0 || !targetText || targetText.length === 0) {
    return { score: 0, matchedTokens: [] };
  }

  const lowerTarget = targetText.toLowerCase();
  const matched: string[] = [];

  for (const token of queryTokens) {
    if (lowerTarget.includes(token)) {
      matched.push(token);
    }
  }

  if (matched.length === 0) {
    return { score: 0, matchedTokens: [] };
  }

  // Ratio scaled to maximum 0.40
  const ratio = matched.length / queryTokens.length;
  const score = Math.round(ratio * 0.4 * 10000) / 10000;

  return {
    score,
    matchedTokens: matched.sort()
  };
}

export interface CandidateScoreInput {
  isAnchor?: boolean | undefined;
  isTargetSymbol?: boolean | undefined;
  isTargetLayer?: boolean | undefined;
  lexicalScore?: number | undefined;
  isDirectDependency?: boolean | undefined;
  isReverseDependency?: boolean | undefined;
  isEntryPoint?: boolean | undefined;
  centralityRatio?: number | undefined; // 0.0 to 1.0
  isSameLayerOrModule?: boolean | undefined;
  isTechnicalDecision?: boolean | undefined;
  hasDiagnostic?: boolean | undefined;
}

/**
 * Computes a deterministic composite relevance score bounded in [0.0, 1.0].
 */
export function calculateRelevanceScore(input: CandidateScoreInput): number {
  let score = 0;

  if (input.isAnchor) score += 1.0;
  if (input.isTargetSymbol) score += 0.9;
  if (input.isTargetLayer) score += 0.85;
  if (input.lexicalScore !== undefined && input.lexicalScore > 0) score += input.lexicalScore;
  if (input.isDirectDependency) score += 0.35;
  if (input.isReverseDependency) score += 0.2;
  if (input.isEntryPoint) score += 0.15;
  if (input.centralityRatio !== undefined && input.centralityRatio > 0) {
    score += Math.min(1.0, Math.max(0.0, input.centralityRatio)) * 0.15;
  }
  if (input.isSameLayerOrModule) score += 0.1;
  if (input.isTechnicalDecision) score += 0.1;
  if (input.hasDiagnostic) score += 0.1;

  const bounded = Math.min(1.0, Math.max(0.0, score));
  return Math.round(bounded * 10000) / 10000;
}

export interface ScoredCandidate {
  readonly score: number;
  readonly filePath: string;
  readonly lineStart?: number | undefined;
  readonly name?: string | undefined;
  readonly reason: ContextRelevanceReason;
}

/**
 * Strict canonical tie-breaking comparator:
 * 1. score descending
 * 2. filePath ascending (alphabetical)
 * 3. lineStart ascending
 * 4. name / symbol name ascending
 * 5. reason ascending
 */
export function compareCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }

  const fileCmp = a.filePath.localeCompare(b.filePath);
  if (fileCmp !== 0) return fileCmp;

  const lineA = a.lineStart ?? 0;
  const lineB = b.lineStart ?? 0;
  if (lineA !== lineB) return lineA - lineB;

  const nameA = a.name ?? '';
  const nameB = b.name ?? '';
  const nameCmp = nameA.localeCompare(nameB);
  if (nameCmp !== 0) return nameCmp;

  return a.reason.localeCompare(b.reason);
}
