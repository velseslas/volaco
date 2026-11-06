/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * AI Orchestrator & Engineering Agent Orchestrator Type Definitions
 */

import type { Role } from '../../identity/permissions.js';
import type { ProviderCapability } from '../../ai/providers/types.js';
import type { EngineeringPlan, HumanAiMessage, IntentResult } from '../conversation-intelligence/types.js';
import type { ApplicationSemanticModel } from '../application-understanding/types.js';
import type { ImpactAnalysis } from '../impact-intelligence/types.js';
import type { ProjectDesignContext } from '../design-harmony/design-context.js';
import type { StructuredDiff, TransactionStatus } from '../mutation-orchestrator/types.js';
import type { EngineeringPreflightReport } from '../validation/engineering-preflight.js';
import type { BrowserSandboxReport } from '../validation/browser-sandbox.js';
import type { BrowserFunctionalTestsReport } from '../validation/functional-tests.js';

export type AgentDomain =
  | 'UI'
  | 'BACKEND'
  | 'DATA'
  | 'SECURITY'
  | 'TEST'
  | 'ARCHITECTURE'
  | 'CODE';

export type AgentCapability =
  | 'PAGE_GENERATION'
  | 'COMPONENT_STYLING'
  | 'RESPONSIVE_LAYOUT'
  | 'API_DESIGN'
  | 'SERVICE_LOGIC'
  | 'SCHEMA_MODELING'
  | 'DATA_INTEGRITY'
  | 'AUTH_RBAC'
  | 'VULNERABILITY_SCAN'
  | 'UNIT_TEST_GEN'
  | 'FILE_MUTATION'
  | 'INTEGRATION_TEST'
  | 'E2E_SCENARIO'
  | 'IMPACT_ASSESSMENT';

export type AgentRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface SpecializedAgentDefinition {
  readonly id: string;
  readonly name: string;
  readonly domain: AgentDomain;
  readonly capabilities: readonly AgentCapability[];
  readonly description: string;
  readonly riskLevel: AgentRiskLevel;
  readonly requiredProviderCapabilities: readonly ProviderCapability[];
  readonly allowedTools: readonly string[];
}

export type AgentTaskStatus =
  | 'QUEUED'
  | 'READY'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED';

export interface TaskContextRequirements {
  readonly includeSemanticModel?: boolean | undefined;
  readonly includeDna?: boolean | undefined;
  readonly includeSemanticGraph?: boolean | undefined;
  readonly targetFiles?: readonly string[] | undefined;
  readonly targetSymbols?: readonly string[] | undefined;
  readonly maxTokensBudget?: number | undefined;
}

export interface TaskContextPayload {
  readonly understandingSnapshot?: Partial<ApplicationSemanticModel> | undefined;
  readonly relevantFiles: Record<string, string>;
  readonly relevantSymbols: readonly string[];
  readonly decisions: readonly string[];
  readonly constraints: readonly string[];
  readonly recentHistory: readonly HumanAiMessage[];
  /**
   * CDC V8 §11 — Design DNA RÉEL du projet (tokens inférés, direction,
   * règles, corrections attendues + bloc de prompt borné). Présent
   * uniquement quand la tâche pose `includeDna` ET qu'un rapport Design
   * Harmony est persisté pour le couple tenant/projet — sinon absent
   * (prompt identique au comportement historique).
   */
  readonly designContext?: ProjectDesignContext | undefined;
}

export interface AgentTask {
  readonly id: string;
  readonly parentTaskId?: string | undefined;
  readonly title: string;
  readonly description: string;
  readonly domain: AgentDomain;
  readonly priority: number;
  readonly dependencies: readonly string[];
  readonly requiredContext: TaskContextRequirements;
  readonly requiredCapabilities: readonly AgentCapability[];
  readonly status: AgentTaskStatus;
  readonly assignedAgentId?: string | undefined;
  readonly operation?: 'ANALYZE' | 'CREATE' | 'MODIFY' | 'DELETE' | 'VERIFY' | undefined;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly error?: string | undefined;
}

export interface EngineeringTaskGraph {
  readonly graphId: string;
  readonly planId: string;
  readonly tasks: readonly AgentTask[];
  readonly rootTaskIds: readonly string[];
  readonly graphHash: string;
  readonly isAcyclic: boolean;
}

export interface AgentEvidence {
  readonly source: 'FILE' | 'AST_SYMBOL' | 'GRAPH_NODE' | 'UNDERSTANDING_FEATURE' | 'IMPACT_PATH';
  readonly identifier: string;
  readonly hash: string;
  readonly summary: string;
}

export type AgentArtifactKind =
  | 'PROPOSED_FILE_CHANGE'
  | 'CODE_PATCH'
  | 'DATA_SCHEMA_CHANGE'
  | 'API_SPEC_CHANGE'
  | 'TEST_SUITE_PROPOSAL'
  | 'SECURITY_FINDING'
  | 'UI_SPEC';

export interface ProposedFileChangePayload {
  readonly filePath: string;
  readonly operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'RENAME' | 'MOVE';
  readonly proposedContent?: string | undefined;
  /** ÉTAPE 35 — nouvelle cible pour RENAME/MOVE. */
  readonly newPath?: string | undefined;
  readonly reason: string;
}

export interface AgentArtifact {
  readonly id: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly domain: AgentDomain;
  readonly kind: AgentArtifactKind;
  readonly targetFiles: readonly string[];
  readonly payload: unknown;
  readonly evidences?: readonly AgentEvidence[] | undefined;
  readonly confidence: number;
  readonly summary?: string | undefined;
  readonly hash: string;
  readonly createdAt?: string | undefined;
}

export interface AgentConflict {
  readonly conflictId: string;
  readonly involvedAgents: readonly string[];
  readonly affectedFiles: readonly string[];
  readonly description: string;
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKING';
  readonly proposedResolution?: string | undefined;
  readonly requiresHumanIntervention: boolean;
}

export interface AgentResult {
  /** P2 — vrai quand le contenu ne provient PAS du LLM (fallback local). */
  degraded?: boolean;
  degradeReason?: string;
  /** Bascule de clés (page Clés API — agents) : slot ayant servi l'appel IA. */
  credentialSlot?: 'primary' | 'fallback' | 'legacy-tenant';
  credentialProviderId?: string;
  /** Liste motivée des échecs avant bascule (honnêteté : jamais masquée). */
  failoverReason?: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly status: 'SUCCESS' | 'FAILURE' | 'ESCALATED';
  readonly artifacts: readonly AgentArtifact[];
  readonly conflicts: readonly AgentConflict[];
  readonly tokensUsed: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
  readonly durationMs: number;
  readonly error?: string | undefined;
}

export type OrchestrationState =
  | 'INITIALIZING'
  | 'DECOMPOSING'
  | 'EXECUTING_GRAPH'
  | 'CORRELATING_ARTIFACTS'
  | 'VALIDATING'
  | 'REPAIRING'
  | 'READY_FOR_MUTATION'
  | 'MUTATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'WAITING_HUMAN_APPROVAL';

export interface OrchestrationTrace {
  readonly traceId: string;
  readonly timestamp: string;
  readonly stateBefore: OrchestrationState;
  readonly stateAfter: OrchestrationState;
  readonly activeTaskId?: string | undefined;
  readonly activeAgentId?: string | undefined;
  readonly event: string;
  readonly durationMs: number;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface OrchestrationRun {
  /** P2 — tâches exécutées en mode dégradé (sans IA). */
  degradedCount?: number | undefined;
  readonly orchestrationId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly conversationId?: string | undefined;
  readonly planId: string;
  readonly state: OrchestrationState;
  readonly taskGraph: EngineeringTaskGraph;
  readonly completedTaskIds: readonly string[];
  readonly artifacts: readonly AgentArtifact[];
  readonly conflicts: readonly AgentConflict[];
  readonly traces: readonly OrchestrationTrace[];
  readonly totalCostUsd: number;
  readonly totalTokens: number;
  readonly repairCycles: number;
  readonly mutationTransactionId?: string | undefined;
  readonly impactReport?: ImpactAnalysis | undefined;
  readonly error?: string | undefined;
  readonly startedAt?: string | undefined;
  readonly completedAt?: string | undefined;
}

export interface AIOrchestratorConfig {
  readonly maxConcurrentTasks: number;
  readonly maxSelfRepairCycles: number;
  readonly defaultTaskTimeoutMs: number;
  readonly tokenBudgetPerOrchestration: number;
  readonly strictConflictGate: boolean;
  readonly cacheMaxEntries: number;
}

export interface OrchestratePlanParams {
  readonly tenantId: string;
  readonly projectId: string;
  readonly plan: EngineeringPlan;
  readonly intent?: IntentResult | undefined;
  readonly conversationId?: string | undefined;
  readonly userRole?: Role | undefined;
  readonly requestId?: string | undefined;
  readonly autoMutateIfLowRisk?: boolean | undefined;
}

// ============================================================================
// V7-LOT6 — Exécution sandbox / application confirmée d'un run AINT-010
// ============================================================================

export type OrchestrationExecutionRefusalCode =
  | 'RUN_NOT_FOUND'
  | 'RUN_NOT_EXECUTABLE'
  | 'RUN_ALREADY_EXECUTED'
  | 'DEGRADED_ARTIFACTS'
  | 'BLOCKING_CONFLICTS'
  | 'NO_FILE_CHANGES'
  | 'INVALID_ARTIFACTS'
  | 'PREFLIGHT_FAILED'
  | 'RUNTIME_FAILED'
  | 'FUNCTIONAL_TESTS_FAILED'
  | 'CONFIRMATION_REQUIRED'
  | 'RISK_ACCEPTANCE_REQUIRED'
  | 'BREAKING_ACCEPTANCE_REQUIRED'
  | 'EXECUTION_FAILED';

export interface OrchestrationExecutionOptions {
  readonly tenantId: string;
  readonly projectId: string;
  readonly userRole?: Role | undefined;
  readonly requestId?: string | undefined;
  /** Obligatoire pour appliquer : l'utilisateur confirme explicitement. */
  readonly confirm?: boolean | undefined;
  /** Obligatoire si le gate exige une approbation (HIGH/CRITICAL/DELETE). */
  readonly acceptRisk?: boolean | undefined;
  /** Obligatoire si l'impact contient des changements de rupture. */
  readonly acceptBreaking?: boolean | undefined;
}

export interface OrchestrationExecutionValidation {
  readonly isValid: boolean;
  readonly requiresHumanApproval: boolean;
  readonly riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly validationErrors: readonly string[];
  readonly breakingCount: number;
}

export interface OrchestrationExecutionPreflight {
  readonly path: string;
  readonly report: EngineeringPreflightReport;
}

/**
 * V7-LOT7 — rapport d'exécution réelle d'un document candidat dans le
 * sandbox navigateur. `report.blocking=true` interdit l'apply ; les warnings
 * restent consultatifs et ne remplacent pas le Quality Gate visuel.
 */
export interface OrchestrationExecutionRuntime {
  readonly path: string;
  readonly report: BrowserSandboxReport;
}

/**
 * V7-LOT8 — agrégat des tests fonctionnels générés sur les documents exécutés.
 * Seul `blocking=true` (échec déterministe) interdit l'apply ; `UNAVAILABLE`
 * et `SKIPPED` restent explicites mais non bloquants.
 */
export interface OrchestrationExecutionFunctionalTests {
  readonly verdict: 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL' | 'SKIPPED' | 'UNAVAILABLE';
  readonly passed: boolean;
  readonly blocking: boolean;
  readonly total: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly warningCount: number;
  readonly skippedCount: number;
  readonly durationMs: number;
  readonly documents: readonly {
    readonly path: string;
    readonly report: BrowserFunctionalTestsReport;
  }[];
}

export interface OrchestrationExecutionTransaction {
  readonly transactionId: string;
  readonly status: TransactionStatus;
  readonly appliedCount: number;
  readonly durationMs: number;
  readonly transactionHash: string;
  readonly createdAt: string;
}

export interface OrchestrationExecutionPreview {
  readonly ok: true;
  readonly dryRun: true;
  readonly orchestrationId: string;
  readonly validation: OrchestrationExecutionValidation;
  readonly preflight: readonly OrchestrationExecutionPreflight[];
  readonly runtime: readonly OrchestrationExecutionRuntime[];
  readonly runtimeSkipped: number;
  readonly functionalTests: OrchestrationExecutionFunctionalTests;
  readonly transaction: OrchestrationExecutionTransaction;
  readonly diffs: readonly StructuredDiff[];
  readonly appliedCount: number;
}

export interface OrchestrationExecutionApplied {
  readonly ok: true;
  readonly dryRun: false;
  readonly run: OrchestrationRun;
  readonly validation: OrchestrationExecutionValidation;
  readonly preflight: readonly OrchestrationExecutionPreflight[];
  readonly runtime: readonly OrchestrationExecutionRuntime[];
  readonly runtimeSkipped: number;
  readonly functionalTests: OrchestrationExecutionFunctionalTests;
  readonly transaction: OrchestrationExecutionTransaction;
  readonly diffs: readonly StructuredDiff[];
  readonly appliedCount: number;
}

export interface OrchestrationExecutionRefusal {
  readonly ok: false;
  readonly code: OrchestrationExecutionRefusalCode;
  readonly message: string;
  readonly validation?: OrchestrationExecutionValidation | undefined;
  readonly preflight?: readonly OrchestrationExecutionPreflight[] | undefined;
  readonly runtime?: readonly OrchestrationExecutionRuntime[] | undefined;
  /** Documents HTML non exécutés à cause de la borne de coût du sandbox. */
  readonly runtimeSkipped?: number | undefined;
  /** Tests fonctionnels générés, présents si le sandbox a pu les exécuter. */
  readonly functionalTests?: OrchestrationExecutionFunctionalTests | undefined;
  /** Présent quand une tentative d'application a réellement été exécutée. */
  readonly run?: OrchestrationRun | undefined;
  readonly transaction?: OrchestrationExecutionTransaction | undefined;
}

export type OrchestrationExecutionPreviewOutcome =
  | OrchestrationExecutionPreview
  | OrchestrationExecutionRefusal;

export type OrchestrationExecutionApplyOutcome =
  | OrchestrationExecutionApplied
  | OrchestrationExecutionRefusal;
