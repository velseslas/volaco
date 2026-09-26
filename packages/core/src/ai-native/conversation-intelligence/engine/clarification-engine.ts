/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Intelligent Clarification Engine (Knowing When NOT to Ask)
 */

import type {
  ClarificationItem,
  ContradictionRecord,
  ConversationAssumption,
  IntentCategory,
  IntentResult
} from '../types.js';

export function classifyAmbiguities(
  prompt: string,
  category: IntentCategory,
  entities: readonly string[]
): readonly ClarificationItem[] {
  const items: ClarificationItem[] = [];

  // Destructive Actions: always require confirmation
  if (category === 'DELETE') {
    items.push({
      id: 'clarif_destructive_action',
      question: 'Confirmez-vous la suppression définitive des éléments ciblés ?',
      level: 'NEEDS_CONFIRMATION',
      suggestedDefault: 'Non',
      reason: 'Action destructive irréversible sur des données ou du code source'
    });
  }

  // Large Scope Additions
  if (category === 'CREATE' && entities.length === 0) {
    items.push({
      id: 'clarif_missing_entity',
      question: 'Quel type de composant ou d entité souhaitez-vous créer exactement ?',
      level: 'BLOCKING',
      reason: 'Demande de création sans entité cible spécifiable'
    });
  }

  // Micro-decisions: SAFE_TO_ASSUME
  if (/bouton|section|champ|formulaire/i.test(prompt)) {
    items.push({
      id: 'clarif_ui_styling',
      question: 'Quel style visuel appliquer ?',
      level: 'SAFE_TO_ASSUME',
      suggestedDefault: 'Suivre les conventions TailwindCSS et le thème existant du projet',
      reason: 'Les conventions de design du projet fournissent des règles par défaut saines'
    });
  }

  return items;
}

export class ClarificationEngine {
  public assessClarifications(params: {
    intent: IntentResult;
    assumptions: readonly ConversationAssumption[];
    contradictions: readonly ContradictionRecord[];
  }): readonly ClarificationItem[] {
    const { intent, assumptions, contradictions } = params;
    const items: ClarificationItem[] = [...intent.ambiguities];

    // High risk assumptions need confirmation
    for (const assumption of assumptions) {
      if (assumption.requiresConfirmation && assumption.risk === 'HIGH') {
        items.push({
          id: `clarif_assump_${assumption.id}`,
          question: `Confirmez-vous l'hypothèse suivante : ${assumption.statement} ?`,
          level: 'NEEDS_CONFIRMATION',
          suggestedDefault: 'Oui',
          reason: assumption.evidence
        });
      }
    }

    // Contradictions need blocking clarification
    for (const conflict of contradictions) {
      items.push({
        id: `clarif_conflict_${conflict.id}`,
        question: `Conflit détecté avec une décision antérieure : ${conflict.explanation}. Quelle option souhaitez-vous retenir ?`,
        level: 'BLOCKING',
        reason: conflict.explanation
      });
    }

    return Object.freeze(items);
  }
}
