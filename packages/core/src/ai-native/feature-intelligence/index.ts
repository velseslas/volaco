/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature Intelligence & Product Evolution Engine - Module Exports
 */

export * from './types.js';
export { computeFeatureCandidateHash, computeFeatureReportHash, compareFeatureCandidates } from './canonical.js';
export * from './cache.js';

export * from './discovery/signal-collector.js';
export * from './discovery/feature-gap-detector.js';
export * from './discovery/feature-redundancy-detector.js';
export * from './discovery/feature-conflict-detector.js';
export * from './discovery/opportunity-detector.js';

export * from './generation/feature-candidate-generator.js';
export * from './generation/feature-spec-generator.js';
export * from './generation/feature-alternative-generator.js';

export * from './evidence/evidence-engine.js';
export * from './evidence/evidence-ranker.js';
export * from './evidence/confidence-engine.js';

export * from './impact/feature-impact-analyzer.js';
export * from './impact/dependency-analyzer.js';
export * from './impact/blast-radius-analyzer.js';

export * from './scoring/feature-value-engine.js';
export * from './scoring/priority-engine.js';
export * from './scoring/opportunity-ranking.js';

export * from './graph/feature-graph.js';
export * from './graph/feature-dependency-graph.js';

export * from './lifecycle/feature-state-machine.js';
export * from './lifecycle/feature-lifecycle.js';

export * from './bridge/audit-bridge.js';
export * from './bridge/conversation-bridge.js';
export * from './bridge/orchestrator-bridge.js';

export * from './service.js';
