/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Effort Estimator - Quantifies implementation effort, story points, and hours
 */

import type { EffortLevel } from '../types.js';

export interface EstimatedEffort {
  level: EffortLevel;
  points: number;
  estimatedHours: number;
  explanation: string;
}

export class EffortEstimator {
  /**
   * Estimates effort from files impacted, lines modified, and complexity.
   */
  public estimate(
    filesCount: number,
    estimatedTokensOrLines: number,
    requiresNewComponent: boolean
  ): EstimatedEffort {
    let rawScore = filesCount + (requiresNewComponent ? 2 : 0);
    if (estimatedTokensOrLines > 1000) rawScore += 3;
    else if (estimatedTokensOrLines > 400) rawScore += 1;

    if (rawScore <= 1) {
      return {
        level: 'XS',
        points: 1,
        estimatedHours: 1,
        explanation: 'Intervention minimale et ciblée (< 1h).'
      };
    } else if (rawScore <= 2) {
      return {
        level: 'S',
        points: 2,
        estimatedHours: 3,
        explanation: 'Modification standard de composant ou correctif rapide (~3h).'
      };
    } else if (rawScore <= 5) {
      return {
        level: 'M',
        points: 3,
        estimatedHours: 6,
        explanation: 'Développement d un composant ou refactor modéré (~6h).'
      };
    } else if (rawScore <= 8) {
      return {
        level: 'L',
        points: 5,
        estimatedHours: 12,
        explanation: 'Module complexe impliquant plusieurs fichiers et états (~12h).'
      };
    } else {
      return {
        level: 'XL',
        points: 8,
        estimatedHours: 24,
        explanation: 'Changement architectural d envergure nécessitant plusieurs itérations (~24h).'
      };
    }
  }
}
