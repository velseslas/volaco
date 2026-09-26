/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Feedback Bridge - Ingestion and priority mapping with AINT-015
 */

import type { UserFeedbackReport, AggregatedProblem } from '../../user-feedback/types.js';

export class StrategyFeedbackBridge {
  /**
   * Extracts active user defects, regressions, and frustrations from AINT-015.
   */
  public extractActiveProblems(report?: UserFeedbackReport): AggregatedProblem[] {
    if (!report || !report.problems) {
      return [];
    }
    return report.problems.filter(p => p.status !== 'RESOLVED' && p.status !== 'WONT_FIX');
  }

  /**
   * Identifies if any blocking regression exists that should automatically preempt features.
   */
  public hasCriticalRegression(report?: UserFeedbackReport): boolean {
    if (!report || !report.problems) return false;
    return report.problems.some(
      p => (p.subtype === 'REGRESSION' || p.regressionStatus === 'CONFIRMED') && (p.severity === 'CRITICAL' || p.severity === 'HIGH')
    );
  }
}
