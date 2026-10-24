/**
 * VibeCode Core - Phase 9.5 : Decision Engine
 *
 * But : Centraliser la logique de décision avant exécution.
 *
 * Aujourd'hui, le ConversationCompass prend des décisions de transition
 * d'état sans accès aux contraintes (CDC/ADRs), aux décisions passées,
 * ni aux alternatives. Le DecisionEngine comble ce manque.
 *
 * Verdicts possibles :
 *  - READY              : peut exécuter maintenant
 *  - NEEDS_CONFIRMATION : risque modéré, utilisateur doit valider
 *  - BLOCKED            : contrainte HARD violée, refus
 *  - DEFERRED           : contradiction avec décision passée, à revoir
 */

import type { IntentResult } from '../conversation-intelligence/types.js';
import type { ProjectMemory } from '../conversation-intelligence/types.js';
import type { IntelligenceRecommendation } from '../intelligence-pool/types.js';
import type { MemorySignals } from './memory-signals.js';

export type DecisionVerdict =
  | 'READY'
  | 'NEEDS_CONFIRMATION'
  | 'BLOCKED'
  | 'DEFERRED';

export type ConstraintSource =
  | 'CDC'
  | 'ADR'
  | 'CONVENTION'
  | 'USER_PREFERENCE'
  | 'TECHNICAL';

export type ConstraintSeverity = 'HARD' | 'SOFT';

export interface DecisionConstraint {
  readonly id: string;
  readonly source: ConstraintSource;
  readonly statement: string;
  readonly severity: ConstraintSeverity;
  readonly rationale: string;
  readonly appliesTo?: readonly string[] | undefined;
}

export interface DecisionAlternative {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly constraintsHonored: readonly string[];
  readonly constraintsViolated: readonly string[];
  readonly riskScore: number;
  readonly reversible: boolean;
  readonly estimatedEffort: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly source: 'LLM' | 'INTELLIGENCE_POOL' | 'USER';
  readonly targetFiles: readonly string[];
  readonly proposedActions: readonly string[];
}

export interface Decision {
  readonly decisionId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly intentGoal: string;
  readonly intentCategory: string;
  readonly verdict: DecisionVerdict;
  readonly chosenAlternative?: DecisionAlternative | undefined;
  readonly alternatives: readonly DecisionAlternative[];
  readonly constraints: readonly DecisionConstraint[];
  /** Signaux mémoire réellement pris en compte (V7). */
  readonly memorySignals?: MemorySignals | undefined;
  readonly contradictingDecisions: readonly string[];
  readonly rationale: string;
  readonly requiredClarifications: readonly string[];
  readonly intelligenceSources: readonly string[];
  readonly createdAt: string;
  readonly status: 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED';
}

export interface DecisionContext {
  readonly intent: IntentResult;
  readonly projectId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly memory: ProjectMemory;
  readonly currentState?: string | undefined;
  readonly intelligenceRecommendations?: readonly IntelligenceRecommendation[] | undefined;
}

export interface DecisionOutcome {
  readonly decision: Decision;
  readonly nextState: string;
  readonly reasoningTrace: readonly string[];
}
