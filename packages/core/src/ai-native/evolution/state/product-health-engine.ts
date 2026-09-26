/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Product Health Engine - Deterministic weighted health score computation
 *
 * Formula (deterministic, 0 Math.random()):
 *   overall = 0.15×reliability + 0.20×security + 0.10×ux + 0.10×performance
 *           + 0.15×architecture + 0.15×codeQuality + 0.05×featureHealth
 *           + 0.05×userSatisfaction + 0.05×strategicAlignment
 *   clamped 0..100
 */

import type {
  ApplicationEvolutionState,
  ProductHealthScore,
} from '../types.js';

// ---------------------------------------------------------------------------
// Weight constants — must sum to 1.0
// ---------------------------------------------------------------------------

const W_RELIABILITY: number = 0.15;
const W_SECURITY: number = 0.20;
const W_UX: number = 0.10;
const W_PERFORMANCE: number = 0.10;
const W_ARCHITECTURE: number = 0.15;
const W_CODE_QUALITY: number = 0.15;
const W_FEATURE_HEALTH: number = 0.05;
const W_USER_SATISFACTION: number = 0.05;
const W_STRATEGIC_ALIGNMENT: number = 0.05;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Computes a deterministic ProductHealthScore from an ApplicationEvolutionState.
 */
export class ProductHealthEngine {
  /**
   * Computes the overall product health score and individual dimension scores.
   * Formula is deterministic — no randomness, no LLM interpolation.
   */
  public compute(state: ApplicationEvolutionState): ProductHealthScore {
    const r = state.reliability.value;
    const s = state.security.value;
    const u = state.ux.value;
    const p = state.performance.value;
    const a = state.architecture.value;
    const c = state.codeQuality.value;
    const f = state.featureHealth.value;
    const us = state.userSatisfaction.value;
    const sa = state.strategicAlignment.value;

    const raw =
      W_RELIABILITY * r +
      W_SECURITY * s +
      W_UX * u +
      W_PERFORMANCE * p +
      W_ARCHITECTURE * a +
      W_CODE_QUALITY * c +
      W_FEATURE_HEALTH * f +
      W_USER_SATISFACTION * us +
      W_STRATEGIC_ALIGNMENT * sa;

    const overall = clamp(Math.round(raw), 0, 100);

    const rC = Math.round(W_RELIABILITY * r);
    const sC = Math.round(W_SECURITY * s);
    const uC = Math.round(W_UX * u);
    const pC = Math.round(W_PERFORMANCE * p);
    const aC = Math.round(W_ARCHITECTURE * a);
    const cC = Math.round(W_CODE_QUALITY * c);
    const fC = Math.round(W_FEATURE_HEALTH * f);
    const usC = Math.round(W_USER_SATISFACTION * us);
    const saC = Math.round(W_STRATEGIC_ALIGNMENT * sa);

    const mathematicalExplanation =
      `overall = clamp(` +
      `0.15×${r}(${rC}) + 0.20×${s}(${sC}) + 0.10×${u}(${uC}) + ` +
      `0.10×${p}(${pC}) + 0.15×${a}(${aC}) + 0.15×${c}(${cC}) + ` +
      `0.05×${f}(${fC}) + 0.05×${us}(${usC}) + 0.05×${sa}(${saC}), 0, 100) = ${overall}/100`;

    return {
      overall,
      reliability: r,
      security: s,
      ux: u,
      performance: p,
      architecture: a,
      codeQuality: c,
      featureHealth: f,
      userSatisfaction: us,
      strategicAlignment: sa,
      mathematicalExplanation,
    };
  }
}
