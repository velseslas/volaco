/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Signal Ingestor: Central Gateway for Ingestion, Validation and Preprocessing
 */

import { computeSignalHash } from '../canonical.js';
import type { FeedbackAnalysisRequest, RawErrorSignal, UserSignal } from '../types.js';
import { FeedbackNormalizer } from './feedback-normalizer.js';
import { ErrorSignalCollector } from './error-signal-collector.js';
import { ConversationSignalCollector } from './conversation-signal-collector.js';

export class SignalIngestor {
  private readonly normalizer = new FeedbackNormalizer();
  private readonly errorCollector = new ErrorSignalCollector();
  private readonly conversationCollector = new ConversationSignalCollector();

  /**
   * Ingère et valide l'ensemble des sources hétérogènes d'une requête d'analyse
   */
  public ingest(request: FeedbackAnalysisRequest): readonly UserSignal[] {
    const results: UserSignal[] = [];

    // 1. Signaux structurés déjà fournis
    if (request.signals && Array.isArray(request.signals)) {
      for (const sig of request.signals) {
        if (sig && typeof sig.rawText === 'string' && sig.rawText.trim().length > 0) {
          const norm = this.normalizer.normalize(sig.rawText);
          results.push({
            ...sig,
            normalizedText: sig.normalizedText || norm.normalizedText,
            timestamp: sig.timestamp || '2026-01-01T00:00:00.000Z'
          });
        }
      }
    }

    // 2. Retours texte bruts
    if (request.rawFeedbacks && Array.isArray(request.rawFeedbacks)) {
      for (const raw of request.rawFeedbacks) {
        if (typeof raw === 'string' && raw.trim().length > 0) {
          const norm = this.normalizer.normalize(raw);
          const id = computeSignalHash({
            source: 'user_report',
            rawText: raw
          });

          results.push({
            id,
            source: 'user_report',
            category: this.guessCategory(raw),
            rawText: raw,
            normalizedText: norm.normalizedText,
            sentiment: this.guessSentiment(raw),
            timestamp: '2026-01-01T00:00:00.000Z'
          });
        }
      }
    }

    // 3. Erreurs runtime
    if (request.errors && Array.isArray(request.errors)) {
      const errorSignals = this.errorCollector.collect(request.errors);
      results.push(...errorSignals);
    }

    // 4. Tours de conversation
    if (request.conversationTurns && Array.isArray(request.conversationTurns)) {
      const convSignals = this.conversationCollector.collect(request.conversationTurns);
      results.push(...convSignals);
    }

    // 5. Findings d'audit qualité critique (AINT-013)
    if (request.auditReport && request.auditReport.findings) {
      for (const finding of request.auditReport.findings) {
        if (finding.severity === 'CRITICAL' || finding.severity === 'HIGH') {
          const raw = `[Audit ${finding.dimension}] ${finding.title}: ${finding.description}`;
          const norm = this.normalizer.normalize(raw);
          const timestamp = request.auditReport.createdAt || '2026-01-01T00:00:00.000Z';
          const id = computeSignalHash({
            source: 'audit_finding',
            rawText: raw
          });

          results.push({
            id,
            source: 'audit_finding',
            category: finding.dimension === 'ACCESSIBILITY' ? 'ACCESSIBILITY' : 'BUG',
            rawText: raw,
            normalizedText: norm.normalizedText,
            sentiment: 'NEUTRAL',
            url: finding.location?.filePath,
            componentId: finding.location?.selector,
            timestamp,
            metadata: {
              auditFindingId: finding.id,
              severity: finding.severity,
              dimension: finding.dimension
            }
          });
        }
      }
    }

    return results;
  }

  private guessCategory(text: string): 'BUG' | 'FEATURE_REQUEST' | 'UX_PROBLEM' | 'PERFORMANCE' {
    const lower = text.toLowerCase();
    if (lower.includes('bug') || lower.includes('erreur') || lower.includes('crash') || lower.includes('bloqué') || lower.includes('plante')) {
      return 'BUG';
    }
    if (lower.includes('ajouter') || lower.includes('souhait') || lower.includes('serait top') || lower.includes('feature') || lower.includes('export')) {
      return 'FEATURE_REQUEST';
    }
    if (lower.includes('lent') || lower.includes('rame') || lower.includes('performance') || lower.includes('délai')) {
      return 'PERFORMANCE';
    }
    return 'UX_PROBLEM';
  }

  private guessSentiment(text: string): 'FRUSTRATED' | 'ANNOYED' | 'NEUTRAL' | 'SATISFIED' {
    const lower = text.toLowerCase();
    if (lower.includes('impossible') || lower.includes('horrible') || lower.includes('inacceptable') || lower.includes('furieux')) {
      return 'FRUSTRATED';
    }
    if (lower.includes('pénible') || lower.includes('embêtant') || lower.includes('dommage') || lower.includes('décevant')) {
      return 'ANNOYED';
    }
    if (lower.includes('super') || lower.includes('merci') || lower.includes('génial') || lower.includes('bravo')) {
      return 'SATISFIED';
    }
    return 'NEUTRAL';
  }
}
