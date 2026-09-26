/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature Spec Generator - Builds Standard Engineering Specifications
 */

import type { FeatureSpecification } from '../types.js';
import { FeatureAlternativeGenerator } from './feature-alternative-generator.js';

export class FeatureSpecGenerator {
  private readonly altGen = new FeatureAlternativeGenerator();

  public generateSpec(params: {
    readonly title: string;
    readonly problem: string;
    readonly proposedSolution: string;
    readonly affectedModules: readonly string[];
  }): FeatureSpecification {
    const alternatives = this.altGen.generateAlternatives(params.title, params.proposedSolution);

    return {
      problem: params.problem,
      proposedSolution: params.proposedSolution,
      scope: [
        `Intégration du composant principal dans ${params.affectedModules.join(', ') || 'le projet'}`,
        'Mise à disposition de l interface utilisateur réactive',
        'Tests unitaires automatisés associés'
      ],
      outOfScope: [
        'Refonte globale de la base de données existante',
        'Remplacement des composants externes non liés'
      ],
      successCriteria: [
        'Composant rendu sans erreur dans le canvas',
        'Zéro régression sur la suite de tests existante',
        'Temps de réponse de l interaction < 100ms'
      ],
      alternatives
    };
  }
}
