/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Conversation Signal Collector: Extraction of User Feedback from Chat Turns
 */

import type { ConversationTurn } from '../types.js';
import { computeSignalHash } from '../canonical.js';
import type { FeedbackCategory, UserSentiment, UserSignal } from '../types.js';
import { FeedbackNormalizer } from './feedback-normalizer.js';

export class ConversationSignalCollector {
  private readonly normalizer = new FeedbackNormalizer();

  /**
   * Extrait les signaux de feedback ou signalements d'erreurs depuis les tours de conversation
   */
  public collect(turns: readonly ConversationTurn[]): readonly UserSignal[] {
    if (!turns || !Array.isArray(turns)) {
      return [];
    }

    const signals: UserSignal[] = [];

    for (const turn of turns) {
      if (!turn.userMessage || !turn.userMessage.content) {
        continue;
      }

      const text = turn.userMessage.content.trim();
      if (text.length < 5) {
        continue;
      }

      const lower = text.toLowerCase();
      let category: FeedbackCategory | undefined;
      let sentiment: UserSentiment = 'NEUTRAL';

      if (
        lower.includes('bug') ||
        lower.includes('erreur') ||
        lower.includes('ne marche pas') ||
        lower.includes('plante') ||
        lower.includes('cassé') ||
        lower.includes('broken') ||
        lower.includes('crash') ||
        lower.includes('fails')
      ) {
        category = 'BUG';
        sentiment = 'FRUSTRATED';
      } else if (
        lower.includes('ajouter') ||
        lower.includes('il faudrait') ||
        lower.includes('serait bien') ||
        lower.includes('feature') ||
        lower.includes('pouvoir faire') ||
        lower.includes('pourrait-on') ||
        lower.includes('souhaiterais')
      ) {
        category = 'FEATURE_REQUEST';
        sentiment = 'NEUTRAL';
      } else if (
        lower.includes('difficile') ||
        lower.includes('pas clair') ||
        lower.includes('bizarre') ||
        lower.includes('inconfortable') ||
        lower.includes('confus') ||
        lower.includes('perdu')
      ) {
        category = 'UX_PROBLEM';
        sentiment = 'ANNOYED';
      } else if (
        lower.includes('lent') ||
        lower.includes('rame') ||
        lower.includes('lag') ||
        lower.includes('freeze')
      ) {
        category = 'PERFORMANCE';
        sentiment = 'FRUSTRATED';
      }

      if (category) {
        const normalized = this.normalizer.normalize(text);
        const timestamp = turn.userMessage.timestamp && !isNaN(Date.parse(turn.userMessage.timestamp))
          ? turn.userMessage.timestamp
          : new Date().toISOString();

        const signalId = computeSignalHash({
          source: 'conversation',
          rawText: text,
          userId: turn.intent?.goal || 'user-chat',
          timestamp
        });

        signals.push({
          id: signalId,
          source: 'conversation',
          category,
          rawText: text,
          normalizedText: normalized.normalizedText,
          sentiment,
          timestamp,
          metadata: {
            conversationTurnIndex: turn.turnIndex,
            intentCategory: turn.intent?.category
          }
        });
      }
    }

    return signals;
  }
}
