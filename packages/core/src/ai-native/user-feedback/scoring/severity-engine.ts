/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Severity Engine: Intrinsic Defect Gravity & Severity Scoring
 */

import type { BugSubtype, ProblemSeverity, UserSignal } from '../types.js';

export interface SeverityAssessment {
  readonly severity: ProblemSeverity;
  readonly severityScore: number; // 0 - 100
  readonly reasoning: string;
}

export class SeverityEngine {
  public assessSeverity(
    signals: readonly UserSignal[],
    subtype?: BugSubtype
  ): SeverityAssessment {
    if (!signals || signals.length === 0) {
      return {
        severity: 'LOW',
        severityScore: 25,
        reasoning: 'Aucun signal pour évaluer la sévérité.'
      };
    }

    // 1. Crash ou corruption de données ou bloquant sécurité -> CRITICAL
    if (subtype === 'CRASH' || subtype === 'STATE_CORRUPTION') {
      return {
        severity: 'CRITICAL',
        severityScore: 100,
        reasoning: 'Interruption fatale ou corruption d\'état critique.'
      };
    }

    let hasCriticalIndicator = false;
    let hasHighIndicator = false;

    for (const sig of signals) {
      const text = (sig.normalizedText || sig.rawText).toLowerCase();
      if (
        text.includes('sécurité') ||
        text.includes('faille') ||
        text.includes('perte de données') ||
        text.includes('bloquant') ||
        text.includes('auth impossible')
      ) {
        hasCriticalIndicator = true;
      } else if (
        sig.category === 'BUG' ||
        subtype === 'NETWORK' ||
        subtype === 'REGRESSION' ||
        sig.sentiment === 'FRUSTRATED'
      ) {
        hasHighIndicator = true;
      }
    }

    if (hasCriticalIndicator) {
      return {
        severity: 'CRITICAL',
        severityScore: 100,
        reasoning: 'Indicateur critique bloquant détecté dans les signaux.'
      };
    }

    if (hasHighIndicator) {
      return {
        severity: 'HIGH',
        severityScore: 75,
        reasoning: 'Défaut fonctionnel significatif ou régression affectant l\'usage normal.'
      };
    }

    const hasMedium = signals.some(
      s => s.category === 'PERFORMANCE' || s.category === 'UX_PROBLEM' || s.sentiment === 'ANNOYED'
    );

    if (hasMedium) {
      return {
        severity: 'MEDIUM',
        severityScore: 50,
        reasoning: 'Anomalie ergonomique ou de performance sans blocage strict du parcours.'
      };
    }

    return {
      severity: 'LOW',
      severityScore: 25,
      reasoning: 'Désagrément mineur ou suggestion cosmétique.'
    };
  }
}
