/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Problem Analyzer - Analyzes user feedback, bugs, regressions and defects from AINT-015
 */

import type { StrategyContext, StrategyEvidence, RecommendationType } from '../types.js';
import type { AggregatedProblem } from '../../user-feedback/types.js';

export interface EvaluatedProblem {
  problemId: string;
  recommendationType: RecommendationType;
  title: string;
  description: string;
  severityScore: number; // 0-100
  urgencyScore: number; // 0-100
  isRegression: boolean;
  isBlocker: boolean;
  affectedUsersCount: number;
  evidence: StrategyEvidence[];
  effortPoints: number;
}

export class ProblemAnalyzer {
  /**
   * Analyzes problems present in the StrategyContext.
   */
  public analyze(context: StrategyContext): EvaluatedProblem[] {
    if (!context.feedbackReport || !context.feedbackReport.problems) {
      return [];
    }

    const results: EvaluatedProblem[] = [];

    for (const prob of context.feedbackReport.problems) {
      const isRegression = prob.subtype === 'REGRESSION' || prob.regressionStatus === 'CONFIRMED';
      const isCritical = prob.severity === 'CRITICAL';
      const isBlocker = isCritical || prob.urgency === 'IMMEDIATE';

      // Determine recommendation type
      let recType: RecommendationType = 'FIX_CRITICAL_PROBLEM';
      if (isRegression) {
        recType = 'FIX_REGRESSION';
      } else if (prob.category === 'UX_PROBLEM' || prob.category === 'CONFUSION') {
        recType = 'IMPROVE_UX';
      } else if (prob.category === 'PERFORMANCE') {
        recType = 'IMPROVE_PERFORMANCE';
      } else if (prob.category === 'ACCESSIBILITY') {
        recType = 'IMPROVE_ACCESSIBILITY';
      } else if (!isCritical && prob.severity === 'LOW') {
        recType = 'REDUCE_TECHNICAL_DEBT';
      }

      // Evidence extraction
      const evidence: StrategyEvidence[] = (prob.evidence || []).map((e, idx) => ({
        id: `ev-prb-${prob.id}-${idx}`,
        source: 'FEEDBACK' as const,
        description: e.description || `Signal d'anomalie: ${prob.title}`,
        confidence: typeof e.confidence === 'number' ? e.confidence : 0.9,
        provenanceType: 'FACT' as const,
        verifiableReference: `AINT-015:PROBLEM:${prob.id}`,
        dataPayload: { severity: prob.severity, category: prob.category }
      }));

      if (evidence.length === 0) {
        evidence.push({
          id: `ev-prb-${prob.id}-direct`,
          source: 'FEEDBACK' as const,
          description: `Rapport AINT-015: ${prob.description}`,
          confidence: 0.85,
          provenanceType: 'FACT' as const,
          verifiableReference: `AINT-015:${prob.id}`
        });
      }

      // Effort estimation: defects are typically XS (1) to M (3)
      let effortPoints = 2; // S by default
      if (isCritical) effortPoints = 3; // M
      if (prob.severity === 'LOW') effortPoints = 1; // XS

      const sevScore = prob.scores?.severityScore ?? (isCritical ? 95 : 60);
      const urgScore = prob.scores?.priorityScore ?? (isBlocker ? 90 : 50);

      results.push({
        problemId: prob.id,
        recommendationType: recType,
        title: `Corriger: ${prob.title}`,
        description: prob.description,
        severityScore: Math.min(100, Math.max(0, sevScore)),
        urgencyScore: Math.min(100, Math.max(0, urgScore)),
        isRegression,
        isBlocker,
        affectedUsersCount: prob.impact?.affectedUsersCount || 1,
        evidence,
        effortPoints
      });
    }

    return results;
  }
}
