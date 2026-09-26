/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Risk Engine - Deterministic risk computation based on blast radius and scope
 *
 * compute(): category base + blast radius weighted
 * computeChangeRisk(): blastRadius×0.40 + nbDependencies×5 (cap 30) + nbComponents×3 (cap 30)
 * All values clamped 0..100. 0 Math.random().
 */

import type { EvolutionCategory, EvolutionProposal } from '../types.js';

// ---------------------------------------------------------------------------
// Base risk scores per category (0-100)
// ---------------------------------------------------------------------------

const CATEGORY_BASE_RISK: Record<EvolutionCategory, number> = {
  BUG_REMEDIATION: 15,
  DOCUMENTATION: 5,
  DEPENDENCY_UPDATE: 30,
  ACCESSIBILITY: 10,
  OBSERVABILITY: 10,
  UX_IMPROVEMENT: 15,
  PERFORMANCE_OPTIMIZATION: 25,
  FEATURE_IMPROVEMENT: 20,
  TECH_DEBT_REDUCTION: 30,
  SECURITY_HARDENING: 35,
  REMOVE_FEATURE: 40,
  INVESTIGATE: 5,
  DEFER: 0,
  NEW_FEATURE: 25,
  ARCHITECTURE_IMPROVEMENT: 60,
};

function clamp100(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function safeArray(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

function safeNumber(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return fallback;
}

function extractRecord(raw: unknown): Record<string, unknown> {
  if (raw !== null && raw !== undefined && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

// ---------------------------------------------------------------------------
// RiskEngine
// ---------------------------------------------------------------------------

/**
 * Computes implementation risk (0..100) deterministically.
 *
 * - compute(): category base + blast radius contribution
 * - computeChangeRisk(): weighted formula over blast radius, dependencies, components
 */
export class RiskEngine {
  /**
   * Computes risk (0..100) from category and blast radius.
   *
   * Formula:
   *   base = CATEGORY_BASE_RISK[category]
   *   blastPenalty = blastRadius × 0.40
   *   componentPenalty = min(affectedComponents.length × 2, 20)
   *   risk = clamp(base × 0.6 + blastPenalty + componentPenalty, 0, 100)
   */
  public compute(
    category: EvolutionCategory,
    blastRadius: number,
    affectedComponents: string[],
  ): number {
    const base = CATEGORY_BASE_RISK[category];
    const blastPenalty = Math.min(100, Math.max(0, blastRadius)) * 0.40;
    const componentPenalty = Math.min(affectedComponents.length * 2, 20);

    return clamp100(base * 0.6 + blastPenalty + componentPenalty);
  }

  /**
   * Computes change risk for a partial proposal.
   *
   * Formula:
   *   changeRisk = blastRadius × 0.40
   *             + min(nbDependencies × 5, 30)
   *             + min(nbAffectedComponents × 3, 30)
   *   clamped 0..100
   */
  public computeChangeRisk(proposal: Partial<EvolutionProposal>): number {
    const p = extractRecord(proposal);

    const blastRadius = safeNumber(p['blastRadius'], 0);
    const dependencies = safeArray(p['dependencies']);
    const affectedComponents = safeArray(p['affectedComponents']);

    const blastContrib = Math.min(100, Math.max(0, blastRadius)) * 0.40;
    const depContrib = Math.min(dependencies.length * 5, 30);
    const compContrib = Math.min(affectedComponents.length * 3, 30);

    return clamp100(blastContrib + depContrib + compContrib);
  }
}
