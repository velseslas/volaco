/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * 3-Tier Memory Manager: Turn Memory, Project Memory, Decision Memory
 */

import { deepFreeze } from './canonical.js';
import type {
  ConversationMessage,
  ConversationTurn,
  DecisionRecord,
  EngineeringPlan,
  ProjectMemory,
  TurnMemory
} from '../types.js';

export class MemoryManager {
  /**
   * Creates initial turn memory.
   */
  public createInitialTurnMemory(): TurnMemory {
    return deepFreeze({
      recentMessages: [],
      currentAssumptions: []
    });
  }

  /**
   * Creates initial project memory.
   */
  public createInitialProjectMemory(): ProjectMemory {
    return deepFreeze({
      architecturalDecisions: [],
      userPreferences: {},
      acceptedPlans: [],
      rejectedPlans: [],
      knownConstraints: [],
      knownConventions: [],
      knownRisks: []
    });
  }

  /**
   * Updates turn memory with the latest turn, capping history to maxHistory.
   */
  public updateTurnMemory(
    current: TurnMemory,
    turn: ConversationTurn,
    maxHistory: number = 10
  ): TurnMemory {
    const updatedMessages: ConversationMessage[] = [
      ...current.recentMessages,
      turn.userMessage,
      turn.agentResponse
    ];

    const trimmedMessages = updatedMessages.slice(-maxHistory);

    return deepFreeze({
      lastMessage: turn.agentResponse,
      recentMessages: trimmedMessages,
      activeIntent: turn.intent,
      currentPlan: turn.plan ?? current.currentPlan,
      currentAssumptions: turn.assumptions
    });
  }

  /**
   * É47 — continuité post-exécution : le RÉSULTAT RÉEL de l'exécution du plan
   * (la réponse conversationnelle composée depuis les faits vérifiés du
   * superviseur É46) entre dans la mémoire conversationnelle comme message
   * AGENT. Sans cela, le tour suivant ignore ce qui vient d'être fait
   * (risque de fausse déclaration ou d'invention) — défaut démontré par la
   * sonde É47 (scénarios S12–S15).
   *
   * Contrairement à `updateTurnMemory` (cycle de tour complet), cette méthode
   * n'écrit QUE le dernier message et la fenêtre d'historique : `activeIntent`,
   * `currentPlan` et `currentAssumptions` sont préservés à l'identique (aucun
   * tour factice, aucun effet sur les contrats gelés É39–É46).
   */
  public recordExecutionReply(
    current: TurnMemory,
    reply: ConversationMessage,
    maxHistory: number = 10
  ): TurnMemory {
    const updatedMessages: ConversationMessage[] = [...current.recentMessages, reply];
    const trimmedMessages = updatedMessages.slice(-maxHistory);
    return deepFreeze({
      lastMessage: reply,
      recentMessages: trimmedMessages,
      activeIntent: current.activeIntent,
      currentPlan: current.currentPlan,
      currentAssumptions: current.currentAssumptions
    });
  }

  /**
   * Records an architectural decision in Decision Memory / Project Memory.
   */
  public recordDecision(projectMemory: ProjectMemory, decision: DecisionRecord): ProjectMemory {
    // If decision supersedes an older one, mark old one as SUPERSEDED
    const updatedDecisions = projectMemory.architecturalDecisions.map((d) => {
      if (d.statement.toLowerCase() === decision.statement.toLowerCase() && d.decisionId !== decision.decisionId) {
        return { ...d, status: 'SUPERSEDED' as const };
      }
      return d;
    });

    const isAlreadyPresent = updatedDecisions.some((d) => d.decisionId === decision.decisionId);
    const finalDecisions = isAlreadyPresent ? updatedDecisions : [...updatedDecisions, decision];

    return deepFreeze({
      ...projectMemory,
      architecturalDecisions: finalDecisions
    });
  }

  /**
   * Records acceptance or rejection of an engineering plan.
   */
  public recordPlanDecision(
    projectMemory: ProjectMemory,
    planId: string,
    accepted: boolean
  ): ProjectMemory {
    if (accepted) {
      const acceptedPlans = Array.from(new Set([...projectMemory.acceptedPlans, planId]));
      const rejectedPlans = projectMemory.rejectedPlans.filter((id) => id !== planId);
      return deepFreeze({
        ...projectMemory,
        acceptedPlans,
        rejectedPlans
      });
    } else {
      const rejectedPlans = Array.from(new Set([...projectMemory.rejectedPlans, planId]));
      const acceptedPlans = projectMemory.acceptedPlans.filter((id) => id !== planId);
      return deepFreeze({
        ...projectMemory,
        acceptedPlans,
        rejectedPlans
      });
    }
  }

  /**
   * Adds a known constraint to Project Memory.
   */
  public addConstraint(projectMemory: ProjectMemory, constraint: string): ProjectMemory {
    if (!constraint || projectMemory.knownConstraints.includes(constraint)) {
      return projectMemory;
    }
    return deepFreeze({
      ...projectMemory,
      knownConstraints: [...projectMemory.knownConstraints, constraint]
    });
  }

  /**
   * Sets a user preference in Project Memory.
   */
  public setUserPreference(
    projectMemory: ProjectMemory,
    key: string,
    value: string
  ): ProjectMemory {
    return deepFreeze({
      ...projectMemory,
      userPreferences: {
        ...projectMemory.userPreferences,
        [key]: value
      }
    });
  }
}

// ---------------------------------------------------------------------------
// ÉTAPE 31 — détection déterministe d'une préférence utilisateur exprimée.
// Heuristique purement lexicale (aucun LLM, aucun aléa) : la phrase est
// enregistrée via l'API existante setUserPreference dans le stockage
// existant (ProjectMemory.userPreferences — scope réel tenant/projet).
// ---------------------------------------------------------------------------

/** Formes négatives exclues : elles relèvent des contraintes, pas des préférences. */
const NEGATION_PATTERN = /\b(?:ne (?:pas|jamais|veut)|jamais|sans|aucun|aucune)\b/i;

/** « Je préfère X » / « Je souhaite X » / « J'aimerais X » — 1 à 6 mots capturés. */
const PREFERENCE_PATTERN =
  /(?:je\s+)?(?:pr[ée]f[èe]re|prefere|souhaite|aimerais)\s+(?:que\s+|les?\s+|la\s+|des?\s+|une?\s+|l')?([a-zà-ÿ0-9][\wà-ÿ'’-]*(?:\s+[a-zà-ÿ0-9][\wà-ÿ'’-]*){0,5})/i;

/** Mots génériques exclus de la dérivation de clé. */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'que', 'les', 'des', 'une', 'Dans', 'pour', 'avec', 'tout', 'toute', 'toutes', 'tous',
  'être', 'etre', 'avoir', 'faire', 'cela', 'cette', 'ceux', 'celui'
]);

export interface ExtractedUserPreference {
  readonly key: string;
  readonly value: string;
}

/**
 * Extrait UNE préférence utilisateur d'un message, de façon déterministe.
 * Retourne null si le message n'exprime pas de préférence claire (ou si la
 * forme est négative — une négation est une contrainte, pas une préférence).
 * Même entrée → même sortie.
 */
export function extractUserPreference(text: string): ExtractedUserPreference | null {
  if (!text || typeof text !== 'string') return null;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (NEGATION_PATTERN.test(normalized)) return null;

  const match = normalized.match(PREFERENCE_PATTERN);
  if (!match) return null;
  const phrase = (match[1] ?? '').trim().replace(/[.,;:!?]+$/, '');
  if (phrase.length < 3) return null;

  // Clé = slug des 2 premiers mots significatifs (sémantique de mise à jour :
  // réexprimer la même préférence remplace la valeur précédente).
  const words = phrase
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
  const key = words.slice(0, 2).join('-') || phrase.toLowerCase().slice(0, 40);
  if (!key) return null;

  return { key, value: phrase };
}
