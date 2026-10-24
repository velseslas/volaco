/**
 * VibeCode Core - Design Harmony
 * CDC V8 §6 — Catalogue de Design Directions VERSIONNÉ + override projet.
 *
 * Le CDC exige que « la Design Direction devienne une contrainte persistante
 * du projet », avec 8 dimensions explicites : Style, Density, Personality,
 * Visual Energy, Professionalism, Motion, Visual Complexity, Information
 * Density.
 *
 * Ce module fournit :
 *   - un catalogue de presets nommés (source unique, versionné — traçable) ;
 *   - la normalisation STRICTE d'un override projet (valeurs du CDC
 *     uniquement, aucune valeur libre inventée) ;
 *   - l'application déterministe de l'override sur la direction dérivée ;
 *   - un profil étendu 8/8 dimensions (les 2 dimensions que la dérivation
 *     historique n'observait pas sont DÉRIVÉES des preuves réelles, jamais
 *     inventées, et leur provenance est citée).
 */

import { ValidationError } from '../../errors.js';
import type {
  DesignDirection,
  DesignDirectionComplexity,
  DesignDirectionDensity,
  DesignDirectionEnergy,
  DesignDirectionMotion,
  DesignDirectionOverride,
  DesignDirectionPersonality,
  DesignDirectionProfessionalism,
  DesignDirectionStyle
} from './design-direction.js';

/** Version du catalogue — à incrémenter dès qu'un preset change. */
export const DESIGN_DIRECTION_CATALOG_VERSION = '1.0.0';

export interface DesignDirectionPresetValues {
  readonly style: DesignDirectionStyle;
  readonly density: DesignDirectionDensity;
  readonly personality: DesignDirectionPersonality;
  readonly visualEnergy: DesignDirectionEnergy;
  readonly professionalism: DesignDirectionProfessionalism;
  readonly motion: DesignDirectionMotion;
  readonly visualComplexity: DesignDirectionComplexity;
  readonly informationDensity: 'High' | 'Medium' | 'Low';
}

export interface DesignDirectionPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly values: DesignDirectionPresetValues;
}

/**
 * CATALOGUE — ordre stable = ordre de comparaison en cas d'égalité de score.
 * Chaque preset couvre les 8 dimensions du CDC §6.
 */
export const DESIGN_DIRECTION_PRESETS: readonly DesignDirectionPreset[] = [
  {
    id: 'premium-minimal',
    name: 'Premium Minimal',
    description: 'Épuré haut de gamme : peu de couleurs, beaucoup d’air, complexité minimale.',
    values: {
      style: 'Balanced Modern',
      density: 'Spacious',
      personality: 'Professional / Technical',
      visualEnergy: 'Calm',
      professionalism: 'Premium',
      motion: 'Subtle',
      visualComplexity: 'Low',
      informationDensity: 'Low'
    }
  },
  {
    id: 'product-operational',
    name: 'Produit opérationnel',
    description: 'Outil métier dense et technique : information prioritaire, décisions rapides.',
    values: {
      style: 'Sharp & Technical',
      density: 'Dense',
      personality: 'Professional / Technical',
      visualEnergy: 'Calm',
      professionalism: 'Professional',
      motion: 'Subtle',
      visualComplexity: 'Medium',
      informationDensity: 'High'
    }
  },
  {
    id: 'friendly-editorial',
    name: 'Friendly Editorial',
    description: 'Contenu chaleureux : formes douces, ton éditorial, accents assumés.',
    values: {
      style: 'Soft & Rounded',
      density: 'Balanced',
      personality: 'Friendly / Editorial',
      visualEnergy: 'Expressive',
      professionalism: 'Friendly',
      motion: 'Subtle',
      visualComplexity: 'Medium',
      informationDensity: 'Medium'
    }
  },
  {
    id: 'technical-dashboard',
    name: 'Technical Dashboard',
    description: 'Tableaux de bord : densité forte, angles nets, complexité maîtrisée mais élevée.',
    values: {
      style: 'Sharp & Technical',
      density: 'Dense',
      personality: 'Professional / Technical',
      visualEnergy: 'Calm',
      professionalism: 'Professional',
      motion: 'Subtle',
      visualComplexity: 'High',
      informationDensity: 'High'
    }
  },
  {
    id: 'calm-brand',
    name: 'Calm Brand',
    description: 'Marque apaisée : équilibre moderne, palette sobre, ton convivial.',
    values: {
      style: 'Balanced Modern',
      density: 'Balanced',
      personality: 'Friendly / Editorial',
      visualEnergy: 'Calm',
      professionalism: 'Premium',
      motion: 'Subtle',
      visualComplexity: 'Low',
      informationDensity: 'Medium'
    }
  },
  {
    id: 'expressive-launch',
    name: 'Expressive Launch',
    description: 'Page de lancement : formes rondes, énergie visuelle forte, mouvement expressif.',
    values: {
      style: 'Soft & Rounded',
      density: 'Spacious',
      personality: 'Friendly / Editorial',
      visualEnergy: 'Expressive',
      professionalism: 'Friendly',
      motion: 'Expressive',
      visualComplexity: 'High',
      informationDensity: 'Low'
    }
  }
];

const STYLE_VALUES: readonly DesignDirectionStyle[] = ['Soft & Rounded', 'Balanced Modern', 'Sharp & Technical'];
const DENSITY_VALUES: readonly DesignDirectionDensity[] = ['Dense', 'Balanced', 'Spacious'];
const PERSONALITY_VALUES: readonly DesignDirectionPersonality[] = ['Professional / Technical', 'Friendly / Editorial'];
const ENERGY_VALUES: readonly DesignDirectionEnergy[] = ['Expressive', 'Calm'];
const MOTION_VALUES: readonly DesignDirectionMotion[] = ['Subtle', 'Expressive', 'None'];
const PROFESSIONALISM_VALUES: readonly DesignDirectionProfessionalism[] = ['Premium', 'Professional', 'Friendly'];
const COMPLEXITY_VALUES: readonly DesignDirectionComplexity[] = ['Low', 'Medium', 'High'];
const INFORMATION_DENSITY_VALUES: readonly ('High' | 'Medium' | 'Low')[] = ['High', 'Medium', 'Low'];

const OVERRIDE_KEYS = [
  'style',
  'density',
  'personality',
  'visualEnergy',
  'professionalism',
  'motion',
  'visualComplexity',
  'informationDensity'
] as const;

type OverrideKey = (typeof OVERRIDE_KEYS)[number];

const ALLOWED_VALUES: Record<OverrideKey, readonly string[]> = {
  style: STYLE_VALUES,
  density: DENSITY_VALUES,
  personality: PERSONALITY_VALUES,
  visualEnergy: ENERGY_VALUES,
  professionalism: PROFESSIONALISM_VALUES,
  motion: MOTION_VALUES,
  visualComplexity: COMPLEXITY_VALUES,
  informationDensity: INFORMATION_DENSITY_VALUES
};

/**
 * Normalise un override §6 : clés connues uniquement, valeurs du CDC
 * uniquement, au moins une dimension fixée. Toute autre entrée est refusée
 * (ValidationError) — jamais de valeur libre inventée.
 */
export function normalizeDesignDirectionOverride(input: unknown): DesignDirectionOverride {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Override de Design Direction invalide : objet attendu.', { field: 'override' });
  }
  const source = input as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!(OVERRIDE_KEYS as readonly string[]).includes(key)) {
      throw new ValidationError(
        `Dimension de Design Direction inconnue : "${key}" (attendu : ${OVERRIDE_KEYS.join(', ')}).`,
        { field: key }
      );
    }
  }
  const normalized: Record<string, string> = {};
  for (const key of OVERRIDE_KEYS) {
    const raw = source[key];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (!ALLOWED_VALUES[key].includes(value)) {
      throw new ValidationError(
        `Valeur invalide pour "${key}" : "${value}" (attendu : ${ALLOWED_VALUES[key].join(' | ')}).`,
        { field: key }
      );
    }
    normalized[key] = value;
  }
  if (Object.keys(normalized).length === 0) {
    throw new ValidationError(
      'Override de Design Direction vide : fixez au moins une dimension du CDC §6.',
      { field: 'override' }
    );
  }
  return normalized as DesignDirectionOverride;
}

/**
 * Applique un override sur la direction dérivée : seules les dimensions
 * explicitement fixées sont remplacées. Les preuves de dérivation restent
 * celles de la base (l'override est une DÉCISION, pas une mesure).
 */
export function applyDesignDirectionOverride(
  base: DesignDirection,
  override: DesignDirectionOverride
): DesignDirection {
  const merged: DesignDirection = {
    ...base,
    ...(override.style !== undefined ? { style: override.style } : {}),
    ...(override.density !== undefined ? { density: override.density } : {}),
    ...(override.personality !== undefined ? { personality: override.personality } : {}),
    ...(override.visualEnergy !== undefined ? { visualEnergy: override.visualEnergy } : {}),
    ...(override.professionalism !== undefined ? { professionalism: override.professionalism } : {}),
    ...(override.motion !== undefined ? { motion: override.motion } : {}),
    ...(override.visualComplexity !== undefined ? { visualComplexity: override.visualComplexity } : {}),
    ...(override.informationDensity !== undefined ? { informationDensity: override.informationDensity } : {}),
    evidence: base.evidence
  };
  return merged;
}

/**
 * Dérive la dimension « Professionalism » des preuves réelles :
 * polices mono / personnalité technique → Professional ; formes très
 * arrondies → Friendly ; sinon Premium. Déterministe, documentée.
 */
export function deriveProfessionalism(direction: DesignDirection): DesignDirectionProfessionalism {
  if (direction.personality === 'Professional / Technical') return 'Professional';
  if (direction.style === 'Soft & Rounded') return 'Friendly';
  return 'Premium';
}

/**
 * Dérive la dimension « Visual Complexity » des preuves réelles :
 * nombre de couleurs et de polices observées (bornes documentées).
 */
export function deriveVisualComplexity(direction: DesignDirection): DesignDirectionComplexity {
  const colors = direction.evidence.colorCount;
  const fonts = direction.evidence.fontCount;
  if (colors > 8 || fonts > 3) return 'High';
  if (colors > 4 || fonts > 2) return 'Medium';
  return 'Low';
}

export interface DesignDirectionProfile {
  readonly catalogVersion: string;
  readonly style: DesignDirectionStyle;
  readonly density?: DesignDirectionDensity | undefined;
  readonly personality: DesignDirectionPersonality;
  readonly visualEnergy: DesignDirectionEnergy;
  readonly professionalism: DesignDirectionProfessionalism;
  readonly motion: DesignDirectionMotion;
  readonly visualComplexity: DesignDirectionComplexity;
  readonly informationDensity?: 'High' | 'Medium' | 'Low' | undefined;
  /** Preset du catalogue le plus proche — jamais un verdict, une proximité. */
  readonly closestPresetId?: string | undefined;
  readonly source: 'derived' | 'override';
  readonly evidence: DesignDirection['evidence'];
}

function presetMatchRatio(preset: DesignDirectionPreset, profile: Omit<DesignDirectionProfile, 'catalogVersion' | 'closestPresetId' | 'source' | 'evidence'>): number {
  let compared = 0;
  let matched = 0;
  for (const key of OVERRIDE_KEYS) {
    const value = profile[key];
    if (value === undefined || value === null) continue;
    compared += 1;
    if (preset.values[key] === value) matched += 1;
  }
  return compared === 0 ? 0 : matched / compared;
}

/** Preset le plus proche (égalité → ordre du catalogue, déterministe). */
export function closestDirectionPresetId(
  profile: Omit<DesignDirectionProfile, 'catalogVersion' | 'closestPresetId' | 'source' | 'evidence'>
): string | undefined {
  let best: { id: string; ratio: number } | undefined;
  for (const preset of DESIGN_DIRECTION_PRESETS) {
    const ratio = presetMatchRatio(preset, profile);
    if (!best || ratio > best.ratio) best = { id: preset.id, ratio };
  }
  return best && best.ratio > 0 ? best.id : undefined;
}

/**
 * Profil étendu 8/8 dimensions du CDC. `override` fixe les dimensions
 * décidées ; les dimensions non observables sans stats DOM restent absentes
 * (honnêteté : jamais de densité inventée).
 */
export function buildDesignDirectionProfile(
  base: DesignDirection,
  override?: DesignDirectionOverride | undefined
): DesignDirectionProfile {
  const effective = override ? applyDesignDirectionOverride(base, override) : base;
  const partial = {
    style: effective.style,
    ...(effective.density !== undefined ? { density: effective.density } : {}),
    personality: effective.personality,
    visualEnergy: effective.visualEnergy,
    professionalism: effective.professionalism ?? deriveProfessionalism(effective),
    motion: effective.motion,
    visualComplexity: effective.visualComplexity ?? deriveVisualComplexity(effective),
    ...(effective.informationDensity !== undefined ? { informationDensity: effective.informationDensity } : {})
  };
  return {
    catalogVersion: DESIGN_DIRECTION_CATALOG_VERSION,
    ...partial,
    closestPresetId: closestDirectionPresetId(partial),
    source: override ? 'override' : 'derived',
    evidence: effective.evidence
  };
}
