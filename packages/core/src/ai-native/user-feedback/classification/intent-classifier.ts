/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Intent Classifier: Extraction of Underlying User Intent
 */

import type { UserSignal } from '../types.js';

export type UserIntentType =
  | 'REPORT_DEFECT'
  | 'REQUEST_FEATURE'
  | 'SEEK_GUIDANCE'
  | 'EXPRESS_OPINION'
  | 'DISPUTE_CHANGE';

export interface UserIntentResult {
  readonly intent: UserIntentType;
  readonly confidence: number;
  readonly description: string;
}

export class IntentClassifier {
  public classifyIntent(signal: UserSignal): UserIntentResult {
    const text = (signal.normalizedText || signal.rawText).toLowerCase();

    if (signal.source === 'error_runtime' || signal.category === 'BUG') {
      return {
        intent: 'REPORT_DEFECT',
        confidence: 0.95,
        description: 'L\'utilisateur ou le système signale une anomalie technique à corriger.'
      };
    }

    if (
      text.includes('préférais avant') ||
      text.includes('remettez') ||
      text.includes('pourquoi avoir changé') ||
      text.includes('l\'ancienne version était mieux')
    ) {
      return {
        intent: 'DISPUTE_CHANGE',
        confidence: 0.85,
        description: 'L\'utilisateur conteste une modification récente de l\'interface ou du comportement.'
      };
    }

    if (signal.category === 'FEATURE_REQUEST') {
      return {
        intent: 'REQUEST_FEATURE',
        confidence: 0.90,
        description: 'L\'utilisateur suggère un ajout ou une extension de capacité fonctionnelle.'
      };
    }

    if (
      text.includes('comment') ||
      text.includes('où est') ||
      text.includes('aide') ||
      text.includes('je ne comprends pas')
    ) {
      return {
        intent: 'SEEK_GUIDANCE',
        confidence: 0.80,
        description: 'L\'utilisateur cherche de l\'assistance ou des explications sur l\'usage.'
      };
    }

    return {
      intent: 'EXPRESS_OPINION',
      confidence: 0.65,
      description: 'L\'utilisateur partage son appréciation ou avis subjectif sur l\'application.'
    };
  }
}
