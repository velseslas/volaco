/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Feedback Classifier: Multi-class Deterministic Categorization of User Feedback
 */

import type { FeedbackCategory, UserSignal } from '../types.js';

export interface ClassificationResult {
  readonly category: FeedbackCategory;
  readonly confidence: number;
  readonly matchedKeywords: readonly string[];
}

export class FeedbackClassifier {
  /**
   * Détermine la catégorie principale d'un signal utilisateur avec un indice de confiance déterministe
   */
  public classify(signal: UserSignal): ClassificationResult {
    const text = (signal.normalizedText || signal.rawText).toLowerCase();
    const source = signal.source;

    if (source === 'error_runtime') {
      return {
        category: 'BUG',
        confidence: 0.95,
        matchedKeywords: ['source:error_runtime']
      };
    }

    if (source === 'telemetry') {
      if (text.includes('latence') || text.includes('slow')) {
        return {
          category: 'PERFORMANCE',
          confidence: 0.90,
          matchedKeywords: ['telemetry:slow']
        };
      }
      return {
        category: 'UX_PROBLEM',
        confidence: 0.85,
        matchedKeywords: ['telemetry:interaction']
      };
    }

    const bugMatches = this.findMatches(text, [
      'bug', 'erreur', 'crash', 'ne fonctionne pas', 'ne marche pas', 'bloqué', 'bloque',
      'cassé', 'exception', 'échec', 'fails', 'broken', 'stack', 'undefined is not',
      'cannot read properties', '500', '404', 'écran blanc', 'freeze'
    ]);

    const a11yMatches = this.findMatches(text, [
      'contraste', 'accessibilité', 'a11y', 'lecteur d\'écran', 'screen reader', 'aria',
      'clavier', 'focus', 'invisible', 'illisibilité', 'trop petit', 'mal voyant'
    ]);

    const perfMatches = this.findMatches(text, [
      'lent', 'lenteur', 'rame', 'lag', 'temps de chargement', 'freeze', 'infiniment',
      'latence', 'ralentit', 'performance', 'timeout', 'délai'
    ]);

    const requestMatches = this.findMatches(text, [
      'ajouter', 'ajout', 'souhaiterais', 'feature', 'fonctionnalité', 'serait utile',
      'serait bien', 'il manque', 'possibilité de', 'pourrait-on', 'suggestion',
      'export', 'import', 'filtre', 'trier', 'option'
    ]);

    const confusionMatches = this.findMatches(text, [
      'comprends pas', 'pas clair', 'comment faire', 'où trouver', 'perdu',
      'incompréhensible', 'sens de ce bouton', 'aide', 'guide'
    ]);

    const uxMatches = this.findMatches(text, [
      'ergonomie', 'difficile à utiliser', 'mal placé', 'clic', 'bouton', 'trop de clics',
      'disposition', 'menu caché', 'pas intuitif', 'mauvaise expérience', 'design'
    ]);

    // Priorités et pondérations déterministes
    if (bugMatches.length > 0) {
      return {
        category: 'BUG',
        confidence: Math.min(0.95, 0.60 + bugMatches.length * 0.10),
        matchedKeywords: bugMatches
      };
    }

    if (a11yMatches.length > 0) {
      return {
        category: 'ACCESSIBILITY',
        confidence: Math.min(0.90, 0.60 + a11yMatches.length * 0.10),
        matchedKeywords: a11yMatches
      };
    }

    if (perfMatches.length > 0) {
      return {
        category: 'PERFORMANCE',
        confidence: Math.min(0.90, 0.60 + perfMatches.length * 0.10),
        matchedKeywords: perfMatches
      };
    }

    if (requestMatches.length > 0) {
      return {
        category: 'FEATURE_REQUEST',
        confidence: Math.min(0.90, 0.60 + requestMatches.length * 0.10),
        matchedKeywords: requestMatches
      };
    }

    if (confusionMatches.length > 0) {
      return {
        category: 'CONFUSION',
        confidence: Math.min(0.85, 0.55 + confusionMatches.length * 0.10),
        matchedKeywords: confusionMatches
      };
    }

    if (uxMatches.length > 0) {
      return {
        category: 'UX_PROBLEM',
        confidence: Math.min(0.85, 0.55 + uxMatches.length * 0.10),
        matchedKeywords: uxMatches
      };
    }

    return {
      category: signal.category || 'UX_PROBLEM',
      confidence: 0.50,
      matchedKeywords: []
    };
  }

  private findMatches(text: string, patterns: readonly string[]): readonly string[] {
    const matches: string[] = [];
    for (const pat of patterns) {
      if (text.includes(pat)) {
        matches.push(pat);
      }
    }
    return matches;
  }
}
