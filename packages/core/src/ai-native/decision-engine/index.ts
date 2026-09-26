/**
 * VibeCode Core - Decision Engine (Phase 9.5)
 * Public exports.
 */

export type {
  DecisionVerdict,
  ConstraintSource,
  ConstraintSeverity,
  DecisionConstraint,
  DecisionAlternative,
  Decision,
  DecisionContext,
  DecisionOutcome
} from './types.js';

export { ConstraintRegistry } from './constraint-registry.js';
export { DecisionLedger } from './decision-ledger.js';
export { AlternativeGenerator } from './alternative-generator.js';
export { DecisionEngine } from './decision-engine.js';
export type { DecisionEngineDeps } from './decision-engine.js';
