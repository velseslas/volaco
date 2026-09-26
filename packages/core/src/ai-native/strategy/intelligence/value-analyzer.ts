/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Strategy Value Analyzer - Computes composite business, user, and technical value
 */

import type { RecommendationType } from '../types.js';

export interface EvaluatedValue {
  valueScore: number; // 0-100
  expectedValueDescription: string;
  userImpact: string;
  technicalImpact: string;
  businessImpact: string;
}

export class StrategyValueAnalyzer {
  /**
   * Evaluates value for a recommendation based on its category and parameters.
   */
  public evaluate(
    type: RecommendationType,
    severityOrGapScore: number,
    isRegression: boolean,
    isBlocker: boolean
  ): EvaluatedValue {
    let baseValue = 50;
    let userImpact = 'Amélioration générale du confort utilisateur.';
    let technicalImpact = 'Maintenabilité accrue du code source.';
    let businessImpact = 'Consolidation de la valeur produit.';

    if (type === 'FIX_CRITICAL_PROBLEM') {
      baseValue = 90;
      userImpact = 'Débloque immédiatement les parcours critiques des utilisateurs affectés.';
      technicalImpact = 'Élimine une exception ou défaillance majeure dans le runtime.';
      businessImpact = 'Évite l attrition des utilisateurs et préserve la conversion.';
    } else if (type === 'FIX_REGRESSION') {
      baseValue = 95;
      userImpact = 'Restaure une fonctionnalité préalablement opérationnelle et attendue.';
      technicalImpact = 'Garantit l intégrité des contrats et empêche l accumulation d anomalies.';
      businessImpact = 'Rétablit la confiance utilisateur et la crédibilité de la plateforme.';
    } else if (type === 'FIX_SECURITY_RISK') {
      baseValue = 88;
      userImpact = 'Sécurisation des données et conformité des interactions.';
      technicalImpact = 'Suppression des failles de sécurité et vecteurs d injection.';
      businessImpact = 'Conformité légale et protection de la réputation.';
    } else if (type === 'BUILD_FEATURE') {
      baseValue = 75;
      userImpact = 'Offre une nouvelle capacité répondant à un besoin direct des utilisateurs.';
      technicalImpact = 'Extension modulaire du graphe fonctionnel.';
      businessImpact = 'Augmentation de l engagement et différenciation concurrentielle.';
    } else if (type === 'EXTEND_FEATURE') {
      baseValue = 68;
      userImpact = 'Enrichit l expérience utilisateur existante.';
      technicalImpact = 'Optimisation des composants en place.';
      businessImpact = 'Renforcement de la rétention sur les fonctionnalités clés.';
    } else if (type === 'REDUCE_TECHNICAL_DEBT' || type === 'REFACTOR') {
      baseValue = 60;
      userImpact = 'Fluidité accrue et réduction indirecte des bugs futurs.';
      technicalImpact = 'Clarté architecturale, réduction de la dette et vélocité accrue.';
      businessImpact = 'Réduction des coûts de maintenance future.';
    } else if (type === 'IMPROVE_PERFORMANCE') {
      baseValue = 70;
      userImpact = 'Temps de réponse réduit et chargements instantanés.';
      technicalImpact = 'Diminution de la consommation mémoire et CPU.';
      businessImpact = 'Amélioration du taux de conversion et du SEO.';
    } else if (type === 'IMPROVE_DESIGN_HARMONY') {
      baseValue = 65;
      userImpact = 'Cohérence visuelle irréprochable et meilleure lisibilité.';
      technicalImpact = 'Standardisation des tokens de design et réduction de doublons CSS.';
      businessImpact = 'Perception de marque premium et professionnalisme.';
    }

    if (isRegression) {
      baseValue = Math.min(100, baseValue + 10);
    }
    if (isBlocker) {
      baseValue = Math.min(100, baseValue + 10);
    }

    const valueScore = Math.min(100, Math.max(0, Math.round(0.6 * baseValue + 0.4 * severityOrGapScore)));

    return {
      valueScore,
      expectedValueDescription: `${userImpact} ${businessImpact}`,
      userImpact,
      technicalImpact,
      businessImpact
    };
  }
}
