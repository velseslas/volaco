/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Feedback Normalizer: Sanitization, Text Normalization & Metadata Extraction
 */

export interface NormalizedFeedback {
  readonly normalizedText: string;
  readonly detectedUrls: readonly string[];
  readonly detectedSelectors: readonly string[];
  readonly detectedErrorCodes: readonly string[];
}

export class FeedbackNormalizer {
  /**
   * Normalise un texte brut de retour utilisateur ou journal d'erreur :
   * - Supprime les caractères invisibles / de contrôle
   * - Réduit les espaces multiples
   * - Extrait les URLs, sélecteurs CSS et codes d'erreur
   */
  public normalize(raw: string): NormalizedFeedback {
    if (!raw || typeof raw !== 'string') {
      return {
        normalizedText: '',
        detectedUrls: [],
        detectedSelectors: [],
        detectedErrorCodes: []
      };
    }

    // Retirer les caractères de contrôle sauf saut de ligne
    let cleaned = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');

    // Extraire les URLs (http, https, /path)
    const urlMatches = cleaned.match(/https?:\/\/[^\s)]+|\/[a-zA-Z0-9_\-\/]+/g) ?? [];
    const detectedUrls = Array.from(new Set(urlMatches));

    // Extraire les sélecteurs potentiels (#id, .class, [data-*])
    const selectorMatches = cleaned.match(/(?:#|\.)[a-zA-Z0-9_\-]+|\[data-[a-zA-Z0-9_\-]+(?:="[^"]*")?\]/g) ?? [];
    const detectedSelectors = Array.from(new Set(selectorMatches));

    // Extraire les erreurs communes (TypeError, 404, 500, ERR_*, etc.)
    const errorMatches = cleaned.match(/\b(?:TypeError|ReferenceError|SyntaxError|NetworkError|ERR_[A-Z0-9_]+|HTTP\s*(?:400|401|403|404|500|502|503))\b/gi) ?? [];
    const detectedErrorCodes = Array.from(new Set(errorMatches));

    // Normaliser les espaces consécutifs
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return {
      normalizedText: cleaned,
      detectedUrls,
      detectedSelectors,
      detectedErrorCodes
    };
  }
}
