/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Structured Assumption Management Engine
 */

import type { ApplicationSemanticModel } from '../../application-understanding/types.js';
import type { ConversationAssumption, IntentResult, ProjectMemory } from '../types.js';
import { compareAssumptions } from './canonical.js';

export function deriveAssumptions(
  intent: IntentResult,
  existingConventions: readonly string[] = []
): readonly ConversationAssumption[] {
  const assumptions: ConversationAssumption[] = [];

  if (intent.category === 'CREATE') {
    if (intent.domain === 'dom_suppliers' || intent.entities.includes('fournisseur') || intent.entities.includes('fournisseurs')) {
      assumptions.push({
        id: 'assump_supplier_crud',
        statement: 'Le module fournisseurs nécessite les opérations CRUD de base (liste, ajout, édition, suppression).',
        confidence: 0.90,
        evidence: 'Convention standard d ingénierie pour les espaces de gestion métier',
        risk: 'LOW',
        reversible: true,
        requiresConfirmation: false,
        status: 'PROPOSED'
      });

      assumptions.push({
        id: 'assump_supplier_nav',
        statement: 'Un lien de navigation vers les fournisseurs sera intégré dans le menu principal.',
        confidence: 0.85,
        evidence: 'Accès utilisateur standard requis pour toute nouvelle section applicative',
        risk: 'LOW',
        reversible: true,
        requiresConfirmation: false,
        status: 'PROPOSED'
      });
    }

    if (intent.entities.includes('bouton')) {
      assumptions.push({
        id: 'assump_ui_button_theme',
        statement: 'Le bouton utilisera la palette et les styles de composants existants du projet.',
        confidence: 0.95,
        evidence: 'Convention de cohérence d interface utilisateur',
        risk: 'LOW',
        reversible: true,
        requiresConfirmation: false,
        status: 'PROPOSED'
      });
    }
  }

  return assumptions.sort(compareAssumptions);
}

export class ConversationAssumptionEngine {
  public synthesizeAssumptions(params: {
    intent: IntentResult;
    projectMemory: ProjectMemory;
    semanticModel?: ApplicationSemanticModel | undefined;
  }): readonly ConversationAssumption[] {
    const { intent, projectMemory } = params;
    return deriveAssumptions(intent, projectMemory.knownConventions);
  }
}
