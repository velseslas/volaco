/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Evolution Readiness Engine - Deterministic readiness status assessment
 *
 * Rules (deterministic, priority ordered):
 *  - BLOCKED      : any proposal has status BLOCKED
 *  - UNKNOWN      : state has incomplete sources (any dimension source = 'UNKNOWN')
 *  - READY        : security ≥ 70 AND codeQuality ≥ 60 AND no BLOCKED proposals
 *  - READY_WITH_RISK: security ≥ 50 AND codeQuality ≥ 40
 *  - NOT_READY    : security < 50 OR codeQuality < 40
 */

import type {
  ApplicationEvolutionState,
  EvolutionProposal,
  EvolutionReadinessStatus,
} from '../types.js';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const THRESHOLD_SECURITY_READY: number = 70;
const THRESHOLD_CODE_QUALITY_READY: number = 60;
const THRESHOLD_SECURITY_RISK: number = 50;
const THRESHOLD_CODE_QUALITY_RISK: number = 40;

function hasBlockedProposals(proposals: EvolutionProposal[]): boolean {
  return proposals.some((p) => p.status === 'BLOCKED');
}

function hasIncompleteState(state: ApplicationEvolutionState): boolean {
  return (
    state.reliability.source === 'UNKNOWN' ||
    state.security.source === 'UNKNOWN' ||
    state.codeQuality.source === 'UNKNOWN'
  );
}

/**
 * Assesses evolution readiness based on application state and current proposals.
 * Returns a deterministic EvolutionReadinessStatus with no invented values.
 */
export class EvolutionReadinessEngine {
  /**
   * Assesses the evolution readiness of the application.
   *
   * Priority order:
   * 1. BLOCKED — any proposal is in BLOCKED status
   * 2. UNKNOWN — critical state sources are missing
   * 3. READY — security ≥ 70, codeQuality ≥ 60, no blocked proposals
   * 4. READY_WITH_RISK — security ≥ 50, codeQuality ≥ 40
   * 5. NOT_READY — below minimum thresholds
   */
  public assess(
    state: ApplicationEvolutionState,
    proposals: EvolutionProposal[],
  ): EvolutionReadinessStatus {
    if (hasBlockedProposals(proposals)) {
      return 'BLOCKED';
    }

    if (hasIncompleteState(state)) {
      return 'UNKNOWN';
    }

    const security = state.security.value;
    const codeQuality = state.codeQuality.value;

    if (
      security >= THRESHOLD_SECURITY_READY &&
      codeQuality >= THRESHOLD_CODE_QUALITY_READY
    ) {
      return 'READY';
    }

    if (
      security >= THRESHOLD_SECURITY_RISK &&
      codeQuality >= THRESHOLD_CODE_QUALITY_RISK
    ) {
      return 'READY_WITH_RISK';
    }

    return 'NOT_READY';
  }
}
