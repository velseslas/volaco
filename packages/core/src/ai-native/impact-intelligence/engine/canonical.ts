/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-005)
 * Canonicalization, Comparators, and Impact Hash Computation
 */

import { createHash } from 'node:crypto';
import { canonicalObject, canonicalSort, deepFreeze } from '../../context/engine/base.js';
import type {
  ImpactClassification,
  ImpactPath,
  ImpactRiskLevel,
  ImpactedNode,
  ResolvedTarget
} from '../types.js';

export { canonicalObject, canonicalSort, deepFreeze };

const CLASSIFICATION_PRIORITY: Record<ImpactClassification, number> = {
  BREAKING: 0,
  REGRESSION_RISK: 1,
  BEHAVIORAL: 2,
  INFORMATIONAL: 3
};

const RISK_LEVEL_PRIORITY: Record<ImpactRiskLevel, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3
};

/**
 * Deterministic comparator for ImpactedNode.
 * 1. depth ascending
 * 2. classification priority ascending (BREAKING > REGRESSION_RISK > BEHAVIORAL > INFORMATIONAL)
 * 3. riskLevel priority ascending (CRITICAL > HIGH > MEDIUM > LOW)
 * 4. node.kind ascending
 * 5. node.id ascending
 */
export function compareImpactNodes(a: ImpactedNode, b: ImpactedNode): number {
  if (a.depth !== b.depth) {
    return a.depth - b.depth;
  }
  const classDiff = CLASSIFICATION_PRIORITY[a.classification] - CLASSIFICATION_PRIORITY[b.classification];
  if (classDiff !== 0) {
    return classDiff;
  }
  const riskDiff = RISK_LEVEL_PRIORITY[a.riskLevel] - RISK_LEVEL_PRIORITY[b.riskLevel];
  if (riskDiff !== 0) {
    return riskDiff;
  }
  if (a.node.kind !== b.node.kind) {
    return a.node.kind.localeCompare(b.node.kind);
  }
  return a.node.id.localeCompare(b.node.id);
}

/**
 * Deterministic comparator for ImpactPath.
 * 1. length ascending
 * 2. step signature ascending
 */
export function compareImpactPaths(a: ImpactPath, b: ImpactPath): number {
  if (a.length !== b.length) {
    return a.length - b.length;
  }
  for (let i = 0; i < a.length; i++) {
    const stepA = a.steps[i]!;
    const stepB = b.steps[i]!;
    const sigA = `${stepA.fromNodeId}:${stepA.edgeKind}:${stepA.toNodeId}`;
    const sigB = `${stepB.fromNodeId}:${stepB.edgeKind}:${stepB.toNodeId}`;
    const cmp = sigA.localeCompare(sigB);
    if (cmp !== 0) {
      return cmp;
    }
  }
  return 0;
}

/**
 * Deterministic comparator for ResolvedTarget.
 * Sorts by matchedBy, then targetNode.id.
 */
export function compareResolvedTargets(a: ResolvedTarget, b: ResolvedTarget): number {
  if (a.matchedBy !== b.matchedBy) {
    return a.matchedBy.localeCompare(b.matchedBy);
  }
  return a.targetNode.id.localeCompare(b.targetNode.id);
}

/**
 * Computes deterministic SHA-256 hash over an ImpactAnalysis payload.
 * EXCLUDES volatile execution metadata: createdAt, durationMs, and impactHash.
 */
export function computeImpactHash(analysisPayload: Record<string, unknown>): string {
  const {
    createdAt: _discarded1,
    durationMs: _discarded2,
    impactHash: _discarded3,
    ...stableData
  } = analysisPayload;

  const canonical = canonicalObject(stableData);
  const jsonStr = JSON.stringify(canonical);
  return createHash('sha256').update(jsonStr).digest('hex');
}
