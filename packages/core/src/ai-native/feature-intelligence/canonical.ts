/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Canonical Hashing, Deterministic Comparators & Immutability Utilities
 */

import { createHash } from 'node:crypto';
import type { FeatureCandidate, FeatureIntelligenceReport } from './types.js';

/**
 * Calcule un hash déterministe SHA-256 pour un candidat d'opportunité
 */
export function computeFeatureCandidateHash(input: {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly problem: string;
  readonly proposedSolution: string;
  readonly priorityScore: number;
}): string {
  const serialized = [
    input.id,
    input.title.trim().toLowerCase(),
    input.category,
    input.problem.trim(),
    input.proposedSolution.trim(),
    Math.round(input.priorityScore)
  ].join('::');

  return `fop:${createHash('sha256').update(serialized, 'utf8').digest('hex').substring(0, 16)}`;
}

/**
 * Calcule un hash déterministe SHA-256 pour un rapport complet d'intelligence produit
 */
export function computeFeatureReportHash(input: {
  readonly tenantId: string;
  readonly projectId: string;
  readonly opportunitiesCount: number;
  readonly avgPriorityScore: number;
  readonly candidateHashes: readonly string[];
}): string {
  const sortedHashes = [...input.candidateHashes].sort().join('|');
  const payload = `${input.tenantId}:${input.projectId}:${input.opportunitiesCount}:${Math.round(input.avgPriorityScore)}:${sortedHashes}`;
  return `fir:${createHash('sha256').update(payload, 'utf8').digest('hex').substring(0, 16)}`;
}

/**
 * Comparateur déterministe pour ordonner les candidats de manière stable :
 * 1. Score de priorité décroissant
 * 2. Confiance des preuves décroissante
 * 3. Valeur business décroissante
 * 4. Titre alphabétique (tie-breaker stable)
 */
export function compareFeatureCandidates(a: FeatureCandidate, b: FeatureCandidate): number {
  if (b.scores.priorityScore !== a.scores.priorityScore) {
    return b.scores.priorityScore - a.scores.priorityScore;
  }
  if (b.scores.evidenceConfidence !== a.scores.evidenceConfidence) {
    return b.scores.evidenceConfidence - a.scores.evidenceConfidence;
  }
  if (b.scores.businessValue !== a.scores.businessValue) {
    return b.scores.businessValue - a.scores.businessValue;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Gèle récursivement un objet pour garantir l'immutabilité stricte
 */
export function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const value = (obj as Record<string, unknown>)[name];
    if (value && typeof value === 'object') {
      deepFreeze(value);
    }
  }

  return Object.freeze(obj);
}
