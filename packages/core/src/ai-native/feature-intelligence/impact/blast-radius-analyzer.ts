/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Blast Radius Analyzer - Computes Risk Score and Blast Radius
 */

import type { FeatureComplexity, FeatureEffort } from '../types.js';

export class BlastRadiusAnalyzer {
  public computeBlastRadius(params: {
    readonly affectedModulesCount: number;
    readonly affectedFilesCount: number;
    readonly touchesCoreOrAuth: boolean;
  }): {
    readonly blastRadiusScore: number;
    readonly estimatedComplexity: FeatureComplexity;
    readonly estimatedEffort: FeatureEffort;
  } {
    let score = params.affectedModulesCount * 10 + params.affectedFilesCount * 5;
    if (params.touchesCoreOrAuth) {
      score += 20;
    }

    const blastRadiusScore = Math.max(5, Math.min(100, score));

    let estimatedComplexity: FeatureComplexity = 'LOW';
    let estimatedEffort: FeatureEffort = 'XS';

    if (blastRadiusScore > 65) {
      estimatedComplexity = 'VERY_HIGH';
      estimatedEffort = 'XL';
    } else if (blastRadiusScore > 45) {
      estimatedComplexity = 'HIGH';
      estimatedEffort = 'L';
    } else if (blastRadiusScore > 25) {
      estimatedComplexity = 'MEDIUM';
      estimatedEffort = 'M';
    } else if (blastRadiusScore > 12) {
      estimatedComplexity = 'LOW';
      estimatedEffort = 'S';
    }

    return {
      blastRadiusScore,
      estimatedComplexity,
      estimatedEffort
    };
  }
}
