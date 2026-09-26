/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Request Classifier: Qualification of Feature Inquiries and Enhancement Ideas
 */

import type { UserSignal } from '../types.js';

export interface RequestQualification {
  readonly isFeatureRequest: boolean;
  readonly targetCapability: string;
  readonly expectedBenefit: string;
  readonly confidence: number;
}

export class RequestClassifier {
  public qualify(signal: UserSignal): RequestQualification {
    const text = (signal.normalizedText || signal.rawText).toLowerCase();

    const requestMarkers = [
      'ajouter', 'ajout', 'souhaiterais', 'feature', 'fonctionnalité', 'serait utile',
      'serait bien', 'il manque', 'possibilité de', 'pourrait-on', 'suggestion',
      'export', 'import', 'filtre', 'mode sombre', 'notifications', 'partage'
    ];

    let matchCount = 0;
    let foundMarker = '';

    for (const marker of requestMarkers) {
      if (text.includes(marker)) {
        matchCount++;
        if (!foundMarker) {
          foundMarker = marker;
        }
      }
    }

    const isFeature = signal.category === 'FEATURE_REQUEST' || matchCount > 0;
    const confidence = isFeature ? Math.min(0.95, 0.50 + matchCount * 0.15) : 0.20;

    let targetCapability = 'Général';
    if (text.includes('export') || text.includes('csv') || text.includes('pdf')) {
      targetCapability = 'Export de données';
    } else if (text.includes('filtre') || text.includes('recherche') || text.includes('trier')) {
      targetCapability = 'Recherche & Filtrage';
    } else if (text.includes('sombre') || text.includes('dark mode') || text.includes('thème')) {
      targetCapability = 'Thématisation / Mode Sombre';
    } else if (text.includes('notif') || text.includes('alerte')) {
      targetCapability = 'Système de Notifications';
    } else if (foundMarker) {
      targetCapability = `Amélioration (${foundMarker})`;
    }

    return {
      isFeatureRequest: isFeature,
      targetCapability,
      expectedBenefit: 'Amélioration de la satisfaction et de la productivité des utilisateurs finaux.',
      confidence
    };
  }
}
