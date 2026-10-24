/**
 * VibeCode Core - Design Harmony
 * CDC V8 §9/§10 — COMPONENT CONTRACTS AUDIT : évalue les composants RÉELLEMENT
 * observés contre les contrats effectifs (catalogue ± overrides projet).
 *
 * Mesures réelles uniquement :
 *  - accessibilité : libellés accessibles, aria-modal, th/caption, cible
 *    tactile ≥ 44px sur le snapshot MOBILE ;
 *  - états : preuves CSS documentaires (pseudo-états de la famille) et
 *    marqueurs DOM réels (aria-busy, data-state, classes d'état) — un état
 *    sans preuve statique est UNKNOWN, jamais FAIL inventé ;
 *  - variantes : discipline mesurée (nombre de valeurs distinctes de hauteur /
 *    padding / rayon ≤ budget du contrat) ;
 *  - contrôle par tokens : espacement / typographie / rayon réellement
 *    conformes aux tokens inférés ;
 *  - dépréciation / désactivation : un composant retiré mais encore utilisé
 *    est un échec explicite avec son remplacement.
 *
 * Aucun Math.random : ids et auditId déterministes (hash de contenu).
 */

import { createHash } from 'node:crypto';
import type { InferredDesignSystem } from './types.js';
import type { NormalizedDomNode, VisualSnapshot } from '../visual-intelligence/types.js';
import {
  COMPONENT_CONTRACTS_VERSION,
  type ComponentContractFindingSeverity,
  type ComponentStateId,
  type EffectiveComponentContract
} from './component-contracts.js';

/** Seuil de conformité tokens (miroir de la règle CDC spacing ≥ 80 %). */
export const MIN_COMPONENT_TOKEN_CONTROL_PERCENT = 80;

/** Cap de preuves conservées par finding (les compteurs restent complets). */
const MAX_SELECTORS_PER_FINDING = 3;

export type ComponentAuditStatus = 'PASS' | 'FAIL' | 'UNKNOWN';
export type ComponentStateStatus = 'DECLARED' | 'MISSING' | 'UNKNOWN';

export interface ComponentContractFinding {
  readonly id: string;
  readonly componentId: string;
  readonly code: string;
  readonly severity: ComponentContractFindingSeverity;
  readonly pageRoutes: readonly string[];
  readonly selectors: readonly string[];
  readonly message: string;
  readonly observedValue?: string | undefined;
  readonly expectedValue?: string | undefined;
  readonly evidence: readonly string[];
  readonly recommendation: string;
  readonly occurrences: number;
}

export interface ComponentStateCheck {
  readonly state: ComponentStateId;
  readonly status: ComponentStateStatus;
  readonly evidence: readonly string[];
}

export interface ComponentVariantCheckResult {
  readonly property: 'height' | 'padding' | 'radius';
  readonly label: string;
  readonly maxDistinct: number;
  readonly status: ComponentAuditStatus;
  readonly observed: readonly string[];
}

export interface ComponentTokenControl {
  readonly spacing: number | null;
  readonly typography: number | null;
  readonly radius: number | null;
  readonly overall: number | null;
}

export interface ComponentContractAuditItem {
  readonly componentId: string;
  readonly name: string;
  readonly status: ComponentAuditStatus;
  readonly score: number | null;
  readonly observedCount: number;
  readonly pages: readonly string[];
  readonly states: readonly ComponentStateCheck[];
  readonly variantChecks: readonly ComponentVariantCheckResult[];
  readonly tokenControl: ComponentTokenControl;
  readonly findings: readonly ComponentContractFinding[];
}

export interface ComponentContractAuditSummary {
  readonly contracts: number;
  readonly observed: number;
  readonly pass: number;
  readonly fail: number;
  readonly unknown: number;
  readonly componentContractScore: number | null;
  readonly coverage: number;
  readonly findings: number;
  readonly bySeverity: {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
  };
  readonly deprecatedUsage: readonly string[];
  readonly disabledUsage: readonly string[];
}

export interface ComponentContractAuditReport {
  readonly catalogVersion: string;
  readonly auditId: string;
  readonly analyzedAt: string;
  readonly pages: readonly string[];
  readonly items: readonly ComponentContractAuditItem[];
  readonly summary: ComponentContractAuditSummary;
}

export interface ComponentContractAuditInput {
  readonly snapshots: readonly VisualSnapshot[];
  readonly mobileSnapshots?: readonly VisualSnapshot[] | undefined;
  readonly tokens: InferredDesignSystem;
  readonly cssContent?: string | undefined;
  readonly contracts: readonly EffectiveComponentContract[];
}

// ---------------------------------------------------------------------------
// Helpers — preuves réelles, jamais de valeur de remplissage.
// ---------------------------------------------------------------------------

function flatten(node: NormalizedDomNode, out: NormalizedDomNode[] = []): NormalizedDomNode[] {
  out.push(node);
  for (const child of node.children) flatten(child, out);
  return out;
}

function parsePxValues(value: string | undefined): number[] {
  if (!value) return [];
  const matches = String(value).match(/(-?\d+(?:\.\d+)?)px/gi) ?? [];
  return matches
    .map((entry) => Number(entry.replace(/px/i, '')))
    .filter((entry) => Number.isFinite(entry));
}

function normalizeValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = String(value).trim().replace(/\s+/g, ' ');
  return trimmed.length === 0 ? undefined : trimmed.toLowerCase();
}

interface ObservedNode {
  readonly node: NormalizedDomNode;
  readonly pageRoute: string;
}

function exactMatch(contract: EffectiveComponentContract, node: NormalizedDomNode): boolean {
  const tag = node.tagName.toLowerCase();
  if (contract.tagNames.includes(tag)) return true;
  const classes = node.classes.map((entry) => entry.toLowerCase());
  if (contract.classSignals.some((signal) => classes.includes(signal.toLowerCase()))) return true;
  return false;
}

function matchesAttributeSignals(contract: EffectiveComponentContract, node: NormalizedDomNode): boolean {
  for (const signal of contract.attributeSignals) {
    const value = (node.attributes[signal.name] ?? '').toLowerCase();
    if (value.length > 0 && signal.values.some((entry) => entry.toLowerCase() === value)) return true;
  }
  return false;
}

/** Détection en deux passes : signaux DOM exacts, puis rôles sémantiques. */
function detectObservedNodes(
  contracts: readonly EffectiveComponentContract[],
  snapshots: readonly VisualSnapshot[]
): Map<string, ObservedNode[]> {
  const result = new Map<string, ObservedNode[]>();
  const claimed = new Set<string>();
  const nodesBySnapshot = snapshots.map((snapshot) => ({
    snapshot,
    nodes: flatten(snapshot.rootNode)
  }));

  for (const contract of contracts) {
    result.set(contract.id, []);
  }

  for (const contract of contracts) {
    for (const entry of nodesBySnapshot) {
      for (const node of entry.nodes) {
        if (claimed.has(node.id)) continue;
        if (exactMatch(contract, node) || matchesAttributeSignals(contract, node)) {
          claimed.add(node.id);
          result.get(contract.id)!.push({ node, pageRoute: entry.snapshot.pageRoute });
        }
      }
    }
  }

  for (const contract of contracts) {
    if (contract.roles.length === 0) continue;
    for (const entry of nodesBySnapshot) {
      for (const node of entry.nodes) {
        if (claimed.has(node.id)) continue;
        if (contract.roles.includes(node.role)) {
          claimed.add(node.id);
          result.get(contract.id)!.push({ node, pageRoute: entry.snapshot.pageRoute });
        }
      }
    }
  }

  return result;
}

function accessibleName(node: NormalizedDomNode): string | undefined {
  const text = node.textContent.trim();
  if (text.length > 0) return text;
  const attrs = node.attributes;
  return (
    attrs['aria-label']?.trim() ||
    attrs['aria-labelledby']?.trim() ||
    attrs['title']?.trim() ||
    undefined
  );
}

function hasLabelAssociation(node: NormalizedDomNode, pageNodes: readonly NormalizedDomNode[]): boolean {
  if (node.attributes['aria-label']?.trim() || node.attributes['aria-labelledby']?.trim() || node.attributes['title']?.trim()) {
    return true;
  }
  const id = node.attributes['id'];
  if (!id) return false;
  return pageNodes.some(
    (candidate) =>
      candidate.tagName.toLowerCase() === 'label' && (candidate.attributes['for'] ?? '').trim() === id.trim()
  );
}

// ---------------------------------------------------------------------------
// Séquelles CSS — sélecteurs réellement déclarés.
// ---------------------------------------------------------------------------

function extractSelectors(cssContent: string): string[] {
  const selectors: string[] = [];
  const regex = /([^{}]+)\{/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cssContent)) !== null) {
    const body = match[1];
    if (!body) continue;
    for (const part of body.split(',')) {
      const selector = part.trim().toLowerCase();
      if (selector.length === 0 || selector.startsWith('@')) continue;
      selectors.push(selector.replace(/\s+/g, ' '));
    }
  }
  return selectors;
}

function familyTokens(contract: EffectiveComponentContract, observed: readonly ObservedNode[]): string[] {
  const tokens = new Set<string>();
  for (const tag of contract.tagNames) tokens.add(tag.toLowerCase());
  for (const signal of contract.classSignals) tokens.add(`.${signal.toLowerCase()}`);
  for (const entry of observed) {
    for (const cls of entry.node.classes) {
      if (cls.trim().length > 0) tokens.add(`.${cls.trim().toLowerCase()}`);
    }
  }
  return [...tokens];
}

const PSEUDO_STATE_SELECTORS: Partial<Record<ComponentStateId, RegExp>> = {
  hover: /:hover/,
  focus: /:focus(-visible|-within)?/,
  active: /:active/,
  disabled: /:disabled|\[disabled\]|\[aria-disabled/
};

const DATA_STATE_MARKERS: Partial<Record<ComponentStateId, { attributes?: readonly string[]; classes?: readonly string[]; dataState?: readonly string[] }>> = {
  loading: { attributes: ['aria-busy'], classes: ['loading', 'is-loading', 'skeleton'], dataState: ['loading'] },
  empty: { classes: ['empty', 'is-empty', 'empty-state'], dataState: ['empty'] },
  error: { attributes: ['aria-invalid'], classes: ['error', 'is-error', 'invalid'], dataState: ['error'] },
  success: { classes: ['success', 'is-success'], dataState: ['success'] },
  selected: { attributes: ['aria-selected', 'aria-current'], classes: ['selected', 'is-selected'], dataState: ['selected'] },
  dismissed: { classes: ['dismissed', 'is-dismissed'], dataState: ['dismissed'] }
};

function domHasStateMarker(node: NormalizedDomNode, state: ComponentStateId): boolean {
  const spec = DATA_STATE_MARKERS[state];
  if (!spec) return false;
  const attrs = node.attributes;
  if (spec.attributes?.some((name) => {
    const value = (attrs[name] ?? '').trim().toLowerCase();
    if (value.length === 0) return false;
    if (name === 'aria-busy' || name === 'aria-selected' || name === 'aria-current') return value === 'true' || value === 'page' || value === 'step';
    return true;
  })) {
    return true;
  }
  if (spec.classes?.some((cls) => node.classes.some((entry) => entry.trim().toLowerCase() === cls))) return true;
  const dataState = (attrs['data-state'] ?? '').trim().toLowerCase();
  if (spec.dataState?.includes(dataState)) return true;
  return false;
}

function evaluateState(params: {
  state: ComponentStateId;
  observed: readonly ObservedNode[];
  selectors: readonly string[];
  cssAvailable: boolean;
  familyTokens: readonly string[];
}): ComponentStateCheck {
  const { state, observed, selectors, cssAvailable, familyTokens } = params;

  if (state === 'default') {
    return {
      state,
      status: observed.length > 0 ? 'DECLARED' : 'UNKNOWN',
      evidence: observed.length > 0 ? [`${observed.length} élément(s) rendus sur ${observed[0]?.pageRoute ?? '/'}`] : ['aucun élément observé']
    };
  }

  if (observed.some((entry) => domHasStateMarker(entry.node, state))) {
    return { state, status: 'DECLARED', evidence: ['marqueur DOM réel observé (attribut/classe d’état)'] };
  }

  const pseudo = PSEUDO_STATE_SELECTORS[state];
  if (pseudo) {
    if (!cssAvailable) {
      return { state, status: 'UNKNOWN', evidence: ['CSS documentaire indisponible — état non vérifiable'] };
    }
    const familySelectors = selectors.filter((selector) => familyTokens.some((token) => selector.includes(token)));
    if (familySelectors.length === 0) {
      return { state, status: 'UNKNOWN', evidence: ['aucun sélecteur de la famille dans le CSS documentaire'] };
    }
    const matched = familySelectors.filter((selector) => pseudo.test(selector));
    return matched.length > 0
      ? { state, status: 'DECLARED', evidence: [`sélecteur(s) réel(s) : ${matched.slice(0, 3).join(' | ')}`] }
      : { state, status: 'MISSING', evidence: [`${familySelectors.length} sélecteur(s) de famille, aucun ne déclare l’état`] };
  }

  // États pilotés par le code (loading/empty/error/success/selected/dismissed) :
  // une preuve CSS ou DOM déclare ; l'absence reste UNKNOWN (jamais un FAIL inventé).
  if (cssAvailable) {
    const spec = DATA_STATE_MARKERS[state];
    const stateTokens = [
      ...(spec?.classes ?? []).map((cls) => `.${cls}`),
      ...(spec?.dataState ?? []).map((entry) => `data-state="${entry}"`)
    ];
    const matched = selectors.filter(
      (selector) => familyTokens.some((token) => selector.includes(token)) && stateTokens.some((token) => selector.includes(token))
    );
    if (matched.length > 0) {
      return { state, status: 'DECLARED', evidence: [`sélecteur(s) réel(s) : ${matched.slice(0, 3).join(' | ')}`] };
    }
  }
  return { state, status: 'UNKNOWN', evidence: ['aucune preuve statique (état potentiellement piloté par le code)'] };
}

// ---------------------------------------------------------------------------
// Variantes & tokens
// ---------------------------------------------------------------------------

function propertyValues(property: 'height' | 'padding' | 'radius', observed: readonly ObservedNode[]): string[] {
  const values: string[] = [];
  for (const entry of observed) {
    const node = entry.node;
    if (property === 'height') {
      if (node.layout.height > 0) values.push(`${node.layout.height}px`);
    } else if (property === 'padding') {
      const normalized = normalizeValue(node.styles.padding);
      if (normalized && normalized !== '0px' && normalized !== '0') values.push(normalized);
    } else {
      const normalized = normalizeValue(node.styles.borderRadius);
      if (normalized && normalized !== '0px' && normalized !== '0') values.push(normalized);
    }
  }
  return values;
}

function tokenCompliance(
  values: readonly number[],
  allowed: readonly number[],
  options: { includeZero: boolean; gridStep?: number | undefined }
): number | null {
  const relevant = options.includeZero ? values : values.filter((value) => value !== 0);
  if (relevant.length === 0 || allowed.length === 0) return null;
  const compliant = relevant.filter(
    (value) =>
      value === 0 ||
      allowed.some((entry) => Math.abs(entry - value) < 0.51) ||
      (options.gridStep !== undefined && options.gridStep > 0 && Math.abs(value % options.gridStep) < 0.01)
  );
  return Math.round((compliant.length / relevant.length) * 100);
}

// ---------------------------------------------------------------------------
// Audit principal
// ---------------------------------------------------------------------------

export function auditComponentContracts(input: ComponentContractAuditInput): ComponentContractAuditReport {
  const { snapshots, tokens, contracts } = input;
  const mobileSnapshots = input.mobileSnapshots ?? [];
  const cssContent = input.cssContent ?? '';
  const cssAvailable = cssContent.trim().length > 0;
  const selectors = cssAvailable ? extractSelectors(cssContent) : [];

  const observedByContract = detectObservedNodes(contracts, snapshots);
  const observedMobileByContract = detectObservedNodes(contracts, mobileSnapshots);
  const pages = [...new Set(snapshots.map((snapshot) => snapshot.pageRoute))].sort();

  const spacingScale = tokens.spacingTokens.detectedScale;
  const baseStep = tokens.spacingTokens.baseGridStep;
  const fontScale = tokens.typographyTokens.detectedScale
    .flatMap((entry) => parsePxValues(entry))
    .concat(tokens.typographyTokens.styleScale ? Object.values(tokens.typographyTokens.styleScale).flatMap((entry) => parsePxValues(entry)) : []);
  const radiusScale = tokens.shapeTokens.detectedRadii.flatMap((entry) => parsePxValues(entry));

  const items: ComponentContractAuditItem[] = contracts.map((contract) => {
    const observed = observedByContract.get(contract.id) ?? [];
    const observedMobile = observedMobileByContract.get(contract.id) ?? [];
    const findings = new Map<string, ComponentContractFinding>();

    const pushFinding = (finding: Omit<ComponentContractFinding, 'id' | 'occurrences'>): void => {
      const id = `ccf-${contract.id}-${finding.code.toLowerCase()}`;
      const existing = findings.get(id);
      if (existing) {
        findings.set(id, {
          ...existing,
          occurrences: existing.occurrences + 1,
          selectors: [...new Set([...existing.selectors, ...finding.selectors])].slice(0, MAX_SELECTORS_PER_FINDING),
          pageRoutes: [...new Set([...existing.pageRoutes, ...finding.pageRoutes])]
        });
        return;
      }
      findings.set(id, {
        ...finding,
        id,
        selectors: finding.selectors.slice(0, MAX_SELECTORS_PER_FINDING),
        occurrences: 1
      });
    };

    const routeOf = (entry: ObservedNode): string => entry.pageRoute;
    const selectorOf = (entry: ObservedNode): string => entry.node.selector || entry.node.tagName.toLowerCase();

    // ---- États -------------------------------------------------------------
    const tokensForFamily = familyTokens(contract, observed);
    const allStates: ComponentStateId[] = [...contract.requiredStates, ...contract.optionalStates];
    const states: ComponentStateCheck[] = allStates.map((state) =>
      evaluateState({ state, observed, selectors, cssAvailable, familyTokens: tokensForFamily })
    );
    // Un état REQUIS réellement MISSING (preuve CSS de famille sans l'état) est
    // un échec mesuré ; un état sans preuve statique reste UNKNOWN (déjà géré).
    for (const check of states) {
      if (check.status === 'MISSING' && contract.requiredStates.includes(check.state)) {
        pushFinding({
          componentId: contract.id,
          code: `STATE_${check.state.toUpperCase()}_MISSING`,
          severity: 'MEDIUM',
          pageRoutes: [...new Set(observed.map(routeOf))],
          selectors: observed.slice(0, MAX_SELECTORS_PER_FINDING).map(selectorOf),
          message: `État requis non déclaré : ${check.state} pour ${contract.id}`,
          observedValue: check.evidence[0] ?? 'aucun sélecteur déclaré',
          expectedValue: `sélecteur :${check.state} sur la famille`,
          evidence: check.evidence,
          recommendation: `Déclarer l’état ${check.state} dans le CSS de la famille ${contract.id}.`
        });
      }
    }

    // ---- Accessibilité -----------------------------------------------------
    const isInteractive = ['button', 'input', 'select'].includes(contract.id);
    if (contract.id === 'button') {
      const missing = observed.filter((entry) => accessibleName(entry.node) === undefined);
      if (missing.length > 0) {
        pushFinding({
          componentId: contract.id,
          code: 'ACCESSIBLE_NAME_MISSING',
          severity: 'HIGH',
          pageRoutes: [...new Set(missing.map(routeOf))],
          selectors: missing.map(selectorOf),
          message: `${missing.length} bouton(s) sans libellé accessible`,
          observedValue: `${missing.length}/${observed.length} sans nom`,
          expectedValue: 'libellé visible ou aria-label',
          evidence: missing.slice(0, 3).map((entry) => `${entry.pageRoute} ${selectorOf(entry)}`),
          recommendation: 'Ajouter un texte visible ou un aria-label à chaque bouton.'
        });
      }
    }
    if (contract.id === 'input' || contract.id === 'select') {
      const pageNodesByRoute = new Map<string, NormalizedDomNode[]>();
      for (const snapshot of snapshots) {
        pageNodesByRoute.set(snapshot.pageRoute, flatten(snapshot.rootNode));
      }
      const missing = observed.filter((entry) => {
        const pageNodes = pageNodesByRoute.get(entry.pageRoute) ?? [];
        return !hasLabelAssociation(entry.node, pageNodes);
      });
      const placeholderOnly = missing.filter((entry) => (entry.node.attributes['placeholder'] ?? '').trim().length > 0);
      if (missing.length > 0) {
        pushFinding({
          componentId: contract.id,
          code: placeholderOnly.length === missing.length ? 'PLACEHOLDER_ONLY_LABEL' : 'ACCESSIBLE_NAME_MISSING',
          severity: placeholderOnly.length === missing.length ? 'MEDIUM' : 'HIGH',
          pageRoutes: [...new Set(missing.map(routeOf))],
          selectors: missing.map(selectorOf),
          message: `${missing.length} champ(s) de type ${contract.name} sans libellé associé`,
          observedValue: `${missing.length}/${observed.length} sans libellé`,
          expectedValue: 'label associé ou aria-label',
          evidence: missing.slice(0, 3).map((entry) => `${entry.pageRoute} ${selectorOf(entry)}`),
          recommendation: 'Associer un libellé réel (jamais le placeholder seul).'
        });
      }
    }
    if (contract.id === 'modal') {
      const missingAria = observed.filter((entry) => (entry.node.attributes['aria-modal'] ?? '').toLowerCase() !== 'true');
      if (missingAria.length > 0) {
        pushFinding({
          componentId: contract.id,
          code: 'MODAL_ARIA_MODAL_MISSING',
          severity: 'HIGH',
          pageRoutes: [...new Set(missingAria.map(routeOf))],
          selectors: missingAria.map(selectorOf),
          message: `${missingAria.length} modale(s) sans aria-modal="true"`,
          observedValue: `${missingAria.length}/${observed.length}`,
          expectedValue: 'aria-modal="true"',
          evidence: missingAria.slice(0, 3).map((entry) => `${entry.pageRoute} ${selectorOf(entry)}`),
          recommendation: 'Déclarer role="dialog" + aria-modal et relier le titre.'
        });
      }
      const missingLabel = observed.filter((entry) => accessibleName(entry.node) === undefined);
      if (missingLabel.length > 0) {
        pushFinding({
          componentId: contract.id,
          code: 'MODAL_LABEL_MISSING',
          severity: 'MEDIUM',
          pageRoutes: [...new Set(missingLabel.map(routeOf))],
          selectors: missingLabel.map(selectorOf),
          message: `${missingLabel.length} modale(s) sans titre accessible`,
          expectedValue: 'aria-labelledby ou titre relié',
          evidence: missingLabel.slice(0, 3).map((entry) => `${entry.pageRoute} ${selectorOf(entry)}`),
          recommendation: 'Relier le titre de la modale (aria-labelledby).'
        });
      }
    }
    if (contract.id === 'data-table') {
      const missingHeaders = observed.filter(
        (entry) => !flatten(entry.node).some((candidate) => candidate.tagName.toLowerCase() === 'th')
      );
      const missingCaption = observed.filter((entry) => {
        const hasCaption = flatten(entry.node).some((candidate) => candidate.tagName.toLowerCase() === 'caption');
        const label = (entry.node.attributes['aria-label'] ?? '').trim();
        return !hasCaption && label.length === 0;
      });
      if (missingHeaders.length > 0) {
        pushFinding({
          componentId: contract.id,
          code: 'TABLE_HEADERS_MISSING',
          severity: 'MEDIUM',
          pageRoutes: [...new Set(missingHeaders.map(routeOf))],
          selectors: missingHeaders.map(selectorOf),
          message: `${missingHeaders.length} tableau(x) sans cellule d'en-tête th`,
          expectedValue: 'th avec scope',
          evidence: missingHeaders.slice(0, 3).map((entry) => `${entry.pageRoute} ${selectorOf(entry)}`),
          recommendation: 'Déclarer des th avec scope pour chaque colonne.'
        });
      }
      if (missingCaption.length > 0) {
        pushFinding({
          componentId: contract.id,
          code: 'TABLE_CAPTION_MISSING',
          severity: 'LOW',
          pageRoutes: [...new Set(missingCaption.map(routeOf))],
          selectors: missingCaption.map(selectorOf),
          message: `${missingCaption.length} tableau(x) sans caption ni aria-label`,
          expectedValue: 'caption ou aria-label',
          evidence: missingCaption.slice(0, 3).map((entry) => `${entry.pageRoute} ${selectorOf(entry)}`),
          recommendation: 'Décrire le tableau (caption ou aria-label).'
        });
      }
    }
    if (contract.id === 'navigation') {
      const navsByPage = new Map<string, number>();
      for (const entry of observed) {
        navsByPage.set(entry.pageRoute, (navsByPage.get(entry.pageRoute) ?? 0) + 1);
      }
      const multipleNavPages = [...navsByPage.entries()].filter(([, count]) => count > 1).map(([route]) => route);
      if (multipleNavPages.length > 0) {
        const unlabeled = observed.filter(
          (entry) => multipleNavPages.includes(entry.pageRoute) && !(entry.node.attributes['aria-label'] ?? '').trim()
        );
        if (unlabeled.length > 0) {
          pushFinding({
            componentId: contract.id,
            code: 'NAV_LABEL_MISSING',
            severity: 'LOW',
            pageRoutes: [...new Set(unlabeled.map(routeOf))],
            selectors: unlabeled.map(selectorOf),
            message: `${unlabeled.length} navigation(s) sans aria-label sur une page multi-navigations`,
            expectedValue: 'aria-label distinct par repère nav',
            evidence: unlabeled.slice(0, 3).map((entry) => `${entry.pageRoute} ${selectorOf(entry)}`),
            recommendation: 'Libeller chaque repère nav pour les distinguer.'
          });
        }
      }
    }
    if (isInteractive) {
      const tooSmall = observedMobile.filter(
        (entry) => entry.node.layout.height > 0 && entry.node.layout.height < contract.responsive.minTouchTargetPx
      );
      if (tooSmall.length > 0) {
        pushFinding({
          componentId: contract.id,
          code: 'TOUCH_TARGET_TOO_SMALL',
          severity: 'MEDIUM',
          pageRoutes: [...new Set(tooSmall.map(routeOf))],
          selectors: tooSmall.map(selectorOf),
          message: `${tooSmall.length} ${contract.name.toLowerCase()}(s) sous ${contract.responsive.minTouchTargetPx}px sur mobile`,
          observedValue: `${tooSmall[0]?.node.layout.height ?? 0}px (premier observé)`,
          expectedValue: `≥ ${contract.responsive.minTouchTargetPx}px`,
          evidence: tooSmall.slice(0, 3).map((entry) => `${entry.pageRoute} ${selectorOf(entry)} — ${entry.node.layout.height}px`),
          recommendation: `Porter la cible tactile à au moins ${contract.responsive.minTouchTargetPx}px sur mobile.`
        });
      }
    }

    // ---- Dépréciation / désactivation -------------------------------------
    if (observed.length > 0 && contract.status === 'DEPRECATED') {
      pushFinding({
        componentId: contract.id,
        code: 'COMPONENT_DEPRECATED',
        severity: 'HIGH',
        pageRoutes: [...new Set(observed.map(routeOf))],
        selectors: observed.map(selectorOf),
        message: `Composant déprécié encore utilisé : ${contract.id}`,
        expectedValue: contract.deprecated?.replacementId ?? 'composant de remplacement',
        evidence: [`déprécié depuis ${contract.deprecated?.since ?? '—'} : ${contract.deprecated?.reason ?? '—'}`],
        recommendation: `Remplacer par ${contract.deprecated?.replacementId ?? 'le composant recommandé'}.`
      });
    }
    if (observed.length > 0 && contract.status === 'DISABLED') {
      pushFinding({
        componentId: contract.id,
        code: 'COMPONENT_DISABLED_USED',
        severity: 'HIGH',
        pageRoutes: [...new Set(observed.map(routeOf))],
        selectors: observed.map(selectorOf),
        message: `Composant désactivé encore utilisé : ${contract.id}`,
        expectedValue: 'composant indisponible',
        evidence: ['désactivé par décision projet (override §9/§10)'],
        recommendation: 'Remplacer ce composant ou lever la décision de désactivation.'
      });
    }

    // ---- Variantes ---------------------------------------------------------
    const variantChecks: ComponentVariantCheckResult[] = contract.variantChecks.map((check) => {
      const values = propertyValues(check.property, observed);
      const distinct = [...new Set(values)].sort();
      if (values.length < 3) {
        return { property: check.property, label: check.label, maxDistinct: check.maxDistinct, status: 'UNKNOWN', observed: distinct };
      }
      const status: ComponentAuditStatus = distinct.length <= check.maxDistinct ? 'PASS' : 'FAIL';
      if (status === 'FAIL') {
        pushFinding({
          componentId: contract.id,
          code: `VARIANT_DRIFT_${check.property.toUpperCase()}`,
          severity: 'MEDIUM',
          pageRoutes: [...new Set(observed.map(routeOf))],
          selectors: observed.slice(0, MAX_SELECTORS_PER_FINDING).map(selectorOf),
          message: `${check.label} : ${distinct.length} valeurs distinctes pour ${check.maxDistinct} variante(s) autorisée(s)`,
          observedValue: distinct.slice(0, 6).join(', '),
          expectedValue: `≤ ${check.maxDistinct} valeurs distinctes`,
          evidence: [`${values.length} mesures réelles sur ${observed.length} élément(s)`],
          recommendation: `Unifier les ${check.label.toLowerCase()} sur les variantes du contrat ${contract.id}.`
        });
      }
      return { property: check.property, label: check.label, maxDistinct: check.maxDistinct, status, observed: distinct };
    });

    // ---- Contrôle par tokens ----------------------------------------------
    const spacingValues = observed.flatMap((entry) => parsePxValues(entry.node.styles.padding));
    const fontValues = observed.flatMap((entry) => parsePxValues(entry.node.styles.fontSize));
    const radiusValues = observed.flatMap((entry) => parsePxValues(entry.node.styles.borderRadius));
    const spacingPercent = tokenCompliance(spacingValues, spacingScale, { includeZero: true, gridStep: baseStep });
    const typographyPercent = fontScale.length > 0 ? tokenCompliance(fontValues, fontScale, { includeZero: false }) : null;
    const radiusPercent = radiusScale.length > 0 ? tokenCompliance(radiusValues, radiusScale, { includeZero: true }) : null;
    const available = [
      spacingPercent !== null ? { percent: spacingPercent, weight: 0.4, label: 'espacement' } : undefined,
      typographyPercent !== null ? { percent: typographyPercent, weight: 0.3, label: 'typographie' } : undefined,
      radiusPercent !== null ? { percent: radiusPercent, weight: 0.3, label: 'rayon' } : undefined
    ].filter((entry): entry is { percent: number; weight: number; label: string } => entry !== undefined);
    const totalWeight = available.reduce((sum, entry) => sum + entry.weight, 0);
    const tokenOverall =
      available.length === 0 ? null : Math.round(available.reduce((sum, entry) => sum + entry.percent * entry.weight, 0) / totalWeight);
    for (const entry of available) {
      if (entry.percent < MIN_COMPONENT_TOKEN_CONTROL_PERCENT && observed.length >= 3) {
        pushFinding({
          componentId: contract.id,
          code: `TOKEN_CONTROL_${entry.label.toUpperCase()}`,
          severity: 'MEDIUM',
          pageRoutes: [...new Set(observed.map(routeOf))],
          selectors: observed.slice(0, MAX_SELECTORS_PER_FINDING).map(selectorOf),
          message: `Contrôle par tokens faible sur ${entry.label} : ${entry.percent}%`,
          observedValue: `${entry.percent}%`,
          expectedValue: `≥ ${MIN_COMPONENT_TOKEN_CONTROL_PERCENT}%`,
          evidence: [`${observed.length} élément(s) mesurés contre les tokens inférés`],
          recommendation: `Aligner les valeurs de ${entry.label} sur les tokens du projet.`
        });
      }
    }
    const tokenControl: ComponentTokenControl = {
      spacing: spacingPercent,
      typography: typographyPercent,
      radius: radiusPercent,
      overall: tokenOverall
    };

    // ---- Score & statut ----------------------------------------------------
    const penalties: Record<ComponentContractFinding['severity'], number> = {
      CRITICAL: 30,
      HIGH: 20,
      MEDIUM: 10,
      LOW: 4,
      INFO: 0
    };
    const findingList = [...findings.values()].sort(
      (a, b) => penalties[b.severity] - penalties[a.severity] || a.code.localeCompare(b.code)
    );
    const score =
      observed.length === 0
        ? null
        : Math.max(0, 100 - findingList.reduce((sum, finding) => sum + penalties[finding.severity], 0));
    const status: ComponentAuditStatus =
      observed.length === 0
        ? 'UNKNOWN'
        : findingList.some((finding) => finding.severity === 'CRITICAL' || finding.severity === 'HIGH') || (score ?? 0) < 70
          ? 'FAIL'
          : 'PASS';

    return {
      componentId: contract.id,
      name: contract.name,
      status,
      score,
      observedCount: observed.length,
      pages: [...new Set(observed.map(routeOf))].sort(),
      states,
      variantChecks,
      tokenControl,
      findings: findingList
    };
  });

  // ---- Résumé --------------------------------------------------------------
  const observedItems = items.filter((item) => item.observedCount > 0);
  const weightSum = observedItems.reduce((sum, item) => sum + item.observedCount, 0);
  const componentContractScore =
    weightSum === 0
      ? null
      : Math.round(
          observedItems.reduce((sum, item) => sum + (item.score ?? 0) * item.observedCount, 0) / weightSum
        );
  const allFindings = items.flatMap((item) => item.findings);
  const summary: ComponentContractAuditSummary = {
    contracts: contracts.length,
    observed: observedItems.length,
    pass: items.filter((item) => item.status === 'PASS').length,
    fail: items.filter((item) => item.status === 'FAIL').length,
    unknown: items.filter((item) => item.status === 'UNKNOWN').length,
    componentContractScore,
    coverage: contracts.length === 0 ? 0 : Math.round((observedItems.length / contracts.length) * 100) / 100,
    findings: allFindings.length,
    bySeverity: {
      critical: allFindings.filter((finding) => finding.severity === 'CRITICAL').length,
      high: allFindings.filter((finding) => finding.severity === 'HIGH').length,
      medium: allFindings.filter((finding) => finding.severity === 'MEDIUM').length,
      low: allFindings.filter((finding) => finding.severity === 'LOW').length
    },
    deprecatedUsage: items.filter((item) => item.findings.some((finding) => finding.code === 'COMPONENT_DEPRECATED')).map((item) => item.componentId),
    disabledUsage: items.filter((item) => item.findings.some((finding) => finding.code === 'COMPONENT_DISABLED_USED')).map((item) => item.componentId)
  };

  const auditId =
    'cca-' +
    createHash('sha256')
      .update(
        JSON.stringify({
          catalogVersion: COMPONENT_CONTRACTS_VERSION,
          pages,
          items: items.map((item) => ({
            componentId: item.componentId,
            status: item.status,
            score: item.score,
            observedCount: item.observedCount,
            findings: item.findings.map((finding) => finding.code)
          }))
        }),
        'utf8'
      )
      .digest('hex')
      .slice(0, 16);

  return {
    catalogVersion: COMPONENT_CONTRACTS_VERSION,
    auditId,
    analyzedAt: new Date().toISOString(),
    pages,
    items,
    summary
  };
}
