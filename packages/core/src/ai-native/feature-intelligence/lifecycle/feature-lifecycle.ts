/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature Lifecycle - Applies Transitions and Tracks History
 */

import type { FeatureCandidate, FeatureOpportunityStatus } from '../types.js';
import { FeatureStateMachine } from './feature-state-machine.js';

export class FeatureLifecycle {
  private readonly stateMachine = new FeatureStateMachine();

  /**
   * Applique une transition d'état sur un candidat et enregistre la provenance dans l'historique
   */
  public transition(
    candidate: FeatureCandidate,
    newStatus: FeatureOpportunityStatus,
    reason?: string,
    userId?: string
  ): FeatureCandidate {
    const validation = this.stateMachine.validateTransition(candidate.status, newStatus);
    if (!validation.isAllowed) {
      throw new Error(validation.reason);
    }

    const now = new Date().toISOString();
    const transitionRecord = {
      fromStatus: candidate.status,
      toStatus: newStatus,
      timestamp: now,
      reason: reason || `Transition vers ${newStatus}`,
      userId
    };

    return {
      ...candidate,
      status: newStatus,
      updatedAt: now,
      history: [...candidate.history, transitionRecord]
    };
  }
}
