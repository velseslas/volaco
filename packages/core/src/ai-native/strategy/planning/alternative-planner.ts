/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Alternative Planner - Generates What-If comparative scenarios and trade-off matrices
 */

import type { StrategicRecommendation, WhatIfComparison, WhatIfScenario } from '../types.js';
import { OpportunityCostEngine } from '../prioritization/opportunity-cost-engine.js';

export class AlternativePlanner {
  private readonly oppCostEngine = new OpportunityCostEngine();

  /**
   * Generates a comparative What-If matrix with 3 canonical strategic paths.
   */
  public generateAlternatives(recommendations: StrategicRecommendation[]): WhatIfComparison {
    if (recommendations.length === 0) {
      const emptyScenario: WhatIfScenario = {
        id: 'scen-empty',
        name: 'Aucune action requise',
        description: 'Aucune recommandation active à comparer.',
        selectedRecommendationIds: [],
        projectedStrategicValue: 100,
        projectedRiskScore: 0,
        projectedEffortPoints: 0,
        opportunityCost: { forgoneRecommendations: [], totalForgoneValue: 0, rationale: 'Système nominal.' },
        pros: ['Stabilité parfaite'],
        cons: ['Aucune évolution']
      };

      return {
        baseStrategy: emptyScenario,
        alternativeScenarios: [],
        recommendedScenarioId: 'scen-empty',
        recommendationRationale: 'Aucune intervention requise.',
        comparisonMatrix: []
      };
    }

    // Scenario 1: Stabilité & Qualité d'Abord (Fixes, Regressions, Security)
    const stabilityRecs = recommendations.filter(
      r => r.type === 'FIX_CRITICAL_PROBLEM' || r.type === 'FIX_REGRESSION' || r.type === 'FIX_SECURITY_RISK' || r.type === 'REDUCE_TECHNICAL_DEBT'
    );
    const stabIds = (stabilityRecs.length > 0 ? stabilityRecs : recommendations.slice(0, 3)).map(r => r.id);
    const stabOpp = this.oppCostEngine.evaluate(stabIds, recommendations);

    const scenarioStability: WhatIfScenario = {
      id: 'scen-stability-first',
      name: 'Stratégie A : Stabilité & Fiabilité Prioritaire',
      description: 'Priorise la résolution de tous les bugs bloquants, régressions et risques techniques avant tout ajout de code fonctionnel.',
      selectedRecommendationIds: stabIds,
      projectedStrategicValue: Math.round(
        stabIds.reduce((sum, id) => sum + (recommendations.find(r => r.id === id)?.strategicScore || 70), 0) / Math.max(1, stabIds.length)
      ),
      projectedRiskScore: 20,
      projectedEffortPoints: stabIds.reduce((sum, id) => sum + (recommendations.find(r => r.id === id)?.effort.points || 2), 0),
      opportunityCost: {
        forgoneRecommendations: stabOpp.forgoneRecommendations.map(f => ({ id: f.id, title: f.title, score: f.score })),
        totalForgoneValue: stabOpp.totalForgoneValue,
        rationale: stabOpp.rationale
      },
      pros: [
        'Résolution radicale des régressions et bugs utilisateurs',
        'Réduction immédiate de la dette technique',
        'Base de code ultra-saine pour les développements futurs'
      ],
      cons: [
        'Report des nouvelles fonctionnalités attendues',
        'Progression perçue plus lente sur le plan produit'
      ]
    };

    // Scenario 2: Accélération Produit (Features First)
    const featureRecs = recommendations.filter(
      r => r.type === 'BUILD_FEATURE' || r.type === 'EXTEND_FEATURE'
    );
    const featIds = (featureRecs.length > 0 ? featureRecs : recommendations.slice(0, 2)).map(r => r.id);
    const featOpp = this.oppCostEngine.evaluate(featIds, recommendations);

    const scenarioFeatures: WhatIfScenario = {
      id: 'scen-features-first',
      name: 'Stratégie B : Accélération Produit & Nouvelles Features',
      description: 'Priorise le déploiement rapide des nouvelles fonctionnalités et opportunités pour capter de nouveaux usages.',
      selectedRecommendationIds: featIds,
      projectedStrategicValue: Math.round(
        featIds.reduce((sum, id) => sum + (recommendations.find(r => r.id === id)?.valueScore || 65), 0) / Math.max(1, featIds.length)
      ),
      projectedRiskScore: 65,
      projectedEffortPoints: featIds.reduce((sum, id) => sum + (recommendations.find(r => r.id === id)?.effort.points || 3), 0),
      opportunityCost: {
        forgoneRecommendations: featOpp.forgoneRecommendations.map(f => ({ id: f.id, title: f.title, score: f.score })),
        totalForgoneValue: featOpp.totalForgoneValue,
        rationale: featOpp.rationale
      },
      pros: [
        'Impact commercial immédiat et valeur perçue élevée',
        'Réponse rapide aux demandes d évolutions utilisateurs'
      ],
      cons: [
        'Risque d accumulation d anomalies non résolues',
        'Fragilisation potentielle de l architecture existante'
      ]
    };

    // Scenario 3: Stratégie Optimale Équilibrée (Recommandée)
    const balancedRecs = recommendations.slice(0, Math.min(4, recommendations.length));
    const balancedIds = balancedRecs.map(r => r.id);
    const balancedOpp = this.oppCostEngine.evaluate(balancedIds, recommendations);

    const scenarioBalanced: WhatIfScenario = {
      id: 'scen-balanced-optimal',
      name: 'Stratégie C : Approche Équilibrée & Déterministe (Recommandée)',
      description: 'Combine la correction des régressions critiques tout en délivrant l opportunité produit à plus forte valeur.',
      selectedRecommendationIds: balancedIds,
      projectedStrategicValue: Math.round(
        balancedIds.reduce((sum, id) => sum + (recommendations.find(r => r.id === id)?.strategicScore || 80), 0) / Math.max(1, balancedIds.length)
      ),
      projectedRiskScore: 35,
      projectedEffortPoints: balancedIds.reduce((sum, id) => sum + (recommendations.find(r => r.id === id)?.effort.points || 2), 0),
      opportunityCost: {
        forgoneRecommendations: balancedOpp.forgoneRecommendations.map(f => ({ id: f.id, title: f.title, score: f.score })),
        totalForgoneValue: balancedOpp.totalForgoneValue,
        rationale: balancedOpp.rationale
      },
      pros: [
        'Élimination des blocages critiques garantissant la stabilité',
        'Livraison simultanée de valeur produit visible',
        'Meilleur ratio Valeur / Risque mathématique'
      ],
      cons: [
        'Nécessite une rigueur d ordonnancement pour respecter les dépendances'
      ]
    };

    const scenarios = [scenarioBalanced, scenarioStability, scenarioFeatures];

    const comparisonMatrix = scenarios.map(s => ({
      scenarioId: s.id,
      scenarioName: s.name,
      score: s.projectedStrategicValue,
      value: s.projectedStrategicValue,
      risk: s.projectedRiskScore,
      effort: s.projectedEffortPoints,
      verdict: s.id === 'scen-balanced-optimal' ? 'OPTIMAL' : s.projectedRiskScore > 50 ? 'RISQUÉ' : 'CONSERVATEUR'
    }));

    return {
      baseStrategy: scenarioBalanced,
      alternativeScenarios: [scenarioStability, scenarioFeatures],
      recommendedScenarioId: scenarioBalanced.id,
      recommendationRationale: 'La Stratégie C offre le ratio Valeur / Risque le plus élevé en éliminant les régressions prioritaires sans bloquer l évolution fonctionnelle.',
      comparisonMatrix
    };
  }
}
