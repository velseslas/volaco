/**
 * VibeCode Core - Design Harmony
 * CDC V8 §9/§10 — COMPONENT CONTRACTS : le Design System devient une
 * représentation exploitable par l'IA.
 *
 * §9 — le moteur connaît, pour chaque composant : disponibilité, variantes,
 *      états, propriétés, contraintes, relations et règles d'utilisation.
 * §10 — chaque composant possède un profil (Purpose, variantes autorisées,
 *      états requis, spacing/typography token-controlled, accessibilité et
 *      responsive requis). L'UI Agent ne doit pas recréer arbitrairement un
 *      composant existant : le catalogue est injecté dans le contexte agent
 *      (design-context.ts) et toute proposition est validable.
 *
 * HONNÊTETÉ : le catalogue est un contrat DÉCLARÉ, versionné et testable ; il
 * n'invente aucune mesure. Les verdicts viennent de l'audit réel
 * (component-contracts-audit.ts). La dépréciation est portée par le projet
 * (override persisté) — jamais silencieuse : replacement + raison exigés.
 */

import { ValidationError } from '../../errors.js';
import type { SemanticRole } from '../visual-intelligence/types.js';

/** Version du catalogue — incrémenter si un contrat/une variante change. */
export const COMPONENT_CONTRACTS_VERSION = '1.0.0';

export const MAX_COMPONENT_OVERRIDES = 50;

export type ComponentContractStatus = 'AVAILABLE' | 'DEPRECATED' | 'DISABLED';

export const COMPONENT_STATUSES: readonly ComponentContractStatus[] = ['AVAILABLE', 'DEPRECATED', 'DISABLED'];

/** Sévérités des findings d'audit composants (alignées sur HarmonySeverity). */
export type ComponentContractFindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/** États du CDC §10 — chaque contrat déclare les siens (requis / optionnels). */
export type ComponentStateId =
  | 'default'
  | 'hover'
  | 'focus'
  | 'active'
  | 'disabled'
  | 'loading'
  | 'empty'
  | 'error'
  | 'success'
  | 'selected'
  | 'dismissed';

export const COMPONENT_STATE_IDS: readonly ComponentStateId[] = [
  'default',
  'hover',
  'focus',
  'active',
  'disabled',
  'loading',
  'empty',
  'error',
  'success',
  'selected',
  'dismissed'
];

export interface ComponentVariantAxis {
  readonly id: string;
  readonly label: string;
  readonly values: readonly string[];
}

/** Contrôle de discipline des variantes sur une propriété réellement mesurée. */
export interface ComponentVariantCheck {
  readonly property: 'height' | 'padding' | 'radius';
  readonly label: string;
  readonly maxDistinct: number;
}

export interface ComponentProperties {
  readonly spacing: 'TOKEN_CONTROLLED';
  readonly typography: 'TOKEN_CONTROLLED';
  readonly radius: 'TOKEN_CONTROLLED';
}

export interface ComponentRelations {
  readonly composedOf: readonly string[];
  readonly usedIn: readonly string[];
  readonly alternatives: readonly string[];
}

export interface ComponentResponsiveRules {
  readonly required: true;
  readonly minTouchTargetPx: number;
  readonly mustNotOverflow: boolean;
}

export interface ComponentAttributeSignal {
  readonly name: string;
  readonly values: readonly string[];
}

export interface ComponentContract {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  /** Détection réelle : rôles sémantiques, balises et signaux DOM. */
  readonly roles: readonly SemanticRole[];
  readonly tagNames: readonly string[];
  readonly classSignals: readonly string[];
  readonly attributeSignals: readonly ComponentAttributeSignal[];
  readonly variants: readonly ComponentVariantAxis[];
  readonly requiredStates: readonly ComponentStateId[];
  readonly optionalStates: readonly ComponentStateId[];
  readonly variantChecks: readonly ComponentVariantCheck[];
  readonly properties: ComponentProperties;
  readonly constraints: readonly string[];
  readonly relations: ComponentRelations;
  readonly usageRules: readonly string[];
  readonly accessibility: readonly string[];
  readonly responsive: ComponentResponsiveRules;
}

export interface ComponentDeprecation {
  readonly replacementId: string;
  readonly reason: string;
  /** Date (AAAA-MM-JJ) de la dépréciation réellement décidée. */
  readonly since: string;
}

/** Contrat effectif = catalogue ± override projet (jamais de mutation du catalogue). */
export interface EffectiveComponentContract {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly status: ComponentContractStatus;
  /** Signaux de détection réels (rôles sémantiques, balises, classes, attributs). */
  readonly roles: readonly SemanticRole[];
  readonly tagNames: readonly string[];
  readonly classSignals: readonly string[];
  readonly attributeSignals: readonly ComponentAttributeSignal[];
  readonly variants: readonly ComponentVariantAxis[];
  readonly requiredStates: readonly ComponentStateId[];
  readonly optionalStates: readonly ComponentStateId[];
  readonly variantChecks: readonly ComponentVariantCheck[];
  readonly properties: ComponentProperties;
  readonly constraints: readonly string[];
  readonly relations: ComponentRelations;
  readonly usageRules: readonly string[];
  readonly accessibility: readonly string[];
  readonly responsive: ComponentResponsiveRules;
  readonly deprecated?: ComponentDeprecation | undefined;
}

const TOKEN_CONTROLLED: ComponentProperties = {
  spacing: 'TOKEN_CONTROLLED',
  typography: 'TOKEN_CONTROLLED',
  radius: 'TOKEN_CONTROLLED'
};

const RESPONSIVE_DEFAULT: ComponentResponsiveRules = {
  required: true,
  minTouchTargetPx: 44,
  mustNotOverflow: true
};

/**
 * Catalogue par défaut — 9 composants couvrant la chaîne §9 (components →
 * patterns) dont le DataTable de l'exemple CDC §10 (variantes Compact/Standard/
 * Dense ; états Loading/Empty/Error/Success/Selected/Disabled).
 */
export const COMPONENT_CONTRACTS: readonly ComponentContract[] = [
  {
    id: 'button',
    name: 'Button',
    purpose: 'Déclencher une action utilisateur explicite',
    roles: ['BUTTON'],
    tagNames: ['button'],
    classSignals: [],
    attributeSignals: [],
    variants: [
      { id: 'emphasis', label: 'Emphase', values: ['primary', 'secondary', 'ghost', 'destructive'] },
      { id: 'size', label: 'Taille', values: ['compact', 'standard', 'large'] }
    ],
    requiredStates: ['default', 'hover', 'focus', 'active', 'disabled'],
    optionalStates: ['loading'],
    variantChecks: [{ property: 'height', label: 'Hauteurs de boutons', maxDistinct: 3 }],
    properties: TOKEN_CONTROLLED,
    constraints: [
      'un seul bouton primaire visible par vue',
      'un bouton icône seule porte un libellé accessible',
      'une action destructive exige une confirmation'
    ],
    relations: { composedOf: ['icon', 'label'], usedIn: ['card', 'modal', 'navigation', 'page'], alternatives: ['link'] },
    usageRules: ['un bouton déclenche une action ; pour naviguer, utiliser un lien'],
    accessibility: ['libellé visible ou aria-label requis', 'cible tactile ≥ 44px sur mobile', 'état de focus visible'],
    responsive: RESPONSIVE_DEFAULT
  },
  {
    id: 'input',
    name: 'Input',
    purpose: 'Saisir une valeur textuelle contrôlée',
    roles: ['INPUT'],
    tagNames: ['input', 'textarea'],
    classSignals: [],
    attributeSignals: [],
    variants: [
      { id: 'type', label: 'Type', values: ['text', 'email', 'password', 'search', 'number'] },
      { id: 'size', label: 'Taille', values: ['compact', 'standard'] }
    ],
    requiredStates: ['default', 'hover', 'focus', 'error', 'disabled'],
    optionalStates: ['loading'],
    variantChecks: [{ property: 'height', label: 'Hauteurs de champs', maxDistinct: 2 }],
    properties: TOKEN_CONTROLLED,
    constraints: [
      'un libellé associé est obligatoire (placeholder jamais seul)',
      "l'erreur est reliée au champ (aria-describedby/aria-invalid)"
    ],
    relations: { composedOf: ['label', 'field', 'help-text', 'error-text'], usedIn: ['form', 'card', 'modal'], alternatives: ['select'] },
    usageRules: ['utiliser le type HTML adapté à la donnée demandée'],
    accessibility: ['libellé associé requis', 'erreur annoncée et décrite', 'cible tactile ≥ 44px sur mobile'],
    responsive: RESPONSIVE_DEFAULT
  },
  {
    id: 'select',
    name: 'Select',
    purpose: 'Choisir une valeur dans une liste fermée',
    roles: ['INPUT'],
    tagNames: ['select'],
    classSignals: [],
    attributeSignals: [],
    variants: [{ id: 'size', label: 'Taille', values: ['compact', 'standard'] }],
    requiredStates: ['default', 'hover', 'focus', 'error', 'disabled'],
    optionalStates: ['loading'],
    variantChecks: [{ property: 'height', label: 'Hauteurs de sélecteurs', maxDistinct: 2 }],
    properties: TOKEN_CONTROLLED,
    constraints: ['au-delà de 10 options, préférer un champ de recherche', 'la valeur vide porte un libellé explicite'],
    relations: { composedOf: ['label', 'trigger', 'menu'], usedIn: ['form', 'modal'], alternatives: ['input'] },
    usageRules: ['réserver aux listes fermées et courtes'],
    accessibility: ['libellé associé requis', 'navigation clavier complète', 'cible tactile ≥ 44px sur mobile'],
    responsive: RESPONSIVE_DEFAULT
  },
  {
    id: 'card',
    name: 'Card',
    purpose: 'Regrouper un contenu homogène et son action principale',
    roles: ['CARD'],
    tagNames: [],
    classSignals: ['card', 'panel', 'tile'],
    attributeSignals: [],
    variants: [
      { id: 'role', label: 'Rôle', values: ['standard', 'interactive', 'metric'] },
      { id: 'elevation', label: 'Élévation', values: ['flat', 'raised'] }
    ],
    requiredStates: ['default'],
    optionalStates: ['hover', 'focus', 'selected', 'loading', 'disabled'],
    variantChecks: [{ property: 'radius', label: 'Rayons de cartes', maxDistinct: 3 }],
    properties: TOKEN_CONTROLLED,
    constraints: [
      'une carte interactive ne contient qu’une cible interactive principale',
      'la hiérarchie de titres est conservée dans la carte'
    ],
    relations: { composedOf: ['heading', 'content', 'actions'], usedIn: ['grid', 'list', 'page'], alternatives: ['modal'] },
    usageRules: ['regrouper ce qui se lit ensemble ; ne pas imbriquer des cartes profondes'],
    accessibility: ['carte interactive accessible au clavier', 'titres hiérarchisés'],
    responsive: RESPONSIVE_DEFAULT
  },
  {
    id: 'data-table',
    name: 'DataTable',
    purpose: 'Afficher des jeux de données structurés',
    roles: [],
    tagNames: ['table'],
    classSignals: ['table', 'data-table', 'datatable'],
    attributeSignals: [],
    variants: [{ id: 'density', label: 'Densité', values: ['compact', 'standard', 'dense'] }],
    requiredStates: ['default', 'loading', 'empty', 'error', 'success', 'selected', 'disabled'],
    optionalStates: [],
    variantChecks: [{ property: 'padding', label: 'Paddings de cellules', maxDistinct: 3 }],
    properties: TOKEN_CONTROLLED,
    constraints: [
      'en-têtes triables avec aria-sort réel',
      'sélection de lignes avec cases libellées',
      'état vide explicite plutôt qu’un tableau vide'
    ],
    relations: {
      composedOf: ['header', 'row', 'cell', 'pagination', 'empty-state'],
      usedIn: ['card', 'page'],
      alternatives: ['card', 'list']
    },
    usageRules: ['réservé aux données tabulaires ; pas de mise en page par tableau'],
    accessibility: ['caption ou aria-label requis', 'en-têtes th avec scope', 'cible tactile ≥ 44px sur mobile'],
    responsive: RESPONSIVE_DEFAULT
  },
  {
    id: 'modal',
    name: 'Modal',
    purpose: 'Concentrer une tâche ou une confirmation bloquante',
    roles: ['MODAL'],
    tagNames: ['dialog'],
    classSignals: ['modal', 'dialog', 'drawer'],
    attributeSignals: [],
    variants: [{ id: 'kind', label: 'Type', values: ['dialog', 'confirm', 'side-panel'] }],
    requiredStates: ['default', 'focus'],
    optionalStates: ['loading', 'error', 'disabled'],
    variantChecks: [{ property: 'radius', label: 'Rayons de modales', maxDistinct: 2 }],
    properties: TOKEN_CONTROLLED,
    constraints: [
      'piège de focus réel pendant l’ouverture',
      'fermeture par Échap et par action explicite',
      'titre relié par aria-labelledby'
    ],
    relations: { composedOf: ['overlay', 'title', 'content', 'actions'], usedIn: ['page'], alternatives: ['side-panel', 'page'] },
    usageRules: ['une seule modale à la fois ; jamais pour du contenu de navigation'],
    accessibility: ['role dialog + aria-modal réel', 'titre accessible', 'focus rendu à l’élément déclencheur'],
    responsive: RESPONSIVE_DEFAULT
  },
  {
    id: 'navigation',
    name: 'Navigation',
    purpose: 'Structurer l’accès aux sections de l’application',
    roles: ['NAVIGATION'],
    tagNames: ['nav'],
    classSignals: ['nav', 'navbar', 'sidebar', 'breadcrumb'],
    attributeSignals: [],
    variants: [{ id: 'placement', label: 'Placement', values: ['top', 'side', 'breadcrumb'] }],
    requiredStates: ['default', 'hover', 'focus', 'selected'],
    optionalStates: ['active', 'disabled'],
    variantChecks: [{ property: 'padding', label: 'Paddings de navigation', maxDistinct: 3 }],
    properties: TOKEN_CONTROLLED,
    constraints: [
      'la page courante porte aria-current',
      'le menu mobile replié reste libellé et accessible au clavier'
    ],
    relations: { composedOf: ['link', 'menu-toggle', 'brand'], usedIn: ['page'], alternatives: ['tabs'] },
    usageRules: ['un lien = une destination ; pas de bouton déguisé en lien'],
    accessibility: ['repère nav libellé si plusieurs navigations', 'cible tactile ≥ 44px sur mobile'],
    responsive: RESPONSIVE_DEFAULT
  },
  {
    id: 'badge',
    name: 'Badge',
    purpose: 'Signaler un statut ou un compteur court',
    roles: [],
    tagNames: [],
    classSignals: ['badge', 'tag', 'chip'],
    attributeSignals: [],
    variants: [
      { id: 'kind', label: 'Type', values: ['status', 'count'] },
      { id: 'tone', label: 'Ton', values: ['neutral', 'success', 'warning', 'error'] }
    ],
    requiredStates: ['default'],
    optionalStates: [],
    variantChecks: [{ property: 'radius', label: 'Rayons de badges', maxDistinct: 2 }],
    properties: TOKEN_CONTROLLED,
    constraints: ['un badge n’est jamais le seul indicateur (texte + couleur)', 'contenu textuel court (≤ 24 caractères)'],
    relations: { composedOf: ['label'], usedIn: ['card', 'data-table', 'page'], alternatives: ['alert'] },
    usageRules: ['signaler un état, pas décorer'],
    accessibility: ['contraste suffisant', 'information jamais portée par la couleur seule'],
    responsive: RESPONSIVE_DEFAULT
  },
  {
    id: 'alert',
    name: 'Alert',
    purpose: 'Communiquer un message d’état important',
    roles: [],
    tagNames: [],
    classSignals: ['alert', 'toast', 'banner'],
    attributeSignals: [{ name: 'role', values: ['alert', 'status'] }],
    variants: [{ id: 'tone', label: 'Ton', values: ['info', 'success', 'warning', 'error'] }],
    requiredStates: ['default'],
    optionalStates: ['loading', 'error', 'success', 'dismissed'],
    variantChecks: [{ property: 'radius', label: 'Rayons d’alertes', maxDistinct: 2 }],
    properties: TOKEN_CONTROLLED,
    constraints: ['les erreurs bloquantes utilisent role="alert"', 'le ton est porté par un texte explicite, pas seulement la couleur'],
    relations: { composedOf: ['icon', 'message', 'actions'], usedIn: ['page', 'form', 'modal'], alternatives: ['badge'] },
    usageRules: ['un message = un ton ; ne pas empiler les alertes'],
    accessibility: ['annonce role alert/status pour les messages urgents', 'contraste suffisant'],
    responsive: RESPONSIVE_DEFAULT
  }
] as const;

const CONTRACT_BY_ID = new Map(COMPONENT_CONTRACTS.map((contract) => [contract.id, contract]));

/** Id de contrat connu du catalogue (validation stricte). */
export function isKnownComponentId(id: string): boolean {
  return CONTRACT_BY_ID.has(id.trim());
}

/** Override projet VALIDÉ (déjà normalisé — le store reste passif). */
export interface ComponentContractOverride {
  readonly status: ComponentContractStatus;
  readonly replacementId?: string | undefined;
  readonly reason?: string | undefined;
}

/**
 * Normalise un override projet : statut connu ; DEPRECATED exige un
 * remplacement existant ≠ soi-même + une raison ; DISABLED exige une raison.
 * Toute entrée incohérente est refusée — jamais de dépréciation silencieuse.
 */
export function normalizeComponentOverride(input: unknown, componentId: string): ComponentContractOverride {
  const id = componentId.trim();
  if (!CONTRACT_BY_ID.has(id)) {
    throw new ValidationError(`Composant inconnu : "${id}" (catalogue ${COMPONENT_CONTRACTS_VERSION}).`, {
      field: 'componentId'
    });
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Override composant invalide : objet attendu.', { field: 'override' });
  }
  const record = input as Record<string, unknown>;
  const status = String(record.status ?? '').trim() as ComponentContractStatus;
  if (!COMPONENT_STATUSES.includes(status)) {
    throw new ValidationError(
      `Statut de composant invalide : "${String(record.status ?? '')}" (attendu : ${COMPONENT_STATUSES.join(', ')}).`,
      { field: 'status' }
    );
  }

  if (status === 'AVAILABLE') {
    return { status };
  }

  const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
  if (reason.length < 10 || reason.length > 280) {
    throw new ValidationError(
      `Une raison est obligatoire (10..280 caractères) pour passer "${id}" en ${status}.`,
      { field: 'reason' }
    );
  }

  if (status === 'DISABLED') {
    return { status, reason };
  }

  const replacementId = typeof record.replacementId === 'string' ? record.replacementId.trim() : '';
  if (!CONTRACT_BY_ID.has(replacementId)) {
    throw new ValidationError(
      `Un remplacement existant est obligatoire pour déprécier "${id}" (reçu : "${replacementId}").`,
      { field: 'replacementId' }
    );
  }
  if (replacementId === id) {
    throw new ValidationError(`Le remplacement de "${id}" ne peut pas être lui-même.`, { field: 'replacementId' });
  }
  return { status, replacementId, reason };
}

/**
 * Applique les overrides projet au catalogue (fonction pure). Un override
 * AVAILABLE neutralise le statut sans effacer l'historique du store.
 */
export function resolveComponentContracts(
  overrides: readonly { readonly componentId: string; readonly override: ComponentContractOverride; readonly updatedAt?: string | undefined }[]
): readonly EffectiveComponentContract[] {
  const byComponent = new Map<string, { override: ComponentContractOverride; updatedAt?: string | undefined }>();
  for (const entry of overrides) {
    if (CONTRACT_BY_ID.has(entry.componentId)) {
      byComponent.set(entry.componentId, { override: entry.override, updatedAt: entry.updatedAt });
    }
  }

  return COMPONENT_CONTRACTS.map((contract) => {
    const applied = byComponent.get(contract.id);
    const base: EffectiveComponentContract = {
      id: contract.id,
      name: contract.name,
      purpose: contract.purpose,
      status: 'AVAILABLE',
      roles: contract.roles,
      tagNames: contract.tagNames,
      classSignals: contract.classSignals,
      attributeSignals: contract.attributeSignals,
      variants: contract.variants,
      requiredStates: contract.requiredStates,
      optionalStates: contract.optionalStates,
      variantChecks: contract.variantChecks,
      properties: contract.properties,
      constraints: contract.constraints,
      relations: contract.relations,
      usageRules: contract.usageRules,
      accessibility: contract.accessibility,
      responsive: contract.responsive
    };
    if (!applied || applied.override.status === 'AVAILABLE') return base;
    if (applied.override.status === 'DISABLED') {
      return { ...base, status: 'DISABLED' };
    }
    return {
      ...base,
      status: 'DEPRECATED',
      deprecated: {
        replacementId: applied.override.replacementId ?? '',
        reason: applied.override.reason ?? '',
        since: (applied.updatedAt ?? '').slice(0, 10)
      }
    };
  });
}

/** Profil résumé pour l'API/le prompt (évite de transporter tout le catalogue). */
export interface ComponentContractSummary {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly status: ComponentContractStatus;
  readonly variants: readonly ComponentVariantAxis[];
  readonly requiredStates: readonly ComponentStateId[];
  readonly optionalStates: readonly ComponentStateId[];
  readonly constraints: readonly string[];
  readonly accessibility: readonly string[];
  readonly responsive: ComponentResponsiveRules;
  readonly replacementId?: string | undefined;
}

export function summarizeComponentContract(contract: EffectiveComponentContract): ComponentContractSummary {
  return {
    id: contract.id,
    name: contract.name,
    purpose: contract.purpose,
    status: contract.status,
    variants: contract.variants,
    requiredStates: contract.requiredStates,
    optionalStates: contract.optionalStates,
    constraints: contract.constraints,
    accessibility: contract.accessibility,
    responsive: contract.responsive,
    ...(contract.deprecated ? { replacementId: contract.deprecated.replacementId } : {})
  };
}

// ---------------------------------------------------------------------------
// §10 — Validation d'une proposition de composant (garde-fou de génération)
// ---------------------------------------------------------------------------

export type ComponentViolationCode =
  | 'UNKNOWN_COMPONENT'
  | 'COMPONENT_DISABLED'
  | 'COMPONENT_DEPRECATED'
  | 'UNKNOWN_VARIANT_AXIS'
  | 'VARIANT_VALUE_NOT_ALLOWED'
  | 'STATE_NOT_ALLOWED';

export interface ComponentViolation {
  readonly code: ComponentViolationCode;
  readonly field: string;
  readonly message: string;
}

export interface ComponentProposal {
  readonly componentId: string;
  readonly variants?: Record<string, string> | undefined;
  readonly states?: readonly string[] | undefined;
}

export interface ComponentProposalVerdict {
  readonly accepted: boolean;
  readonly componentId: string;
  readonly status: ComponentContractStatus | 'UNKNOWN';
  readonly replacementId?: string | undefined;
  readonly violations: readonly ComponentViolation[];
}

/**
 * Valide une proposition de génération contre les contrats EFFECTIFS : composant
 * connu et disponible, axes/valeurs de variantes autorisés, états autorisés.
 * Un composant déprécié est refusé avec son remplacement — l'UI Agent ne doit
 * pas recréer ni prolonger un composant retiré.
 */
export function validateComponentProposal(
  proposal: ComponentProposal,
  contracts: readonly EffectiveComponentContract[]
): ComponentProposalVerdict {
  const id = String(proposal.componentId ?? '').trim();
  const contract = contracts.find((entry) => entry.id === id);
  if (!contract) {
    return {
      accepted: false,
      componentId: id,
      status: 'UNKNOWN',
      violations: [
        {
          code: 'UNKNOWN_COMPONENT',
          field: 'componentId',
          message: `Composant inconnu : "${id}". Utiliser un composant du catalogue (${contracts.map((c) => c.id).join(', ')}).`
        }
      ]
    };
  }

  const violations: ComponentViolation[] = [];
  if (contract.status === 'DISABLED') {
    violations.push({
      code: 'COMPONENT_DISABLED',
      field: 'componentId',
      message: `Le composant "${id}" est désactivé pour ce projet : ne pas l'utiliser.`
    });
  }
  if (contract.status === 'DEPRECATED') {
    violations.push({
      code: 'COMPONENT_DEPRECATED',
      field: 'componentId',
      message: `Le composant "${id}" est déprécié : utiliser "${contract.deprecated?.replacementId ?? '—'}".`
    });
  }

  for (const [axisId, value] of Object.entries(proposal.variants ?? {})) {
    const axis = contract.variants.find((entry) => entry.id === axisId);
    if (!axis) {
      violations.push({
        code: 'UNKNOWN_VARIANT_AXIS',
        field: `variants.${axisId}`,
        message: `Axe de variante inconnu pour "${id}" : "${axisId}".`
      });
      continue;
    }
    if (!axis.values.includes(String(value))) {
      violations.push({
        code: 'VARIANT_VALUE_NOT_ALLOWED',
        field: `variants.${axisId}`,
        message: `Valeur "${String(value)}" interdite pour l'axe "${axisId}" de "${id}" (autorisé : ${axis.values.join(', ')}).`
      });
    }
  }

  const allowedStates = new Set<string>([...contract.requiredStates, ...contract.optionalStates]);
  for (const state of proposal.states ?? []) {
    if (!allowedStates.has(String(state))) {
      violations.push({
        code: 'STATE_NOT_ALLOWED',
        field: `states.${String(state)}`,
        message: `État "${String(state)}" non déclaré pour "${id}" (autorisé : ${[...allowedStates].join(', ')}).`
      });
    }
  }

  return {
    accepted: violations.length === 0,
    componentId: id,
    status: contract.status,
    ...(contract.deprecated ? { replacementId: contract.deprecated.replacementId } : {}),
    violations
  };
}

// ---------------------------------------------------------------------------
// Bloc de contexte AGENT (§9/§10) — borné, séparé du bloc design principal.
// ---------------------------------------------------------------------------

export const MAX_COMPONENT_PROMPT_BLOCK_CHARS = 900;

function truncateBlock(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Compose le bloc « SYSTÈME DE COMPOSANTS » injecté aux générations : les
 * composants disponibles avec variantes/états/contraintes, les indisponibles
 * et dépréciés avec leur remplacement. Interdiction explicite de recréer.
 */
export function buildComponentContextBlock(contracts: readonly EffectiveComponentContract[]): string {
  if (contracts.length === 0) return '';
  // Les composants INDISPONIBLES / DÉPRÉCIÉS passent en tête : si le bloc doit
  // être tronqué, l'interdiction et le remplacement survivent toujours.
  const statusRank = (status: ComponentContractStatus): number =>
    status === 'DEPRECATED' ? 0 : status === 'DISABLED' ? 1 : 2;
  const ordered = [...contracts].sort(
    (a, b) => statusRank(a.status) - statusRank(b.status) || a.id.localeCompare(b.id)
  );
  const lines = ordered.map((contract) => {
    const variants = contract.variants
      .map((axis) => `${axis.id} ${axis.values.join('|')}`)
      .join(' ; ');
    const states = contract.requiredStates.join('/');
    if (contract.status === 'DISABLED') {
      return `- ${contract.id} [INDISPONIBLE — ne pas utiliser]`;
    }
    if (contract.status === 'DEPRECATED') {
      return `- ${contract.id} [DÉPRÉCIÉ — remplacer par ${contract.deprecated?.replacementId ?? '—'}]`;
    }
    const constraint = contract.constraints[0] ? ` ; contrainte : ${contract.constraints[0]}` : '';
    return `- ${contract.id} — ${contract.purpose} (variantes : ${variants} ; états requis : ${states}${constraint})`;
  });
  const head =
    `SYSTÈME DE COMPOSANTS OBLIGATOIRE — catalogue v${COMPONENT_CONTRACTS_VERSION} : ` +
    "utilise exclusivement ces composants, ne recrée jamais un composant existant et n'invente ni variante ni état.";
  return truncateBlock([head, ...lines].join('\n'), MAX_COMPONENT_PROMPT_BLOCK_CHARS);
}
