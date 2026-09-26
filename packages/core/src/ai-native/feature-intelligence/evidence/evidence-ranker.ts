/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Evidence Ranker - Ranks Evidence by Source Authority
 */

import type { FeatureEvidence, EvidenceSource } from '../types.js';

const SOURCE_AUTHORITY_WEIGHTS: Record<EvidenceSource, number> = {
  audit: 1.0,         // Données factuelles vérifiées par scanner AST/layout
  application: 0.95,  // Code source existant, routes, composants
  decision: 0.9,      // ADR validé par l'architecte ou l'humain
  conversation: 0.85, // Demande explicite de l'utilisateur
  ux: 0.8,            // Problème ergonomique mesuré
  design: 0.8,        // Dérive constatée par rapport aux tokens
  feedback: 0.75,     // Retours utilisateurs
  architecture: 0.7,  // Opportunité de refactorisation
  usage: 0.65         // Statistiques d'usage
};

export class EvidenceRanker {
  /**
   * Trie les évidences par poids d'autorité puis par confiance décroissante
   */
  public rankEvidence(evidenceList: readonly FeatureEvidence[]): readonly FeatureEvidence[] {
    return [...evidenceList].sort((a, b) => {
      const weightA = SOURCE_AUTHORITY_WEIGHTS[a.source] ?? 0.5;
      const weightB = SOURCE_AUTHORITY_WEIGHTS[b.source] ?? 0.5;
      const scoreA = weightA * a.confidence;
      const scoreB = weightB * b.confidence;
      return scoreB - scoreA;
    });
  }

  /**
   * Récupère le coefficient d'autorité d'une source
   */
  public getSourceWeight(source: EvidenceSource): number {
    return SOURCE_AUTHORITY_WEIGHTS[source] ?? 0.5;
  }
}
