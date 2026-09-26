/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Root Cause Correlator: Cross-Correlation with Application DNA & Quality Audits
 */

import type { ApplicationDNA } from '../../dna/types.js';
import type { ApplicationAuditReport } from '../../application-audit/types.js';
import type { ProblemEvidence, UserSignal } from '../types.js';

export interface RootCauseCorrelation {
  readonly hypothesis: string;
  readonly suggestedRemediation: string;
  readonly correlatedFiles: readonly string[];
  readonly correlatedAuditFindingIds: readonly string[];
  readonly confidence: number;
}

export class RootCauseCorrelator {
  /**
   * Établit des corrélations factuelles entre les signaux, l'audit qualité et l'architecture applicative
   */
  public correlate(
    signals: readonly UserSignal[],
    evidence: readonly ProblemEvidence[],
    dna?: ApplicationDNA,
    auditReport?: ApplicationAuditReport
  ): RootCauseCorrelation {
    const matchedFiles = new Set<string>();
    const matchedAuditIds = new Set<string>();
    let hypothesis = 'Cause racine indéterminée nécessitant une reproduction pas-à-pas.';
    let suggestedRemediation = 'Ajouter des logs défensifs et isoler le cas de test.';
    let confidence = 0.50;

    // 1. Extraire les fichiers cités dans les signaux et preuves
    for (const sig of signals) {
      if (sig.url && sig.url.includes('.')) {
        matchedFiles.add(sig.url);
      }
    }
    for (const ev of evidence) {
      if (ev.filePath) {
        matchedFiles.add(ev.filePath);
      }
    }

    // 2. Corrélation avec les findings de l'audit AINT-013
    if (auditReport && auditReport.findings) {
      for (const finding of auditReport.findings) {
        for (const sig of signals) {
          const text = (sig.normalizedText || sig.rawText).toLowerCase();
          const findingTitle = finding.title.toLowerCase();
          const filePath = finding.location?.filePath;
          const selector = finding.location?.selector;

          if (
            text.includes(findingTitle) ||
            (filePath && text.includes(filePath.toLowerCase())) ||
            (selector && sig.componentId && sig.componentId.includes(selector))
          ) {
            matchedAuditIds.add(finding.id);
            if (filePath) matchedFiles.add(filePath);

            hypothesis = `Corrélation directe avec l'audit [${finding.dimension}]: ${finding.title}.`;
            suggestedRemediation = finding.recommendation || 'Appliquer la recommandation issue de l\'audit qualité.';
            confidence = 0.90;
            break;
          }
        }
      }
    }

    // 3. Corrélation avec l'Application DNA si fichiers trouvés
    if (dna && matchedFiles.size === 0 && signals.length > 0) {
      const firstSig = signals[0];
      if (firstSig) {
        const sampleText = (firstSig.normalizedText || firstSig.rawText).toLowerCase();
        if (dna.architecture && Array.isArray(dna.architecture.layers)) {
          for (const layer of dna.architecture.layers) {
            if (sampleText.includes(layer.name.toLowerCase())) {
              for (const fp of layer.filePaths) {
                matchedFiles.add(fp);
              }
              hypothesis = `Anomalie localisée dans la couche architecturale "${layer.name}".`;
              suggestedRemediation = `Vérifier l'intégrité des composants de la couche ${layer.name}.`;
              confidence = 0.75;
              break;
            }
          }
        }
      }
    }

    // 4. Si runtime error stacktrace
    const errorSignal = signals.find(s => s.source === 'error_runtime');
    if (errorSignal && errorSignal.metadata && errorSignal.metadata.hasStack) {
      hypothesis = `Exception non rattrapée dans le flux d'exécution: ${errorSignal.rawText.split('\n')[0]}`;
      suggestedRemediation = 'Vérifier la nullité des références et encapsuler l\'appel dans un bloc try/catch défensif.';
      confidence = 0.95;
    }

    return {
      hypothesis,
      suggestedRemediation,
      correlatedFiles: Array.from(matchedFiles).sort(),
      correlatedAuditFindingIds: Array.from(matchedAuditIds).sort(),
      confidence
    };
  }
}
