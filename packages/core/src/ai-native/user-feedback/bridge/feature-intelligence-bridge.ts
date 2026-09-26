/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Feature Intelligence Bridge: Feed AINT-014 with Real User Signals & Needs
 */

import type { FeatureEvidence } from '../../feature-intelligence/types.js';
import type { AggregatedProblem } from '../types.js';

export class FeatureIntelligenceBridge {
  /**
   * Convertit les demandes de fonctionnalités et problèmes ergonomiques en preuves pour AINT-014
   */
  public extractFeatureEvidences(problems: readonly AggregatedProblem[]): readonly FeatureEvidence[] {
    const evidences: FeatureEvidence[] = [];

    for (const prob of problems) {
      if (prob.category === 'FEATURE_REQUEST' || prob.category === 'UX_PROBLEM') {
        evidences.push({
          id: `evi-feedback-${prob.id}`,
          source: 'feedback',
          description: `Demande utilisateur issue du terrain (${prob.impact.affectedUsersCount} utilisateur(s)): ${prob.description}`,
          confidence: Math.min(1.0, prob.scores.confidenceScore / 100),
          references: prob.evidence.map(e => ({
            sourceId: e.id,
            filePath: e.filePath,
            line: e.line,
            selector: e.selector,
            detail: e.description,
            observedValue: e.observedValue
          }))
        });
      }
    }

    return evidences;
  }
}
