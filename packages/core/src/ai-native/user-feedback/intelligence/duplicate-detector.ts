/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Duplicate Detector: Fuzzy and Exact Signal Deduplication
 */

import type { UserSignal } from '../types.js';

export interface DuplicateCluster {
  readonly canonicalSignal: UserSignal;
  readonly duplicateSignals: readonly UserSignal[];
  readonly similarityScore: number;
}

export class DuplicateDetector {
  /**
   * Regroupe les signaux identiques ou fortement similaires en clusters dédupliqués
   */
  public clusterDuplicates(signals: readonly UserSignal[], threshold = 0.70): readonly DuplicateCluster[] {
    if (!signals || signals.length === 0) {
      return [];
    }

    const clusters: { canonical: UserSignal; duplicates: UserSignal[]; maxSim: number }[] = [];

    for (const signal of signals) {
      let matchedClusterIndex = -1;
      let highestSimilarity = 0;

      for (let i = 0; i < clusters.length; i++) {
        const targetCluster = clusters[i];
        if (!targetCluster) continue;

        const sim = this.computeSimilarity(signal, targetCluster.canonical);
        if (sim >= threshold && sim > highestSimilarity) {
          highestSimilarity = sim;
          matchedClusterIndex = i;
        }
      }

      if (matchedClusterIndex !== -1) {
        const matched = clusters[matchedClusterIndex];
        if (matched) {
          matched.duplicates.push(signal);
          if (highestSimilarity > matched.maxSim) {
            matched.maxSim = highestSimilarity;
          }
        }
      } else {
        clusters.push({
          canonical: signal,
          duplicates: [],
          maxSim: 1.0
        });
      }
    }

    return clusters.map(c => ({
      canonicalSignal: c.canonical,
      duplicateSignals: c.duplicates,
      similarityScore: c.duplicates.length > 0 ? c.maxSim : 1.0
    }));
  }

  /**
   * Calcule la similarité déterministe (Jaccard sur tokens normalisés + composant/url)
   */
  public computeSimilarity(a: UserSignal, b: UserSignal): number {
    const sameTarget = Boolean(
      (a.componentId && b.componentId && a.componentId === b.componentId) ||
      (a.url && b.url && a.url === b.url)
    );

    const tokensA = this.tokenize(a.normalizedText || a.rawText);
    const tokensB = this.tokenize(b.normalizedText || b.rawText);

    if (tokensA.size === 0 || tokensB.size === 0) {
      return sameTarget ? 0.80 : 0.0;
    }

    let intersectionCount = 0;
    for (const token of tokensA) {
      if (tokensB.has(token)) {
        intersectionCount++;
      }
    }

    const unionCount = new Set([...tokensA, ...tokensB]).size;
    const jaccard = unionCount > 0 ? intersectionCount / unionCount : 0;

    if (sameTarget && a.category === b.category) {
      return Math.min(1.0, jaccard + 0.35);
    }

    return jaccard;
  }

  private tokenize(text: string): Set<string> {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9_\-\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
    return new Set(words);
  }
}
