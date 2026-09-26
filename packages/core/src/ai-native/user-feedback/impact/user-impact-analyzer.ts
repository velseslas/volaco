/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * User Impact Analyzer: Quantification of Impacted Users and Sessions
 */

import type { UserSignal } from '../types.js';

export interface UserImpactMetrics {
  readonly affectedUsersCount: number;
  readonly affectedSessionsCount: number;
  readonly userImpactRatio: number; // 0.0 - 1.0
  readonly userImpactScore: number; // 0 - 100
}

export class UserImpactAnalyzer {
  /**
   * Analyse l'empreinte utilisateur des signaux d'un problème
   */
  public analyze(signals: readonly UserSignal[], totalActiveUsers = 20): UserImpactMetrics {
    if (!signals || signals.length === 0) {
      return {
        affectedUsersCount: 0,
        affectedSessionsCount: 0,
        userImpactRatio: 0,
        userImpactScore: 0
      };
    }

    const users = new Set<string>();
    const sessions = new Set<string>();

    for (const s of signals) {
      if (s.userId) users.add(s.userId);
      if (s.sessionId) sessions.add(s.sessionId);
    }

    const affectedUsers = Math.max(1, users.size);
    const affectedSessions = Math.max(1, sessions.size);

    const safeTotal = Math.max(1, totalActiveUsers);
    const ratio = Math.min(1.0, affectedUsers / safeTotal);

    // Score déterministe (0 - 100)
    let score = Math.round(ratio * 70 + Math.min(30, signals.length * 5));
    score = Math.max(10, Math.min(100, score));

    return {
      affectedUsersCount: affectedUsers,
      affectedSessionsCount: affectedSessions,
      userImpactRatio: Math.round(ratio * 100) / 100,
      userImpactScore: score
    };
  }
}
