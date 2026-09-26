/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Proposal Validator - Completeness and evidence rules for evolution proposals
 *
 * Rules:
 * - id must be non-empty
 * - tenantId must be non-empty
 * - projectId must be non-empty
 * - evidence.length > 0 to be PROPOSED
 * - category must be a valid EvolutionCategory
 */

import type { EvolutionCategory, EvolutionProposal } from '../types.js';

// ---------------------------------------------------------------------------
// Valid categories (exhaustive list matching types.ts)
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set<EvolutionCategory>([
  'BUG_REMEDIATION',
  'NEW_FEATURE',
  'FEATURE_IMPROVEMENT',
  'ARCHITECTURE_IMPROVEMENT',
  'TECH_DEBT_REDUCTION',
  'SECURITY_HARDENING',
  'PERFORMANCE_OPTIMIZATION',
  'UX_IMPROVEMENT',
  'ACCESSIBILITY',
  'OBSERVABILITY',
  'DEPENDENCY_UPDATE',
  'DOCUMENTATION',
  'REMOVE_FEATURE',
  'INVESTIGATE',
  'DEFER',
]);

function isValidCategory(value: string): value is EvolutionCategory {
  return VALID_CATEGORIES.has(value as EvolutionCategory);
}

export interface ProposalValidationResult {
  readonly valid: boolean;
  readonly errors: string[];
}

/**
 * Validates EvolutionProposal completeness and evidence requirements.
 *
 * Validation rules:
 * - id must be non-empty string
 * - tenantId must be non-empty string
 * - projectId must be non-empty string
 * - evidence.length > 0 for PROPOSED status
 * - category must be a valid EvolutionCategory value
 */
export class ProposalValidator {
  /**
   * Validates a proposal against all structural and evidence rules.
   * Returns { valid: true, errors: [] } on success.
   */
  public validate(proposal: EvolutionProposal): ProposalValidationResult {
    const errors: string[] = [];

    if (typeof proposal.id !== 'string' || proposal.id.length === 0) {
      errors.push('id is required and must be a non-empty string.');
    }

    if (typeof proposal.tenantId !== 'string' || proposal.tenantId.length === 0) {
      errors.push('tenantId is required and must be a non-empty string.');
    }

    if (typeof proposal.projectId !== 'string' || proposal.projectId.length === 0) {
      errors.push('projectId is required and must be a non-empty string.');
    }

    if (!isValidCategory(proposal.category)) {
      errors.push(`category "${proposal.category as string}" is not a valid EvolutionCategory.`);
    }

    if (proposal.status === 'PROPOSED' && proposal.evidence.length === 0) {
      errors.push(
        'A proposal with status PROPOSED must have at least one piece of evidence. ' +
        'Use status UNSUPPORTED for evidence-free proposals.',
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Returns true only when the proposal has at least one piece of evidence.
   * A proposal with no evidence cannot be PROPOSED.
   */
  public hasMinimumEvidence(proposal: EvolutionProposal): boolean {
    return proposal.evidence.length > 0;
  }
}
