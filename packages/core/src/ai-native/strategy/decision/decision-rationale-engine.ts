/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Decision Rationale Engine - Deterministically generates explanations and consequences if ignored
 */

import type { RecommendationType, StrategicAlternative } from '../types.js';

export interface GeneratedRationale {
  rationale: string;
  consequencesIfIgnored: string[];
  alternatives: StrategicAlternative[];
}

export class DecisionRationaleEngine {
  /**
   * Generates deterministic human-oriented rationales, consequences, and alternatives.
   */
  public generate(
    type: RecommendationType,
    title: string,
    isRegression: boolean,
    isBlocker: boolean,
    score: number
  ): GeneratedRationale {
    let rationale = `Cette action est priorisée à un score stratégique de ${score}/100.`;
    const consequences: string[] = [];
    const alternatives: StrategicAlternative[] = [];

    if (type === 'FIX_REGRESSION') {
      rationale = `Régression active détectée : ${title}. La restauration de la conformité du parcours utilisateur est prioritaire sur tout nouveau développement.`;
      consequences.push(
        'Frustration utilisateur accrue et perte de confiance dans la stabilité de la plateforme.',
        'Risque d effet domino et de complications lors des prochains refactorings.',
        'Augmentation du volume de tickets ou de plaintes utilisateurs.'
      );
      alternatives.push({
        id: 'alt-workaround',
        title: 'Contournement temporaire côté interface',
        description: 'Désactiver temporairement le bouton ou masquer l élément défaillant.',
        tradeOffs: {
          pros: ['Déploiement immédiat'],
          cons: ['Expérience utilisateur dégradée'],
          riskImpact: 'Faible',
          effortDelta: '-1 pt'
        },
        scoreDelta: -15
      });
    } else if (type === 'FIX_CRITICAL_PROBLEM') {
      rationale = `Défaut critique bloquant identifié : ${title}. Résolution requise pour débloquer l exécution normale de l application.`;
      consequences.push(
        'Blocage complet des parcours utilisateurs affectés.',
        'Risque d erreurs 500 ou de plantages du runtime dans le navigateur.',
        'Taux de rebond utilisateur maximal.'
      );
      alternatives.push({
        id: 'alt-graceful-fallback',
        title: 'Ajout d un message d erreur gracieux (Fallback UI)',
        description: 'Informer l utilisateur au lieu de laisser l écran blanc.',
        tradeOffs: {
          pros: ['Évite le plantage visuel'],
          cons: ['Ne résout pas le problème de fond'],
          riskImpact: 'Faible',
          effortDelta: '-1 pt'
        },
        scoreDelta: -20
      });
    } else if (type === 'FIX_SECURITY_RISK') {
      rationale = `Vulnérabilité de sécurité détectée : ${title}. Risque potentiel d injection ou de fuite de données.`;
      consequences.push(
        'Exposition potentielle de données sensibles.',
        'Vulnérabilité aux attaques XSS, CSRF ou injections SQL.',
        'Non-conformité aux exigences de sécurité du socle Volaco.'
      );
      alternatives.push({
        id: 'alt-input-sanitization',
        title: 'Sanitisation stricte en amont',
        description: 'Ajouter un filtre de validation sur les entrées.',
        tradeOffs: {
          pros: ['Mise en place rapide'],
          cons: ['Ne remplace pas une correction structurelle'],
          riskImpact: 'Moyen',
          effortDelta: '-1 pt'
        },
        scoreDelta: -10
      });
    } else if (type === 'BUILD_FEATURE' || type === 'EXTEND_FEATURE') {
      rationale = `Opportunité produit à haute valeur ajoutée : ${title}. Répond directement aux attentes fonctionnelles et comble une lacune identifiée.`;
      consequences.push(
        'Opportunité manquée d engager les utilisateurs sur cette capacité.',
        'L application reste cantonnée à un périmètre fonctionnel restreint.',
        'Retard potentiel face aux solutions équivalentes.'
      );
      alternatives.push({
        id: 'alt-mvp-feature',
        title: 'Version allégée (MVP)',
        description: 'Implémenter une déclinaison simplifiée sans fonctionnalités avancées.',
        tradeOffs: {
          pros: ['Livraison 2x plus rapide', 'Effort réduit'],
          cons: ['Périmètre fonctionnel partiel'],
          riskImpact: 'Faible',
          effortDelta: '-2 pts'
        },
        scoreDelta: -5
      });
    } else if (type === 'REDUCE_TECHNICAL_DEBT' || type === 'REFACTOR') {
      rationale = `Dette technique ou faiblesse architecturale : ${title}. L assainissement préserve la maintenabilité et la vélocité future.`;
      consequences.push(
        'Complexité croissante lors des évolutions ultérieures.',
        'Ralentissement progressif des temps de développement.',
        'Augmentation de la probabilité de régressions lors des modifications.'
      );
      alternatives.push({
        id: 'alt-defer-debt',
        title: 'Différer à la prochaine version majeure',
        description: 'Documenter la dette technique et la planifier dans un jalon ultérieur.',
        tradeOffs: {
          pros: ['Libère du temps immédiat pour les features'],
          cons: ['Intérêts de la dette accumulés'],
          riskImpact: 'Élevé à moyen terme',
          effortDelta: '0 pt'
        },
        scoreDelta: -25
      });
    } else {
      rationale = `Amélioration recommandée : ${title}. Optimise la qualité perçue et la robustesse globale.`;
      consequences.push(
        'Maintien d une expérience sous-optimale sur cette zone de l application.',
        'Perte d opportunité d optimisation globale.'
      );
      alternatives.push({
        id: 'alt-monitor',
        title: 'Mettre sous surveillance télémétrique',
        description: 'Observer l impact avant d engager un refactoring.',
        tradeOffs: {
          pros: ['Aucun effort immédiat'],
          cons: ['Aucune amélioration active'],
          riskImpact: 'Nul',
          effortDelta: '-2 pts'
        },
        scoreDelta: -30
      });
    }

    return { rationale, consequencesIfIgnored: consequences, alternatives };
  }
}
