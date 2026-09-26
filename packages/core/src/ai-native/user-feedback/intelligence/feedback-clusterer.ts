/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Feedback Clusterer: Thematic & Component Grouping of Signals
 */

import type { FeedbackCategory, UserSignal } from '../types.js';

export interface ThematicCluster {
  readonly key: string;
  readonly category: FeedbackCategory;
  readonly signals: readonly UserSignal[];
  readonly representativeTitle: string;
}

export class FeedbackClusterer {
  /**
   * Regroupe les signaux par axe thématique (composant, URL, ou catégorie principale)
   */
  public clusterByTheme(signals: readonly UserSignal[]): readonly ThematicCluster[] {
    const groups = new Map<string, { category: FeedbackCategory; signals: UserSignal[]; title: string }>();

    for (const sig of signals) {
      const key = this.resolveClusterKey(sig);

      const existing = groups.get(key);
      if (existing) {
        existing.signals.push(sig);
      } else {
        groups.set(key, {
          category: sig.category,
          signals: [sig],
          title: this.deriveTitle(sig)
        });
      }
    }

    const clusters: ThematicCluster[] = [];
    for (const [key, val] of groups.entries()) {
      clusters.push({
        key,
        category: val.category,
        signals: val.signals,
        representativeTitle: val.title
      });
    }

    return clusters;
  }

  private resolveClusterKey(sig: UserSignal): string {
    if (sig.componentId) {
      return `comp:${sig.componentId.toLowerCase()}`;
    }
    if (sig.url) {
      return `url:${sig.url.toLowerCase()}`;
    }
    return `cat:${sig.category}:${this.extractMainKeyword(sig.normalizedText || sig.rawText)}`;
  }

  private extractMainKeyword(text: string): string {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    return words[0] || 'general';
  }

  private deriveTitle(sig: UserSignal): string {
    const text = (sig.normalizedText || sig.rawText).trim();
    if (text.length <= 60) {
      return text;
    }
    return `${text.substring(0, 57)}...`;
  }
}
