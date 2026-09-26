/**
 * VibeCode Core - Intelligence Pool (Phase 9.5)
 * Public exports.
 */

export type {
  AnalystId,
  EvidenceType,
  Evidence,
  PriorityWeights,
  PriorityScoreBreakdown,
  IntelligenceRecommendation,
  AnalystContext,
  IntelligenceAnalyst
} from './types.js';

export { deepFreeze, computeHash, canonicalize } from './canonical.js';
export { IntelligenceLruCache } from './lru-cache.js';
export { EvidenceRanker } from './evidence-ranker.js';
export { PriorityScorer, DEFAULT_WEIGHTS, createScorer } from './priority-scorer.js';
export type { PriorityScorerInput } from './priority-scorer.js';

export { AnalystRegistry } from './analysts/index.js';
export { StrategyAnalyst } from './analysts/strategy-analyst.js';
export { EvolutionAnalyst } from './analysts/evolution-analyst.js';
export { FeatureAnalyst } from './analysts/feature-analyst.js';
export { UnderstandingAnalyst } from './analysts/understanding-analyst.js';
