/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * Application Understanding & Semantic Reasoning Engine Public Entrypoint
 */

export * from './types.js';
export * from './cache.js';
export * from './service.js';
export {
  compareFeatures,
  compareDomains,
  compareWorkflows,
  compareJourneys,
  compareDataFlows,
  compareBusinessRules,
  compareComponents,
  compareServices,
  compareApis,
  compareEntryPoints,
  compareBoundaries,
  computeUnderstandingHash
} from './engine/canonical.js';
export { calculateConfidence, determineCertainty } from './engine/confidence.js';
export { isSensitivePath, maskSensitiveDetail, createEvidence as createUnderstandingEvidence } from './engine/evidence.js';
export { discoverFeatures } from './engine/feature-discovery.js';
export { discoverDomains } from './engine/domain-discovery.js';
export { discoverWorkflows } from './engine/workflow-discovery.js';
export { discoverUserJourneys } from './engine/journey-discovery.js';
export { discoverDataFlows } from './engine/data-flow-discovery.js';
export { discoverBusinessRules } from './engine/business-rule-discovery.js';
export { assembleSemanticModel } from './engine/semantic-model.js';
export { runUnderstandingAnalysis } from './engine/understanding-engine.js';
export * from './query/selectors.js';
export * from './query/semantic-query.js';
