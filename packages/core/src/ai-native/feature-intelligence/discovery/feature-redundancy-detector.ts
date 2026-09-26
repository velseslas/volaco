/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature Redundancy Detector - Prevents Proposing Existing Capabilities
 */

import type { CollectedSignals } from './signal-collector.js';

export interface RedundancyCheckResult {
  readonly isRedundant: boolean;
  readonly matchedItem?: string | undefined;
  readonly reason?: string | undefined;
}

export class FeatureRedundancyDetector {
  /**
   * Vérifie si un candidat de fonctionnalité est redondant avec l'existant
   */
  public checkRedundancy(candidateTitle: string, candidateDescription: string, signals: CollectedSignals): RedundancyCheckResult {
    const titleLower = candidateTitle.toLowerCase();
    const descLower = candidateDescription.toLowerCase();

    // 1. Détection de composants équivalents existants
    for (const comp of signals.detectedComponents) {
      const cLow = comp.toLowerCase();
      if (cLow.length > 3) {
        // Détection sémantique : Recherche
        if (
          (titleLower.includes('recherche') || titleLower.includes('search')) &&
          (cLow.includes('search') || cLow.includes('recherche'))
        ) {
          return {
            isRedundant: true,
            matchedItem: `Composant: ${comp}`,
            reason: `Une capacité de recherche existe déjà dans le composant "${comp}".`
          };
        }
        // Détection sémantique : Export
        if (
          (titleLower.includes('export') || titleLower.includes('download')) &&
          (cLow.includes('export') || cLow.includes('download'))
        ) {
          return {
            isRedundant: true,
            matchedItem: `Composant: ${comp}`,
            reason: `Une capacité d export existe déjà dans le composant "${comp}".`
          };
        }
        // Correspondance directe par inclusion
        if (titleLower.includes(cLow) || descLower.includes(cLow)) {
          return {
            isRedundant: true,
            matchedItem: `Composant: ${comp}`,
            reason: `Une capacité similaire existe déjà dans le composant "${comp}".`
          };
        }
      }
    }

    // 2. Détection de routes existantes
    for (const route of signals.detectedRoutes) {
      const rClean = route.replace(/^\//, '').toLowerCase();
      if (rClean.length > 2) {
        if (titleLower.includes('recherche') && (rClean === 'search' || rClean === 'recherche')) {
          return {
            isRedundant: true,
            matchedItem: `Route: ${route}`,
            reason: `La route "${route}" existe déjà dans l application.`
          };
        }
        if (titleLower.includes('export') && rClean === 'export') {
          return {
            isRedundant: true,
            matchedItem: `Route: ${route}`,
            reason: `La route "${route}" existe déjà dans l application.`
          };
        }
      }
    }

    // 3. Détection par rapport aux décisions architecturales existantes
    for (const dec of signals.architecturalDecisions) {
      const decLow = dec.toLowerCase();
      if (titleLower.includes('recherche') && decLow.includes('recherche')) {
        return {
          isRedundant: true,
          matchedItem: `Décision: ${dec}`,
          reason: `Cette capacité fait déjà l objet d une décision d architecture validée : "${dec}".`
        };
      }
    }

    return {
      isRedundant: false
    };
  }
}
