/**
 * VibeCode Core - Design Harmony
 * CDC V8 §26 — DESIGN GOVERNANCE : registre unifié des décisions de design.
 *
 * Le CDC §26 exige que chaque changement de design soit traçable avec les
 * 8 attributs : Who / What / Why / When / Previous / New / Impact / Approval.
 * Ces champs existent déjà, ÉPARPILLÉS par fonctionnalité (override de
 * direction updatedBy+updatedAt, décisions mémoire Decision+Reason+status,
 * historique d'améliorations révisions, overrides de composants reason).
 *
 * Ce module est un AGRÉGATEUR PUR : il ne lit AUCUNE donnée nouvelle et n'en
 * fabrique AUCUNE — il assemble les sources RÉELLES en un seul ledger trié,
 * déterministe (tri at DESC, puis id ASC), sans Math.random.
 *
 * HONNÊTETÉ : un champ non stocké par la source est null (jamais inventé) :
 *   - direction : upsert sans historique → previous/why/impact null ;
 *   - amélioration : previous/new = deltas AQS EXTRAITS du message de
 *     révision canonique (« Design Improve — AQS x → y (stop) ») — un
 *     message non parsable donne null ;
 *   - mémoire : la raison est obligatoire (§24) ; la supersession trace
 *     supersededBy/supersededAt ;
 *   - composants : raison obligatoire pour DEPRECATED/DISABLED (§9/§10).
 *
 * INJECTION : les stores sont injectables (tests) — défaut = singletons
 * réels, exactement comme design-context.ts.
 */

import { deepFreeze } from '../ai-orchestrator/canonical.js';
import type { ApplicationRevision } from '../../model/revision.js';
import { revisionStore } from '../../model/revision-store.js';
import type { DesignMemoryDecision } from './design-memory.js';
import { designMemoryStore } from './design-memory-store.js';
import { designDirectionStore, type StoredDesignDirectionOverride } from './design-direction-store.js';
import { componentContractStore, type StoredComponentOverride } from './component-contract-store.js';

export type DesignGovernanceSource =
  | 'design-direction'
  | 'design-memory'
  | 'design-improvement'
  | 'design-component';

export interface DesignGovernanceEvent {
  /** Id DÉRIVÉ de la source réelle (dmem:…, révision, composant) — jamais généré. */
  readonly id: string;
  readonly source: DesignGovernanceSource;
  readonly status: 'ACTIVE' | 'SUPERSEDED' | 'APPLIED';
  /** When (§26) : horodatage RÉEL de la source (ISO 8601). */
  readonly at: string;
  /** Who (§26) : acteur réel (source d'écriture ou approbateur identifié). */
  readonly who: string;
  readonly what: string;
  /** Why (§26) : raison RÉELLE stockée — null si la source n'en stocke pas. */
  readonly why: string | null;
  /** Previous (§26) : état antérieur réel — null si non tracé (upsert sans historique). */
  readonly previous: string | null;
  /** New (§26) : nouvel état réel — null si non parsable depuis la source. */
  readonly new: string | null;
  /** Impact (§26) : effet mesuré réel (delta AQS) — null si non mesuré. */
  readonly impact: string | null;
  /** Approval (§26) : approbateur réel identifié — null si non applicable. */
  readonly approval: string | null;
}

export interface DesignGovernanceCounts {
  readonly directionOverride: number;
  readonly memoryActive: number;
  readonly memorySuperseded: number;
  readonly improvement: number;
  readonly component: number;
  readonly total: number;
}

export interface DesignGovernanceLedger {
  readonly generatedAt: string;
  readonly counts: DesignGovernanceCounts;
  /** Sources RÉELLEMENT consultées (false = store absent/inaccessible). */
  readonly sources: {
    readonly direction: boolean;
    readonly memory: boolean;
    readonly revisions: boolean;
    readonly components: boolean;
  };
  readonly events: readonly DesignGovernanceEvent[];
}

/** Source minimale d'override de direction (store réel ou test). */
export interface GovernanceDirectionStoreLike {
  get(tenantId: string, projectId: string): StoredDesignDirectionOverride | undefined;
}

/** Source minimale de décisions design (store réel ou test). */
export interface GovernanceMemoryStoreLike {
  list(tenantId: string, projectId: string): readonly DesignMemoryDecision[];
}

/** Source minimale d'historique de révisions (store réel ou test). */
export interface GovernanceRevisionStoreLike {
  listRevisions(tenantId: string, projectId: string): readonly ApplicationRevision[];
}

/** Source minimale d'overrides de composants (store réel ou test). */
export interface GovernanceComponentStoreLike {
  list(tenantId: string, projectId: string): readonly StoredComponentOverride[];
}

const DIRECTION_DIMENSION_ORDER = [
  'style',
  'density',
  'personality',
  'visualEnergy',
  'professionalism',
  'motion',
  'visualComplexity',
  'informationDensity'
] as const;

/** Message de révision canonique de la boucle §17-§21 (improve.ts). */
const IMPROVEMENT_MESSAGE_PATTERN = /^Design Improve — AQS (\d+(?:\.\d+)?) → (\d+(?:\.\d+)?) \(([^)]+)\)$/;

function isoOrRaw(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Texte compact et déterministe des dimensions réellement fixées (ordre du CDC §6). */
function directionOverrideText(override: StoredDesignDirectionOverride['override']): string {
  const parts = DIRECTION_DIMENSION_ORDER.filter((key) => override[key] !== undefined).map(
    (key) => `${key}=${override[key]}`
  );
  return parts.length > 0 ? parts.join(', ') : 'aucune dimension fixée';
}

/**
 * Construit le ledger de gouvernance §26 à partir des stores RÉELS (ou
 * injectés). PURE et déterministe : mêmes entrées → mêmes événements,
 * triés at DESC puis id ASC (jamais de Math.random).
 */
export function buildDesignGovernanceLedger(params: {
  readonly tenantId: string;
  readonly projectId: string;
  readonly directionStore?: GovernanceDirectionStoreLike | undefined;
  readonly memoryStore?: GovernanceMemoryStoreLike | undefined;
  readonly revisionStore?: GovernanceRevisionStoreLike | undefined;
  readonly componentStore?: GovernanceComponentStoreLike | undefined;
  /** Horodatage du ledger (injectable pour les tests déterministes). */
  readonly generatedAt?: string | undefined;
}): DesignGovernanceLedger {
  const { tenantId, projectId } = params;
  const directionSource = params.directionStore ?? designDirectionStore;
  const memorySource = params.memoryStore ?? designMemoryStore;
  const revisionSource = params.revisionStore ?? revisionStore;
  const componentSource = params.componentStore ?? componentContractStore;

  const events: DesignGovernanceEvent[] = [];

  // --- §6 : override de direction persisté (upsert : un seul état connu) ---
  let directionAvailable = false;
  try {
    const stored = directionSource.get(tenantId, projectId);
    directionAvailable = true;
    if (stored) {
      events.push({
        id: 'gov:direction',
        source: 'design-direction',
        status: 'ACTIVE',
        at: isoOrRaw(stored.updatedAt),
        who: stored.updatedBy,
        what: `Override de Design Direction (catalogue ${stored.catalogVersion}) : ${directionOverrideText(stored.override)}`,
        why: null,
        previous: null,
        new: 'override persistant',
        impact: null,
        approval: stored.updatedBy
      });
    }
  } catch {
    directionAvailable = false;
  }

  // --- §24 : décisions de mémoire (ACTIVE + SUPERSEDED tracée) -------------
  let memoryAvailable = false;
  try {
    const decisions = memorySource.list(tenantId, projectId);
    memoryAvailable = true;
    for (const decision of decisions) {
      if (decision.status === 'ACTIVE') {
        events.push({
          id: `gov:memory:${decision.id}`,
          source: 'design-memory',
          status: 'ACTIVE',
          at: isoOrRaw(decision.recordedAt),
          who: decision.source,
          what:
            decision.kind === 'IGNORE_OPPORTUNITY' && decision.opportunityId
              ? `Ignore l'opportunité ${decision.opportunityId} : ${decision.decision}`
              : decision.decision,
          why: decision.reason,
          previous: null,
          new: 'ACTIVE',
          impact: null,
          approval: decision.approvedBy ?? null
        });
      } else {
        events.push({
          id: `gov:memory:${decision.id}:supersede`,
          source: 'design-memory',
          status: 'SUPERSEDED',
          at: isoOrRaw(decision.supersededAt ?? decision.recordedAt),
          who: decision.supersededBy ?? 'non tracé',
          what: `Supersession de la décision « ${decision.decision} »`,
          why: null,
          previous: 'ACTIVE',
          new: 'SUPERSEDED',
          impact: null,
          approval: null
        });
      }
    }
  } catch {
    memoryAvailable = false;
  }

  // --- §29 : améliorations appliquées (deltas AQS extraits du message) ----
  let revisionsAvailable = false;
  try {
    const revisions = revisionSource.listRevisions(tenantId, projectId);
    revisionsAvailable = true;
    for (const revision of revisions) {
      if (!revision.message.startsWith('Design Improve — AQS ')) continue;
      const match = IMPROVEMENT_MESSAGE_PATTERN.exec(revision.message);
      const initial = match ? Number(match[1]) : null;
      const final = match ? Number(match[2]) : null;
      const delta =
        initial !== null && final !== null && Number.isFinite(initial) && Number.isFinite(final)
          ? `${final >= initial ? '+' : ''}${Math.round((final - initial) * 100) / 100}`
          : null;
      events.push({
        id: `gov:improvement:${revision.id}`,
        source: 'design-improvement',
        status: 'APPLIED',
        at: isoOrRaw(revision.createdAt),
        who: revision.author,
        what: revision.message,
        why: null,
        previous: initial !== null ? `AQS ${initial}` : null,
        new: final !== null ? `AQS ${final}` : null,
        impact: delta !== null ? `delta AQS ${delta}` : null,
        approval: null
      });
    }
  } catch {
    revisionsAvailable = false;
  }

  // --- §9/§10 : overrides de composants (upsert : un seul état connu) ------
  let componentsAvailable = false;
  try {
    const overrides = componentSource.list(tenantId, projectId);
    componentsAvailable = true;
    for (const override of overrides) {
      events.push({
        id: `gov:component:${override.componentId}`,
        source: 'design-component',
        status: 'ACTIVE',
        at: isoOrRaw(override.updatedAt),
        who: override.updatedBy,
        what: `Composant ${override.componentId} : ${override.override.status}${
          override.override.replacementId ? ` (remplacement : ${override.override.replacementId})` : ''
        }`,
        why: override.override.reason ?? null,
        previous: null,
        new: override.override.status,
        impact: null,
        approval: null
      });
    }
  } catch {
    componentsAvailable = false;
  }

  // Tri déterministe : at DESC, puis id ASC (jamais de Math.random).
  events.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));

  const counts: DesignGovernanceCounts = {
    directionOverride: events.filter((event) => event.source === 'design-direction').length,
    memoryActive: events.filter((event) => event.source === 'design-memory' && event.status === 'ACTIVE').length,
    memorySuperseded: events.filter((event) => event.source === 'design-memory' && event.status === 'SUPERSEDED')
      .length,
    improvement: events.filter((event) => event.source === 'design-improvement').length,
    component: events.filter((event) => event.source === 'design-component').length,
    total: events.length
  };

  return deepFreeze({
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    counts,
    sources: {
      direction: directionAvailable,
      memory: memoryAvailable,
      revisions: revisionsAvailable,
      components: componentsAvailable
    },
    events
  });
}
