/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Conversation Compass - State Machine & Navigation Engine
 */

import { ValidationError } from '../../../errors.js';
import type {
  AmbiguityLevel,
  ClarificationItem,
  ConversationAssumption,
  ConversationState,
  IntentResult,
  PlanAssessment
} from '../types.js';

/**
 * Valid state transitions table for Human-AI Engineering conversations.
 */
export const VALID_CONVERSATION_TRANSITIONS: Readonly<Record<ConversationState, readonly ConversationState[]>> = {
  EXPLORING: [
    'EXPLORING',
    'UNDERSTANDING',
    'PLANNING',
    'CLARIFYING',
    'WAITING_CONFIRMATION',
    'EXECUTING',
    'COMPLETED'
  ],
  UNDERSTANDING: [
    'UNDERSTANDING',
    'CLARIFYING',
    'WAITING_CONFIRMATION',
    'PLANNING',
    'EXPLORING',
    'COMPLETED'
  ],
  CLARIFYING: [
    'CLARIFYING',
    'WAITING_CONFIRMATION',
    'PLANNING',
    'UNDERSTANDING',
    'EXPLORING',
    'COMPLETED'
  ],
  WAITING_CONFIRMATION: [
    'WAITING_CONFIRMATION',
    'PLANNING',
    'EXECUTING',
    'EXPLORING',
    'FAILED',
    'COMPLETED'
  ],
  PLANNING: [
    'PLANNING',
    'WAITING_CONFIRMATION',
    'EXECUTING',
    'EXPLORING',
    'CLARIFYING',
    'COMPLETED'
  ],
  EXECUTING: [
    'EXECUTING',
    'VALIDATING',
    'REPAIRING',
    'FAILED',
    'COMPLETED',
    'ROLLED_BACK'
  ],
  REPAIRING: [
    'REPAIRING',
    'EXECUTING',
    'VALIDATING',
    'FAILED',
    'ROLLED_BACK'
  ],
  VALIDATING: [
    'VALIDATING',
    'COMPLETED',
    'REPAIRING',
    'FAILED',
    'ROLLED_BACK',
    'EXECUTING'
  ],
  COMPLETED: [
    'COMPLETED',
    'EXPLORING',
    'UNDERSTANDING',
    'PLANNING',
    'CLARIFYING'
  ],
  FAILED: [
    'FAILED',
    'EXPLORING',
    'UNDERSTANDING',
    'PLANNING',
    'ROLLED_BACK'
  ],
  ROLLED_BACK: [
    'ROLLED_BACK',
    'EXPLORING',
    'UNDERSTANDING',
    'PLANNING'
  ]
};

export class ConversationCompass {
  /**
   * Checks whether a state transition is permitted.
   */
  public canTransition(from: ConversationState, to: ConversationState): boolean {
    const allowed = VALID_CONVERSATION_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  /**
   * Performs and validates a state transition.
   */
  public transition(from: ConversationState, to: ConversationState, reason: string): ConversationState {
    if (!this.canTransition(from, to)) {
      throw new ValidationError(
        `Transition d'état de conversation invalide: impossible de passer de '${from}' à '${to}' (Raison: ${reason})`
      );
    }
    return to;
  }

  /**
   * Determines the optimal next conversation state based on intent, ambiguities, assumptions, and plan.
   */
  public determineNextState(params: {
    currentState: ConversationState;
    intent: IntentResult;
    ambiguities: readonly ClarificationItem[];
    assumptions: readonly ConversationAssumption[];
    hasPlan: boolean;
    planApproved?: boolean | undefined;
    planAssessment?: PlanAssessment | undefined;
    autoConfirmLowRisk?: boolean | undefined;
  }): ConversationState {
    const { currentState, intent, ambiguities, assumptions, hasPlan, planApproved, planAssessment, autoConfirmLowRisk } = params;

    // 1. Check for blocking ambiguities (cannot proceed without user clarification)
    const hasBlockingAmbiguity = ambiguities.some((a) => a.level === 'BLOCKING');
    if (hasBlockingAmbiguity) {
      return this.canTransition(currentState, 'CLARIFYING') ? 'CLARIFYING' : currentState;
    }

    // 2. Check for items requiring explicit user confirmation
    const hasNeedsConfirmation =
      ambiguities.some((a) => a.level === 'NEEDS_CONFIRMATION') ||
      assumptions.some((a) => a.requiresConfirmation && a.status === 'PROPOSED') ||
      intent.category === 'DELETE';
    if (hasNeedsConfirmation) {
      return this.canTransition(currentState, 'WAITING_CONFIRMATION') ? 'WAITING_CONFIRMATION' : currentState;
    }

    // 3. Informational or exploratory intents (no code mutations)
    if (
      intent.category === 'QUESTION' ||
      intent.category === 'EXPLAIN' ||
      intent.category === 'EXPLORATION' ||
      intent.category === 'REVIEW' ||
      intent.category === 'NAVIGATION'
    ) {
      return 'COMPLETED';
    }

    // 4. Analysis or deep understanding
    if (intent.category === 'ANALYZE') {
      return 'UNDERSTANDING';
    }

    // 5. Engineering mutation intents (CREATE, MODIFY, DELETE, REFACTOR, DEBUG, OPTIMIZE, TEST, DEPLOYMENT)
    if (hasPlan) {
      if (planApproved) {
        return this.canTransition(currentState, 'EXECUTING') ? 'EXECUTING' : currentState;
      }

      // Check if plan requires explicit confirmation
      const isCriticalOrHighRisk =
        planAssessment && (planAssessment.riskLevel === 'HIGH' || planAssessment.riskLevel === 'CRITICAL');

      if (isCriticalOrHighRisk || !autoConfirmLowRisk) {
        return this.canTransition(currentState, 'WAITING_CONFIRMATION') ? 'WAITING_CONFIRMATION' : currentState;
      }

      return this.canTransition(currentState, 'PLANNING') ? 'PLANNING' : currentState;
    }

    // Default to PLANNING for code-altering intents when no plan exists yet
    return this.canTransition(currentState, 'PLANNING') ? 'PLANNING' : currentState;
  }

  /**
   * PHASE 5 — Détermine l'état suivant en utilisant le nextAction retourné
   * par le LLM (LLMReasoningProvider). Contrairement à determineNextState qui
   * est rule-based (regarde l'intent + ambiguities), cette méthode fait
   * confiance au LLM pour piloter la machine à états, tout en respectant la
   * table de transitions valides.
   *
   * Si le LLM demande un état invalide (transition impossible depuis l'état
   * courant), on garde l'état courant pour ne pas casser la machine.
   */
  public determineNextStateFromAction(
    currentState: ConversationState,
    nextAction: import('../types.js').NextActionKind
  ): ConversationState {
    const mapping: Readonly<Record<import('../types.js').NextActionKind, ConversationState>> = {
      ASK_QUESTION: 'CLARIFYING',
      REQUEST_CONFIRMATION: 'WAITING_CONFIRMATION',
      PRESENT_PLAN: 'PLANNING',
      EXECUTE_PLAN: 'EXECUTING',
      REQUEST_UNDERSTANDING: 'UNDERSTANDING',
      RESPOND_DIRECTLY: 'COMPLETED',
      ROLLBACK: 'ROLLED_BACK'
    };
    const targetState = mapping[nextAction];
    if (this.canTransition(currentState, targetState)) {
      return targetState;
    }
    // Si la transition n'est pas valide depuis l'état courant, on reste
    // (le LLM a pu demander EXECUTE_PLAN alors qu'on est en EXPLORING par ex)
    return currentState;
  }

  /**
   * PHASE 9.5 — Détermine l'état suivant en utilisant le DecisionEngine.
   *
   * Le DecisionEngine produit un verdict (READY / NEEDS_CONFIRMATION /
   * BLOCKED / DEFERRED) qui pilote directement la transition du Compass.
   *
   * Règles :
   *  - Informational intents (QUESTION, EXPLAIN, EXPLORATION, REVIEW, NAVIGATION)
   *    → COMPLETED (pas de mutation, juste une réponse)
   *  - BLOCKED → CLARIFYING (il faut clarifier avec l'utilisateur)
   *  - DEFERRED → CLARIFYING (conflit avec décision passée, à revoir)
   *  - NEEDS_CONFIRMATION → WAITING_CONFIRMATION
   *  - READY + ANALYZE → UNDERSTANDING
   *  - READY + autre → PLANNING (puis EXECUTING après validation utilisateur)
   */
  public determineNextStateWithDecision(params: {
    currentState: ConversationState;
    intent: IntentResult;
    decision: import('../../decision-engine/types.js').Decision;
  }): ConversationState {
    const { currentState, intent, decision } = params;

    // Informational intents → COMPLETED directement
    if (
      intent.category === 'QUESTION' ||
      intent.category === 'EXPLAIN' ||
      intent.category === 'EXPLORATION' ||
      intent.category === 'REVIEW' ||
      intent.category === 'NAVIGATION'
    ) {
      return this.canTransition(currentState, 'COMPLETED') ? 'COMPLETED' : currentState;
    }

    switch (decision.verdict) {
      case 'BLOCKED':
        return this.canTransition(currentState, 'CLARIFYING') ? 'CLARIFYING' : currentState;
      case 'DEFERRED':
        return this.canTransition(currentState, 'CLARIFYING') ? 'CLARIFYING' : currentState;
      case 'NEEDS_CONFIRMATION':
        return this.canTransition(currentState, 'WAITING_CONFIRMATION') ? 'WAITING_CONFIRMATION' : currentState;
      case 'READY':
        if (intent.category === 'ANALYZE') {
          return this.canTransition(currentState, 'UNDERSTANDING') ? 'UNDERSTANDING' : currentState;
        }
        // CREATE, MODIFY, DELETE, REFACTOR, DEBUG, OPTIMIZE, TEST, DEPLOYMENT, UNKNOWN
        // → PLANNING (le Compass attendra l'approval avant EXECUTING)
        return this.canTransition(currentState, 'PLANNING') ? 'PLANNING' : currentState;
      default:
        return currentState;
    }
  }
}
