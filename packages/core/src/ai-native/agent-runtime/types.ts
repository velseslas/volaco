/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * AI Orchestration & Agent Execution Engine Contracts & Types
 */

import { AppError, type ErrorCode } from '../../errors.js';
import type { Role, Permission } from '../../identity/permissions.js';

// ============================================================================
// 1. AGENT ROLES & TYPES (9 Required Roles + Aliases)
// ============================================================================

export type AgentType =
  | 'ARCHITECT_AGENT'
  | 'CODE_AGENT'
  | 'UI_AGENT'
  | 'BACKEND_AGENT'
  | 'DATABASE_AGENT'
  | 'SECURITY_AGENT'
  | 'TEST_AGENT'
  | 'DEBUG_AGENT'
  | 'REVIEW_AGENT';

export type AgentRole =
  | AgentType
  | 'LOGIC_AGENT'
  | 'DATA_AGENT'
  | 'ARCHITECTURE_AGENT'
  | 'TESTING_AGENT'
  | 'DOCUMENTATION_AGENT'
  | 'GENERALIST';

// ============================================================================
// 2. STATE MACHINE (12 Required States + Aliases)
// ============================================================================

export type AgentState =
  | 'RECEIVED'
  | 'RECEIVING'
  | 'IDLE'
  | 'UNDERSTANDING'
  | 'PLANNING'
  | 'CONTEXT_BUILDING'
  | 'EXECUTING'
  | 'WAITING_GATE'
  | 'MUTATING'
  | 'VERIFYING'
  | 'REPAIRING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'IDLE'                 // alias for RECEIVED
  | 'WAITING_CONFIRMATION'; // alias for WAITING_GATE

export interface StateTransitionRecord {
  readonly from: AgentState;
  readonly to: AgentState;
  readonly reason: string;
  readonly timestamp: number;
  readonly runId: string;
  readonly evidenceRef?: string | undefined;
}

// ============================================================================
// 3. INTENT & GOALS
// ============================================================================

export type IntentType =
  | 'UNDERSTAND_PROJECT'
  | 'ANALYZE_CODE'
  | 'FIND_BUG'
  | 'EXPLAIN'
  | 'ADD_FEATURE'
  | 'MODIFY_FEATURE'
  | 'REFACTOR'
  | 'FIX_BUG'
  | 'CREATE_FILE'
  | 'DELETE_FILE'
  | 'RENAME'
  | 'TEST'
  | 'AUDIT'
  | 'OPTIMIZE'
  | 'ASK_INFORMATION';

export interface AgentIntent {
  readonly type: IntentType;
  readonly goal: string;
  readonly entities: readonly string[];
  readonly constraints: readonly string[];
  readonly requestedChanges: readonly string[];
  readonly confidence: number;
  readonly requiresMutation: boolean;
  readonly requiresConfirmation: boolean;
}

// ============================================================================
// 4. TASK DAG & DECOMPOSITION
// ============================================================================

export type TaskStatus =
  | 'PENDING'
  | 'READY'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED'
  | 'BLOCKED';

export interface ExecutionTask {
  readonly taskId: string;
  readonly description: string;
  readonly type: string;
  readonly dependencies: readonly string[];
  readonly requiredAgent: AgentType | AgentRole;
  readonly requiredContext: readonly string[];
  readonly requiredTools: readonly string[];
  readonly riskLevel: ToolRisk;
  status: TaskStatus;
  result?: unknown | undefined;
  error?: string | undefined;
  readonly id?: string | undefined;
  readonly title?: string | undefined;
  readonly assignedAgent?: AgentType | AgentRole | undefined;
  readonly estimatedTokens?: number | undefined;
}

export interface TaskDAGDefinition {
  readonly tasks: readonly ExecutionTask[];
}

// ============================================================================
// 5. CONTEXT REQUIREMENTS & PACKAGE
// ============================================================================

export type ContextRequirementPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface ContextRequirement {
  readonly type: string;
  readonly target: string;
  readonly reason: string;
  readonly priority: ContextRequirementPriority;
  readonly maxTokens: number;
  readonly required: boolean;
}

export interface ContextPackage {
  readonly tenantId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly files: readonly { readonly path: string; readonly content: string }[];
  readonly symbols: readonly string[];
  readonly dnaSummary?: unknown | undefined;
  readonly graphNodes?: readonly unknown[] | undefined;
  readonly impactHash?: string | undefined;
  readonly estimatedTokens: number;
}

// ============================================================================
// 6. TOOLS & TOOL REGISTRY (12 Standard Tools)
// ============================================================================

export type ToolRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ToolId =
  | 'READ_PROJECT'
  | 'READ_FILE'
  | 'SEARCH_CODE'
  | 'ANALYZE_CODE'
  | 'GET_APPLICATION_DNA'
  | 'GET_SEMANTIC_GRAPH'
  | 'ANALYZE_IMPACT'
  | 'BUILD_MUTATION_PLAN'
  | 'PREVIEW_MUTATION'
  | 'EXECUTE_MUTATION'
  | 'VALIDATE_RESULT'
  | 'RUN_TESTS'
  | string;

export interface ToolDefinition {
  readonly toolId?: ToolId | undefined;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
  readonly requiredPermission?: Permission | undefined;
  readonly permissions: readonly string[];
  readonly riskLevel?: ToolRisk | undefined;
  readonly risk: ToolRisk;
  readonly readOnly?: boolean | undefined;
  readonly isReadonly: boolean;
  readonly timeoutMs: number;
  readonly idempotent: boolean;
  readonly provenance?: string | undefined;
}

export interface ToolSelection {
  readonly tool: string;
  readonly reason: string;
  readonly priority: number;
  readonly expectedInformationGain: number;
  readonly risk: ToolRisk;
  readonly input: Record<string, unknown>;
}

export interface ToolExecutionResult {
  readonly tool: string;
  readonly success: boolean;
  readonly output: unknown;
  readonly error?: string | undefined;
  readonly durationMs: number;
  readonly evidenceGenerated?: readonly EvidenceRecord[] | undefined;
}

// ============================================================================
// 7. AGENT DEFINITION & CAPABILITIES
// ============================================================================

export interface AgentCapabilities {
  readonly canReadFiles: boolean;
  readonly canInspectAst: boolean;
  readonly canInspectGraph: boolean;
  readonly canAnalyzeImpact: boolean;
  readonly canPlanMutations: boolean;
  readonly canExecuteMutations: boolean;
  readonly canRunTests: boolean;
  readonly canRunBuild: boolean;
}

export interface AgentDefinition {
  readonly identity?: { readonly id: string; readonly name: string; readonly role: AgentRole } | undefined;
  readonly agentId: string;
  readonly agentType: AgentType | AgentRole;
  readonly name: string;
  readonly capabilities: AgentCapabilities;
  readonly allowedOperations: readonly string[];
  readonly requiredContext: readonly string[];
  readonly riskLevel: ToolRisk;
  readonly maxExecutionDepth: number;
  readonly permissions: readonly Permission[];
  readonly systemPrompt: string;
  readonly defaultTools: readonly string[];
}

// ============================================================================
// 8. REASONING BUDGET & LIMITS
// ============================================================================

export interface ReasoningBudget {
  readonly maxTasks?: number | undefined;
  readonly maxDepth?: number | undefined;
  readonly maxAgentCalls?: number | undefined;
  readonly maxIterations: number;
  readonly maxToolCalls: number;
  readonly maxTokens: number;
  readonly maxCost: number;
  readonly maxExecutionTimeMs: number;
  readonly maxRetries?: number | undefined;
  readonly maxRepairAttempts: number;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface ReasoningBudgetUsage {
  readonly currentIterations: number;
  readonly currentToolCalls: number;
  readonly currentTokens: TokenUsage;
  readonly currentCost: number;
  readonly elapsedTimeMs: number;
  readonly currentRepairAttempts: number;
  readonly currentRetries?: number | undefined;
}

// ============================================================================
// 9. EVIDENCE & HALLUCINATION CONTROL
// ============================================================================

export type EvidenceKind =
  | 'SOURCE_FILE'
  | 'TOOL_RESULT'
  | 'AST_NODE'
  | 'GRAPH_EDGE'
  | 'CONTEXT_FRAGMENT'
  | 'IMPACT_ANALYSIS'
  | 'MUTATION_RESULT'
  | 'VERIFICATION_RESULT';

export type ClaimConfidence = 'FACT' | 'INFERENCE' | 'ASSUMPTION' | 'UNKNOWN';

export interface EvidenceRecord {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly source: string;
  readonly reference: string;
  readonly summary: string;
  readonly timestamp: number;
  readonly payload?: Record<string, unknown> | undefined;
}

export type AssumptionStatus = 'PROPOSED' | 'VALIDATED' | 'REJECTED' | 'EXPIRED';

export interface Assumption {
  readonly id: string;
  readonly statement: string;
  readonly confidence: number;
  readonly evidence: readonly string[];
  readonly status: AssumptionStatus;
  readonly createdAt: number;
  readonly validatedAt?: number | undefined;
}

// ============================================================================
// 10. RECOVERY ERROR TAXONOMY (8 Required Types)
// ============================================================================

export type RecoveryErrorKind =
  | 'TRANSIENT_ERROR'
  | 'MODEL_ERROR'
  | 'VALIDATION_ERROR'
  | 'TOOL_ERROR'
  | 'STALE_CONTEXT'
  | 'IMPACT_FAILURE'
  | 'MUTATION_FAILURE'
  | 'POST_VALIDATION_FAILURE';

export interface RecoveryAttemptRecord {
  readonly attemptNumber: number;
  readonly errorKind: RecoveryErrorKind;
  readonly message: string;
  readonly rollbackExecuted: boolean;
  readonly timestamp: number;
  readonly resolved: boolean;
}

// ============================================================================
// 11. AUDIT & PROVENANCE (15 Required Event Types)
// ============================================================================

export type AuditEventType =
  | 'ORCHESTRATION_STARTED'
  | 'INTENT_PARSED'
  | 'TASK_CREATED'
  | 'AGENT_SELECTED'
  | 'CONTEXT_ASSEMBLED'
  | 'TOOL_CALLED'
  | 'AGENT_OUTPUT_VALIDATED'
  | 'IMPACT_ANALYZED'
  | 'APPROVAL_REQUIRED'
  | 'MUTATION_REQUESTED'
  | 'MUTATION_COMPLETED'
  | 'VALIDATION_COMPLETED'
  | 'RECOVERY_STARTED'
  | 'ORCHESTRATION_COMPLETED'
  | 'ORCHESTRATION_FAILED'
  // Legacy aliases
  | 'RUN_STARTED'
  | 'INTENT_DETECTED'
  | 'CONTEXT_REQUESTED'
  | 'TOOL_SELECTED'
  | 'TOOL_EXECUTED'
  | 'PLAN_CREATED'
  | 'CONFIRMATION_REQUESTED'
  | 'MUTATION_STARTED'
  | 'VERIFICATION_STARTED'
  | 'VERIFICATION_COMPLETED'
  | 'REPAIR_STARTED'
  | 'REPAIR_COMPLETED'
  | 'RUN_COMPLETED'
  | 'RUN_FAILED'
  | 'RUN_CANCELLED';

export interface AgentAuditEvent {
  readonly id: string;
  readonly executionId?: string | undefined;
  readonly runId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly type: AuditEventType;
  readonly timestamp: number;
  readonly actor?: string | undefined;
  readonly agentId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly payload: Record<string, unknown>;
  readonly provenance?: string | undefined;
}

export type AgentRuntimeEvent = AgentAuditEvent;

// ============================================================================
// 12. AGENT STEP & PLAN
// ============================================================================

export type AgentStepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export interface AgentStep {
  readonly id: string;
  readonly index: number;
  readonly description: string;
  readonly tool: string;
  readonly parameters: Record<string, unknown>;
  readonly expectedOutput?: string | undefined;
  readonly status: AgentStepStatus;
  readonly result?: unknown | undefined;
  readonly error?: string | undefined;
}

export interface AgentPlan {
  readonly id: string;
  readonly goal: string;
  readonly assumptions: readonly Assumption[];
  readonly steps: readonly AgentStep[];
  readonly tasks?: readonly ExecutionTask[] | undefined;
  readonly requiredTools: readonly string[];
  readonly expectedChanges: readonly string[];
  readonly risks: readonly string[];
  readonly impactAnalysis?: unknown | undefined;
  readonly confirmationRequired: boolean;
  readonly validated: boolean;
}

// ============================================================================
// 13. OBSERVABILITY METRICS
// ============================================================================

export interface OrchestrationMetrics {
  executionCount: number;
  successCount: number;
  failureCount: number;
  averageExecutionTime: number;
  agentCalls: number;
  toolCalls: number;
  retryCount: number;
  repairCount: number;
  blockedMutations: number;
  impactGates: number;
  cacheHits: number;
  cacheMisses: number;
}

// ============================================================================
// 14. MEMORY & RUN
// ============================================================================

export interface ConversationMessage {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly timestamp: number;
}

export interface ObservationRecord {
  readonly id: string;
  readonly text: string;
  readonly source: string;
  readonly timestamp: number;
}

export interface DecisionRecord {
  readonly id: string;
  readonly rationale: string;
  readonly alternativesConsidered: readonly string[];
  readonly chosenAction: string;
  readonly timestamp: number;
  readonly evidenceRefs: readonly string[];
}

export interface RunMemory {
  readonly runId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly conversationHistory: readonly ConversationMessage[];
  readonly observations: readonly ObservationRecord[];
  readonly decisions: readonly DecisionRecord[];
  readonly toolInvocations: readonly ToolExecutionResult[];
  readonly assumptions: readonly Assumption[];
  readonly facts: readonly EvidenceRecord[];
}

export interface AgentRun {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly agentId: string;
  readonly role: AgentRole;
  readonly state: AgentState;
  readonly intent?: AgentIntent | undefined;
  readonly plan?: AgentPlan | undefined;
  readonly tasks?: readonly ExecutionTask[] | undefined;
  readonly budget: ReasoningBudget;
  readonly budgetUsage: ReasoningBudgetUsage;
  readonly memory: RunMemory;
  readonly events: readonly AgentAuditEvent[];
  readonly runHash: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly error?: string | undefined;
  readonly confirmationRequested?: boolean | undefined;
}

export interface AgentPlanPreview {
  readonly runId: string;
  readonly plan: AgentPlan;
  readonly diffs?: readonly unknown[] | undefined;
  readonly impactRisk?: string | undefined;
  readonly confirmationRequired: boolean;
}

// ============================================================================
// 15. TYPED ERRORS HIERARCHY
// ============================================================================

export class AgentRuntimeError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = 'INTERNAL_ERROR',
    statusCode = 500,
    context?: Record<string, unknown> | undefined,
    requestId?: string | undefined
  ) {
    super(message, code, statusCode, context, requestId);
    this.name = 'AgentRuntimeError';
  }
}

export class CycleDetectedError extends AgentRuntimeError {
  constructor(cycleNodes: readonly string[], requestId?: string | undefined) {
    super(
      `Cycle de dépendance détecté dans le DAG des tâches : ${cycleNodes.join(' -> ')}`,
      'VALIDATION_ERROR',
      400,
      { cycleNodes },
      requestId
    );
    this.name = 'CycleDetectedError';
  }
}

export class AgentCapabilityError extends AgentRuntimeError {
  constructor(
    agentType: string,
    operation: string,
    allowedOperations: readonly string[],
    requestId?: string | undefined
  ) {
    super(
      `Violation de capability boundary : l'agent '${agentType}' n'est pas autorisé à exécuter '${operation}'. Opérations autorisées : [${allowedOperations.join(', ')}]`,
      'FORBIDDEN',
      403,
      { agentType, operation, allowedOperations },
      requestId
    );
    this.name = 'AgentCapabilityError';
  }
}

export class GateRejectedError extends AgentRuntimeError {
  constructor(
    gate: 'IMPACT_GATE' | 'APPROVAL_GATE' | 'MUTATION_GATE',
    reason: string,
    details?: Record<string, unknown> | undefined,
    requestId?: string | undefined
  ) {
    super(
      `Action bloquée par le gate '${gate}' : ${reason}`,
      'FORBIDDEN',
      403,
      { gate, reason, ...details },
      requestId
    );
    this.name = 'GateRejectedError';
  }
}

export class RecoveryExhaustedError extends AgentRuntimeError {
  constructor(
    attempts: number,
    errorKind: RecoveryErrorKind,
    lastError: string,
    requestId?: string | undefined
  ) {
    super(
      `Mécanisme de récupération épuisé après ${attempts} tentatives (type: ${errorKind}). Dernière erreur : ${lastError}`,
      'INTERNAL_ERROR',
      500,
      { attempts, errorKind, lastError },
      requestId
    );
    this.name = 'RecoveryExhaustedError';
  }
}

export class InvalidStateTransitionError extends AgentRuntimeError {
  constructor(
    from: AgentState,
    to: AgentState,
    reason?: string | undefined,
    requestId?: string | undefined
  ) {
    super(
      `Transition d'état invalide : '${from}' vers '${to}'${reason ? ` (${reason})` : ''}`,
      'VALIDATION_ERROR',
      400,
      { from, to, reason },
      requestId
    );
    this.name = 'InvalidStateTransitionError';
  }
}

export class LLMProviderError extends AgentRuntimeError {
  constructor(
    message: string,
    provider: string,
    context?: Record<string, unknown> | undefined,
    requestId?: string | undefined
  ) {
    super(
      `Erreur fournisseur LLM (${provider}) : ${message}`,
      'INTERNAL_ERROR',
      502,
      { provider, ...context },
      requestId
    );
    this.name = 'LLMProviderError';
  }
}

export class ToolExecutionError extends AgentRuntimeError {
  constructor(
    tool: string,
    message: string,
    context?: Record<string, unknown> | undefined,
    requestId?: string | undefined
  ) {
    super(
      `Erreur lors de l'exécution de l'outil '${tool}' : ${message}`,
      'INTERNAL_ERROR',
      500,
      { tool, ...context },
      requestId
    );
    this.name = 'ToolExecutionError';
  }
}

export class BudgetExceededError extends AgentRuntimeError {
  constructor(
    resource: string,
    limit: number,
    current: number,
    requestId?: string | undefined
  ) {
    super(
      `Budget de raisonnement dépassé pour '${resource}' : limite=${limit}, actuel=${current}`,
      'BAD_REQUEST',
      429,
      { resource, limit, current },
      requestId
    );
    this.name = 'BudgetExceededError';
  }
}

export class HallucinationError extends AgentRuntimeError {
  constructor(
    claim: string,
    missingEvidence: string,
    requestId?: string | undefined
  ) {
    super(
      `Hallucination détectée (NO EVIDENCE -> NO CLAIM) : '${claim}'. Preuve manquante : ${missingEvidence}`,
      'VALIDATION_ERROR',
      422,
      { claim, missingEvidence },
      requestId
    );
    this.name = 'HallucinationError';
  }
}

export class ConfirmationRequiredError extends AgentRuntimeError {
  constructor(
    reason: string,
    runId: string,
    requestId?: string | undefined
  ) {
    super(
      `Confirmation explicite de l'utilisateur requise : ${reason}`,
      'FORBIDDEN',
      403,
      { reason, runId },
      requestId
    );
    this.name = 'ConfirmationRequiredError';
  }
}

export class RepairExhaustedError extends AgentRuntimeError {
  constructor(
    attempts: number,
    lastError: string,
    requestId?: string | undefined
  ) {
    super(
      `Nombre maximal de tentatives de réparation (${attempts}) épuisé. Dernière erreur : ${lastError}`,
      'INTERNAL_ERROR',
      500,
      { attempts, lastError },
      requestId
    );
    this.name = 'RepairExhaustedError';
  }
}

export class PlanValidationError extends AgentRuntimeError {
  constructor(
    message: string,
    errors: readonly string[],
    requestId?: string | undefined
  ) {
    super(
      `Validation du plan échouée : ${message} : ${errors.join('; ')}`,
      'VALIDATION_ERROR',
      400,
      { errors },
      requestId
    );
    this.name = 'PlanValidationError';
  }
}

export class AgentSecurityError extends AgentRuntimeError {
  constructor(
    message: string,
    context?: Record<string, unknown> | undefined,
    requestId?: string | undefined
  ) {
    super(
      `Violation de sécurité Agent Runtime : ${message}`,
      'FORBIDDEN',
      403,
      context,
      requestId
    );
    this.name = 'AgentSecurityError';
  }
}
