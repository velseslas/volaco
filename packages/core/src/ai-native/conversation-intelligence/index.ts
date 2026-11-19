/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Conversation Intelligence & Human-AI Engineering Engine Public API
 */

export type {
  ConversationState,
  IntentCategory,
  AmbiguityLevel,
  NextActionKind,
  DecisionStatus,
  PlanStatus,
  ClarificationItem,
  ConversationAssumption,
  IntentResult,
  ArchitecturalDecisionRecord,
  PlanStep,
  EngineeringPlan,
  PlanAssessment,
  PreparedImpact,
  PreparedTurn,
  ContradictionRecord,
  ContextDelta,
  HumanAiMessage,
  ConversationTrace,
  ConversationTurn,
  TurnMemory,
  ProjectMemory,
  ApplicationSnapshot,
  ConversationSession,
  ReasoningRequest,
  ReasoningResponse,
  ReasoningProvider,
  ConversationIntelligenceConfig,
  ConversationCacheMetrics
} from './types.js';

export {
  computeConversationStateHash,
  computeEngineeringPlanHash,
  computeTraceId,
  compareAssumptions,
  compareDecisions,
  comparePlanSteps
} from './engine/canonical.js';

export { ConversationCompass, VALID_CONVERSATION_TRANSITIONS } from './engine/conversation-compass.js';
export { ConversationIntentEngine, classifyIntent } from './engine/intent-engine.js';
export { ClarificationEngine, classifyAmbiguities } from './engine/clarification-engine.js';
export { ConversationAssumptionEngine, deriveAssumptions } from './engine/assumption-engine.js';
export { PlanGenerator } from './engine/plan-generator.js';
export { ContradictionDetector } from './engine/contradiction-detector.js';
export { MemoryManager, extractUserPreference, type ExtractedUserPreference } from './engine/memory-manager.js';
export { UnderstandingBridge } from './engine/understanding-bridge.js';
export { ImpactBridge, type PlanImpactResult } from './engine/impact-bridge.js';
export {
  ExecutionBridge,
  analyzePlanForBatch,
  buildConversationTaskContext,
  type ConversationAgentExecutor,
  type ExecutionResult,
  type PlanBatchAnalysis,
  type PlanBatchAnalysisSession
} from './engine/execution-bridge.js';
export {
  routeIntentToAgent,
  FILE_MUTATION_CAPABILITY,
  extractSourceFiles,
  buildConversationContextBlock,
  type ConversationAgentRoute,
  type ConversationTaskContext
} from './engine/intent-router.js';
export {
  validatePlanStructure,
  type PlanStructureIssue,
  type PlanStructureValidation
} from './engine/plan-validation.js';
export { ConversationEngine } from './engine/conversation-engine.js';
export {
  detectConversationReference,
  isPluralReference,
  resolveConversationReferents,
  buildReferenceAssumption
} from './engine/reference-resolver.js';
export {
  ConversationContextBuilder,
  CONTEXT_BUDGETS,
  MAX_CONTEXT_CHARS,
  type ConversationContext,
  type ConversationContextSection,
  type ConversationContextSectionId,
  type ConversationContextInput,
  type ConversationContextStats
} from './engine/context-builder.js';
export {
  buildEngineeringBrief,
  withEngineeringBrief,
  MAX_ENGINEERING_BRIEF_CHARS
} from './engine/generation-brief.js';
export { DefaultReasoningProvider, MockReasoningProvider } from './provider/reasoning-provider.js';
export { ConversationTraceCollector, type TraceSummaryMetrics } from './observability/conversation-trace.js';
export { ConversationSessionLruCache } from './cache.js';
export {
  ConversationIntelligenceService,
  DEFAULT_CONVERSATION_CONFIG
} from './service.js';
