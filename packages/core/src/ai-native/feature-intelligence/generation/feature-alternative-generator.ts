/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature Alternative Generator - Generates Pragmatic Alternatives (MVP vs Full)
 */

import type { FeatureAlternative } from '../types.js';

export class FeatureAlternativeGenerator {
  public generateAlternatives(title: string, proposedSolution: string): readonly FeatureAlternative[] {
    return [
      {
        id: 'alt-mvp',
        title: `Version Légère (MVP) : ${title}`,
        description: `Implémentation minimale ciblée sans dépendance additionnelle : ${proposedSolution.slice(0, 100)}...`,
        tradeOffs: 'Développement rapide (< 1 jour), impact minimal, mais fonctionnalités avancées reportées.',
        estimatedEffort: 'S',
        isRecommended: true
      },
      {
        id: 'alt-full',
        title: `Version Étendue (Complète) : ${title}`,
        description: `Architecture robuste avec persistance étendue, paramétrage fin et documentation complète.`,
        tradeOffs: 'Couverture exhaustive et personnalisable, mais effort plus élevé et surface de test accrue.',
        estimatedEffort: 'L',
        isRecommended: false
      }
    ];
  }
}
