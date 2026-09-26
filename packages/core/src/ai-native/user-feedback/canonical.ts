/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Canonical Hashing, Deterministic Comparators & Immutability Utilities
 */

import { createHash } from 'node:crypto';
import type { AggregatedProblem, ProblemSeverity, UserSignal } from './types.js';

/**
 * Calcule un hash déterministe SHA-256 pour un signal utilisateur brut
 */
export function computeSignalHash(input: {
  readonly source: string;
  readonly rawText: string;
  readonly userId?: string | undefined;
  readonly timestamp?: string | undefined;
}): string {
  const payload = [
    input.source,
    input.rawText.trim().toLowerCase(),
    input.userId ?? 'anonymous'
  ].join('::');

  return `sig:${createHash('sha256').update(payload, 'utf8').digest('hex').substring(0, 16)}`;
}

/**
 * Calcule un hash déterministe SHA-256 pour un problème agrégé
 */
export function computeProblemHash(input: {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly description: string;
  readonly priorityScore: number;
}): string {
  const serialized = [
    input.id,
    input.title.trim().toLowerCase(),
    input.category,
    input.description.trim(),
    Math.round(input.priorityScore)
  ].join('::');

  return `prob:${createHash('sha256').update(serialized, 'utf8').digest('hex').substring(0, 16)}`;
}

/**
 * Calcule un hash déterministe SHA-256 pour un rapport complet de retours utilisateurs et bugs
 */
export function computeFeedbackReportHash(input: {
  readonly tenantId: string;
  readonly projectId: string;
  readonly problemsCount: number;
  readonly avgPriorityScore: number;
  readonly problemHashes: readonly string[];
}): string {
  const sortedHashes = [...input.problemHashes].sort().join('|');
  const payload = `${input.tenantId}:${input.projectId}:${input.problemsCount}:${Math.round(input.avgPriorityScore)}:${sortedHashes}`;
  return `ufr:${createHash('sha256').update(payload, 'utf8').digest('hex').substring(0, 16)}`;
}

const SEVERITY_WEIGHT: Record<ProblemSeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1
};

/**
 * Comparateur déterministe pour ordonner les problèmes de manière stable :
 * 1. Score de priorité décroissant
 * 2. Confiance des preuves décroissante
 * 3. Gravité intrinsèque (sévérité) décroissante
 * 4. Titre alphabétique (tie-breaker stable)
 */
export function compareProblems(a: AggregatedProblem, b: AggregatedProblem): number {
  if (b.scores.priorityScore !== a.scores.priorityScore) {
    return b.scores.priorityScore - a.scores.priorityScore;
  }
  if (b.scores.confidenceScore !== a.scores.confidenceScore) {
    return b.scores.confidenceScore - a.scores.confidenceScore;
  }
  const weightA = SEVERITY_WEIGHT[a.severity] ?? 0;
  const weightB = SEVERITY_WEIGHT[b.severity] ?? 0;
  if (weightB !== weightA) {
    return weightB - weightA;
  }
  return a.title.localeCompare(b.title);
}

/**
 * Comparateur déterministe pour ordonner les signaux de manière stable
 */
export function compareSignals(a: UserSignal, b: UserSignal): number {
  const timeA = new Date(a.timestamp).getTime();
  const timeB = new Date(b.timestamp).getTime();
  if (timeB !== timeA) {
    return timeB - timeA;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Immutabilité récursive profonde (Deep Freeze)
 */
export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const prop = (obj as Record<string, unknown>)[key];
    if (prop !== null && typeof prop === 'object' && !Object.isFrozen(prop)) {
      deepFreeze(prop);
    }
  }
  return obj;
}
