/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Problem Lifecycle: Immutable State Transition Manager & Audit Trail
 */

import { computeProblemHash } from '../canonical.js';
import type { AggregatedProblem, ProblemStateTransition, ProblemStatus } from '../types.js';
import { FeedbackStateMachine } from './feedback-state-machine.js';

export class ProblemLifecycleManager {
  /**
   * Effectue une transition d'état contrôlée en préservant l'historique d'audit
   */
  public transition(
    problem: AggregatedProblem,
    toStatus: ProblemStatus,
    reason?: string,
    userId?: string
  ): AggregatedProblem {
    FeedbackStateMachine.assertValidTransition(problem.status, toStatus);

    const transition: ProblemStateTransition = {
      fromStatus: problem.status,
      toStatus,
      timestamp: new Date().toISOString(),
      reason,
      userId
    };

    const newHistory = [...problem.history, transition];
    const updatedAt = new Date().toISOString();

    const newHash = computeProblemHash({
      id: problem.id,
      title: problem.title,
      category: problem.category,
      description: problem.description,
      priorityScore: problem.scores.priorityScore
    });

    return {
      ...problem,
      status: toStatus,
      updatedAt,
      history: newHistory,
      problemHash: newHash
    };
  }
}
