/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * AI Orchestrator & Engineering Agent Orchestrator Type Definitions
 */

import type { Role } from '../../identity/permissions.js';
import type { ProviderCapability } from '../../ai/providers/types.js';
import type { EngineeringPlan, HumanAiMessage, IntentResult } from '../conversation-intelligence/types.js';
import type { ApplicationSemanticModel } from '../application-understanding/types.js';
import type { ImpactAnalysis } from '../impact-intelligence/types.js';

export type AgentDomain =
  | 'UI'
  | 'BACKEND'
  | 'DATA'
  | 'SECURITY'
  | 'TEST'
  | 'ARCHITECTURE';

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
  readonly operation: 'CREATE' | 'UPDATE' | 'DELETE';
  readonly proposedContent?: string | undefined;
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
  degradedCount?: number;
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
