/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Feature Impact Analyzer: Mapping of Problems to Affected Functional Features
 */

import type { UserSignal } from '../types.js';

export interface FeatureImpactResult {
  readonly affectedFeatures: readonly string[];
  readonly primaryFeature: string;
}

export class FeatureImpactAnalyzer {
  public analyze(signals: readonly UserSignal[]): FeatureImpactResult {
    const featureSet = new Set<string>();

    for (const sig of signals) {
      if (sig.componentId) {
        featureSet.add(sig.componentId);
      }
      if (sig.url) {
        const pathPart = sig.url.split('?')[0];
        const route = pathPart ? pathPart.split('#')[0] : undefined;
        if (route) {
          featureSet.add(route);
        }
      }

      const text = (sig.normalizedText || sig.rawText).toLowerCase();
      if (text.includes('auth') || text.includes('connexion') || text.includes('login')) {
        featureSet.add('Authentication');
      } else if (text.includes('export') || text.includes('csv') || text.includes('pdf')) {
        featureSet.add('Data Export');
      } else if (text.includes('checkout') || text.includes('panier') || text.includes('paiement')) {
        featureSet.add('Billing & Checkout');
      } else if (text.includes('dashboard') || text.includes('tableau de bord')) {
        featureSet.add('Dashboard');
      } else if (text.includes('editor') || text.includes('éditeur')) {
        featureSet.add('Code Editor');
      }
    }

    const affectedFeatures = Array.from(featureSet).sort();
    const primaryFeature = affectedFeatures[0] || 'Core Application';

    return {
      affectedFeatures,
      primaryFeature
    };
  }
}
