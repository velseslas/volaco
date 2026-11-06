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

  // LOT CONVERS-CLARIFY — distinguer le BRUIT d'une demande vague mais
  // portante : « crée un site fdfdfdfdf » doit questionner (comportement
  // conversationnel attendu), « crée un site de restaurant » doit
  // construire. On retire verbes d'action et mots vides ; s'il ne reste
  // AUCUN mot porteur (voyelle + structure de mot), le domaine est
  // illisible → clarification bloquante, déterministe et indépendante de
  // l'état du fournisseur IA (marche même en repli mots-clés).
  // LOT CONVERS-CLARIFY-2 — la borne « CREATE » est levée : « dfdfdf » envoyé
  // sur une page existante a déclenché une MODIFICATION inventée (le LLM
  // modifiait titre et bouton sur un message bruit). Le détecteur tourne
  // désormais pour toute catégorie (create/modify/delete/question) tant
  // qu'aucune entité concrète n'a été extraite de la demande.
  if (entities.length === 0) {
    const cleaned = prompt.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const STOP = new Set([
      'crée', 'créer', 'fais', 'faire', 'génère', 'générer', 'construis', 'construire',
      'développe', 'développer', 'lance', 'donne', 'veux', 'voudrais', 'besoin',
      'modifie', 'modifier', 'change', 'changer', 'supprime', 'supprimer',
      'enlève', 'enlever', 'ajoute', 'ajouter', 'remplace', 'remplacer',
      'mets', 'mettre', 'passe', 'passer', 'rend', 'rendre', 'corrige', 'corriger',
      'un', 'une', 'de', 'du', 'des', 'le', 'la', 'les', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes',
      'pour', 'avec', 'que', 'qui', 'et', 'ou', 'à', 'au', 'aux', 'me', 'moi', 'je', 'tu', 'il',
      'son', 'sa', 'ses', 'ce', 'cet', 'cette', 'sur', 'dans', 'par', 'stp', 'svp',
      'site', 'application', 'app', 'web', 'page', 'nouvel', 'nouveau', 'nouvelle', 'petit'
    ]);
    const content = tokens.filter(t => !STOP.has(t) && t.length > 0);
    const isRealWord = (t: string) => {
      if (t.length < 3) return false;
      if (!/[aeiouyàâéèêëîïôöûü]/.test(t)) return false; // aucune voyelle = suite de lettres
      if (/[bcdfghjklmnpqrstvwxz]{4,}/.test(t)) return false; // run de consonnes = bruit
      if (/([a-z]{2})\1{2,}/.test(t)) return false; // répétition type xyxyxyz = bruit
      return true;
    };
    const hasPayload = content.some(isRealWord);
    if (!hasPayload) {
      items.push({
        id: 'clarif_incoherent_input',
        question: "Je préfère te demander avant d'agir : ta demande ne me dit pas encore quoi faire. Peux-tu préciser ce que tu veux créer ou modifier, et sur quoi ça porte ?",
        level: 'BLOCKING',
        reason: "Aucun mot porteur reconnaissable dans la demande (suite de lettres sans domaine ni cible) — toute action construction ou modification est refusée jusqu'à clarification"
      });
    }
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
