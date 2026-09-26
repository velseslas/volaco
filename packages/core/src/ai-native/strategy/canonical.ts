/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * AI Strategy Optimizer Engine - Canonical Hashing & Deterministic Comparators
 */

import { createHash } from 'node:crypto';
import type {
  StrategicRecommendation,
  StrategicRoadmap,
  StrategyContext,
  StrategyOptimizationReport
} from './types.js';

/**
 * Computes a deterministic SHA-256 hash for a recommendation
 */
export function computeRecommendationHash(
  rec: Pick<StrategicRecommendation, 'type' | 'title' | 'tenantId' | 'projectId'> & { dependencies?: string[] }
): string {
  const deps = (rec.dependencies || []).slice().sort().join(',');
  const raw = `${rec.tenantId}#${rec.projectId}#${rec.type}#${rec.title.trim().toLowerCase()}#${deps}`;
  const sha = createHash('sha256').update(raw, 'utf8').digest('hex').substring(0, 16);
  return `rec:${sha}`;
}

/**
 * Computes a deterministic SHA-256 hash for a roadmap
 */
export function computeRoadmapHash(
  roadmap: Pick<StrategicRoadmap, 'tenantId' | 'projectId'> & { topologicalOrder?: string[] }
): string {
  const order = (roadmap.topologicalOrder || []).join(',');
  const raw = `${roadmap.tenantId}#${roadmap.projectId}#${order}`;
  const sha = createHash('sha256').update(raw, 'utf8').digest('hex').substring(0, 16);
  return `rdm:${sha}`;
}

/**
 * Computes a deterministic SHA-256 hash for a StrategyContext
 */
export function computeStrategyContextHash(ctx: Pick<StrategyContext, 'tenantId' | 'projectId'> & { inputHash?: string }): string {
  const raw = `${ctx.tenantId}#${ctx.projectId}#${ctx.inputHash || 'default'}`;
  const sha = createHash('sha256').update(raw, 'utf8').digest('hex').substring(0, 16);
  return `ctx:${sha}`;
}

/**
 * Computes a deterministic SHA-256 hash for a full strategy report
 */
export function computeStrategyReportHash(
  report: Pick<StrategyOptimizationReport, 'tenantId' | 'projectId' | 'overallStrategicScore'> & {
    recommendationIds?: string[];
  }
): string {
  const recs = (report.recommendationIds || []).slice().sort().join(',');
  const raw = `${report.tenantId}#${report.projectId}#${report.overallStrategicScore}#${recs}`;
  const sha = createHash('sha256').update(raw, 'utf8').digest('hex').substring(0, 16);
  return `srep:${sha}`;
}

/**
 * Strict deterministic comparator for ranking recommendations:
 * 1. Strategic score descending (highest score first)
 * 2. Urgency score descending
 * 3. Confidence descending
 * 4. Title alphabetical ascending
 * 5. ID alphabetical ascending
 */
export function compareRecommendations(
  a: Pick<StrategicRecommendation, 'id' | 'title' | 'strategicScore' | 'urgencyScore' | 'confidence'>,
  b: Pick<StrategicRecommendation, 'id' | 'title' | 'strategicScore' | 'urgencyScore' | 'confidence'>
): number {
  if (b.strategicScore !== a.strategicScore) {
    return b.strategicScore - a.strategicScore;
  }
  if (b.urgencyScore !== a.urgencyScore) {
    return b.urgencyScore - a.urgencyScore;
  }
  if (b.confidence !== a.confidence) {
    return b.confidence - a.confidence;
  }
  const titleCmp = a.title.localeCompare(b.title);
  if (titleCmp !== 0) return titleCmp;
  return a.id.localeCompare(b.id);
}

/**
 * Recursively deep freezes an object for strict immutability.
 */
export function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj as Readonly<T>;
}
