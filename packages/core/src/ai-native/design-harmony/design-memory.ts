/**
 * VibeCode Core - Design Harmony
 * CDC V8 §24 — DESIGN MEMORY : les décisions design importantes sont
 * MÉMORISÉES (Decision + Reason) pour qu'une génération future ne revienne
 * pas à un autre style.
 *
 * Honnêteté et déterminisme :
 *   - l'id est un hash de CONTENU (tenant, projet, kind, décision, raison,
 *     source) : rejouer la même décision ne crée jamais de doublon ;
 *   - la décision est bornée en taille, sa raison est OBLIGATOIRE (§24 exige
 *     une justification — jamais de décision sans raison) ;
 *   - supersede() n'efface rien : la décision est marquée SUPERSEDED avec
 *     auteur + horodatage (traçabilité §26).
 *
 * Deux natures :
 *   - DECISION : injectée dans le contexte design des générations (prompt) ;
 *   - IGNORE_OPPORTUNITY : masque une opportunité du dashboard §30 — elle
 *     n'est PAS injectée dans les prompts.
 */

import { createHash } from 'node:crypto';
import { ValidationError } from '../../errors.js';
import type { AqsDimensionId } from './types.js';

export type DesignMemoryDecisionKind = 'DECISION' | 'IGNORE_OPPORTUNITY';
export type DesignMemoryDecisionSource = 'HUMAN' | 'AGENT' | 'IMPROVEMENT';
export type DesignMemoryDecisionStatus = 'ACTIVE' | 'SUPERSEDED';

export const DESIGN_MEMORY_KINDS: readonly DesignMemoryDecisionKind[] = ['DECISION', 'IGNORE_OPPORTUNITY'];
export const DESIGN_MEMORY_SOURCES: readonly DesignMemoryDecisionSource[] = ['HUMAN', 'AGENT', 'IMPROVEMENT'];

const AQS_DIMENSIONS: readonly AqsDimensionId[] = [
  'visual_hierarchy',
  'composition',
  'typography',
  'color_harmony',
  'spacing_rhythm',
  'component_quality',
  'visual_balance',
  'information_density',
  'interaction_design',
  'responsive_quality',
  'brand_alignment',
  'perceived_quality'
];

export interface DesignMemoryDecision {
  /** 'dmem:' + 16 premiers caractères du hash de contenu (déterministe). */
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly kind: DesignMemoryDecisionKind;
  /** §24 — « Decision: Use compact tables. » */
  readonly decision: string;
  /** §24 — « Reason: Application targets professional users… » */
  readonly reason: string;
  readonly source: DesignMemoryDecisionSource;
  readonly dimension?: AqsDimensionId | undefined;
  /** Pour IGNORE_OPPORTUNITY : l'id d'opportunité (§30) masquée. */
  readonly opportunityId?: string | undefined;
  readonly approvedBy?: string | undefined;
  readonly status: DesignMemoryDecisionStatus;
  readonly createdAt: string;
  readonly recordedAt: string;
  readonly supersededAt?: string | undefined;
  readonly supersededBy?: string | undefined;
}

export interface DesignMemoryDecisionInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly decision: string;
  readonly reason: string;
  readonly kind?: DesignMemoryDecisionKind | undefined;
  readonly source?: DesignMemoryDecisionSource | undefined;
  readonly dimension?: string | undefined;
  readonly opportunityId?: string | undefined;
  readonly approvedBy?: string | undefined;
}

function normalizeText(value: unknown, field: string, min: number, max: number): string {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (text.length < min || text.length > max) {
    throw new ValidationError(
      `"${field}" invalide : ${min}..${max} caractères attendus (reçu : ${text.length}).`,
      { field }
    );
  }
  return text;
}

/** Id de contenu déterministe — mêmes entrées → même id (jamais de doublon). */
export function computeDesignMemoryId(params: {
  tenantId: string;
  projectId: string;
  kind: DesignMemoryDecisionKind;
  decision: string;
  reason: string;
  source: DesignMemoryDecisionSource;
  opportunityId?: string | undefined;
}): string {
  const raw = [
    params.tenantId.trim(),
    params.projectId.trim(),
    params.kind,
    params.decision.trim().toLowerCase().replace(/\s+/g, ' '),
    params.reason.trim().toLowerCase().replace(/\s+/g, ' '),
    params.source,
    params.opportunityId?.trim() ?? '-'
  ].join('|');
  return 'dmem:' + createHash('sha256').update(raw, 'utf8').digest('hex').substring(0, 16);
}

/**
 * Construit une décision VALIDÉE. `createdAt` (horodatage de la décision) est
 * injecté par l'appelant — il est EXCLU de l'id (id de contenu).
 */
export function buildDesignMemoryDecision(
  input: DesignMemoryDecisionInput,
  times: { readonly createdAt: string; readonly recordedAt: string }
): DesignMemoryDecision {
  const kind = input.kind ?? 'DECISION';
  if (!DESIGN_MEMORY_KINDS.includes(kind)) {
    throw new ValidationError(`Nature de décision inconnue : "${String(kind)}".`, { field: 'kind' });
  }
  const source = input.source ?? 'HUMAN';
  if (!DESIGN_MEMORY_SOURCES.includes(source)) {
    throw new ValidationError(`Source de décision inconnue : "${String(source)}".`, { field: 'source' });
  }
  const decision = normalizeText(input.decision, 'decision', 3, 240);
  const reason = normalizeText(input.reason, 'reason', 10, 500);

  let dimension: AqsDimensionId | undefined;
  if (input.dimension !== undefined && input.dimension !== null && String(input.dimension).trim().length > 0) {
    const value = String(input.dimension).trim() as AqsDimensionId;
    if (!AQS_DIMENSIONS.includes(value)) {
      throw new ValidationError(`Dimension AQS inconnue : "${value}".`, { field: 'dimension' });
    }
    dimension = value;
  }

  let opportunityId: string | undefined;
  if (input.opportunityId !== undefined && input.opportunityId !== null) {
    const value = String(input.opportunityId).trim();
    if (!/^opp-[a-z_]{2,40}$/.test(value)) {
      throw new ValidationError(`Id d'opportunité invalide : "${value}".`, { field: 'opportunityId' });
    }
    opportunityId = value;
  }

  if (kind === 'IGNORE_OPPORTUNITY' && !opportunityId) {
    throw new ValidationError('IGNORE_OPPORTUNITY exige opportunityId.', { field: 'opportunityId' });
  }

  const approvedBy =
    input.approvedBy !== undefined && String(input.approvedBy).trim().length > 0
      ? String(input.approvedBy).trim()
      : undefined;

  return {
    id: computeDesignMemoryId({
      tenantId: input.tenantId,
      projectId: input.projectId,
      kind,
      decision,
      reason,
      source,
      ...(opportunityId !== undefined ? { opportunityId } : {})
    }),
    tenantId: input.tenantId.trim(),
    projectId: input.projectId.trim(),
    kind,
    decision,
    reason,
    source,
    ...(dimension !== undefined ? { dimension } : {}),
    ...(opportunityId !== undefined ? { opportunityId } : {}),
    ...(approvedBy !== undefined ? { approvedBy } : {}),
    status: 'ACTIVE',
    createdAt: times.createdAt,
    recordedAt: times.recordedAt
  };
}
