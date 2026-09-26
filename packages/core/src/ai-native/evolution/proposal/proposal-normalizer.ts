/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Proposal Normalizer - Deduplication, sorting, and completeness validation
 *
 * - Deduplicates by id (first occurrence wins)
 * - Sorts by priorityScore DESC
 * - Validates required field completeness
 */

import type { EvolutionProposal } from '../types.js';

// ---------------------------------------------------------------------------
// Required fields for completeness check
// ---------------------------------------------------------------------------

type RequiredStringField = 'id' | 'tenantId' | 'projectId' | 'title' | 'description' | 'rationale';

const REQUIRED_STRING_FIELDS: RequiredStringField[] = [
  'id',
  'tenantId',
  'projectId',
  'title',
  'description',
  'rationale',
];

function isComplete(proposal: EvolutionProposal): boolean {
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof proposal[field] !== 'string' || proposal[field].length === 0) {
      return false;
    }
  }
  return true;
}

function deduplicateById(proposals: EvolutionProposal[]): EvolutionProposal[] {
  const seen = new Set<string>();
  const result: EvolutionProposal[] = [];
  for (const p of proposals) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      result.push(p);
    }
  }
  return result;
}

function sortByPriorityDesc(proposals: EvolutionProposal[]): EvolutionProposal[] {
  return [...proposals].sort((a, b) => b.priorityScore - a.priorityScore);
}

/**
 * Normalizes a list of EvolutionProposal items:
 * 1. Deduplicates by id (first occurrence wins)
 * 2. Removes proposals with incomplete required fields
 * 3. Sorts by priorityScore DESC
 */
export class ProposalNormalizer {
  /**
   * Returns a normalized, deduplicated, sorted proposal list.
   * Proposals with missing required fields are silently dropped.
   */
  public normalize(proposals: EvolutionProposal[]): EvolutionProposal[] {
    const deduplicated = deduplicateById(proposals);
    const complete = deduplicated.filter(isComplete);
    return sortByPriorityDesc(complete);
  }
}
