/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * AI Strategy Optimizer Engine - Public Module Exports
 */

export type * from './types.js';

export {
  computeRecommendationHash,
  computeRoadmapHash,
  computeStrategyContextHash,
  computeStrategyReportHash,
  compareRecommendations
} from './canonical.js';

export { StrategyLruCache, type StrategyCacheMetrics } from './cache.js';

// Intelligence
export { StrategyContextBuilder } from './intelligence/strategy-context-builder.js';
export { OpportunityAnalyzer, type EvaluatedOpportunity } from './intelligence/opportunity-analyzer.js';
export { ProblemAnalyzer, type EvaluatedProblem } from './intelligence/problem-analyzer.js';
export { TechnicalDebtAnalyzer, type EvaluatedDebtItem } from './intelligence/technical-debt-analyzer.js';
export { StrategyRiskAnalyzer, type EvaluatedRisk } from './intelligence/risk-analyzer.js';
export { StrategyValueAnalyzer, type EvaluatedValue } from './intelligence/value-analyzer.js';
export { StrategyDependencyAnalyzer, type CandidateDependencyRef } from './intelligence/dependency-analyzer.js';
export { StrategicSignalAggregator, type RawStrategicCandidate } from './intelligence/strategic-signal-aggregator.js';

// Prioritization
export { StrategicScoreEngine, type ScoreInput } from './prioritization/strategic-score-engine.js';
export { ValueScoreEngine, type ValueScoreParameters } from './prioritization/value-score-engine.js';
export { RiskScoreEngine, type RiskCalculationParameters } from './prioritization/risk-score-engine.js';
export { EffortEstimator, type EstimatedEffort } from './prioritization/effort-estimator.js';
export { StrategicUrgencyEngine, type UrgencyFactors } from './prioritization/urgency-engine.js';
export { OpportunityCostEngine, type OpportunityCostEvaluation } from './prioritization/opportunity-cost-engine.js';
export { PriorityRankingEngine } from './prioritization/priority-ranking-engine.js';

// Planning
export { StrategicRoadmapEngine } from './planning/strategic-roadmap-engine.js';
export { ActionSequencer } from './planning/action-sequencer.js';
export { DependencyPlanner, type DependencyValidationResult } from './planning/dependency-planner.js';
export { MilestonePlanner, type StrategicMilestone } from './planning/milestone-planner.js';
export { AlternativePlanner } from './planning/alternative-planner.js';

// Decision
export { StrategicRecommendationEngine } from './decision/recommendation-engine.js';
export { DecisionEngine } from './decision/decision-engine.js';
export { StrategicConfidenceEngine } from './decision/decision-confidence-engine.js';
export { DecisionRationaleEngine, type GeneratedRationale } from './decision/decision-rationale-engine.js';
export { DecisionProvenanceEngine, type RecommendationProvenanceTrace, type ProvenanceTraceStep } from './decision/decision-provenance-engine.js';

// Graph
export { StrategyGraph, type StrategyGraphNode, type StrategyGraphEdge, type StrategyGraphExport } from './graph/strategy-graph.js';
export { OpportunityProblemGraph, type ProblemSolutionLink } from './graph/opportunity-problem-graph.js';
export { RoadmapGraph, type HorizonLane, type RoadmapGraphStructure } from './graph/roadmap-graph.js';

// Lifecycle
export { StrategyStateMachine, type StrategyOptimizationState } from './lifecycle/strategy-state-machine.js';
export { RecommendationLifecycleManager, type StatusTransitionRecord } from './lifecycle/recommendation-lifecycle.js';

// Bridges
export { StrategyConversationBridge } from './bridge/conversation-bridge.js';
export { StrategyFeatureIntelligenceBridge } from './bridge/feature-intelligence-bridge.js';
export { StrategyFeedbackBridge } from './bridge/feedback-bridge.js';
export { StrategyAuditBridge } from './bridge/audit-bridge.js';
export { StrategyApplicationUnderstandingBridge, type ArchitecturalSummary } from './bridge/application-understanding-bridge.js';
export { StrategyOrchestratorBridge } from './bridge/orchestrator-bridge.js';

// Master Service
export { StrategyOptimizerService } from './service.js';
