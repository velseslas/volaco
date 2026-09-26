/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * User Feedback & Bug Intelligence Engine - Public Exports
 */

export type * from './types.js';

export {
  computeSignalHash,
  computeProblemHash,
  computeFeedbackReportHash,
  compareProblems,
  compareSignals
} from './canonical.js';

export { UserFeedbackLruCache, type UserFeedbackCacheMetrics } from './cache.js';

export { SignalIngestor } from './ingestion/signal-ingestor.js';
export { FeedbackNormalizer, type NormalizedFeedback } from './ingestion/feedback-normalizer.js';
export { ErrorSignalCollector } from './ingestion/error-signal-collector.js';
export { ConversationSignalCollector } from './ingestion/conversation-signal-collector.js';
export { TelemetrySignalCollector, type TelemetryEvent } from './ingestion/telemetry-signal-collector.js';

export { FeedbackClassifier, type ClassificationResult } from './classification/feedback-classifier.js';
export { BugClassifier, type BugClassificationResult } from './classification/bug-classifier.js';
export { RequestClassifier, type RequestQualification } from './classification/request-classifier.js';
export { SentimentClassifier, type SentimentAnalysisResult } from './classification/sentiment-classifier.js';
export { IntentClassifier, type UserIntentResult, type UserIntentType } from './classification/intent-classifier.js';

export { FeedbackEvidenceEngine } from './evidence/feedback-evidence-engine.js';
export { EvidenceRanker as FeedbackEvidenceRanker } from './evidence/evidence-ranker.js';
export { EvidenceConfidenceEngine } from './evidence/evidence-confidence-engine.js';
export { ProvenanceEngine, type ProvenanceRecord } from './evidence/provenance-engine.js';

export { DuplicateDetector, type DuplicateCluster } from './intelligence/duplicate-detector.js';
export { FeedbackClusterer, type ThematicCluster } from './intelligence/feedback-clusterer.js';
export { RecurringProblemDetector, type RecurrenceAnalysis } from './intelligence/recurring-problem-detector.js';
export { RegressionDetector, type RegressionAnalysis } from './intelligence/regression-detector.js';
export { ContradictionDetector as FeedbackContradictionDetector } from './intelligence/contradiction-detector.js';
export { TrendDetector, type TrendAnalysis } from './intelligence/trend-detector.js';
export { RootCauseCorrelator, type RootCauseCorrelation } from './intelligence/root-cause-correlator.js';

export { UserImpactAnalyzer, type UserImpactMetrics } from './impact/user-impact-analyzer.js';
export { FeatureImpactAnalyzer as FeedbackFeatureImpactAnalyzer, type FeatureImpactResult } from './impact/feature-impact-analyzer.js';
export { RoleImpactAnalyzer, type RoleImpactResult } from './impact/role-impact-analyzer.js';
export { ApplicationImpactAnalyzer, type ApplicationImpactResult } from './impact/application-impact-analyzer.js';

export { SeverityEngine, type SeverityAssessment } from './scoring/severity-engine.js';
export { ConfidenceEngine as FeedbackConfidenceEngine } from './scoring/confidence-engine.js';
export { UrgencyEngine, type UrgencyAssessment } from './scoring/urgency-engine.js';
export { ProblemPriorityEngine, type PriorityCalculationInput } from './scoring/problem-priority-engine.js';

export { FeedbackGraphBuilder } from './graph/feedback-graph.js';
export { ProblemGraphBuilder } from './graph/problem-graph.js';
export { FeedbackFeatureGraphBuilder } from './graph/feedback-feature-graph.js';

export { FeedbackStateMachine } from './lifecycle/feedback-state-machine.js';
export { ProblemLifecycleManager } from './lifecycle/problem-lifecycle.js';

export { ConversationBridge } from './bridge/conversation-bridge.js';
export { AuditBridge, type AuditCorrelationEntry } from './bridge/audit-bridge.js';
export { FeatureIntelligenceBridge } from './bridge/feature-intelligence-bridge.js';
export { FeedbackOrchestratorBridge } from './bridge/orchestrator-bridge.js';

export { UserFeedbackService } from './service.js';
