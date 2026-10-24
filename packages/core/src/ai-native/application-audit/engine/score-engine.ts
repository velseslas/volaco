/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Global Score Engine - Weighted Multi-Dimensional Scoring
 */

import type {
  ApplicationAuditFinding,
  AuditDimension,
  AuditDimensionScores,
  AuditDimensionStatus,
  AuditDimensionStatusMap,
  AuditSeverity
} from '../types.js';

const SEVERITY_PENALTIES: Record<AuditSeverity, number> = {
  CRITICAL: 20,
  HIGH: 10,
  MEDIUM: 5,
  LOW: 2,
  INFO: 0
};

export const AUDIT_DIMENSION_ORDER: readonly AuditDimension[] = [
  'ARCHITECTURE',
  'CODE_QUALITY',
  'SECURITY',
  'PERFORMANCE',
  'UX',
  'ACCESSIBILITY',
  'AI_CONFIG',
  'DESIGN_HARMONY'
];

export const AUDIT_DIMENSION_WEIGHTS: Readonly<Record<AuditDimension, number>> = {
  ARCHITECTURE: 0.15,
  CODE_QUALITY: 0.15,
  SECURITY: 0.20,
  PERFORMANCE: 0.10,
  UX: 0.10,
  ACCESSIBILITY: 0.10,
  AI_CONFIG: 0.05,
  DESIGN_HARMONY: 0.15
};

const ALL_MEASURED: AuditDimensionStatusMap = {
  ARCHITECTURE: 'MEASURED',
  CODE_QUALITY: 'MEASURED',
  SECURITY: 'MEASURED',
  PERFORMANCE: 'MEASURED',
  UX: 'MEASURED',
  ACCESSIBILITY: 'MEASURED',
  AI_CONFIG: 'MEASURED',
  DESIGN_HARMONY: 'MEASURED'
};

const COVERAGE_FACTOR: Readonly<Record<AuditDimensionStatus, number>> = {
  MEASURED: 1,
  PARTIAL: 0.5,
  UNKNOWN: 0
};

export class ApplicationAuditScoreEngine {
  /**
   * Calcule un score honnête : une dimension UNKNOWN vaut null et n'entre
   * jamais dans le score global. La couverture expose la part réellement
   * mesurée (partielle = 0,5).
   *
   * Le troisième paramètre est optionnel pour préserver les appels historiques
   * du moteur ; le service d'audit, lui, fournit toujours la carte de statuts.
   */
  public computeScores(
    findings: readonly ApplicationAuditFinding[],
    baselineHarmonyScore?: number,
    dimensionStatusInput?: AuditDimensionStatusMap
  ): {
    overallScore: number | null;
    dimensionScores: AuditDimensionScores;
    dimensionStatus: AuditDimensionStatusMap;
    coverage: number;
  } {
    const dimensionStatus: Record<AuditDimension, AuditDimensionStatus> = {
      ...(dimensionStatusInput ?? ALL_MEASURED)
    };

    // Une finding réelle constitue une preuve : elle ne peut pas rester UNKNOWN.
    for (const finding of findings) {
      if (dimensionStatus[finding.dimension] === 'UNKNOWN') {
        dimensionStatus[finding.dimension] = 'PARTIAL';
      }
    }

    // 1. Initialiser uniquement les dimensions réellement mesurées.
    const subScores: Record<AuditDimension, number | null> = {
      ARCHITECTURE: dimensionStatus.ARCHITECTURE === 'UNKNOWN' ? null : 100,
      CODE_QUALITY: dimensionStatus.CODE_QUALITY === 'UNKNOWN' ? null : 100,
      SECURITY: dimensionStatus.SECURITY === 'UNKNOWN' ? null : 100,
      PERFORMANCE: dimensionStatus.PERFORMANCE === 'UNKNOWN' ? null : 100,
      UX: dimensionStatus.UX === 'UNKNOWN' ? null : 100,
      ACCESSIBILITY: dimensionStatus.ACCESSIBILITY === 'UNKNOWN' ? null : 100,
      AI_CONFIG: dimensionStatus.AI_CONFIG === 'UNKNOWN' ? null : 100,
      DESIGN_HARMONY: dimensionStatus.DESIGN_HARMONY === 'UNKNOWN'
        ? null
        : (baselineHarmonyScore !== undefined ? baselineHarmonyScore : 100)
    };

    // 2. Appliquer les déductions calibrées aux seules dimensions mesurées.
    for (const f of findings) {
      if (f.dimension === 'DESIGN_HARMONY' && baselineHarmonyScore !== undefined) {
        continue;
      }
      const current = subScores[f.dimension];
      if (current === null) continue;
      const penalty = SEVERITY_PENALTIES[f.severity] ?? 0;
      subScores[f.dimension] = current - penalty;
    }

    const clamp = (val: number) => Math.max(0, Math.min(100, Math.round(val)));
    const scoreOrNull = (val: number | null) => val === null ? null : clamp(val);

    const dimensionScores: AuditDimensionScores = {
      architecture: scoreOrNull(subScores.ARCHITECTURE),
      codeQuality: scoreOrNull(subScores.CODE_QUALITY),
      security: scoreOrNull(subScores.SECURITY),
      performance: scoreOrNull(subScores.PERFORMANCE),
      ux: scoreOrNull(subScores.UX),
      accessibility: scoreOrNull(subScores.ACCESSIBILITY),
      aiConfig: scoreOrNull(subScores.AI_CONFIG),
      designHarmony: scoreOrNull(subScores.DESIGN_HARMONY)
    };

    // 3. Moyenne pondérée normalisée sur les seules dimensions mesurées.
    let weightedSum = 0;
    let measuredWeight = 0;
    let coverage = 0;
    for (const dimension of AUDIT_DIMENSION_ORDER) {
      const weight = AUDIT_DIMENSION_WEIGHTS[dimension];
      const status = dimensionStatus[dimension];
      coverage += weight * COVERAGE_FACTOR[status];
      const score = this.scoreForDimension(dimension, dimensionScores);
      if (score !== null && status !== 'UNKNOWN') {
        weightedSum += score * weight;
        measuredWeight += weight;
      }
    }

    const overallScore = measuredWeight > 0 ? clamp(weightedSum / measuredWeight) : null;
    const roundedCoverage = Math.round(coverage * 1000) / 1000;

    return {
      overallScore,
      dimensionScores,
      dimensionStatus,
      coverage: roundedCoverage
    };
  }

  private scoreForDimension(
    dimension: AuditDimension,
    scores: AuditDimensionScores
  ): number | null {
    switch (dimension) {
      case 'ARCHITECTURE': return scores.architecture;
      case 'CODE_QUALITY': return scores.codeQuality;
      case 'SECURITY': return scores.security;
      case 'PERFORMANCE': return scores.performance;
      case 'UX': return scores.ux;
      case 'ACCESSIBILITY': return scores.accessibility;
      case 'AI_CONFIG': return scores.aiConfig;
      case 'DESIGN_HARMONY': return scores.designHarmony;
    }
  }
}
