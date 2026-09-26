/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Effort Engine - Deterministic effort estimation based on category and scope
 *
 * Base effort per category (0-100) adjusted by complexity and affected components.
 * 0 Math.random() — fully deterministic.
 */

import type { EvolutionCategory } from '../types.js';

// ---------------------------------------------------------------------------
// Base effort scores per category (0-100)
// ---------------------------------------------------------------------------

const CATEGORY_BASE_EFFORT: Record<EvolutionCategory, number> = {
  BUG_REMEDIATION: 20,
  DOCUMENTATION: 15,
  DEPENDENCY_UPDATE: 25,
  ACCESSIBILITY: 30,
  OBSERVABILITY: 35,
  UX_IMPROVEMENT: 40,
  PERFORMANCE_OPTIMIZATION: 50,
  FEATURE_IMPROVEMENT: 55,
  TECH_DEBT_REDUCTION: 60,
  SECURITY_HARDENING: 65,
  REMOVE_FEATURE: 30,
  INVESTIGATE: 20,
  DEFER: 0,
  NEW_FEATURE: 70,
  ARCHITECTURE_IMPROVEMENT: 90,
};

function clamp100(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

// ---------------------------------------------------------------------------
// EffortEngine
// ---------------------------------------------------------------------------

/**
 * Estimates implementation effort (0..100) for an evolution proposal.
 *
 * Formula:
 *   base = CATEGORY_BASE_EFFORT[category]
 *   complexityPenalty = (complexity / 100) × 20
 *   componentPenalty  = min(affectedComponents.length × 3, 20)
 *   effort = clamp(base + complexityPenalty + componentPenalty, 0, 100)
 */
export class EffortEngine {
  /**
   * Estimates effort (0..100) based on category, complexity, and scope.
   *
   * - BUG_REMEDIATION and DOCUMENTATION start at low effort.
   * - ARCHITECTURE_IMPROVEMENT starts at maximum base effort.
   * - Complexity and number of affected components add penalty (max +40 combined).
   */
  public estimate(
    category: EvolutionCategory,
    complexity: number,
    affectedComponents: string[],
  ): number {
    const base = CATEGORY_BASE_EFFORT[category];
    const complexityPenalty = (Math.min(100, Math.max(0, complexity)) / 100) * 20;
    const componentPenalty = Math.min(affectedComponents.length * 3, 20);

    return clamp100(base + complexityPenalty + componentPenalty);
  }
}
