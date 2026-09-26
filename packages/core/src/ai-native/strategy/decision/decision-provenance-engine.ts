/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Decision Provenance Engine - Builds verifiable end-to-end provenance traces
 * 
 * Trace structure:
 * Recommendation → Evidence → Source → Reason → Score contribution → Decision
 */

import type { StrategicRecommendation, StrategyEvidence } from '../types.js';

export interface ProvenanceTraceStep {
  step: number;
  stage: 'EVIDENCE' | 'CORRELATION' | 'SCORING' | 'DECISION' | 'EXECUTION_PROJECTION';
  source: string;
  verifiableReference: string;
  description: string;
  weightOrContribution?: number;
}

export interface RecommendationProvenanceTrace {
  recommendationId: string;
  recommendationTitle: string;
  ruleSet: string;
  originHash: string;
  chain: ProvenanceTraceStep[];
  isFullyVerifiable: boolean;
}

export class DecisionProvenanceEngine {
  /**
   * Generates a complete, verifiable provenance trace for a recommendation.
   */
  public buildProvenanceTrace(rec: StrategicRecommendation): RecommendationProvenanceTrace {
    const chain: ProvenanceTraceStep[] = [];
    let stepCount = 1;

    // Stage 1: Underlying Evidence
    for (const ev of rec.evidence) {
      chain.push({
        step: stepCount++,
        stage: 'EVIDENCE',
        source: ev.source,
        verifiableReference: ev.verifiableReference,
        description: `Preuve observée (${ev.provenanceType}): ${ev.description} (confiance: ${Math.round(ev.confidence * 100)}%)`
      });
    }

    // Stage 2: Correlation with Problems / Opportunities / Audit Findings
    if (rec.supportingProblems.length > 0) {
      chain.push({
        step: stepCount++,
        stage: 'CORRELATION',
        source: 'AINT-015',
        verifiableReference: rec.supportingProblems.join(','),
        description: `Rapprochement avec ${rec.supportingProblems.length} problème(s) / régression(s) AINT-015.`
      });
    }

    if (rec.supportingOpportunities.length > 0) {
      chain.push({
        step: stepCount++,
        stage: 'CORRELATION',
        source: 'AINT-014',
        verifiableReference: rec.supportingOpportunities.join(','),
        description: `Rapprochement avec ${rec.supportingOpportunities.length} opportunité(s) produit AINT-014.`
      });
    }

    if (rec.supportingFindings.length > 0) {
      chain.push({
        step: stepCount++,
        stage: 'CORRELATION',
        source: 'AINT-013',
        verifiableReference: rec.supportingFindings.join(','),
        description: `Rapprochement avec ${rec.supportingFindings.length} anomalie(s) d audit qualité AINT-013.`
      });
    }

    // Stage 3: Scoring Formula Factors
    for (const factor of rec.scoreBreakdown.factors) {
      chain.push({
        step: stepCount++,
        stage: 'SCORING',
        source: 'StrategicScoreEngine',
        verifiableReference: `factor:${factor.name}`,
        description: `${factor.name} : score brut ${factor.rawScore}, pondération ${factor.weight} → contribution nette de ${factor.weightedContribution} pts.`,
        weightOrContribution: factor.weightedContribution
      });
    }

    // Stage 4: Strategic Decision
    chain.push({
      step: stepCount++,
      stage: 'DECISION',
      source: 'AINT-016 RecommendationEngine',
      verifiableReference: rec.id,
      description: `Recommandation émise au statut ${rec.status} pour l horizon ${rec.recommendedHorizon} (Score: ${rec.strategicScore}/100).`
    });

    // Stage 5: Execution Projection
    chain.push({
      step: stepCount++,
      stage: 'EXECUTION_PROJECTION',
      source: 'AINT-010 Orchestrator Bridge',
      verifiableReference: 'HUMAN_APPROVAL_REQUIRED',
      description: 'En attente d approbation humaine. Aucune mutation directe de code ne sera exécutée sans validation.'
    });

    const isFullyVerifiable = rec.evidenceStatus === 'VERIFIED' && rec.evidence.length > 0;

    return {
      recommendationId: rec.id,
      recommendationTitle: rec.title,
      ruleSet: rec.provenance.ruleSet,
      originHash: rec.provenance.hash,
      chain,
      isFullyVerifiable
    };
  }
}
