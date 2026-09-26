/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Value Engine - Deterministic user/business/technical value computation
 *
 * Rules:
 * - USER_DEMAND / FEEDBACK evidence → userValue contribution
 * - FACT → +30, CORRELATION → +20, HYPOTHESIS → +5 (per evidence item)
 * - All values clamped 0..100
 */

import type { EvolutionEvidence, EvolutionCategory } from '../types.js';

// ---------------------------------------------------------------------------
// Evidence contribution constants
// ---------------------------------------------------------------------------

const FACT_CONTRIBUTION: number = 30;
const CORRELATION_CONTRIBUTION: number = 20;
const HYPOTHESIS_CONTRIBUTION: number = 5;

function evidenceContribution(type: EvolutionEvidence['type']): number {
  switch (type) {
    case 'FACT': return FACT_CONTRIBUTION;
    case 'CORRELATION': return CORRELATION_CONTRIBUTION;
    case 'HYPOTHESIS': return HYPOTHESIS_CONTRIBUTION;
  }
}

function clamp100(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Category-based base scores
// ---------------------------------------------------------------------------

function categoryUserValueBase(category: EvolutionCategory): number {
  switch (category) {
    case 'BUG_REMEDIATION': return 60;
    case 'UX_IMPROVEMENT': return 70;
    case 'ACCESSIBILITY': return 65;
    case 'NEW_FEATURE': return 55;
    case 'FEATURE_IMPROVEMENT': return 60;
    case 'PERFORMANCE_OPTIMIZATION': return 50;
    case 'SECURITY_HARDENING': return 40;
    case 'ARCHITECTURE_IMPROVEMENT': return 25;
    case 'TECH_DEBT_REDUCTION': return 20;
    case 'OBSERVABILITY': return 15;
    case 'DEPENDENCY_UPDATE': return 10;
    case 'DOCUMENTATION': return 15;
    case 'REMOVE_FEATURE': return 30;
    case 'INVESTIGATE': return 10;
    case 'DEFER': return 5;
  }
}

function categoryBusinessValueBase(category: EvolutionCategory): number {
  switch (category) {
    case 'BUG_REMEDIATION': return 50;
    case 'SECURITY_HARDENING': return 75;
    case 'NEW_FEATURE': return 65;
    case 'FEATURE_IMPROVEMENT': return 55;
    case 'ARCHITECTURE_IMPROVEMENT': return 60;
    case 'TECH_DEBT_REDUCTION': return 50;
    case 'PERFORMANCE_OPTIMIZATION': return 55;
    case 'UX_IMPROVEMENT': return 50;
    case 'ACCESSIBILITY': return 40;
    case 'OBSERVABILITY': return 45;
    case 'DEPENDENCY_UPDATE': return 35;
    case 'DOCUMENTATION': return 25;
    case 'REMOVE_FEATURE': return 20;
    case 'INVESTIGATE': return 15;
    case 'DEFER': return 5;
  }
}

function categoryTechnicalValueBase(category: EvolutionCategory): number {
  switch (category) {
    case 'ARCHITECTURE_IMPROVEMENT': return 80;
    case 'TECH_DEBT_REDUCTION': return 75;
    case 'SECURITY_HARDENING': return 70;
    case 'OBSERVABILITY': return 65;
    case 'DEPENDENCY_UPDATE': return 55;
    case 'PERFORMANCE_OPTIMIZATION': return 60;
    case 'BUG_REMEDIATION': return 50;
    case 'REMOVE_FEATURE': return 40;
    case 'FEATURE_IMPROVEMENT': return 35;
    case 'NEW_FEATURE': return 30;
    case 'DOCUMENTATION': return 30;
    case 'UX_IMPROVEMENT': return 20;
    case 'ACCESSIBILITY': return 20;
    case 'INVESTIGATE': return 10;
    case 'DEFER': return 0;
  }
}

// ---------------------------------------------------------------------------
// ValueEngine
// ---------------------------------------------------------------------------

/**
 * Computes deterministic user, business, and technical value scores.
 *
 * Base value comes from category; evidence contributions are additive and clamped.
 * FACT evidence contributes +30, CORRELATION +20, HYPOTHESIS +5 per item.
 */
export class ValueEngine {
  /**
   * Computes user-facing value (0..100).
   *
   * Higher for UX/FEEDBACK/ACCESSIBILITY evidence.
   * FEEDBACK and CONVERSATION sources receive a 1.5× multiplier on contribution.
   */
  public computeUserValue(
    evidence: EvolutionEvidence[],
    category: EvolutionCategory,
  ): number {
    const base = categoryUserValueBase(category);
    let bonus = 0;

    for (const e of evidence) {
      const contribution = evidenceContribution(e.type);
      const multiplier =
        e.source === 'FEEDBACK' || e.source === 'CONVERSATION' ? 1.5 : 1.0;
      bonus += contribution * multiplier;
    }

    return clamp100(base + bonus * 0.3);
  }

  /**
   * Computes business value (0..100).
   *
   * Higher for SECURITY/NEW_FEATURE/STRATEGY evidence.
   * STRATEGY and DNA sources receive a 1.5× multiplier.
   */
  public computeBusinessValue(
    evidence: EvolutionEvidence[],
    category: EvolutionCategory,
  ): number {
    const base = categoryBusinessValueBase(category);
    let bonus = 0;

    for (const e of evidence) {
      const contribution = evidenceContribution(e.type);
      const multiplier =
        e.source === 'STRATEGY' || e.source === 'DNA' ? 1.5 : 1.0;
      bonus += contribution * multiplier;
    }

    return clamp100(base + bonus * 0.3);
  }

  /**
   * Computes technical value (0..100).
   *
   * Higher for ARCHITECTURE/TECH_DEBT categories.
   * AUDIT source receives a 1.5× multiplier.
   */
  public computeTechnicalValue(
    evidence: EvolutionEvidence[],
    category: EvolutionCategory,
  ): number {
    const base = categoryTechnicalValueBase(category);
    let bonus = 0;

    for (const e of evidence) {
      const contribution = evidenceContribution(e.type);
      const multiplier = e.source === 'AUDIT' ? 1.5 : 1.0;
      bonus += contribution * multiplier;
    }

    return clamp100(base + bonus * 0.3);
  }
}
