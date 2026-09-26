/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-012)
 * Design Harmony Engine - Public Exports
 */

export * from './types.js';
export {
  parseRgb,
  computeRelativeLuminance,
  computeContrastRatio,
  computeColorDistance,
  compareFindings,
  computeDesignHarmonyReportHash
} from './canonical.js';
export * from './cache.js';
export * from './engine/token-inferer.js';
export * from './engine/drift-detector.js';
export * from './engine/component-harmony.js';
export * from './engine/cross-page-harmony.js';
export * from './engine/responsive-a11y-harmony.js';
export * from './engine/score-engine.js';
export * from './engine/recommendation-engine.js';
export * from './bridge/conversation-bridge.js';
export * from './bridge/orchestrator-bridge.js';
export * from './service.js';
