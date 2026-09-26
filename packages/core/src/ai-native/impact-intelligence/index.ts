/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-005)
 * Impact Intelligence Engine
 */

export * from './types.js';
export * from './service.js';
export * from './cache.js';
export {
  compareImpactNodes,
  compareImpactPaths,
  compareResolvedTargets,
  computeImpactHash
} from './engine/canonical.js';
export * from './engine/evidence.js';
export * from './engine/criticality.js';
export * from './engine/scoring.js';
export * from './engine/propagation.js';
export * from './engine/impact-analyzer.js';
export * from './graph/traversal.js';
export * from './graph/impact-graph.js';
