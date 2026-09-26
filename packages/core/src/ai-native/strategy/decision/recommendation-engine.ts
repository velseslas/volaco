/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Recommendation Engine - Constructs fully-evidenced, prioritized strategic recommendations
 * 
 * Strict Invariants:
 * - NO EVIDENCE → NO CLAIM: checks evidence strength and marks INSUFFICIENT_EVIDENCE if missing or unverified.
 * - DETERMINISTIC: pure mathematical computation, zero random.
 */

import { computeRecommendationHash } from '../canonical.js';
import type {
  StrategicRecommendation,
  StrategyContext,
  StrategyEvidence,
  RoadmapHorizon
} from '../types.js';
import type { RawStrategicCandidate } from '../intelligence/strategic-signal-aggregator.js';
import { StrategicConfidenceEngine } from './decision-confidence-engine.js';
import { StrategicScoreEngine } from '../prioritization/strategic-score-engine.js';
import { DecisionRationaleEngine } from './decision-rationale-engine.js';

export class StrategicRecommendationEngine {
  private readonly confidenceEngine = new StrategicConfidenceEngine();
  private readonly scoreEngine = new StrategicScoreEngine();
  private readonly rationaleEngine = new DecisionRationaleEngine();

  /**
   * Constructs fully qualified StrategicRecommendation objects from raw candidates.
   */
  public buildRecommendations(
    candidates: RawStrategicCandidate[],
    context: StrategyContext
  ): StrategicRecommendation[] {
    const recommendations: StrategicRecommendation[] = [];

    for (const cand of candidates) {
      // 1. Evaluate Confidence
      const confidence = this.confidenceEngine.computeConfidence(cand.evidence);

      // 2. Strict Check: NO EVIDENCE → NO CLAIM
      let evidenceStatus: 'VERIFIED' | 'INSUFFICIENT_EVIDENCE' | 'CORRELATED' = 'VERIFIED';
      if (!cand.evidence || cand.evidence.length === 0 || confidence < 0.25) {
        evidenceStatus = 'INSUFFICIENT_EVIDENCE';
      } else if (cand.evidence.some(e => e.provenanceType === 'FACT')) {
        evidenceStatus = 'VERIFIED';
      } else {
        evidenceStatus = 'CORRELATED';
      }

      // 3. Compute Deterministic Strategic Score
      const scoreBreakdown = this.scoreEngine.computeScore({
        valueScore: cand.valueScore,
        urgencyScore: cand.urgencyScore,
        riskScore: cand.riskScore,
        effortPoints: cand.effortPoints,
        confidence,
        isRegression: cand.isRegression,
        isBlocker: cand.isBlocker,
        severityOrGapScore: cand.severityOrGapScore
      });

      // 4. Generate Rationale & Alternatives
      const { rationale, consequencesIfIgnored, alternatives } = this.rationaleEngine.generate(
        cand.type,
        cand.title,
        cand.isRegression,
        cand.isBlocker,
        scoreBreakdown.strategicScore
      );

      // 5. Generate Deterministic ID & Provenance Hash
      const hash = computeRecommendationHash({
        type: cand.type,
        title: cand.title,
        tenantId: context.tenantId,
        projectId: context.projectId,
        dependencies: cand.dependencies
      });
      const id = hash.replace('rec:', 'strat-rec-');

      // Estimated hours based on points
      const estimatedHours = cand.effortPoints * 3;

      const rec: StrategicRecommendation = {
        id,
        tenantId: context.tenantId,
        projectId: context.projectId,
        type: cand.type,
        title: cand.title,
        description: cand.description,

        strategicScore: scoreBreakdown.strategicScore,
        valueScore: cand.valueScore,
        riskScore: cand.riskScore,
        effortScore: scoreBreakdown.effortScore,
        urgencyScore: cand.urgencyScore,
        confidence,
        scoreBreakdown,

        expectedValue: cand.expectedValue,
        userImpact: cand.userImpact,
        technicalImpact: cand.technicalImpact,
        businessImpact: cand.businessImpact,

        risk: {
          severity: cand.riskSeverity,
          blastRadius: cand.blastRadius,
          mitigation: cand.mitigation
        },
        effort: {
          level: cand.effortLevel,
          points: cand.effortPoints,
          estimatedHours
        },
        dependencies: cand.dependencies,

        evidence: cand.evidence,
        evidenceStatus,
        supportingProblems: cand.supportingProblems,
        supportingOpportunities: cand.supportingOpportunities,
        supportingFindings: cand.supportingFindings,

        rationale,
        alternatives,
        consequencesIfIgnored,

        recommendedHorizon: 'LATER' as RoadmapHorizon,
        recommendedSequence: 0,
        status: 'RECOMMENDED',

        provenance: {
          origin: 'AINT-016:StrategicRecommendationEngine',
          ruleSet: 'VIBECODE-STRATEGY-V1',
          hash
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      recommendations.push(rec);
    }

    return recommendations;
  }
}
