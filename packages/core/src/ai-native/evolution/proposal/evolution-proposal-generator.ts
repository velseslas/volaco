/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Evolution Proposal Generator - Evidence-driven proposal construction
 *
 * Absolute Rule: proposals with zero evidence are NEVER included in output.
 * Proposal IDs are deterministic via computeEvolutionProposalHash (SHA-256).
 */

import { createHash } from 'node:crypto';
import type {
  EvolutionAnalysisRequest,
  EvolutionEvidence,
  ApplicationEvolutionState,
  EvolutionProposal,
  EvolutionCategory,
  EvolutionUrgency,
  StrategicAlignmentLevel,
  ValueEffortQuadrant,
} from '../types.js';
import { ConfidenceEngine } from '../evidence/confidence-engine.js';
import { AlignmentEngine } from '../scoring/alignment-engine.js';
import { ValueEngine } from '../scoring/value-engine.js';
import { EffortEngine } from '../scoring/effort-engine.js';
import { RiskEngine } from '../scoring/risk-engine.js';
import { EvolutionPriorityEngine } from '../scoring/evolution-priority-engine.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function computeEvolutionProposalHash(
  tenantId: string,
  projectId: string,
  category: EvolutionCategory,
  evidenceIds: string[],
): string {
  const raw = [tenantId, projectId, category, ...evidenceIds.sort()].join('::');
  return createHash('sha256').update(raw, 'utf8').digest('hex').substring(0, 16);
}

function safeString(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return fallback;
}

function groupEvidenceByCategory(
  evidence: EvolutionEvidence[],
): Map<EvolutionCategory, EvolutionEvidence[]> {
  const groups = new Map<EvolutionCategory, EvolutionEvidence[]>();

  for (const e of evidence) {
    const payload = e.dataPayload ?? {};
    const rawCategory = payload['category'];
    const category: EvolutionCategory =
      typeof rawCategory === 'string' && rawCategory.length > 0
        ? (rawCategory as EvolutionCategory)
        : inferCategoryFromSource(e);

    const existing = groups.get(category);
    if (existing !== undefined) {
      existing.push(e);
    } else {
      groups.set(category, [e]);
    }
  }

  return groups;
}

function inferCategoryFromSource(e: EvolutionEvidence): EvolutionCategory {
  switch (e.source) {
    case 'AUDIT': return 'BUG_REMEDIATION';
    case 'FEATURE': return 'NEW_FEATURE';
    case 'FEEDBACK': return 'UX_IMPROVEMENT';
    case 'STRATEGY': return 'ARCHITECTURE_IMPROVEMENT';
    case 'DNA': return 'TECH_DEBT_REDUCTION';
    case 'CONVERSATION': return 'FEATURE_IMPROVEMENT';
    default: return 'INVESTIGATE';
  }
}

function inferUrgency(evidence: EvolutionEvidence[]): EvolutionUrgency {
  const hasCritical = evidence.some((e) => {
    const payload = e.dataPayload ?? {};
    const severity = payload['severity'];
    return severity === 'CRITICAL' || severity === 'HIGH';
  });
  if (hasCritical) return 'NOW';
  if (evidence.some((e) => e.confidence > 0.75)) return 'NEXT';
  if (evidence.some((e) => e.confidence > 0.50)) return 'LATER';
  return 'WATCH';
}

function buildTitle(category: EvolutionCategory, evidence: EvolutionEvidence[]): string {
  const first = evidence[0];
  if (first === undefined) return `[${category}] Évolution proposée`;
  const description = first.description.substring(0, 60);
  return `[${category}] ${description}`;
}

function buildDescription(category: EvolutionCategory, evidence: EvolutionEvidence[]): string {
  const count = evidence.length;
  const sources = [...new Set(evidence.map((e) => e.source))].join(', ');
  return (
    `Proposition d'évolution de type ${category} basée sur ${count} preuve(s) ` +
    `provenant de : ${sources}.`
  );
}

function buildRationale(evidence: EvolutionEvidence[]): string {
  return evidence
    .slice(0, 3)
    .map((e) => `[${e.type}/${e.source}] ${e.description}`)
    .join(' | ');
}

function computeAlignmentScore(level: StrategicAlignmentLevel): number {
  switch (level) {
    case 'HIGH': return 100;
    case 'MEDIUM': return 66;
    case 'LOW': return 33;
    case 'CONFLICTING': return 0;
    default: return 50;
  }
}

// ---------------------------------------------------------------------------
// EvolutionProposalGenerator
// ---------------------------------------------------------------------------

const confidenceEngine = new ConfidenceEngine();
const alignmentEngine = new AlignmentEngine();
const valueEngine = new ValueEngine();
const effortEngine = new EffortEngine();
const riskEngine = new RiskEngine();
const priorityEngine = new EvolutionPriorityEngine();

/**
 * Generates evidence-driven EvolutionProposal items.
 *
 * Absolute invariant: proposals without evidence are NEVER included.
 * IDs are deterministic via SHA-256 of (tenantId, projectId, category, evidenceIds).
 */
export class EvolutionProposalGenerator {
  /**
   * Generates proposals grouped by evidence category.
   * Proposals with zero evidence receive status UNSUPPORTED and are excluded.
   */
  public generate(
    request: EvolutionAnalysisRequest,
    evidence: EvolutionEvidence[],
    _state: ApplicationEvolutionState,
  ): EvolutionProposal[] {
    if (evidence.length === 0) return [];

    const groups = groupEvidenceByCategory(evidence);
    const now = new Date().toISOString();
    const proposals: EvolutionProposal[] = [];

    for (const [category, categoryEvidence] of groups) {
      if (categoryEvidence.length === 0) continue;

      const evidenceConfidence = confidenceEngine.compute(categoryEvidence);
      const strategicAlignmentLevel = alignmentEngine.computeStrategicAlignment(
        categoryEvidence,
        [],
      );
      const strategicAlignmentScore = computeAlignmentScore(strategicAlignmentLevel);

      const affectedComponents: string[] = categoryEvidence
        .flatMap((e) => {
          const payload = e.dataPayload ?? {};
          const comps = payload['affectedComponents'];
          return Array.isArray(comps) ? (comps as string[]) : [];
        })
        .filter((c): c is string => typeof c === 'string');

      const uniqueComponents = [...new Set(affectedComponents)];
      const blastRadius = Math.min(uniqueComponents.length * 10, 100);

      const userValue = valueEngine.computeUserValue(categoryEvidence, category);
      const businessValue = valueEngine.computeBusinessValue(categoryEvidence, category);
      const technicalValue = valueEngine.computeTechnicalValue(categoryEvidence, category);
      const complexity = Math.min(
        50 + uniqueComponents.length * 5,
        100,
      );
      const effort = effortEngine.estimate(category, complexity, uniqueComponents);
      const risk = riskEngine.compute(category, blastRadius, uniqueComponents);
      const urgency = inferUrgency(categoryEvidence);
      const expectedValue = Math.round((userValue + businessValue + technicalValue) / 3);

      const quadrant = alignmentEngine.computeValueEffortQuadrant(userValue, effort);

      const hash = computeEvolutionProposalHash(
        request.tenantId,
        request.projectId,
        category,
        categoryEvidence.map((e) => e.id),
      );

      // Construit l'intégralité des champs de EvolutionProposal (hors priorityScore,
      // qui dépend de cet objet) pour respecter la signature de computeEPS :
      // Omit<EvolutionProposal, 'priorityScore'>. Corrige TS2345 (champs manquants
      // id/title/description/rationale/status/provenance/createdAt/updatedAt).
      const proposalDraft: Omit<EvolutionProposal, 'priorityScore'> = {
        id: `evo:${hash}`,
        tenantId: request.tenantId,
        projectId: request.projectId,
        category,
        title: buildTitle(category, categoryEvidence),
        description: buildDescription(category, categoryEvidence),
        rationale: buildRationale(categoryEvidence),
        userValue,
        businessValue,
        technicalValue,
        effort,
        complexity,
        risk,
        expectedValue,
        urgency,
        strategicAlignmentLevel,
        strategicAlignmentScore,
        evidence: categoryEvidence,
        evidenceConfidence,
        affectedComponents: uniqueComponents,
        blastRadius,
        dependencies: [] as string[],
        status: 'PROPOSED',
        valueEffortQuadrant: quadrant,
        provenance: {
          origin: 'AINT-017:EvolutionProposalGenerator',
          ruleSet: `evidence-driven-v1:${category}`,
          hash,
        },
        createdAt: now,
        updatedAt: now,
      };

      const priorityScore = priorityEngine.computeEPS(proposalDraft);

      const proposal: EvolutionProposal = {
        ...proposalDraft,
        priorityScore,
      };

      proposals.push(proposal);
    }

    return proposals;
  }
}

export { computeEvolutionProposalHash };
export type { ValueEffortQuadrant };
