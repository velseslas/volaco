/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Recurring Problem Detector: Multi-session, Multi-user Recurrence Analysis
 */

import type { UserSignal } from '../types.js';

export interface RecurrenceAnalysis {
  readonly isRecurring: boolean;
  readonly distinctUsers: number;
  readonly distinctSessions: number;
  readonly occurrenceCount: number;
  readonly frequencyScore: number; // 0 - 100
  readonly description: string;
}

export class RecurringProblemDetector {
  /**
   * Évalue si un problème ou un groupe de signaux constitue une anomalie récurrente
   */
  public analyzeRecurrence(signals: readonly UserSignal[]): RecurrenceAnalysis {
    if (!signals || signals.length === 0) {
      return {
        isRecurring: false,
        distinctUsers: 0,
        distinctSessions: 0,
        occurrenceCount: 0,
        frequencyScore: 0,
        description: 'Aucun signal analysé.'
      };
    }

    const users = new Set<string>();
    const sessions = new Set<string>();

    for (const s of signals) {
      if (s.userId) users.add(s.userId);
      if (s.sessionId) sessions.add(s.sessionId);
    }

    const distinctUsers = Math.max(1, users.size);
    const distinctSessions = Math.max(1, sessions.size);
    const count = signals.length;

    // Déterminer la récurrence : >= 3 occurrences OU >= 2 utilisateurs distincts
    const isRecurring = count >= 3 || distinctUsers >= 2 || distinctSessions >= 2;

    // Calcul du score de fréquence (0 - 100)
    let frequencyScore = 20;
    if (count >= 10 || distinctUsers >= 5) {
      frequencyScore = 100;
    } else if (count >= 5 || distinctUsers >= 3) {
      frequencyScore = 75;
    } else if (count >= 2 || distinctUsers >= 2) {
      frequencyScore = 50;
    }

    const description = isRecurring
      ? `Problème récurrent identifié avec ${count} occurrences réparties sur ${distinctUsers} utilisateur(s) et ${distinctSessions} session(s).`
      : `Occurrence isolée (${count} signalement).`;

    return {
      isRecurring,
      distinctUsers,
      distinctSessions,
      occurrenceCount: count,
      frequencyScore,
      description
    };
  }
}
