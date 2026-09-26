/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Recommendation Lifecycle Manager - Governs status transitions with strict RBAC enforcement
 * 
 * Strict Invariant: HUMAN CONTROL.
 * Transition to APPROVED or REJECTED requires explicit human action with PROJECT_UPDATE permission.
 */

import { assertPermission } from '../../../identity/permissions.js';
import type { Role } from '../../../identity/permissions.js';
import type {
  RecommendationStatus,
  StrategicRecommendation,
  StrategicMemoryEntry
} from '../types.js';

export interface StatusTransitionRecord {
  recommendationId: string;
  previousStatus: RecommendationStatus;
  newStatus: RecommendationStatus;
  reason: string;
  performedByRole: Role;
  timestamp: string;
}

export class RecommendationLifecycleManager {
  private readonly validTransitions: Record<RecommendationStatus, RecommendationStatus[]> = {
    RECOMMENDED: ['APPROVED', 'REJECTED', 'PLANNED'],
    APPROVED: ['PLANNED', 'EXECUTING', 'REJECTED'],
    REJECTED: ['RECOMMENDED'],
    PLANNED: ['EXECUTING', 'REJECTED'],
    EXECUTING: ['COMPLETED', 'REJECTED'],
    COMPLETED: []
  };

  /**
   * Transitions a recommendation to a new status with RBAC check.
   */
  public transition(
    recommendation: StrategicRecommendation,
    newStatus: RecommendationStatus,
    role: Role,
    reason: string,
    requestId: string
  ): { updatedRecommendation: StrategicRecommendation; transitionRecord: StatusTransitionRecord; memoryEntry: StrategicMemoryEntry } {
    // 1. RBAC: Changing recommendation state requires PROJECT_UPDATE
    assertPermission(role, 'PROJECT_UPDATE', requestId);

    // 2. Validate transition
    const allowed = this.validTransitions[recommendation.status] || [];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Transition de statut invalide pour la recommandation ${recommendation.id}: ${recommendation.status} -> ${newStatus}`
      );
    }

    const previousStatus = recommendation.status;
    const now = new Date().toISOString();

    const updatedRecommendation: StrategicRecommendation = {
      ...recommendation,
      status: newStatus,
      updatedAt: now
    };

    const transitionRecord: StatusTransitionRecord = {
      recommendationId: recommendation.id,
      previousStatus,
      newStatus,
      reason,
      performedByRole: role,
      timestamp: now
    };

    const memoryAction = newStatus === 'APPROVED' ? 'APPROVED' : newStatus === 'REJECTED' ? 'REJECTED' : newStatus === 'COMPLETED' ? 'COMPLETED' : 'DEFERRED';

    const memoryEntry: StrategicMemoryEntry = {
      id: `mem-${recommendation.id}-${Date.now()}`,
      tenantId: recommendation.tenantId,
      projectId: recommendation.projectId,
      recommendationId: recommendation.id,
      action: memoryAction,
      reason,
      contextHash: recommendation.provenance.hash,
      timestamp: now,
      recordedByRole: role
    };

    return { updatedRecommendation, transitionRecord, memoryEntry };
  }
}
