/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Urgency Engine - Computes operational urgency and time-sensitivity
 */

import type { RecommendationType } from '../types.js';

export interface UrgencyFactors {
  type: RecommendationType;
  isBlocker: boolean;
  isRegression: boolean;
  userComplaintsCount: number;
}

export class StrategicUrgencyEngine {
  /**
   * Computes an urgency score between 0 and 100.
   */
  public computeUrgency(factors: UrgencyFactors): number {
    let baseUrgency = 40;

    if (factors.isBlocker) {
      baseUrgency = 95;
    } else if (factors.isRegression) {
      baseUrgency = 88;
    } else if (factors.type === 'FIX_SECURITY_RISK') {
      baseUrgency = 85;
    } else if (factors.type === 'FIX_CRITICAL_PROBLEM') {
      baseUrgency = 90;
    } else if (factors.type === 'IMPROVE_PERFORMANCE') {
      baseUrgency = 60;
    } else if (factors.type === 'BUILD_FEATURE') {
      baseUrgency = 50;
    } else if (factors.type === 'REDUCE_TECHNICAL_DEBT' || factors.type === 'REFACTOR') {
      baseUrgency = 35;
    } else if (factors.type === 'DEFER' || factors.type === 'MONITOR') {
      baseUrgency = 15;
    }

    // Boost urgency if there are multiple user signals
    const complaintBoost = Math.min(20, factors.userComplaintsCount * 5);
    return Math.min(100, Math.max(0, baseUrgency + complaintBoost));
  }
}
