/**
 * VibeCode Core - Design Harmony
 * CDC V8 §6/§11 — Design Direction v1 : dérivation DÉTERMINISTE des tokens
 * (aucun Math.random — exigence §16 V8, reproductibilité stricte).
 *
 * SOURCE UNIQUE : la route Design (apps/api) ET le contexte des agents
 * design-aware (design-context.ts) dérivent la direction par CETTE fonction.
 * Aucune heuristique dupliquée entre l'API et l'orchestrateur.
 *
 * - avec `stats` (VisualSnapshot réel : couleurs/polices/éléments) : dérivation
 *   complète — identique à la sortie historique de la route ;
 * - sans `stats` (contexte agent : rapport Design Harmony persisté) : seules
 *   les caractéristiques réellement dérivables des tokens sont produites
 *   (densité / densité d'information omises — jamais inventées).
 */

import type { InferredDesignSystem } from './types.js';

/** Statistiques DOM réelles (VisualSnapshot) quand elles sont disponibles. */
export interface DesignDirectionStats {
  /**
   * Nombre de couleurs RETENUES pour la direction (la route historique
   * tronque à 8 — même sémantique conservée pour une parité stricte).
   */
  readonly extractedColorCount: number;
  /** Polices retenues (liste bornée côté appelant, max 4). */
  readonly extractedFonts: readonly string[];
  readonly interactiveElementsCount: number;
  readonly totalElementsCount: number;
}

export interface DesignDirectionEvidence {
  readonly dominantRadiusPx: number;
  readonly colorCount: number;
  readonly fontCount: number;
  /** Présents UNIQUEMENT quand les stats DOM réelles sont fournies. */
  readonly interactiveElements?: number | undefined;
  readonly totalElements?: number | undefined;
}

/** CDC V8 §6 — les 8 dimensions explicites de la Design Direction. */
export type DesignDirectionStyle = 'Soft & Rounded' | 'Balanced Modern' | 'Sharp & Technical';
export type DesignDirectionDensity = 'Dense' | 'Balanced' | 'Spacious';
export type DesignDirectionPersonality = 'Professional / Technical' | 'Friendly / Editorial';
export type DesignDirectionEnergy = 'Expressive' | 'Calm';
export type DesignDirectionMotion = 'Subtle' | 'Expressive' | 'None';
export type DesignDirectionProfessionalism = 'Premium' | 'Professional' | 'Friendly';
export type DesignDirectionComplexity = 'Low' | 'Medium' | 'High';

export interface DesignDirection {
  readonly style: DesignDirectionStyle;
  /** Présente uniquement avec stats DOM réelles. */
  readonly density?: DesignDirectionDensity | undefined;
  readonly personality: DesignDirectionPersonality;
  readonly motion: DesignDirectionMotion;
  readonly visualEnergy: DesignDirectionEnergy;
  /** Présente uniquement avec stats DOM réelles. */
  readonly informationDensity?: 'High' | 'Medium' | 'Low' | undefined;
  /**
   * LOT C (§6) — dimensions CDC supplémentaires. Absentes de la dérivation
   * historique (aucune valeur inventée) : présentes UNIQUEMENT quand un
   * override projet les fixe, ou dans le profil étendu (/design/direction).
   */
  readonly professionalism?: DesignDirectionProfessionalism | undefined;
  readonly visualComplexity?: DesignDirectionComplexity | undefined;
  readonly evidence: DesignDirectionEvidence;
}

/** LOT C (§6) — override projet : seules les dimensions fixées sont remplacées. */
export interface DesignDirectionOverride {
  readonly style?: DesignDirectionStyle | undefined;
  readonly density?: DesignDirectionDensity | undefined;
  readonly personality?: DesignDirectionPersonality | undefined;
  readonly visualEnergy?: DesignDirectionEnergy | undefined;
  readonly professionalism?: DesignDirectionProfessionalism | undefined;
  readonly motion?: DesignDirectionMotion | undefined;
  readonly visualComplexity?: DesignDirectionComplexity | undefined;
  readonly informationDensity?: 'High' | 'Medium' | 'Low' | undefined;
}

/**
 * Rayon dominant (px) — même lecture que la route historique : premier token
 * de forme (primaryButtonRadius), repli 8px si non parsable.
 */
export function dominantRadiusPx(tokens: InferredDesignSystem): number {
  const radiusValues = tokens.shapeTokens as unknown as Record<string, string | undefined>;
  const keys = Object.keys(radiusValues);
  const sample = String((keys.length > 0 ? radiusValues[keys[0]!] : undefined) ?? '');
  return parseInt(sample, 10) || 8;
}

/** Nb de rôles couleur réellement définis (variante tokens-only). */
function definedColorRoleCount(tokens: InferredDesignSystem): number {
  return Object.values(tokens.colorTokens).filter(
    (value) => typeof value === 'string' && value.trim().length > 0
  ).length;
}

export function deriveDesignDirection(
  tokens: InferredDesignSystem,
  stats?: DesignDirectionStats | undefined
): DesignDirection {
  const radiusPx = dominantRadiusPx(tokens);
  const colorCount = stats ? stats.extractedColorCount : definedColorRoleCount(tokens);
  const fontFamilies = stats ? stats.extractedFonts : tokens.typographyTokens.fontFamilies;
  const interactiveRatio =
    stats && stats.totalElementsCount > 0
      ? stats.interactiveElementsCount / stats.totalElementsCount
      : stats
        ? 0
        : undefined;

  return {
    style: radiusPx >= 16 ? 'Soft & Rounded' : radiusPx >= 8 ? 'Balanced Modern' : 'Sharp & Technical',
    ...(interactiveRatio !== undefined
      ? {
          density:
            interactiveRatio > 0.25 ? ('Dense' as const) : interactiveRatio > 0.1 ? ('Balanced' as const) : ('Spacious' as const)
        }
      : {}),
    personality: fontFamilies.some((font) => /mono/i.test(font)) ? 'Professional / Technical' : 'Friendly / Editorial',
    motion: 'Subtle',
    visualEnergy: colorCount > 6 ? 'Expressive' : 'Calm',
    ...(stats
      ? {
          informationDensity:
            stats.totalElementsCount > 300 ? ('High' as const) : stats.totalElementsCount > 120 ? ('Medium' as const) : ('Low' as const)
        }
      : {}),
    evidence: {
      dominantRadiusPx: radiusPx,
      colorCount,
      fontCount: fontFamilies.length,
      ...(stats
        ? {
            interactiveElements: stats.interactiveElementsCount,
            totalElements: stats.totalElementsCount
          }
        : {})
    }
  };
}
