/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Evidence Engine - Enforces NO EVIDENCE -> NO CLAIM
 */

import type { FeatureEvidence, EvidenceSource, EvidenceReference } from '../types.js';

export class EvidenceEngine {
  /**
   * Valide si un ensemble d'évidences est suffisant pour soutenir une opportunité
   */
  public validateEvidence(evidenceList: readonly FeatureEvidence[]): {
    readonly isValid: boolean;
    readonly totalEvidenceCount: number;
    readonly distinctSources: readonly EvidenceSource[];
    readonly reason?: string;
  } {
    if (!evidenceList || evidenceList.length === 0) {
      return {
        isValid: false,
        totalEvidenceCount: 0,
        distinctSources: [],
        reason: 'REJETÉ : Règle NO EVIDENCE -> NO CLAIM violée (aucune preuve fournie).'
      };
    }

    // Filtrer les preuves valides avec au moins une référence ou description concrète
    const validEvidence = evidenceList.filter((e) => {
      const hasDesc = Boolean(e.description && e.description.trim().length > 10);
      const hasConfidence = typeof e.confidence === 'number' && e.confidence > 0;
      const hasReferences = Array.isArray(e.references) && e.references.length > 0;
      return hasDesc && hasConfidence && hasReferences;
    });

    if (validEvidence.length === 0) {
      return {
        isValid: false,
        totalEvidenceCount: 0,
        distinctSources: [],
        reason: 'REJETÉ : Les preuves fournies manquent de références matérielles ou de description vérifiable.'
      };
    }

    const distinctSources = Array.from(new Set(validEvidence.map((e) => e.source)));

    return {
      isValid: true,
      totalEvidenceCount: validEvidence.length,
      distinctSources
    };
  }

  /**
   * Crée un objet FeatureEvidence typé et validé
   */
  public createEvidence(
    id: string,
    source: EvidenceSource,
    description: string,
    confidence: number,
    references: readonly EvidenceReference[]
  ): FeatureEvidence {
    return {
      id,
      source,
      description: description.trim(),
      confidence: Math.max(0, Math.min(1.0, confidence)),
      references: Object.freeze([...references])
    };
  }
}
