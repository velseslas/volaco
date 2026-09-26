/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * Canonicalization, Deterministic Comparators, and Understanding Hashing
 */

import { createHash } from 'node:crypto';
import { canonicalObject, canonicalSort, deepFreeze } from '../../context/engine/base.js';
import type {
  ArchitecturalBoundary,
  SemanticApi,
  SemanticBusinessRule,
  SemanticComponent,
  SemanticDataFlow,
  SemanticDomain,
  SemanticEntryPoint,
  SemanticFeature,
  SemanticService,
  SemanticUserJourney,
  SemanticWorkflow
} from '../types.js';

export { canonicalObject, canonicalSort, deepFreeze };

export function compareFeatures(a: SemanticFeature, b: SemanticFeature): number {
  return a.featureId.localeCompare(b.featureId);
}

export function compareDomains(a: SemanticDomain, b: SemanticDomain): number {
  return a.domainId.localeCompare(b.domainId);
}

export function compareWorkflows(a: SemanticWorkflow, b: SemanticWorkflow): number {
  return a.workflowId.localeCompare(b.workflowId);
}

export function compareJourneys(a: SemanticUserJourney, b: SemanticUserJourney): number {
  return a.journeyId.localeCompare(b.journeyId);
}

export function compareDataFlows(a: SemanticDataFlow, b: SemanticDataFlow): number {
  return a.flowId.localeCompare(b.flowId);
}

export function compareBusinessRules(a: SemanticBusinessRule, b: SemanticBusinessRule): number {
  return a.ruleId.localeCompare(b.ruleId);
}

export function compareComponents(a: SemanticComponent, b: SemanticComponent): number {
  return a.id.localeCompare(b.id);
}

export function compareServices(a: SemanticService, b: SemanticService): number {
  return a.id.localeCompare(b.id);
}

export function compareApis(a: SemanticApi, b: SemanticApi): number {
  return a.id.localeCompare(b.id);
}

export function compareEntryPoints(a: SemanticEntryPoint, b: SemanticEntryPoint): number {
  return a.path.localeCompare(b.path);
}

export function compareBoundaries(a: ArchitecturalBoundary, b: ArchitecturalBoundary): number {
  return a.name.localeCompare(b.name);
}

/**
 * Computes a deterministic SHA-256 hash over an ApplicationSemanticModel payload.
 * EXCLUDES volatile execution metadata: createdAt, durationMs, and understandingHash.
 */
export function computeUnderstandingHash(modelPayload: Record<string, unknown>): string {
  const {
    createdAt: _discarded1,
    durationMs: _discarded2,
    understandingHash: _discarded3,
    metrics: rawMetrics,
    ...stableData
  } = modelPayload;

  let stableMetrics = rawMetrics;
  if (rawMetrics && typeof rawMetrics === 'object') {
    const { durationMs: _discardedMetricsDuration, ...restMetrics } = rawMetrics as Record<string, unknown>;
    stableMetrics = restMetrics;
  }

  const canonical = canonicalObject({
    ...stableData,
    ...(stableMetrics !== undefined ? { metrics: stableMetrics } : {})
  });
  const jsonStr = JSON.stringify(canonical);
  return createHash('sha256').update(jsonStr).digest('hex');
}
