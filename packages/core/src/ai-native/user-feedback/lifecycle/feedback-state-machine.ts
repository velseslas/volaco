/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Feedback State Machine: Strict Lifecycle Validation & Transition Rules
 */

import type { ProblemStatus } from '../types.js';

const ALLOWED_TRANSITIONS: Readonly<Record<ProblemStatus, readonly ProblemStatus[]>> = {
  DETECTED: ['CLASSIFIED', 'REJECTED', 'DUPLICATE'],
  CLASSIFIED: ['CORRELATED', 'REJECTED', 'DUPLICATE', 'CONTRADICTORY'],
  CORRELATED: ['CONFIRMED', 'REJECTED', 'DEFERRED'],
  CONFIRMED: ['PRIORITIZED', 'PLANNED', 'DEFERRED', 'WONT_FIX'],
  PRIORITIZED: ['PLANNED', 'DEFERRED', 'WONT_FIX'],
  PLANNED: ['IN_PROGRESS', 'DEFERRED'],
  IN_PROGRESS: ['RESOLVED', 'PLANNED'],
  RESOLVED: ['VERIFIED', 'IN_PROGRESS'],
  VERIFIED: ['IN_PROGRESS'],
  REJECTED: ['DETECTED', 'CLASSIFIED'],
  DUPLICATE: ['DETECTED'],
  CONTRADICTORY: ['CONFIRMED', 'DEFERRED', 'WONT_FIX'],
  DEFERRED: ['PLANNED', 'PRIORITIZED', 'DETECTED'],
  WONT_FIX: ['DETECTED', 'PLANNED']
};

export class FeedbackStateMachine {
  public static isValidTransition(from: ProblemStatus, to: ProblemStatus): boolean {
    if (from === to) {
      return true;
    }
    const allowed = ALLOWED_TRANSITIONS[from];
    return Boolean(allowed && allowed.includes(to));
  }

  public static assertValidTransition(from: ProblemStatus, to: ProblemStatus): void {
    if (!this.isValidTransition(from, to)) {
      throw new Error(`Transition d'état invalide pour le problème: de "${from}" vers "${to}".`);
    }
  }

  public static getAllowedTransitions(from: ProblemStatus): readonly ProblemStatus[] {
    return ALLOWED_TRANSITIONS[from] ?? [];
  }
}
