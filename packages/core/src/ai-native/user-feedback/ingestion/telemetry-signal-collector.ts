/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Telemetry Signal Collector: Detection of Usage Anomalies and Rage Interactions
 */

import { computeSignalHash } from '../canonical.js';
import type { FeedbackCategory, UserSentiment, UserSignal } from '../types.js';
import { FeedbackNormalizer } from './feedback-normalizer.js';

export interface TelemetryEvent {
  readonly type: 'rage_click' | 'slow_request' | 'unhandled_rejection' | 'form_abandonment';
  readonly targetSelector?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly clickCount?: number | undefined;
  readonly url?: string | undefined;
  readonly userId?: string | undefined;
  readonly timestamp?: string | undefined;
}

export class TelemetrySignalCollector {
  private readonly normalizer = new FeedbackNormalizer();

  public collect(events: readonly TelemetryEvent[]): readonly UserSignal[] {
    if (!events || !Array.isArray(events)) {
      return [];
    }

    const signals: UserSignal[] = [];

    for (const ev of events) {
      let rawText = '';
      let category: FeedbackCategory = 'UX_PROBLEM';
      let sentiment: UserSentiment = 'ANNOYED';

      switch (ev.type) {
        case 'rage_click':
          rawText = `Rage-click répété (${ev.clickCount ?? 5} clics rapides) sur l'élément ${ev.targetSelector ?? 'inconnu'}`;
          category = 'UX_PROBLEM';
          sentiment = 'FRUSTRATED';
          break;
        case 'slow_request':
          rawText = `Latence excessive (${ev.durationMs ?? 3000}ms) détectée sur l'URL ${ev.url ?? '/'}`;
          category = 'PERFORMANCE';
          sentiment = 'FRUSTRATED';
          break;
        case 'unhandled_rejection':
          rawText = `Promesse non gérée rejetée lors de l'interaction sur ${ev.url ?? '/'}`;
          category = 'BUG';
          sentiment = 'FRUSTRATED';
          break;
        case 'form_abandonment':
          rawText = `Abandon de formulaire après interaction sur le sélecteur ${ev.targetSelector ?? 'form'}`;
          category = 'UX_PROBLEM';
          sentiment = 'NEUTRAL';
          break;
      }

      const normalized = this.normalizer.normalize(rawText);
      const timestamp = ev.timestamp && !isNaN(Date.parse(ev.timestamp))
        ? ev.timestamp
        : new Date().toISOString();

      const signalId = computeSignalHash({
        source: 'telemetry',
        rawText,
        userId: ev.userId,
        timestamp
      });

      signals.push({
        id: signalId,
        source: 'telemetry',
        category,
        rawText,
        normalizedText: normalized.normalizedText,
        sentiment,
        userId: ev.userId,
        url: ev.url,
        componentId: ev.targetSelector,
        timestamp,
        metadata: {
          telemetryType: ev.type,
          durationMs: ev.durationMs,
          clickCount: ev.clickCount
        }
      });
    }

    return signals;
  }
}
