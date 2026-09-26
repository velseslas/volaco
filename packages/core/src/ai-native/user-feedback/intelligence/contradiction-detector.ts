/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Contradiction Detector: Modeling of Opposing Feedback & Non-arbitrary UX Arbitration
 */

import { createHash } from 'node:crypto';
import type { Role } from '../../../identity/permissions.js';
import type { ContradictoryFeedbackCluster, UserSignal } from '../types.js';

export class ContradictionDetector {
  /**
   * Analyse les signaux pour détecter les opinions divergentes ou contradictoires
   */
  public detectContradictions(signals: readonly UserSignal[]): readonly ContradictoryFeedbackCluster[] {
    if (!signals || signals.length < 2) {
      return [];
    }

    const topicMap = new Map<string, UserSignal[]>();

    for (const sig of signals) {
      const topic = this.resolveTopic(sig);
      if (!topicMap.has(topic)) {
        topicMap.set(topic, []);
      }
      topicMap.get(topic)!.push(sig);
    }

    const clusters: ContradictoryFeedbackCluster[] = [];

    for (const [topic, group] of topicMap.entries()) {
      if (group.length < 2) continue;

      const positiveSignals: UserSignal[] = [];
      const negativeSignals: UserSignal[] = [];

      for (const sig of group) {
        if (sig.sentiment === 'SATISFIED' || sig.sentiment === 'ENTHUSIASTIC') {
          positiveSignals.push(sig);
        } else if (sig.sentiment === 'FRUSTRATED' || sig.sentiment === 'ANNOYED' || sig.category === 'BUG') {
          negativeSignals.push(sig);
        }
      }

      if (positiveSignals.length > 0 && negativeSignals.length > 0) {
        const positiveRoles: Role[] = [];
        const negativeRoles: Role[] = [];

        for (const s of positiveSignals) {
          if (s.userRole && !positiveRoles.includes(s.userRole)) {
            positiveRoles.push(s.userRole);
          }
        }
        for (const s of negativeSignals) {
          if (s.userRole && !negativeRoles.includes(s.userRole)) {
            negativeRoles.push(s.userRole);
          }
        }

        const idHash = createHash('sha256').update(`contradiction:${topic}`, 'utf8').digest('hex').substring(0, 12);

        clusters.push({
          id: `cc-${idHash}`,
          topic,
          positiveCount: positiveSignals.length,
          negativeCount: negativeSignals.length,
          positiveRoles,
          negativeRoles,
          positiveSignals: positiveSignals.map(s => s.id),
          negativeSignals: negativeSignals.map(s => s.id),
          analysis: `Divergence d'appréciation constatée sur "${topic}" (${positiveSignals.length} favorable(s) vs ${negativeSignals.length} défavorable(s)). Différenciation observée selon les rôles: [${positiveRoles.join(', ') || 'Tous'}] vs [${negativeRoles.join(', ') || 'Tous'}].`,
          recommendation: `Ne pas trancher arbitrairement : envisager une option de configuration dans les préférences utilisateur ou une disposition adaptative par rôle.`
        });
      }
    }

    return clusters;
  }

  private resolveTopic(sig: UserSignal): string {
    if (sig.componentId) {
      return sig.componentId.toLowerCase();
    }
    if (sig.url) {
      return sig.url.toLowerCase();
    }

    const text = (sig.normalizedText || sig.rawText).toLowerCase();
    if (text.includes('vue compacte') || text.includes('densité') || text.includes('espacement')) {
      return 'densité-affichage';
    }
    if (text.includes('mode sombre') || text.includes('thème')) {
      return 'thématisation';
    }
    if (text.includes('menu') || text.includes('navigation') || text.includes('sidebar')) {
      return 'navigation';
    }

    const words = text.split(/\s+/).filter(w => w.length > 4);
    return words[0] || 'general';
  }
}
