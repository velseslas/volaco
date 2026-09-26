/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Feedback-Feature Graph: Bipartite Bridge between User Feedback and Features
 */

import type { AggregatedProblem, FeedbackFeatureBridgeEdge, FeedbackFeatureBridgeNode, FeedbackFeatureGraph } from '../types.js';

export class FeedbackFeatureGraphBuilder {
  public buildGraph(problems: readonly AggregatedProblem[]): FeedbackFeatureGraph {
    const featureMap = new Map<string, {
      problemCount: number;
      bugCount: number;
      requestCount: number;
      highestPriorityScore: number;
    }>();

    const links: FeedbackFeatureBridgeEdge[] = [];

    for (const p of problems) {
      const features = p.impact.affectedFeatures.length > 0
        ? p.impact.affectedFeatures
        : ['Core Application'];

      for (const feat of features) {
        const stats = featureMap.get(feat) || {
          problemCount: 0,
          bugCount: 0,
          requestCount: 0,
          highestPriorityScore: 0
        };

        stats.problemCount++;
        if (p.category === 'BUG') stats.bugCount++;
        if (p.category === 'FEATURE_REQUEST') stats.requestCount++;
        if (p.scores.priorityScore > stats.highestPriorityScore) {
          stats.highestPriorityScore = p.scores.priorityScore;
        }

        featureMap.set(feat, stats);

        let relationship: 'REPORTED_ON' | 'FEATURE_REQUESTED' | 'UX_FLAW' = 'REPORTED_ON';
        if (p.category === 'FEATURE_REQUEST') {
          relationship = 'FEATURE_REQUESTED';
        } else if (p.category === 'UX_PROBLEM' || p.category === 'CONFUSION') {
          relationship = 'UX_FLAW';
        }

        links.push({
          problemId: p.id,
          featureId: feat,
          relationship
        });
      }
    }

    const featureNodes: FeedbackFeatureBridgeNode[] = Array.from(featureMap.entries()).map(([feat, stats]) => ({
      featureId: feat,
      problemCount: stats.problemCount,
      bugCount: stats.bugCount,
      requestCount: stats.requestCount,
      highestPriorityScore: stats.highestPriorityScore
    }));

    return {
      features: featureNodes,
      links
    };
  }
}
