/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Urgency Engine: Temporal Urgency Assessment (IMMEDIATE, HIGH, NORMAL, LOW)
 */

import type { ProblemSeverity, ProblemUrgency, RegressionStatus, TrendStatus } from '../types.js';

export interface UrgencyAssessment {
  readonly urgency: ProblemUrgency;
  readonly reasoning: string;
}

export class UrgencyEngine {
  public assessUrgency(input: {
    readonly severity: ProblemSeverity;
    readonly regressionStatus: RegressionStatus;
    readonly trend: TrendStatus;
    readonly isBlockingCoreFlow: boolean;
  }): UrgencyAssessment {
    // Sévérité critique + bloquant ou régression confirmée -> IMMEDIATE
    if (
      (input.severity === 'CRITICAL' && input.isBlockingCoreFlow) ||
      (input.severity === 'CRITICAL' && input.regressionStatus === 'CONFIRMED')
    ) {
      return {
        urgency: 'IMMEDIATE',
        reasoning: 'Anomalie critique bloquant le parcours principal ou régression critique confirmée.'
      };
    }

    if (
      input.severity === 'CRITICAL' ||
      (input.severity === 'HIGH' && input.trend === 'GROWING') ||
      input.regressionStatus === 'CONFIRMED'
    ) {
      return {
        urgency: 'HIGH',
        reasoning: 'Problème de haute gravité ou à forte vélocité croissante.'
      };
    }

    if (input.severity === 'HIGH' || input.trend === 'EMERGING') {
      return {
        urgency: 'NORMAL',
        reasoning: 'Prise en charge dans le cycle standard d\'amélioration.'
      };
    }

    return {
      urgency: 'LOW',
      reasoning: 'Faible criticité, à traiter au fil de l\'eau.'
    };
  }
}
