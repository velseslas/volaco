/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Trend Detector: Temporal Trajectory and Volume Evolution
 */

import type { TrendStatus, UserSignal } from '../types.js';

export interface TrendAnalysis {
  readonly trend: TrendStatus;
  readonly velocity: number;
  readonly summary: string;
}

export class TrendDetector {
  /**
   * Analyse la trajectoire temporelle des signaux d'un problème
   */
  public analyzeTrend(signals: readonly UserSignal[]): TrendAnalysis {
    if (!signals || signals.length === 0) {
      return {
        trend: 'STABLE',
        velocity: 0,
        summary: 'Volume insuffisant pour dégager une tendance.'
      };
    }

    if (signals.length === 1) {
      return {
        trend: 'EMERGING',
        velocity: 1,
        summary: 'Signalement récent unique : phénomène émergent.'
      };
    }

    const timestamps = signals
      .map(s => new Date(s.timestamp).getTime())
      .filter(t => !isNaN(t))
      .sort((a, b) => a - b);

    if (timestamps.length < 2) {
      return {
        trend: 'STABLE',
        velocity: signals.length,
        summary: 'Horodatages non exploitables, stabilité par défaut.'
      };
    }

    const minTime = timestamps[0];
    const maxTime = timestamps[timestamps.length - 1];

    if (minTime === undefined || maxTime === undefined) {
      return {
        trend: 'STABLE',
        velocity: 1,
        summary: 'Horodatages non exploitables.'
      };
    }

    const durationHours = Math.max(1, (maxTime - minTime) / (1000 * 60 * 60));
    const velocity = signals.length / durationHours;

    // Découper la période en deux moitiés
    const midpoint = minTime + (maxTime - minTime) / 2;
    const firstHalfCount = timestamps.filter(t => t <= midpoint).length;
    const secondHalfCount = timestamps.filter(t => t > midpoint).length;

    let trend: TrendStatus = 'STABLE';
    let summary = 'Fréquence d\'apparition stable dans le temps.';

    if (secondHalfCount > firstHalfCount * 1.5) {
      trend = 'GROWING';
      summary = `Croissance rapide du volume de retours (${secondHalfCount} récents vs ${firstHalfCount} initiaux).`;
    } else if (secondHalfCount < firstHalfCount * 0.5) {
      trend = 'DECLINING';
      summary = `Décroissance du volume (${secondHalfCount} récents vs ${firstHalfCount} initiaux).`;
    } else if (signals.length >= 3 && durationHours < 24) {
      trend = 'EMERGING';
      summary = 'Afflux soudain sur une courte période : tendance émergente vive.';
    }

    return {
      trend,
      velocity: Math.round(velocity * 100) / 100,
      summary
    };
  }
}
