/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Conversation Trace Collector & Observability
 */

import type { ConversationTrace } from '../types.js';

export interface TraceSummaryMetrics {
  readonly totalTraces: number;
  readonly averageDurationMs: number;
  readonly intentDistribution: Readonly<Record<string, number>>;
  readonly stateTransitions: Readonly<Record<string, number>>;
}

export class ConversationTraceCollector {
  private readonly traces = new Map<string, ConversationTrace[]>();

  /**
   * Records a conversation trace event.
   */
  public recordTrace(trace: ConversationTrace): void {
    const sessionTraces = this.traces.get(trace.sessionId) ?? [];
    sessionTraces.push(trace);
    this.traces.set(trace.sessionId, sessionTraces);
  }

  /**
   * Retrieves all traces for a given session.
   */
  public getSessionTraces(sessionId: string): readonly ConversationTrace[] {
    return Object.freeze([...(this.traces.get(sessionId) ?? [])]);
  }

  /**
   * Clears traces for a session.
   */
  public clearSessionTraces(sessionId: string): void {
    this.traces.delete(sessionId);
  }

  /**
   * Computes aggregated trace metrics across all recorded conversations.
   */
  public computeMetrics(): TraceSummaryMetrics {
    let totalTraces = 0;
    let totalDuration = 0;
    const intentDistribution: Record<string, number> = {};
    const stateTransitions: Record<string, number> = {};

    for (const traceList of this.traces.values()) {
      for (const t of traceList) {
        totalTraces += 1;
        totalDuration += t.durationMs;

        intentDistribution[t.intentCategory] = (intentDistribution[t.intentCategory] ?? 0) + 1;

        const transitionKey = `${t.stateBefore}->${t.stateAfter}`;
        stateTransitions[transitionKey] = (stateTransitions[transitionKey] ?? 0) + 1;
      }
    }

    const averageDurationMs = totalTraces > 0 ? Math.round(totalDuration / totalTraces) : 0;

    return {
      totalTraces,
      averageDurationMs,
      intentDistribution: Object.freeze(intentDistribution),
      stateTransitions: Object.freeze(stateTransitions)
    };
  }
}
