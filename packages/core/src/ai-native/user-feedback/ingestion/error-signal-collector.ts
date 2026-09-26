/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Error Signal Collector: Ingestion and Normalization of Runtime Exceptions
 */

import { computeSignalHash } from '../canonical.js';
import type { RawErrorSignal, UserSignal } from '../types.js';
import { FeedbackNormalizer } from './feedback-normalizer.js';

export class ErrorSignalCollector {
  private readonly normalizer = new FeedbackNormalizer();

  /**
   * Convertit une liste d'erreurs runtime brutes en signaux UserSignal vérifiés
   */
  public collect(errors: readonly RawErrorSignal[]): readonly UserSignal[] {
    if (!errors || !Array.isArray(errors)) {
      return [];
    }

    const signals: UserSignal[] = [];

    for (const err of errors) {
      if (!err || !err.message || typeof err.message !== 'string') {
        continue;
      }

      const raw = err.stack ? `${err.message}\n${err.stack}` : err.message;
      const normalized = this.normalizer.normalize(raw);
      const timestamp = err.timestamp && !isNaN(Date.parse(err.timestamp))
        ? err.timestamp
        : new Date().toISOString();

      const signalId = computeSignalHash({
        source: 'error_runtime',
        rawText: raw,
        userId: 'system-runtime',
        timestamp
      });

      signals.push({
        id: signalId,
        source: 'error_runtime',
        category: 'BUG',
        rawText: raw,
        normalizedText: normalized.normalizedText,
        sentiment: 'FRUSTRATED',
        userId: 'system-runtime',
        url: err.url,
        componentId: err.component,
        timestamp,
        metadata: {
          errorCodes: normalized.detectedErrorCodes,
          hasStack: Boolean(err.stack)
        }
      });
    }

    return signals;
  }
}
