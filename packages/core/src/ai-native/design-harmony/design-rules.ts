/**
 * VibeCode Core - Design Harmony
 * CDC V8 §11 — Catalogue de règles de design VERSIONNÉ (source unique).
 *
 * Les règles appliquées aux générations design-aware proviennent d'un
 * CATALOGUE DÉCLARATIF versionné :
 *   - chaque règle a un id stable + une catégorie + un texte construit de
 *     façon DÉTERMINISTE depuis les tokens réellement observés ;
 *   - une règle conditionnelle (palette absente, pas de rayons détectés…)
 *     n'est PAS instanciée — jamais de règle inventée ;
 *   - toute évolution des textes/conditions incrémente CATALOG_VERSION
 *     (traçabilité : contextes et artefacts citent la version appliquée).
 *
 * Aucun import de design-context (pas de cycle) : ce module est la base
 * consommée par le contexte agent ET par l'artefact Design System.
 */

import type { InferredDesignSystem } from './types.js';

/** Version du catalogue — à incrémenter dès qu'un texte/une condition change. */
export const DESIGN_RULES_CATALOG_VERSION = '1.0.0';

export type DesignRuleCategory =
  | 'COLOR'
  | 'TYPOGRAPHY'
  | 'SPACING'
  | 'SHAPE'
  | 'ELEVATION'
  | 'STRUCTURE'
  | 'ACCESSIBILITY';

/** Entrée normalisée du catalogue (dérivée des tokens inférés RÉELS). */
export interface DesignRulesInput {
  readonly palette: readonly { readonly role: string; readonly value: string }[];
  readonly primaryFontFamily: string;
  readonly fontFamilies: readonly string[];
  readonly baseGridStep: number;
  readonly spacingScale: readonly number[];
  readonly radii: readonly string[];
  readonly shadowLevelsCount: number;
}

export interface DesignRuleDefinition {
  readonly id: string;
  readonly category: DesignRuleCategory;
  /** Explication statique du champ d'application (API / documentation). */
  readonly description: string;
  /** Texte déterministe pour ces tokens — undefined si non applicable. */
  readonly buildText: (input: DesignRulesInput) => string | undefined;
}

export interface AppliedDesignRule {
  readonly id: string;
  readonly category: DesignRuleCategory;
  readonly text: string;
}

/**
 * Bornes de lecture des tokens (mêmes limites que la route et le contexte —
 * parité stricte des textes de règles).
 */
const MAX_PALETTE = 12;
const MAX_FONTS = 4;
const MAX_RADII = 6;
const MAX_SPACING = 8;

/**
 * Normalise les tokens RÉELS en entrée de catalogue. Fonction pure : mêmes
 * tokens → même entrée → mêmes règles (CDC §16 V8 : reproductibilité).
 */
export function designRulesInputFromTokens(tokens: InferredDesignSystem): DesignRulesInput {
  const palette: { role: string; value: string }[] = [];
  for (const [role, value] of Object.entries(tokens.colorTokens)) {
    if (typeof value === 'string' && value.trim().length > 0) {
      palette.push({ role, value: value.trim() });
    }
  }
  return {
    palette: palette.slice(0, MAX_PALETTE),
    primaryFontFamily: tokens.typographyTokens.primaryFontFamily.trim(),
    fontFamilies: tokens.typographyTokens.fontFamilies
      .filter((font) => font.trim().length > 0)
      .slice(0, MAX_FONTS),
    baseGridStep: tokens.spacingTokens.baseGridStep,
    spacingScale: tokens.spacingTokens.detectedScale
      .filter((step) => Number.isFinite(step))
      .slice(0, MAX_SPACING)
      .map((step) => Number(step)),
    radii: tokens.shapeTokens.detectedRadii.filter((radius) => radius.trim().length > 0).slice(0, MAX_RADII),
    shadowLevelsCount: tokens.elevationTokens.detectedLevelsCount
  };
}

/**
 * CATALOGUE — ordre d'itération = ordre d'application (déterminisme strict).
 */
export const DESIGN_RULES_CATALOG: readonly DesignRuleDefinition[] = [
  {
    id: 'palette.reuse',
    category: 'COLOR',
    description: 'Réutiliser la palette de référence inférée du DOM réel.',
    buildText: (input) =>
      input.palette.length > 0
        ? `Réutiliser la palette de référence (${input.palette
            .map((p) => `${p.role} ${p.value}`)
            .join(', ')}) — aucune couleur hors palette sans raison métier.`
        : undefined
  },
  {
    id: 'typography.primary-family',
    category: 'TYPOGRAPHY',
    description: 'Ne pas multiplier les familles de police détectées.',
    buildText: (input) =>
      input.primaryFontFamily.length > 0
        ? `Typographie : « ${input.primaryFontFamily} » en priorité — ne pas multiplier les familles détectées (${input.fontFamilies.length}).`
        : undefined
  },
  {
    id: 'spacing.grid-base',
    category: 'SPACING',
    description: 'Aligner paddings et marges sur la grille d’espacement observée.',
    buildText: (input) =>
      `Espacement : multiples de ${input.baseGridStep}px${
        input.spacingScale.length > 0 ? ` (échelle observée : ${input.spacingScale.join('/')}px)` : ''
      }.`
  },
  {
    id: 'shape.radii-range',
    category: 'SHAPE',
    description: 'Rester dans la plage de rayons détectée sur les composants existants.',
    buildText: (input) =>
      input.radii.length > 0
        ? `Rayons : rester dans la plage détectée (${input.radii.join(', ')}).`
        : undefined
  },
  {
    id: 'elevation.max-levels',
    category: 'ELEVATION',
    description: 'Ne pas dépasser le nombre de niveaux d’ombre observés.',
    buildText: (input) =>
      input.shadowLevelsCount > 0
        ? `Élévation : au plus ${input.shadowLevelsCount} niveau(x) d'ombre, comme l'existant.`
        : undefined
  },
  {
    id: 'structure.semantics',
    category: 'STRUCTURE',
    description: 'Structure sémantique : un seul H1, sections header/main/footer, navigation cohérente.',
    buildText: () =>
      'Structure : un seul H1 par page, sections sémantiques (header/main/footer), navigation cohérente avec les pages existantes.'
  },
  {
    id: 'a11y.contrast-labels',
    category: 'ACCESSIBILITY',
    description: 'Contraste texte suffisant et libellés explicites sur les interactions.',
    buildText: () =>
      'Accessibilité : contraste texte ≥ 4.5:1 et libellé explicite sur chaque interaction.'
  }
];

/**
 * Instancie les règles APPLICABLES pour des tokens donnés (ordre du catalogue).
 * Une règle non applicable n'apparaît jamais — aucun texte fabriqué.
 */
export function buildAppliedDesignRules(input: DesignRulesInput): readonly AppliedDesignRule[] {
  const applied: AppliedDesignRule[] = [];
  for (const definition of DESIGN_RULES_CATALOG) {
    const text = definition.buildText(input);
    if (typeof text === 'string' && text.trim().length > 0) {
      applied.push({ id: definition.id, category: definition.category, text });
    }
  }
  return applied;
}
