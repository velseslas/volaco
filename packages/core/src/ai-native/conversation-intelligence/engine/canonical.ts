/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Canonicalization & Conversation State Hashing
 */

import { createHash } from 'node:crypto';
import { canonicalObject, canonicalSort, deepFreeze } from '../../context/engine/base.js';
import type {
  ArchitecturalDecisionRecord,
  ConversationAssumption,
  EngineeringPlan,
  PlanStep
} from '../types.js';

export { canonicalObject, canonicalSort, deepFreeze };

export function compareAssumptions(a: ConversationAssumption, b: ConversationAssumption): number {
  return a.id.localeCompare(b.id);
}

export function compareDecisions(a: ArchitecturalDecisionRecord, b: ArchitecturalDecisionRecord): number {
  return a.decisionId.localeCompare(b.decisionId);
}

export function comparePlanSteps(a: PlanStep, b: PlanStep): number {
  return a.stepIndex - b.stepIndex;
}

/**
 * Computes a deterministic SHA-256 hash over an engineering plan.
 */
export function computeEngineeringPlanHash(plan: Omit<EngineeringPlan, 'planHash'>): string {
  const canonical = canonicalObject(plan);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export const computePlanHash = computeEngineeringPlanHash;

/**
 * Computes a deterministic 16-character trace identifier.
 */
export function computeTraceId(sessionId: string, turnId: string): string {
  return createHash('sha256').update(`${sessionId}:${turnId}`).digest('hex').slice(0, 16);
}

/**
 * Computes a deterministic SHA-256 hash over a conversation state snapshot or values.
 * Excludes volatile timing fields (timestamp, durationMs, createdAt).
 */
export function computeConversationStateHash(
  stateOrPayload: Record<string, unknown> | string,
  ...extra: unknown[]
): string {
  if (typeof stateOrPayload === 'string') {
    const combined = [stateOrPayload, ...extra.map((e) => String(e))].join(':');
    return createHash('sha256').update(combined).digest('hex');
  }

  const sanitize = (val: unknown): unknown => {
    if (!val || typeof val !== 'object') return val;
    if (Array.isArray(val)) return val.map(sanitize);
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (['timestamp', 'durationMs', 'createdAt'].includes(k)) continue;
      result[k] = sanitize(v);
    }
    return result;
  };

  const sanitized = sanitize(stateOrPayload);
  const canonical = canonicalObject(sanitized);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
