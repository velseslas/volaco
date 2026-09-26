/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Feedback Graph: Relational Modeling of User Signals
 */

import type { FeedbackGraph, FeedbackGraphEdge, FeedbackGraphNode, UserSignal } from '../types.js';
import { DuplicateDetector } from '../intelligence/duplicate-detector.js';

export class FeedbackGraphBuilder {
  private readonly duplicateDetector = new DuplicateDetector();

  public buildGraph(signals: readonly UserSignal[]): FeedbackGraph {
    const nodes: FeedbackGraphNode[] = signals.map(s => ({
      id: s.id,
      category: s.category,
      sentiment: s.sentiment,
      timestamp: s.timestamp
    }));

    const edges: FeedbackGraphEdge[] = [];

    // Relier les signaux présentant une forte similarité
    for (let i = 0; i < signals.length; i++) {
      for (let j = i + 1; j < signals.length; j++) {
        const sigA = signals[i];
        const sigB = signals[j];
        if (!sigA || !sigB) continue;

        const similarity = this.duplicateDetector.computeSimilarity(sigA, sigB);
        if (similarity >= 0.50) {
          edges.push({
            fromSignalId: sigA.id,
            toSignalId: sigB.id,
            similarity: Math.round(similarity * 100) / 100,
            reason: `Similarité thématique et lexicale (${Math.round(similarity * 100)}%)`
          });
        }
      }
    }

    return {
      nodes,
      edges
    };
  }
}
