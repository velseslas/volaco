/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Sentiment Classifier: Deterministic Tone and Frustration Analysis
 */

import type { UserSentiment, UserSignal } from '../types.js';

export interface SentimentAnalysisResult {
  readonly sentiment: UserSentiment;
  readonly score: number; // -1.0 (très négatif) à +1.0 (très positif)
  readonly isFrustrated: boolean;
}

export class SentimentClassifier {
  public analyze(signal: UserSignal): SentimentAnalysisResult {
    const text = (signal.normalizedText || signal.rawText).toLowerCase();

    const frustratedWords = [
      'impossible', 'inadmissible', 'horrible', 'inacceptable', 'bloqué', 'furieux',
      'désastre', 'marre', 'perte de temps', 'urgent', 'catastrophe', 'catastrophique'
    ];

    const annoyedWords = [
      'pénible', 'embêtant', 'dommage', 'décevant', 'lent', 'bizarre', 'péniblement',
      'frustrant', 'lourd', 'pas top', 'fatigant', 'complexe', 'agaçant'
    ];

    const satisfiedWords = [
      'bien', 'super', 'merci', 'génial', 'bravo', 'utile', 'top', 'appréciable',
      'clair', 'rapide', 'intuitif', 'propre', 'parfait', 'efficace'
    ];

    const enthusiasticWords = [
      'incroyable', 'exceptionnel', 'adore', 'formidable', 'extraordinaire', 'fantastique'
    ];

    let negativeCount = 0;
    let frustratedCount = 0;
    let positiveCount = 0;
    let enthusiasticCount = 0;

    for (const w of frustratedWords) {
      if (text.includes(w)) frustratedCount++;
    }
    for (const w of annoyedWords) {
      if (text.includes(w)) negativeCount++;
    }
    for (const w of satisfiedWords) {
      if (text.includes(w)) positiveCount++;
    }
    for (const w of enthusiasticWords) {
      if (text.includes(w)) enthusiasticCount++;
    }

    if (signal.source === 'error_runtime') {
      frustratedCount += 2;
    }

    if (frustratedCount > 0) {
      const score = Math.max(-1.0, -0.60 - frustratedCount * 0.15);
      return {
        sentiment: 'FRUSTRATED',
        score,
        isFrustrated: true
      };
    }

    if (negativeCount > 0) {
      const score = Math.max(-0.60, -0.20 - negativeCount * 0.10);
      return {
        sentiment: 'ANNOYED',
        score,
        isFrustrated: false
      };
    }

    if (enthusiasticCount > 0) {
      const score = Math.min(1.0, 0.70 + enthusiasticCount * 0.15);
      return {
        sentiment: 'ENTHUSIASTIC',
        score,
        isFrustrated: false
      };
    }

    if (positiveCount > 0) {
      const score = Math.min(0.70, 0.20 + positiveCount * 0.10);
      return {
        sentiment: 'SATISFIED',
        score,
        isFrustrated: false
      };
    }

    return {
      sentiment: signal.sentiment || 'NEUTRAL',
      score: 0.0,
      isFrustrated: false
    };
  }
}
