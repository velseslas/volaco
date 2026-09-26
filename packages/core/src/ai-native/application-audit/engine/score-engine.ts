/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Global Score Engine - Weighted Multi-Dimensional Scoring
 */

import type {
  ApplicationAuditFinding,
  AuditDimension,
  AuditDimensionScores,
  AuditSeverity
} from '../types.js';

const SEVERITY_PENALTIES: Record<AuditSeverity, number> = {
  CRITICAL: 20,
  HIGH: 10,
  MEDIUM: 5,
  LOW: 2,
  INFO: 0
};

export class ApplicationAuditScoreEngine {
  public computeScores(
    findings: readonly ApplicationAuditFinding[],
    baselineHarmonyScore?: number
  ): { overallScore: number; dimensionScores: AuditDimensionScores } {
    // 1. Initialize subscores to 100
    const subScores: Record<AuditDimension, number> = {
      ARCHITECTURE: 100,
      CODE_QUALITY: 100,
      SECURITY: 100,
      PERFORMANCE: 100,
      UX: 100,
      ACCESSIBILITY: 100,
      AI_CONFIG: 100,
      DESIGN_HARMONY: baselineHarmonyScore !== undefined ? baselineHarmonyScore : 100
    };

    // 2. Apply calibrated deductions
    for (const f of findings) {
      if (f.dimension === 'DESIGN_HARMONY' && baselineHarmonyScore !== undefined) {
        // Already incorporated in baseline harmony score
        continue;
      }
      const penalty = SEVERITY_PENALTIES[f.severity] ?? 0;
      subScores[f.dimension] = (subScores[f.dimension] ?? 100) - penalty;
    }

    // 3. Strict Clamping [0, 100]
    const clamp = (val: number) => Math.max(0, Math.min(100, Math.round(val)));

    const dimensionScores: AuditDimensionScores = {
      architecture: clamp(subScores.ARCHITECTURE ?? 100),
      codeQuality: clamp(subScores.CODE_QUALITY ?? 100),
      security: clamp(subScores.SECURITY ?? 100),
      performance: clamp(subScores.PERFORMANCE ?? 100),
      ux: clamp(subScores.UX ?? 100),
      accessibility: clamp(subScores.ACCESSIBILITY ?? 100),
      aiConfig: clamp(subScores.AI_CONFIG ?? 100),
      designHarmony: clamp(subScores.DESIGN_HARMONY ?? 100)
    };

    // 4. Weighted Composite Overall Score
    const overall =
      dimensionScores.architecture * 0.15 +
      dimensionScores.codeQuality * 0.15 +
      dimensionScores.security * 0.20 +
      dimensionScores.performance * 0.10 +
      dimensionScores.ux * 0.10 +
      dimensionScores.accessibility * 0.10 +
      dimensionScores.aiConfig * 0.05 +
      dimensionScores.designHarmony * 0.15;

    return {
      overallScore: clamp(overall),
      dimensionScores
    };
  }
}
