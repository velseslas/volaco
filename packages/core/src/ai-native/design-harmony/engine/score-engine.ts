/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-012)
 * Design Harmony Scoring Engine
 */

import type {
  DesignHarmonyFinding,
  HarmonyCategory,
  HarmonySeverity,
  HarmonySubScores
} from '../types.js';

const SEVERITY_DEDUCTIONS: Record<HarmonySeverity, number> = {
  CRITICAL: 15,
  HIGH: 8,
  MEDIUM: 4,
  LOW: 1.5,
  INFO: 0.5
};

export class ScoreEngine {
  public computeScores(findings: readonly DesignHarmonyFinding[]): {
    overallScore: number;
    subScores: HarmonySubScores;
  } {
    const deductions: Record<HarmonyCategory, number> = {
      COLOR: 0,
      TYPOGRAPHY: 0,
      SPACING: 0,
      SHAPE: 0,
      ELEVATION: 0,
      COMPONENT: 0,
      CROSS_PAGE: 0,
      RESPONSIVE: 0,
      ACCESSIBILITY: 0
    };

    for (const f of findings) {
      const ded = SEVERITY_DEDUCTIONS[f.severity] ?? 1;
      deductions[f.category] = (deductions[f.category] ?? 0) + ded;
    }

    const clamp = (val: number) => Math.max(0, Math.min(100, Math.round(val * 10) / 10));

    const colorHarmony = clamp(100 - deductions.COLOR);
    const typographyHarmony = clamp(100 - deductions.TYPOGRAPHY);
    const spacingHarmony = clamp(100 - deductions.SPACING);
    const shapeHarmony = clamp(100 - deductions.SHAPE);
    const elevationHarmony = clamp(100 - deductions.ELEVATION);
    const componentHarmony = clamp(100 - deductions.COMPONENT);
    const crossPageHarmony = clamp(100 - deductions.CROSS_PAGE);
    const responsiveA11yHarmony = clamp(100 - (deductions.RESPONSIVE + deductions.ACCESSIBILITY));

    const subScores: HarmonySubScores = {
      colorHarmony,
      typographyHarmony,
      spacingHarmony,
      shapeHarmony,
      elevationHarmony,
      componentHarmony,
      crossPageHarmony,
      responsiveA11yHarmony
    };

    const weightedOverall =
      0.15 * colorHarmony +
      0.15 * typographyHarmony +
      0.15 * spacingHarmony +
      0.10 * shapeHarmony +
      0.10 * elevationHarmony +
      0.15 * componentHarmony +
      0.10 * crossPageHarmony +
      0.10 * responsiveA11yHarmony;

    const overallScore = Math.max(0, Math.min(100, Math.round(weightedOverall)));

    return {
      overallScore,
      subScores
    };
  }
}
