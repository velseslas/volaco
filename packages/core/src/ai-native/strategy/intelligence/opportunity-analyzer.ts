/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Opportunity Analyzer - Evaluates feature opportunities from AINT-014 for strategic alignment
 */

import type { StrategyContext, StrategyEvidence, RecommendationType } from '../types.js';
import type { FeatureCandidate } from '../../feature-intelligence/types.js';

export interface EvaluatedOpportunity {
  candidateId: string;
  recommendationType: RecommendationType;
  title: string;
  description: string;
  strategicValue: number; // 0-100
  urgency: number; // 0-100
  feasibility: number; // 0-100
  evidence: StrategyEvidence[];
  dependencies: string[];
  effortPoints: number;
}

export class OpportunityAnalyzer {
  /**
   * Analyzes opportunities present in the StrategyContext.
   */
  public analyze(context: StrategyContext): EvaluatedOpportunity[] {
    if (!context.featureReport || !context.featureReport.opportunities) {
      return [];
    }

    const results: EvaluatedOpportunity[] = [];

    for (const cand of context.featureReport.opportunities) {
      // Map candidate category to RecommendationType
      let recType: RecommendationType = 'BUILD_FEATURE';
      if (cand.category === 'PRODUCT_EXPANSION') {
        recType = 'EXTEND_FEATURE';
      } else if (cand.category === 'ARCHITECTURE') {
        recType = 'REFACTOR';
      } else if (cand.category === 'UX_IMPROVEMENT') {
        recType = 'IMPROVE_UX';
      } else if (cand.category === 'DESIGN_HARMONY') {
        recType = 'IMPROVE_DESIGN_HARMONY';
      }

      // Convert candidate evidence into StrategyEvidence
      const evidence: StrategyEvidence[] = (cand.evidence || []).map((e, idx) => ({
        id: `ev-opp-${cand.id}-${idx}`,
        source: 'FEATURE' as const,
        description: e.description || `Opportunité détectée: ${cand.title}`,
        confidence: typeof e.confidence === 'number' ? e.confidence : 0.8,
        provenanceType: 'CORRELATION' as const,
        verifiableReference: `AINT-014:${cand.id}`,
        dataPayload: { category: cand.category, scores: cand.scores }
      }));

      // If no evidence was attached, synthesize verifiable reference to candidate
      if (evidence.length === 0) {
        evidence.push({
          id: `ev-opp-${cand.id}-base`,
          source: 'FEATURE' as const,
          description: `Spécification fonctionnelle AINT-014: ${cand.description}`,
          confidence: 0.75,
          provenanceType: 'CORRELATION' as const,
          verifiableReference: `AINT-014:CANDIDATE:${cand.id}`
        });
      }

      // Calculate strategic value
      const bizVal = cand.scores?.businessValue ?? 70;
      const userUrg = cand.scores?.userImpact ?? 50;
      const feasibility = cand.scores?.architecturalFeasibility ?? 80;
      const strategicVal = Math.round(0.6 * bizVal + 0.2 * userUrg + 0.2 * feasibility);

      // Map effort to points
      let effortPoints = 3;
      const effortStr = cand.impact?.estimatedEffort || 'M';
      if (effortStr === 'XS') effortPoints = 1;
      else if (effortStr === 'S') effortPoints = 2;
      else if (effortStr === 'M') effortPoints = 3;
      else if (effortStr === 'L') effortPoints = 5;
      else if (effortStr === 'XL') effortPoints = 8;

      results.push({
        candidateId: cand.id,
        recommendationType: recType,
        title: cand.title,
        description: cand.description,
        strategicValue: Math.min(100, Math.max(0, strategicVal)),
        urgency: Math.min(100, Math.max(0, userUrg)),
        feasibility: Math.min(100, Math.max(0, feasibility)),
        evidence,
        dependencies: cand.impact?.dependencies ? [...cand.impact.dependencies] : [],
        effortPoints
      });
    }

    return results;
  }
}
