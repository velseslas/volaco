/**
 * VibeCode Core - Design Harmony
 * CDC V8 §8 — DESIGN RULE ENGINE : catalogue de 10 règles CDC AUDITABLES.
 *
 * Le CDC exige des règles « versionnées, traçables, testables, héritables,
 * auditables ». Ce module évalue les 10 règles RULE-001..RULE-010 sur des
 * preuves RÉELLES (snapshot DOM + tokens inférés + CSS documentaire) :
 *
 *   - chaque évaluation cite la valeur observée, la valeur attendue et ses
 *     preuves ; un input manquant rend UNKNOWN + raison (jamais un verdict
 *     fabriqué) ;
 *   - les seuils sont surchargeables PAR PROJET (héritage de la règle) et des
 *     règles personnalisées bornées (métriques connues) sont supportées ;
 *   - ids et ordre stables (déterminisme strict — pas de randomUUID).
 *
 * Distinct du catalog `design-rules.ts` (règles de GÉNÉRATION appliquées aux
 * prompts, version 1.0.0) : ce module est l'AUDIT des règles du CDC.
 */

import { ValidationError } from '../../errors.js';
import { computeContrastRatio, parseRgb } from './canonical.js';
import type { InferredDesignSystem } from './types.js';
import type { NormalizedDomNode, VisualSnapshot } from '../visual-intelligence/types.js';

/** Version du catalogue d'audit — incrémenter si une règle/seuil change. */
export const DESIGN_RULE_AUDIT_CATALOG_VERSION = '1.0.0';

export const CDC_RULE_IDS = [
  'RULE-001',
  'RULE-002',
  'RULE-003',
  'RULE-004',
  'RULE-005',
  'RULE-006',
  'RULE-007',
  'RULE-008',
  'RULE-009',
  'RULE-010'
] as const;

export type CdcRuleId = (typeof CDC_RULE_IDS)[number];

export type DesignRuleStatus = 'PASS' | 'FAIL' | 'UNKNOWN';

export type DesignCustomRuleMetric =
  | 'maxRadiusPx'
  | 'maxPrimaryUsagePercent'
  | 'maxVisualAccents'
  | 'maxMotionDurationMs';

export const DESIGN_CUSTOM_RULE_METRICS: readonly DesignCustomRuleMetric[] = [
  'maxRadiusPx',
  'maxPrimaryUsagePercent',
  'maxVisualAccents',
  'maxMotionDurationMs'
];

export interface DesignCustomRule {
  /** Id stable de la règle projet — préfixe CUSTOM- obligatoire. */
  readonly id: string;
  readonly label: string;
  readonly metric: DesignCustomRuleMetric;
  readonly operator: '<=' | '>=' | '==';
  readonly value: number;
}

export interface DesignRulesThresholds {
  readonly maxRadiusPx: number;
  readonly maxPrimaryUsagePercent: number;
  readonly maxVisualAccents: number;
  readonly maxMotionDurationMs: number;
  readonly minSpacingCompliancePercent: number;
}

export interface DesignRulesConfig {
  readonly disabledRuleIds: readonly string[];
  readonly thresholds: DesignRulesThresholds;
  readonly customRules: readonly DesignCustomRule[];
}

/** Défauts = valeurs littérales du CDC §8 (RULE-001 ≤ 15 %, RULE-003 ≤ 16 px, RULE-006 ≤ 3). */
export const DEFAULT_DESIGN_RULES_THRESHOLDS: DesignRulesThresholds = {
  maxRadiusPx: 16,
  maxPrimaryUsagePercent: 15,
  maxVisualAccents: 3,
  maxMotionDurationMs: 600,
  minSpacingCompliancePercent: 80
};

export const DEFAULT_DESIGN_RULES_CONFIG: DesignRulesConfig = {
  disabledRuleIds: [],
  thresholds: DEFAULT_DESIGN_RULES_THRESHOLDS,
  customRules: []
};

const THRESHOLD_BOUNDS: Record<keyof DesignRulesThresholds, readonly [number, number]> = {
  maxRadiusPx: [0, 64],
  maxPrimaryUsagePercent: [0, 100],
  maxVisualAccents: [0, 10],
  maxMotionDurationMs: [0, 5000],
  minSpacingCompliancePercent: [0, 100]
};

const MAX_CUSTOM_RULES = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalise une config projet : ids CDC connus, seuils bornés, règles
 * personnalisées bornées (métriques connues, valeur finie). Toute entrée
 * incohérente est refusée — jamais de règle silencieusement ignorée.
 */
export function normalizeDesignRulesConfig(input: unknown): DesignRulesConfig {
  if (!isRecord(input)) {
    throw new ValidationError('Config des règles invalide : objet attendu.', { field: 'config' });
  }
  const rawDisabled = input.disabledRuleIds ?? [];
  if (!Array.isArray(rawDisabled)) {
    throw new ValidationError('"disabledRuleIds" doit être un tableau.', { field: 'disabledRuleIds' });
  }
  const disabledRuleIds: string[] = [];
  for (const id of rawDisabled) {
    const value = String(id).trim();
    if (!(CDC_RULE_IDS as readonly string[]).includes(value)) {
      throw new ValidationError(`Règle CDC inconnue : "${value}" (attendu : ${CDC_RULE_IDS.join(', ')}).`, {
        field: 'disabledRuleIds'
      });
    }
    if (!disabledRuleIds.includes(value)) disabledRuleIds.push(value);
  }

  const thresholds: DesignRulesThresholds = { ...DEFAULT_DESIGN_RULES_THRESHOLDS };
  const rawThresholds = input.thresholds ?? {};
  if (!isRecord(rawThresholds)) {
    throw new ValidationError('"thresholds" doit être un objet.', { field: 'thresholds' });
  }
  const resolvedThresholds: Record<string, number> = { ...thresholds };
  for (const key of Object.keys(THRESHOLD_BOUNDS)) {
    const raw = rawThresholds[key];
    if (raw === undefined || raw === null) continue;
    const value = Number(raw);
    const [min, max] = THRESHOLD_BOUNDS[key as keyof DesignRulesThresholds];
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new ValidationError(
        `Seuil invalide pour "${key}" : ${String(raw)} (attendu : ${min}..${max}).`,
        { field: key }
      );
    }
    resolvedThresholds[key] = value;
  }

  const rawCustom = input.customRules ?? [];
  if (!Array.isArray(rawCustom)) {
    throw new ValidationError('"customRules" doit être un tableau.', { field: 'customRules' });
  }
  if (rawCustom.length > MAX_CUSTOM_RULES) {
    throw new ValidationError(`Au plus ${MAX_CUSTOM_RULES} règles projet sont supportées.`, { field: 'customRules' });
  }
  const customRules: DesignCustomRule[] = [];
  for (const raw of rawCustom) {
    if (!isRecord(raw)) {
      throw new ValidationError('Chaque règle projet doit être un objet.', { field: 'customRules' });
    }
    const id = String(raw.id ?? '').trim();
    if (!/^CUSTOM-[A-Z0-9-]{1,40}$/i.test(id)) {
      throw new ValidationError(`Id de règle projet invalide : "${id}" (préfixe CUSTOM- requis).`, { field: 'id' });
    }
    if (customRules.some((rule) => rule.id === id)) {
      throw new ValidationError(`Id de règle projet dupliqué : "${id}".`, { field: 'id' });
    }
    const label = String(raw.label ?? '').trim();
    if (label.length < 3 || label.length > 120) {
      throw new ValidationError(`Libellé de règle projet invalide : "${label}" (3..120 caractères).`, { field: 'label' });
    }
    const metric = String(raw.metric ?? '') as DesignCustomRuleMetric;
    if (!DESIGN_CUSTOM_RULE_METRICS.includes(metric)) {
      throw new ValidationError(
        `Métrique inconnue : "${metric}" (attendu : ${DESIGN_CUSTOM_RULE_METRICS.join(', ')}).`,
        { field: 'metric' }
      );
    }
    const operator = String(raw.operator ?? '') as DesignCustomRule['operator'];
    if (operator !== '<=' && operator !== '>=' && operator !== '==') {
      throw new ValidationError('Opérateur invalide (attendu : <=, >=, ==).', { field: 'operator' });
    }
    const value = Number(raw.value);
    if (!Number.isFinite(value) || value < 0 || value > 100000) {
      throw new ValidationError(`Valeur de règle projet invalide : ${String(raw.value)}.`, { field: 'value' });
    }
    customRules.push({ id, label, metric, operator, value });
  }

  return {
    disabledRuleIds,
    thresholds: {
      maxRadiusPx: resolvedThresholds['maxRadiusPx']!,
      maxPrimaryUsagePercent: resolvedThresholds['maxPrimaryUsagePercent']!,
      maxVisualAccents: resolvedThresholds['maxVisualAccents']!,
      maxMotionDurationMs: resolvedThresholds['maxMotionDurationMs']!,
      minSpacingCompliancePercent: resolvedThresholds['minSpacingCompliancePercent']!
    },
    customRules
  };
}

export interface DesignRuleAuditResult {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly status: DesignRuleStatus;
  readonly observedValue: string;
  readonly expectedValue?: string | undefined;
  readonly evidence: readonly string[];
  /** Règle personnalisée projet (CUSTOM-*) vs règle CDC. */
  readonly custom: boolean;
}

export interface DesignRuleAuditInput {
  readonly snapshot: VisualSnapshot;
  readonly tokens: InferredDesignSystem;
  readonly cssContent?: string | undefined;
  readonly config?: DesignRulesConfig | undefined;
}

export interface DesignRuleAuditReport {
  readonly catalogVersion: string;
  readonly config: DesignRulesConfig;
  readonly results: readonly DesignRuleAuditResult[];
  readonly summary: {
    readonly total: number;
    readonly pass: number;
    readonly fail: number;
    readonly unknown: number;
  };
}

// ---------------------------------------------------------------------------
// Métriques — calculées UNE fois depuis les preuves réelles.
// ---------------------------------------------------------------------------

interface RuleMetrics {
  readonly styledNodeCount: number;
  readonly primaryColor?: string | undefined;
  readonly primaryUsagePercent?: number | undefined;
  readonly spacingScale: readonly number[];
  readonly spacingRegularityRatio?: number | undefined;
  readonly maxRadiusPx?: number | undefined;
  readonly h1Count: number;
  readonly headingSizes: readonly number[];
  readonly hasInteractiveStyleEvidence: boolean;
  readonly cssHoverSignal: boolean;
  readonly motionHoverSignal: boolean;
  readonly accentColors: readonly string[];
  readonly maxMotionDurationMs?: number | undefined;
  readonly interactiveCount: number;
  readonly prominentActionCount: number;
  readonly offPaletteColors: readonly string[];
  readonly distinctInteractiveRadii: readonly string[];
}

function toHex(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const rgb = parseRgb(color);
  if (!rgb) return undefined;
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function parsePx(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = String(value).match(/(-?\d+(?:\.\d+)?)px/i);
  if (!match || !match[1]) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDurationMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = String(value).trim().toLowerCase();
  const seconds = trimmed.match(/(-?\d+(?:\.\d+)?)s$/);
  if (seconds && seconds[1] && !trimmed.endsWith('ms')) {
    const parsed = Number(seconds[1]);
    return Number.isFinite(parsed) ? Math.round(parsed * 1000) : undefined;
  }
  const millis = trimmed.match(/(-?\d+(?:\.\d+)?)ms$/);
  if (millis && millis[1]) {
    const parsed = Number(millis[1]);
    return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
  }
  const bare = Number(trimmed);
  return Number.isFinite(bare) ? bare : undefined;
}

/** Saturation HSL (0..1) — suffisant pour repérer les accents saturés. */
function saturation(hexOrColor: string): number {
  const rgb = parseRgb(hexOrColor);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const lightness = (max + min) / 2;
  const delta = max - min;
  return lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
}

function flatten(node: NormalizedDomNode, out: NormalizedDomNode[] = []): NormalizedDomNode[] {
  out.push(node);
  for (const child of node.children) flatten(child, out);
  return out;
}

function collectMetrics(input: DesignRuleAuditInput): RuleMetrics {
  const { snapshot, tokens, cssContent } = input;
  const nodes = flatten(snapshot.rootNode);

  const roleValues = Object.values(tokens.colorTokens)
    .map((value) => toHex(value))
    .filter((value): value is string => value !== undefined);
  const primaryColor = toHex(tokens.colorTokens.primary);

  // RULE-001 — part des nœuds visibles qui utilisent la couleur primaire.
  let styledNodeCount = 0;
  let usingPrimary = 0;
  const interactiveRadii = new Set<string>();
  let interactiveCount = 0;
  let prominentActionCount = 0;
  const nodeById = new Map<string, NormalizedDomNode>();
  for (const node of nodes) nodeById.set(node.id, node);
  for (const node of nodes) {
    if (node.layout.isVisible === false) continue;
    const bg = toHex(node.styles.backgroundColor);
    const fg = toHex(node.styles.color);
    const border = toHex(node.styles.borderColor);
    const styled = bg !== undefined || fg !== undefined;
    if (styled) {
      styledNodeCount += 1;
      if (primaryColor && (bg === primaryColor || fg === primaryColor || border === primaryColor)) {
        usingPrimary += 1;
      }
    }
  }

  // RULE-010 / RULE-008 — profils des éléments interactifs réels.
  for (const profile of snapshot.interactiveElements) {
    const node = nodeById.get(profile.nodeId);
    if (!node) continue;
    interactiveCount += 1;
    const bg = toHex(node.styles.backgroundColor);
    if (primaryColor && bg === primaryColor) {
      prominentActionCount += 1;
    } else {
      const contrast = computeContrastRatio(node.styles.color, node.styles.backgroundColor);
      if (bg !== undefined && contrast >= 4.5) prominentActionCount += 1;
    }
    const radiusPx = parsePx(node.styles.borderRadius) ?? 0;
    interactiveRadii.add(`${radiusPx}px`);
  }

  // RULE-003 — rayons réellement observés dans les tokens de forme.
  const radiusValues = tokens.shapeTokens.detectedRadii
    .map((value) => parsePx(value))
    .filter((value): value is number => value !== undefined);
  const maxRadiusPx = radiusValues.length > 0 ? Math.max(...radiusValues) : undefined;

  // RULE-004 — hiérarchie des titres (document order, tailles réelles).
  const headings = nodes.filter(
    (node) => node.layout.isVisible !== false && /^h[1-6]$/i.test(node.tagName)
  );
  const headingSizes = headings
    .map((node) => parsePx(node.styles.fontSize))
    .filter((value): value is number => value !== undefined);
  const h1Count = headings.filter((node) => /^h1$/i.test(node.tagName)).length;

  // RULE-006 — accents saturés hors rôles sémantiques connus.
  const roleSet = new Set(roleValues);
  const accentColors: string[] = [];
  const offPaletteColors: string[] = [];
  const seen = new Set<string>();
  for (const raw of snapshot.extractedColors) {
    const hex = toHex(raw);
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    if (saturation(hex) >= 0.6) {
      if (roleSet.has(hex)) {
        accentColors.push(hex);
      } else {
        offPaletteColors.push(hex);
        accentColors.push(hex);
      }
    }
  }

  // RULE-007 — durées réellement observées.
  const durations = (tokens.motionTokens?.durations ?? [])
    .map((value) => parseDurationMs(value))
    .filter((value): value is number => value !== undefined);

  const hasInteractiveStyleEvidence = cssContent !== undefined || tokens.motionTokens !== undefined;
  const cssHoverSignal = cssContent !== undefined && /:(hover|focus|active)\b/i.test(cssContent);
  const motionHoverSignal =
    (tokens.motionTokens?.hover.length ?? 0) > 0 || (tokens.motionTokens?.feedback.length ?? 0) > 0;

  return {
    styledNodeCount,
    primaryColor,
    primaryUsagePercent:
      styledNodeCount > 0 && primaryColor !== undefined
        ? Math.round((usingPrimary / styledNodeCount) * 100)
        : undefined,
    spacingScale: tokens.spacingTokens.detectedScale,
    spacingRegularityRatio:
      tokens.spacingTokens.detectedScale.length > 0 ? tokens.spacingTokens.regularityRatio : undefined,
    maxRadiusPx,
    h1Count,
    headingSizes,
    hasInteractiveStyleEvidence,
    cssHoverSignal,
    motionHoverSignal,
    accentColors,
    maxMotionDurationMs: durations.length > 0 ? Math.max(...durations) : undefined,
    interactiveCount,
    prominentActionCount,
    offPaletteColors,
    distinctInteractiveRadii: Array.from(interactiveRadii).sort()
  };
}

function result(
  partial: Omit<DesignRuleAuditResult, 'custom'> & { custom?: boolean }
): DesignRuleAuditResult {
  return { custom: partial.custom ?? false, ...partial };
}

function expectedValueFor(key: keyof DesignRulesThresholds, config: DesignRulesConfig): string {
  const value = config.thresholds[key];
  if (key === 'maxRadiusPx') return `≤ ${value}px`;
  if (key === 'maxMotionDurationMs') return `≤ ${value}ms`;
  if (key === 'minSpacingCompliancePercent') return `≥ ${value}%`;
  return `≤ ${value}%`;
}

function evaluateCdcRule(id: CdcRuleId, metrics: RuleMetrics, config: DesignRulesConfig): DesignRuleAuditResult {
  switch (id) {
    case 'RULE-001': {
      if (metrics.primaryUsagePercent === undefined) {
        return result({
          id,
          label: 'Usage de la couleur primaire',
          category: 'COLOR',
          status: 'UNKNOWN',
          observedValue: 'aucune couleur primaire inférée',
          evidence: [`${metrics.styledNodeCount} nœuds stylés observés`]
        });
      }
      const limit = config.thresholds.maxPrimaryUsagePercent;
      return result({
        id,
        label: 'Usage de la couleur primaire',
        category: 'COLOR',
        status: metrics.primaryUsagePercent <= limit ? 'PASS' : 'FAIL',
        observedValue: `${metrics.primaryUsagePercent}% des nœuds stylés utilisent ${metrics.primaryColor ?? 'la primaire'}`,
        expectedValue: expectedValueFor('maxPrimaryUsagePercent', config),
        evidence: [`${metrics.styledNodeCount} nœuds visibles stylés analysés`]
      });
    }
    case 'RULE-002': {
      if (metrics.spacingRegularityRatio === undefined) {
        return result({
          id,
          label: 'Échelle d’espacement respectée',
          category: 'SPACING',
          status: 'UNKNOWN',
          observedValue: 'aucune échelle d’espacement détectée',
          evidence: ['tokens.spacingTokens.detectedScale vide']
        });
      }
      const percent = Math.round(metrics.spacingRegularityRatio * 100);
      const min = config.thresholds.minSpacingCompliancePercent;
      return result({
        id,
        label: 'Échelle d’espacement respectée',
        category: 'SPACING',
        status: percent >= min ? 'PASS' : 'FAIL',
        observedValue: `${percent}% des espacements suivent l’échelle (${metrics.spacingScale.join('/')}px)`,
        expectedValue: expectedValueFor('minSpacingCompliancePercent', config),
        evidence: [`${metrics.spacingScale.length} pas d’espacement observés`]
      });
    }
    case 'RULE-003': {
      if (metrics.maxRadiusPx === undefined) {
        return result({
          id,
          label: 'Rayon maximal',
          category: 'SHAPE',
          status: 'UNKNOWN',
          observedValue: 'aucun rayon détecté',
          evidence: ['tokens.shapeTokens.detectedRadii vide']
        });
      }
      const limit = config.thresholds.maxRadiusPx;
      return result({
        id,
        label: 'Rayon maximal',
        category: 'SHAPE',
        status: metrics.maxRadiusPx <= limit ? 'PASS' : 'FAIL',
        observedValue: `${metrics.maxRadiusPx}px (rayon maximal observé)`,
        expectedValue: expectedValueFor('maxRadiusPx', config),
        evidence: [`rayons observés : ${metrics.distinctInteractiveRadii.length > 0 ? metrics.distinctInteractiveRadii.join(', ') : 'via tokens'}`]
      });
    }
    case 'RULE-004': {
      if (metrics.headingSizes.length === 0) {
        return result({
          id,
          label: 'Hiérarchie de titres cohérente',
          category: 'STRUCTURE',
          status: 'FAIL',
          observedValue: 'aucun titre (h1-h6) visible',
          expectedValue: 'un H1 unique, tailles décroissantes',
          evidence: ['aucun nœud de titre détecté dans le DOM']
        });
      }
      if (metrics.h1Count !== 1) {
        return result({
          id,
          label: 'Hiérarchie de titres cohérente',
          category: 'STRUCTURE',
          status: 'FAIL',
          observedValue: `${metrics.h1Count} H1 détecté(s)`,
          expectedValue: 'un H1 unique',
          evidence: [`${metrics.headingSizes.length} titres observés`]
        });
      }
      let increasing: string | undefined;
      for (let i = 1; i < metrics.headingSizes.length; i += 1) {
        if (metrics.headingSizes[i]! > metrics.headingSizes[i - 1]! + 1) {
          increasing = `${metrics.headingSizes[i - 1]}px → ${metrics.headingSizes[i]}px`;
          break;
        }
      }
      return result({
        id,
        label: 'Hiérarchie de titres cohérente',
        category: 'STRUCTURE',
        status: increasing ? 'FAIL' : 'PASS',
        observedValue: increasing
          ? `taille de titre croissante (${increasing})`
          : `1 H1, ${metrics.headingSizes.length} titres, tailles décroissantes`,
        expectedValue: 'un H1 unique, tailles décroissantes',
        evidence: [`séquence de tailles : ${metrics.headingSizes.join('px, ')}px`]
      });
    }
    case 'RULE-005': {
      if (!metrics.hasInteractiveStyleEvidence) {
        return result({
          id,
          label: 'États visibles sur les interactions',
          category: 'ACCESSIBILITY',
          status: 'UNKNOWN',
          observedValue: 'aucune preuve CSS/motion disponible',
          evidence: ['ni CSS documentaire ni tokens motion fournis']
        });
      }
      const pass = metrics.cssHoverSignal || metrics.motionHoverSignal;
      return result({
        id,
        label: 'États visibles sur les interactions',
        category: 'ACCESSIBILITY',
        status: pass ? 'PASS' : 'FAIL',
        observedValue: pass
          ? 'règles :hover/:focus ou transitions observées'
          : 'aucune règle :hover/:focus ni transition observée',
        expectedValue: 'états hover/focus visibles',
        evidence: [
          metrics.cssHoverSignal ? 'CSS documentaire : :hover/:focus détecté' : 'CSS documentaire : aucune règle interactive',
          metrics.motionHoverSignal ? 'tokens motion : hover/feedback observés' : 'tokens motion : aucun hover/feedback'
        ]
      });
    }
    case 'RULE-006': {
      const limit = config.thresholds.maxVisualAccents;
      return result({
        id,
        label: 'Nombre d’accents visuels',
        category: 'COLOR',
        status: metrics.accentColors.length <= limit ? 'PASS' : 'FAIL',
        observedValue: `${metrics.accentColors.length} accent(s) saturé(s)${metrics.accentColors.length > 0 ? ' : ' + metrics.accentColors.slice(0, 5).join(', ') : ''}`,
        expectedValue: `≤ ${limit} accents par vue`,
        evidence: [`${metrics.accentColors.length} couleurs saturées (saturation ≥ 60%) observées`]
      });
    }
    case 'RULE-007': {
      if (metrics.maxMotionDurationMs === undefined) {
        return result({
          id,
          label: 'Durées d’animation bornées',
          category: 'MOTION',
          status: 'UNKNOWN',
          observedValue: 'aucune durée observée',
          evidence: ['tokens motion : durations vide']
        });
      }
      const limit = config.thresholds.maxMotionDurationMs;
      return result({
        id,
        label: 'Durées d’animation bornées',
        category: 'MOTION',
        status: metrics.maxMotionDurationMs <= limit ? 'PASS' : 'FAIL',
        observedValue: `${metrics.maxMotionDurationMs}ms (durée maximale observée)`,
        expectedValue: expectedValueFor('maxMotionDurationMs', config),
        evidence: ['durées issues des transitions/keyframes réellement observées']
      });
    }
    case 'RULE-008': {
      if (metrics.interactiveCount === 0) {
        return result({
          id,
          label: 'Prominence des actions critiques',
          category: 'STRUCTURE',
          status: 'UNKNOWN',
          observedValue: 'aucun élément interactif',
          evidence: ['snapshot.interactiveElements vide']
        });
      }
      return result({
        id,
        label: 'Prominence des actions critiques',
        category: 'STRUCTURE',
        status: metrics.prominentActionCount > 0 ? 'PASS' : 'FAIL',
        observedValue: `${metrics.prominentActionCount} action(s) principale(s) mise(s) en avant (primaire ou contraste ≥ 4.5)`,
        expectedValue: '≥ 1 action critique visuellement dominante',
        evidence: [`${metrics.interactiveCount} éléments interactifs analysés`]
      });
    }
    case 'RULE-009': {
      const offenders = metrics.offPaletteColors;
      return result({
        id,
        label: 'Aucune couleur hors palette sémantique',
        category: 'COLOR',
        status: offenders.length === 0 ? 'PASS' : 'FAIL',
        observedValue:
          offenders.length === 0
            ? 'toutes les couleurs saturées appartiennent aux rôles inférés'
            : `${offenders.length} couleur(s) saturée(s) hors rôles : ${offenders.slice(0, 5).join(', ')}`,
        expectedValue: 'couleurs saturées limitées aux rôles sémantiques',
        evidence: ['comparaison couleurs extraites ↔ rôles couleur inférés']
      });
    }
    case 'RULE-010': {
      if (metrics.interactiveCount === 0) {
        return result({
          id,
          label: 'Réutilisation des primitives composants',
          category: 'COMPONENT',
          status: 'UNKNOWN',
          observedValue: 'aucun composant interactif',
          evidence: ['snapshot.interactiveElements vide']
        });
      }
      const distinct = metrics.distinctInteractiveRadii;
      return result({
        id,
        label: 'Réutilisation des primitives composants',
        category: 'COMPONENT',
        status: distinct.length <= 2 ? 'PASS' : 'FAIL',
        observedValue: `${distinct.length} rayon(s) distinct(s) sur les interactifs (${distinct.join(', ')})`,
        expectedValue: '≤ 2 primitives de forme réutilisées',
        evidence: [`${metrics.interactiveCount} éléments interactifs, ${distinct.length} variantes de rayon`]
      });
    }
  }
}

function metricObservation(metric: DesignCustomRuleMetric, metrics: RuleMetrics): number | undefined {
  switch (metric) {
    case 'maxRadiusPx':
      return metrics.maxRadiusPx;
    case 'maxPrimaryUsagePercent':
      return metrics.primaryUsagePercent;
    case 'maxVisualAccents':
      return metrics.accentColors.length;
    case 'maxMotionDurationMs':
      return metrics.maxMotionDurationMs;
  }
}

function compare(observed: number, operator: DesignCustomRule['operator'], value: number): boolean {
  if (operator === '<=') return observed <= value;
  if (operator === '>=') return observed >= value;
  return observed === value;
}

/** Évalue les 10 règles CDC + les règles projet, dans l'ordre stable. */
export function auditDesignRules(input: DesignRuleAuditInput): DesignRuleAuditReport {
  const config = input.config ?? DEFAULT_DESIGN_RULES_CONFIG;
  const metrics = collectMetrics(input);
  const results: DesignRuleAuditResult[] = [];

  for (const id of CDC_RULE_IDS) {
    if (config.disabledRuleIds.includes(id)) continue;
    results.push(evaluateCdcRule(id, metrics, config));
  }

  for (const rule of config.customRules) {
    const observed = metricObservation(rule.metric, metrics);
    if (observed === undefined) {
      results.push(result({
        id: rule.id,
        label: rule.label,
        category: 'PROJECT',
        status: 'UNKNOWN',
        observedValue: `métrique ${rule.metric} non mesurable`,
        evidence: ['règle projet : preuve absente pour cette page'],
        custom: true
      }));
      continue;
    }
    results.push(result({
      id: rule.id,
      label: rule.label,
      category: 'PROJECT',
      status: compare(observed, rule.operator, rule.value) ? 'PASS' : 'FAIL',
      observedValue: `${rule.metric} = ${observed}`,
      expectedValue: `${rule.metric} ${rule.operator} ${rule.value}`,
      evidence: ['règle personnalisée projet évaluée sur les métriques réelles'],
      custom: true
    }));
  }

  const summary = {
    total: results.length,
    pass: results.filter((entry) => entry.status === 'PASS').length,
    fail: results.filter((entry) => entry.status === 'FAIL').length,
    unknown: results.filter((entry) => entry.status === 'UNKNOWN').length
  };
  return { catalogVersion: DESIGN_RULE_AUDIT_CATALOG_VERSION, config, results, summary };
}
