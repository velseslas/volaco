/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Conversation Intelligence & Human-AI Engineering Engine Data Contracts
 */

import type { ApplicationSemanticModel } from '../application-understanding/types.js';
import type { ConversationContext } from './engine/context-builder.js';

export type ConversationState =
  | 'EXPLORING'
  | 'UNDERSTANDING'
  | 'CLARIFYING'
  | 'WAITING_CONFIRMATION'
  | 'PLANNING'
  | 'EXECUTING'
  | 'REPAIRING'
  | 'VALIDATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ROLLED_BACK';

export type IntentCategory =
  | 'QUESTION'
  | 'EXPLORATION'
  | 'CREATE'
  | 'MODIFY'
  | 'DELETE'
  | 'REFACTOR'
  | 'DEBUG'
  | 'ANALYZE'
  | 'EXPLAIN'
  | 'REVIEW'
  | 'OPTIMIZE'
  | 'TEST'
  | 'DEPLOYMENT'
  | 'NAVIGATION'
  | 'UNKNOWN';

export type AmbiguityLevel =
  | 'SAFE_TO_ASSUME'
  | 'LOW_RISK'
  | 'NEEDS_CONFIRMATION'
  | 'BLOCKING';

export type NextActionKind =
  | 'ASK_QUESTION'
  | 'REQUEST_CONFIRMATION'
  | 'PRESENT_PLAN'
  | 'EXECUTE_PLAN'
  | 'REQUEST_UNDERSTANDING'
  | 'RESPOND_DIRECTLY'
  | 'ROLLBACK';

export type DecisionStatus =
  | 'ACTIVE'
  | 'SUPERSEDED'
  | 'REJECTED'
  | 'REVERTED';

export type PlanStatus =
  | 'DRAFT'
  | 'ASSESSED'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTED'
  | 'FAILED'
  | 'ROLLED_BACK';

export interface ClarificationItem {
  readonly id: string;
  readonly question: string;
  readonly level: AmbiguityLevel;
  readonly suggestedDefault?: string | undefined;
  readonly reason: string;
}

export interface ConversationAssumption {
  readonly id: string;
  readonly statement: string;
  readonly confidence: number;
  readonly evidence: string;
  readonly risk: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly reversible: boolean;
  readonly requiresConfirmation: boolean;
  readonly status: 'PROPOSED' | 'CONFIRMED' | 'REJECTED';
}

export interface IntentResult {
  readonly category: IntentCategory;
  readonly domain?: string | undefined;
  readonly goal: string;
  readonly requestedAction: string;
  readonly entities: readonly string[];
  readonly constraints: readonly string[];
  readonly urgency: 'LOW' | 'NORMAL' | 'HIGH';
  readonly confidence: number;
  readonly ambiguities: readonly ClarificationItem[];
}

export interface ArchitecturalDecisionRecord {
  readonly decisionId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly statement: string;
  readonly reason: string;
  readonly evidence: string;
  readonly confidence: number;
  readonly alternatives: readonly string[];
  readonly selectedAlternative: string;
  readonly status: DecisionStatus;
  readonly createdAt: string;
}

// Internal alias
export type DecisionRecord = ArchitecturalDecisionRecord;

export interface PlanStep {
  readonly stepIndex: number;
  readonly title: string;
  readonly description: string;
  readonly targetDomain?: string | undefined;
  readonly targetFiles?: readonly string[] | undefined;
  readonly operation: 'ANALYZE' | 'CREATE' | 'MODIFY' | 'DELETE' | 'VERIFY';
  readonly requiresApproval: boolean;
}

export interface EngineeringPlan {
  readonly planId: string;
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly PlanStep[];
  readonly estimatedImpact?: string | undefined;
  readonly planHash: string;
  readonly status: PlanStatus;
}

export interface PlanAssessment {
  readonly completeness: number;
  readonly consistency: number;
  readonly riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly confidence: number;
  readonly reversibility: boolean;
  readonly isAcceptable: boolean;
  readonly issues: readonly string[];
}

export interface ContradictionRecord {
  readonly id: string;
  readonly type: 'DECISION_CONFLICT' | 'CONSTRAINT_CONFLICT' | 'ARCHITECTURE_CONFLICT';
  readonly previousItem: string;
  readonly newItem: string;
  readonly explanation: string;
  readonly resolved: boolean;
  readonly resolution?: string | undefined;
}

export interface ContextDelta {
  readonly addedRequirements: readonly string[];
  readonly removedRequirements: readonly string[];
  readonly newConstraints: readonly string[];
  readonly newEntities: readonly string[];
  readonly newDecisions: readonly ArchitecturalDecisionRecord[];
}

export interface HumanAiMessage {
  readonly id: string;
  readonly sender: 'HUMAN' | 'AGENT' | 'SYSTEM';
  readonly content: string;
  readonly timestamp: string;
}

// Internal alias
export type ConversationMessage = HumanAiMessage;

export interface ConversationTrace {
  readonly traceId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly stateBefore: ConversationState;
  readonly stateAfter: ConversationState;
  readonly intentCategory: IntentCategory;
  readonly contextHash: string;
  readonly applicationHash: string;
  readonly actionTaken: string;
  readonly confidence: number;
  readonly events: readonly string[];
  readonly durationMs: number;
}

export interface ConversationTurn {
  readonly turnIndex: number;
  readonly turnId: string;
  readonly userMessage: HumanAiMessage;
  readonly stateBefore: ConversationState;
  readonly stateAfter: ConversationState;
  readonly intent: IntentResult;
  readonly contextDelta?: ContextDelta | undefined;
  readonly assumptions: readonly ConversationAssumption[];
  readonly decisions: readonly ArchitecturalDecisionRecord[];
  readonly plan?: EngineeringPlan | undefined;
  readonly agentResponse: HumanAiMessage;
  readonly trace: ConversationTrace;
}

export interface TurnMemory {
  readonly lastMessage?: HumanAiMessage | undefined;
  readonly recentMessages: readonly HumanAiMessage[];
  readonly activeIntent?: IntentResult | undefined;
  readonly currentPlan?: EngineeringPlan | undefined;
  readonly currentAssumptions: readonly ConversationAssumption[];
}

export interface ProjectMemory {
  readonly architecturalDecisions: readonly ArchitecturalDecisionRecord[];
  readonly userPreferences: Record<string, string>;
  readonly acceptedPlans: readonly string[];
  readonly rejectedPlans: readonly string[];
  readonly knownConstraints: readonly string[];
  readonly knownConventions: readonly string[];
  readonly knownRisks: readonly string[];
}

export interface ApplicationSnapshot {
  readonly treeHash: string;
  readonly graphHash: string;
  readonly understandingHash: string;
}

export interface ConversationSession {
  readonly sessionId: string;
  readonly conversationId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly currentState: ConversationState;
  readonly turns: readonly ConversationTurn[];
  readonly activeIntent?: IntentResult | undefined;
  readonly activePlan?: EngineeringPlan | undefined;
  readonly activeAssumptions: readonly ConversationAssumption[];
  readonly activeDecisions: readonly ArchitecturalDecisionRecord[];
  readonly pendingApproval?: { readonly planId: string; readonly reason: string } | undefined;
  readonly applicationSnapshot: ApplicationSnapshot;
  readonly turnMemory: TurnMemory;
  readonly projectMemory: ProjectMemory;
}

export interface ReasoningRequest {
  readonly userMessage: string;
  readonly history: readonly HumanAiMessage[];
  readonly intent: IntentResult;
  readonly applicationModel?: ApplicationSemanticModel | undefined;
  readonly memory: {
    readonly project: ProjectMemory;
    readonly turn: TurnMemory;
  };
  /** ÉTAPE 30 — contexte conversationnel borné et déterministe construit par ConversationContextBuilder. */
  readonly context?: ConversationContext | undefined;
}

export interface ReasoningResponse {
  readonly interpretation: string;
  readonly intent: IntentResult;
  readonly assumptions: readonly ConversationAssumption[];
  readonly clarifications: readonly ClarificationItem[];
  readonly plan?: EngineeringPlan | undefined;
  readonly reply: string;
  readonly confidence: number;
  readonly nextAction: NextActionKind;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface ReasoningProvider {
  reason(request: ReasoningRequest): Promise<ReasoningResponse>;
}

export interface ConversationIntelligenceConfig {
  readonly maxTurnsPerSession: number;
  readonly maxHistoryMessages: number;
  readonly cacheMaxEntries: number;
  readonly requireConfirmationForMediumRisk: boolean;
  readonly defaultReasoningTimeoutMs: number;
}

export interface ConversationCacheMetrics {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly activeSessions: number;
  readonly maxEntries: number;
}
