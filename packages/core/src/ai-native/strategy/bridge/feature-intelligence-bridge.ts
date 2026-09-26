/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Feature Intelligence Bridge - Ingestion and bi-directional correlation with AINT-014
 */

import type { FeatureIntelligenceReport, FeatureCandidate } from '../../feature-intelligence/types.js';

export class StrategyFeatureIntelligenceBridge {
  /**
   * Extracts actionable opportunities from an AINT-014 FeatureIntelligenceReport.
   */
  public extractOpportunities(report?: FeatureIntelligenceReport): FeatureCandidate[] {
    if (!report || !report.opportunities) {
      return [];
    }
    return report.opportunities.filter(c => c.status !== 'REJECTED');
  }

  /**
   * Summarizes the feature landscape for the strategic context.
   */
  public summarizeLandscape(report?: FeatureIntelligenceReport): { total: number; highValueCount: number } {
    if (!report || !report.opportunities) {
      return { total: 0, highValueCount: 0 };
    }
    const highValueCount = report.opportunities.filter(c => (c.scores?.businessValue || 0) >= 75).length;
    return {
      total: report.opportunities.length,
      highValueCount
    };
  }
}
