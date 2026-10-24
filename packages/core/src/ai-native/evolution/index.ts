// Re-export curé : `EvidenceSource`/`EvidenceType` sont déjà exportés par
// d'autres modules AINT (feature-intelligence) — les réexporter ici créerait
// une ambiguïté dans l'agrégat racine. Le moteur d'évolution les consomme en
// interne ; l'API publique expose le service + les contrats propres.
export * from './service.js';
export type {
  EvolutionCategory,
  EvolutionUrgency,
  StrategicAlignmentLevel,
  ValueEffortQuadrant,
  EvolutionEvidence,
  StateDimension,
  ApplicationEvolutionState,
  ProductHealthScore,
  EvolutionReadinessStatus,
  EvolutionProposal,
  EvolutionDecisionResult,
  EvolutionAnalysisRequest,
  EvolutionAnalysisReport
} from './types.js';
