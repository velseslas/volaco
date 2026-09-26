/**
 * VibeCode Core - Intelligence Pool (Phase 9.5)
 *
 * Fusion des 4 modules redondants :
 *   - strategy        → StrategyAnalyst
 *   - evolution       → EvolutionAnalyst
 *   - feature-intelligence → FeatureAnalyst
 *   - application-understanding → UnderstandingAnalyst
 *
 * Tous partagent :
 *   - 1 PriorityScorer paramétrable
 *   - 1 EvidenceRanker unifié
 *   - 1 LruCache partagé
 *   - 1 canonical (deepFreeze + sha256)
 *
 * RÔLE CONSULTATIF UNIQUEMENT :
 * Les analysts produisent des IntelligenceRecommendation qui entrent dans
 * le DecisionEngine comme alternatives possibles. Ils ne peuvent pas
 * exécuter eux-mêmes.
 */

export type AnalystId =
  | 'strategy'
  | 'evolution'
  | 'feature'
  | 'understanding';

export type EvidenceType =
  | 'FACT'
  | 'CORRELATION'
  | 'HYPOTHESIS';

export interface Evidence {
  readonly id: string;
  readonly source: string;
  readonly description: string;
  readonly type: EvidenceType;
  readonly confidence: number; // 0-1
  readonly authorityWeight: number; // 0-1
  readonly payload?: Record<string, unknown> | undefined;
}

export interface PriorityWeights {
  readonly userValue: number;       // default 0.35
  readonly strategicAlignment: number; // default 0.20
  readonly evidenceConfidence: number; // default 0.15
  readonly expectedValue: number;  // default 0.15
  readonly urgency: number;        // default 0.10
  readonly riskReduction: number;  // default 0.05
}

export interface PriorityScoreBreakdown {
  readonly total: number; // 0-100
  readonly userValue: number;
  readonly strategicAlignment: number;
  readonly evidenceConfidence: number;
  readonly expectedValue: number;
  readonly urgency: number;
  readonly riskReduction: number;
  readonly rationale: string;
}

export interface IntelligenceRecommendation {
  readonly id: string;
  readonly source: AnalystId;
  readonly title: string;
  readonly description: string;
  readonly score: number; // 0-100 from PriorityScorer
  readonly scoreBreakdown?: PriorityScoreBreakdown | undefined;
  readonly evidence: Evidence[];
  readonly targetFiles: readonly string[];
  readonly proposedActions: readonly string[];
  readonly reversible: boolean;
  readonly riskScore: number; // 0-100
  readonly estimatedEffort: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface AnalystContext {
  readonly projectId: string;
  readonly tenantId: string;
  readonly files: readonly { path: string; content: string }[];
  readonly feedback?: readonly { message: string; sentiment: string }[] | undefined;
  readonly memory?: import('../conversation-intelligence/types.js').ProjectMemory | undefined;
  readonly userIntent?: string | undefined;
}

export interface IntelligenceAnalyst {
  readonly id: AnalystId;
  readonly displayName: string;
  analyze(context: AnalystContext): Promise<readonly IntelligenceRecommendation[]>;
}
