/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Alignment Engine - Strategic and DNA alignment computation
 *
 * computeStrategicAlignment: evidence-based alignment level
 * computeDNAAlignment: constraint violation detection
 * computeValueEffortQuadrant: 2×2 value/effort matrix (deterministic)
 */

import type {
  EvolutionEvidence,
  EvolutionProposal,
  StrategicAlignmentLevel,
  DNAAlignmentResult,
  ValueEffortQuadrant,
} from '../types.js';

// ---------------------------------------------------------------------------
// Quadrant thresholds
// ---------------------------------------------------------------------------

const THRESHOLD_VALUE_HIGH: number = 60;
const THRESHOLD_EFFORT_LOW: number = 40;

function safeString(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  return '';
}

function extractRecord(raw: unknown): Record<string, unknown> {
  if (raw !== null && raw !== undefined && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

// ---------------------------------------------------------------------------
// AlignmentEngine
// ---------------------------------------------------------------------------

/**
 * Computes strategic and DNA alignment levels deterministically.
 *
 * - computeStrategicAlignment(): FACT evidence from STRATEGY/DNA → HIGH/MEDIUM
 * - computeDNAAlignment(): checks proposal against DNA constraint descriptions
 * - computeValueEffortQuadrant(): 2×2 matrix (QUICK_WIN/STRATEGIC_BET/FILL_IN/AVOID)
 */
export class AlignmentEngine {
  /**
   * Computes the strategic alignment level from evidence and strategy signals.
   *
   * Algorithm:
   * - Count FACT/CORRELATION evidence from STRATEGY or DNA sources
   * - Count conflicting signals (source === STRATEGY, type === HYPOTHESIS, negative)
   * - HIGH: ≥2 FACT strategy/DNA evidence items
   * - MEDIUM: ≥1 FACT or ≥2 CORRELATION evidence items
   * - CONFLICTING: conflicting signals detected
   * - LOW: some correlation evidence
   * - UNKNOWN: no strategy/DNA evidence
   */
  public computeStrategicAlignment(
    evidence: EvolutionEvidence[],
    strategySignals: unknown[],
  ): StrategicAlignmentLevel {
    const strategyEvidence = evidence.filter(
      (e) => e.source === 'STRATEGY' || e.source === 'DNA',
    );

    if (strategyEvidence.length === 0 && strategySignals.length === 0) {
      return 'UNKNOWN';
    }

    const factCount = strategyEvidence.filter((e) => e.type === 'FACT').length;
    const correlationCount = strategyEvidence.filter((e) => e.type === 'CORRELATION').length;

    // Check strategy signals for explicit conflicts
    const conflictSignals = strategySignals.filter((raw) => {
      const s = extractRecord(raw);
      const conflicting = s['conflicting'];
      return conflicting === true;
    });

    if (conflictSignals.length > 0) {
      return 'CONFLICTING';
    }

    if (factCount >= 2) return 'HIGH';
    if (factCount >= 1 || correlationCount >= 2) return 'MEDIUM';
    if (correlationCount >= 1) return 'LOW';

    return 'UNKNOWN';
  }

  /**
   * Computes DNA alignment by checking if the proposal violates DNA constraints.
   *
   * Returns violations for any constraint whose description appears in the
   * proposal description or rationale (case-insensitive keyword matching).
   * If no constraints are provided, alignment is assumed (aligned = true).
   */
  public computeDNAAlignment(
    proposal: Partial<EvolutionProposal>,
    dnaConstraints: unknown[],
  ): DNAAlignmentResult {
    if (dnaConstraints.length === 0) {
      return {
        aligned: true,
        alignmentScore: 100,
        violations: [],
        explanation: 'Aucune contrainte DNA fournie — alignement supposé.',
      };
    }

    const proposalText = [
      safeString(proposal.title),
      safeString(proposal.description),
      safeString(proposal.rationale),
    ]
      .join(' ')
      .toLowerCase();

    const violations: string[] = [];

    for (const raw of dnaConstraints) {
      const c = extractRecord(raw);
      const keyword = safeString(c['keyword'] ?? c['rule'] ?? c['description']).toLowerCase();
      const isForbidden = c['forbidden'] === true;

      if (isForbidden && keyword.length > 0 && proposalText.includes(keyword)) {
        const label = safeString(c['id'] ?? c['constraintId'] ?? 'unknown');
        violations.push(`Contrainte DNA [${label}]: "${keyword}" interdit dans ce contexte.`);
      }
    }

    const alignmentScore = Math.max(0, 100 - violations.length * 20);
    const aligned = violations.length === 0;

    return {
      aligned,
      alignmentScore,
      violations,
      explanation: aligned
        ? 'Proposition alignée avec les contraintes DNA.'
        : `${violations.length} violation(s) DNA détectée(s).`,
    };
  }

  /**
   * Computes the value/effort quadrant using a 2×2 matrix:
   * - QUICK_WIN    : userValue ≥ 60 AND effort ≤ 40
   * - STRATEGIC_BET: userValue ≥ 60 AND effort > 40
   * - FILL_IN      : userValue < 60 AND effort ≤ 40
   * - AVOID        : userValue < 60 AND effort > 40
   */
  public computeValueEffortQuadrant(
    userValue: number,
    effort: number,
  ): ValueEffortQuadrant {
    const highValue = userValue >= THRESHOLD_VALUE_HIGH;
    const lowEffort = effort <= THRESHOLD_EFFORT_LOW;

    if (highValue && lowEffort) return 'QUICK_WIN';
    if (highValue && !lowEffort) return 'STRATEGIC_BET';
    if (!highValue && lowEffort) return 'FILL_IN';
    return 'AVOID';
  }
}
