/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature State Machine - Strict Lifecycle Transitions
 */

import type { FeatureOpportunityStatus } from '../types.js';

const ALLOWED_TRANSITIONS: Record<FeatureOpportunityStatus, readonly FeatureOpportunityStatus[]> = {
  DETECTED: ['VALIDATING', 'REJECTED'],
  VALIDATING: ['CANDIDATE', 'REJECTED'],
  CANDIDATE: ['PROPOSED', 'DEFERRED', 'REJECTED'],
  PROPOSED: ['USER_REVIEW', 'DEFERRED', 'REJECTED', 'ACCEPTED'],
  USER_REVIEW: ['ACCEPTED', 'REJECTED', 'DEFERRED', 'SUPERSEDED'],
  ACCEPTED: ['PLANNED', 'DEFERRED', 'REJECTED'],
  PLANNED: ['IMPLEMENTED', 'DEFERRED'],
  IMPLEMENTED: ['VALIDATED'],
  VALIDATED: ['MEASURED'],
  MEASURED: [],
  REJECTED: ['DETECTED'],
  DEFERRED: ['CANDIDATE', 'REJECTED'],
  SUPERSEDED: []
};

export class FeatureStateMachine {
  /**
   * Vérifie si une transition d'état est autorisée
   */
  public canTransition(from: FeatureOpportunityStatus, to: FeatureOpportunityStatus): boolean {
    if (from === to) {
      return true;
    }
    const allowed = ALLOWED_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  /**
   * Valide la transition et retourne une explication en cas de refus
   */
  public validateTransition(from: FeatureOpportunityStatus, to: FeatureOpportunityStatus): {
    readonly isAllowed: boolean;
    readonly reason?: string;
  } {
    if (this.canTransition(from, to)) {
      return { isAllowed: true };
    }

    return {
      isAllowed: false,
      reason: `Transition illégale de "${from}" vers "${to}". Transitions permises : ${(ALLOWED_TRANSITIONS[from] || []).join(', ') || 'aucune (état terminal)'}.`
    };
  }
}
