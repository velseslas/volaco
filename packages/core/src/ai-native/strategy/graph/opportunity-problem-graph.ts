/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Opportunity-Problem Graph - Bipartite relationship mapping problems to solution recommendations
 */

import type { StrategicRecommendation } from '../types.js';

export interface ProblemSolutionLink {
  problemOrFindingId: string;
  sourceType: 'AINT-015-PROBLEM' | 'AINT-013-FINDING' | 'AINT-014-OPPORTUNITY';
  recommendationId: string;
  recommendationTitle: string;
  remedyType: 'DIRECT_FIX' | 'FEATURE_MITIGATION' | 'ARCHITECTURAL_CLEANUP';
}

export class OpportunityProblemGraph {
  /**
   * Maps all problems and audit findings to the recommendations that resolve them.
   */
  public mapProblemsToSolutions(recommendations: StrategicRecommendation[]): ProblemSolutionLink[] {
    const links: ProblemSolutionLink[] = [];

    for (const rec of recommendations) {
      for (const prbId of rec.supportingProblems) {
        links.push({
          problemOrFindingId: prbId,
          sourceType: 'AINT-015-PROBLEM',
          recommendationId: rec.id,
          recommendationTitle: rec.title,
          remedyType: rec.type.startsWith('FIX_') ? 'DIRECT_FIX' : 'FEATURE_MITIGATION'
        });
      }

      for (const findingId of rec.supportingFindings) {
        links.push({
          problemOrFindingId: findingId,
          sourceType: 'AINT-013-FINDING',
          recommendationId: rec.id,
          recommendationTitle: rec.title,
          remedyType: rec.type === 'REDUCE_TECHNICAL_DEBT' ? 'ARCHITECTURAL_CLEANUP' : 'DIRECT_FIX'
        });
      }

      for (const oppId of rec.supportingOpportunities) {
        links.push({
          problemOrFindingId: oppId,
          sourceType: 'AINT-014-OPPORTUNITY',
          recommendationId: rec.id,
          recommendationTitle: rec.title,
          remedyType: 'FEATURE_MITIGATION'
        });
      }
    }

    return links;
  }
}
