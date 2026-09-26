/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Feedback Evidence Engine: Strict Material Verification (NO EVIDENCE -> NO CLAIM)
 */

import { createHash } from 'node:crypto';
import type { EvidenceProofLevel, ProblemEvidence, UserSignal } from '../types.js';

export class FeedbackEvidenceEngine {
  /**
   * Extrait des preuves matérielles traçables à partir d'un groupe de signaux
   */
  public extractEvidence(signals: readonly UserSignal[]): readonly ProblemEvidence[] {
    const evidenceList: ProblemEvidence[] = [];

    for (const sig of signals) {
      // 1. Preuves factuelles d'erreur runtime (FACT)
      if (sig.source === 'error_runtime') {
        const hash = createHash('sha256').update(`${sig.id}:fact:runtime`, 'utf8').digest('hex').substring(0, 12);
        evidenceList.push({
          id: `evi-${hash}`,
          signalId: sig.id,
          source: 'error_runtime',
          proofLevel: 'FACT',
          description: `Erreur d'exécution runtime journalisée: ${sig.normalizedText.substring(0, 120)}`,
          confidence: 0.98,
          filePath: sig.url,
          observedValue: sig.metadata && typeof sig.metadata.hasStack === 'boolean' ? 'Stack trace capturée' : 'Exception runtime',
          timestamp: sig.timestamp
        });
      }

      // 2. Preuves factuelles d'audit qualité (FACT)
      else if (sig.source === 'audit_finding') {
        const hash = createHash('sha256').update(`${sig.id}:fact:audit`, 'utf8').digest('hex').substring(0, 12);
        evidenceList.push({
          id: `evi-${hash}`,
          signalId: sig.id,
          source: 'audit_finding',
          proofLevel: 'FACT',
          description: `Finding formel de l'audit de qualité: ${sig.normalizedText.substring(0, 120)}`,
          confidence: 0.95,
          filePath: sig.url,
          selector: sig.componentId,
          observedValue: sig.metadata && typeof sig.metadata.severity === 'string' ? sig.metadata.severity : 'ANOMALY',
          timestamp: sig.timestamp
        });
      }

      // 3. Preuves de télémétrie mesurée (FACT)
      else if (sig.source === 'telemetry') {
        const hash = createHash('sha256').update(`${sig.id}:fact:telemetry`, 'utf8').digest('hex').substring(0, 12);
        evidenceList.push({
          id: `evi-${hash}`,
          signalId: sig.id,
          source: 'telemetry',
          proofLevel: 'FACT',
          description: `Interaction anormale mesurée: ${sig.normalizedText.substring(0, 120)}`,
          confidence: 0.90,
          selector: sig.componentId,
          observedValue: sig.metadata && sig.metadata.clickCount ? `${sig.metadata.clickCount} clics` : undefined,
          timestamp: sig.timestamp
        });
      }

      // 4. Signalement utilisateur direct (CORRELATION ou FACT selon précision)
      else {
        const isFact = sig.url || sig.componentId;
        const proofLevel: EvidenceProofLevel = isFact ? 'FACT' : 'CORRELATION';
        const hash = createHash('sha256').update(`${sig.id}:${proofLevel}`, 'utf8').digest('hex').substring(0, 12);

        evidenceList.push({
          id: `evi-${hash}`,
          signalId: sig.id,
          source: sig.source,
          proofLevel,
          description: `Retour utilisateur explicite: ${sig.normalizedText.substring(0, 120)}`,
          confidence: isFact ? 0.85 : 0.70,
          filePath: sig.url,
          selector: sig.componentId,
          observedValue: sig.sentiment,
          timestamp: sig.timestamp
        });
      }
    }

    return evidenceList;
  }

  /**
   * Vérifie formellement le principe NO EVIDENCE -> NO CLAIM
   */
  public hasSufficientEvidence(evidence: readonly ProblemEvidence[], minConfidence = 0.30): boolean {
    if (!evidence || evidence.length === 0) {
      return false;
    }

    // Au moins une preuve FACT ou CORRELATION avec confiance >= minConfidence
    return evidence.some(e => e.confidence >= minConfidence && (e.proofLevel === 'FACT' || e.proofLevel === 'CORRELATION'));
  }
}
