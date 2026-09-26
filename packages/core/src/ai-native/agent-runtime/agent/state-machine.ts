/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Deterministic 12-State Agent Machine
 */

import { type AgentState, InvalidStateTransitionError, type StateTransitionRecord } from '../types.js';

/**
 * Valid state transitions for the 12 lifecycle states:
 * RECEIVED, UNDERSTANDING, PLANNING, CONTEXT_BUILDING, EXECUTING,
 * WAITING_GATE, MUTATING, VERIFYING, REPAIRING, COMPLETED, FAILED, CANCELLED.
 */
const VALID_TRANSITIONS: Record<AgentState, readonly AgentState[]> = {
  IDLE: ['RECEIVED', 'RECEIVING', 'UNDERSTANDING', 'CANCELLED', 'FAILED'],
  RECEIVING: ['UNDERSTANDING', 'CANCELLED', 'FAILED'],
  RECEIVED: ['UNDERSTANDING', 'PLANNING', 'WAITING_GATE', 'CANCELLED', 'FAILED'],
  UNDERSTANDING: ['PLANNING', 'CANCELLED', 'FAILED'],
  PLANNING: ['CONTEXT_BUILDING', 'WAITING_GATE', 'WAITING_CONFIRMATION', 'EXECUTING', 'CANCELLED', 'FAILED'],
  CONTEXT_BUILDING: ['EXECUTING', 'WAITING_GATE', 'WAITING_CONFIRMATION', 'CANCELLED', 'FAILED'],
  WAITING_GATE: ['MUTATING', 'EXECUTING', 'CANCELLED', 'FAILED'],
  WAITING_CONFIRMATION: ['MUTATING', 'EXECUTING', 'CANCELLED', 'FAILED'], // alias
  EXECUTING: ['MUTATING', 'VERIFYING', 'FAILED', 'CANCELLED'],
  MUTATING: ['VERIFYING', 'REPAIRING', 'FAILED', 'CANCELLED'],
  VERIFYING: ['COMPLETED', 'REPAIRING', 'FAILED', 'CANCELLED'],
  REPAIRING: ['MUTATING', 'EXECUTING', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: []
};

export class AgentStateMachine {
  private currentState: AgentState;
  private readonly history: StateTransitionRecord[] = [];
  private readonly runId: string;

  constructor(runId: string = 'sm-default', initialState: AgentState = 'RECEIVED') {
    this.runId = runId;
    this.currentState = initialState;
  }

  public getState(): AgentState {
    return this.currentState;
  }

  public getHistory(): readonly StateTransitionRecord[] {
    return [...this.history];
  }

  public isTerminal(): boolean {
    return (
      this.currentState === 'COMPLETED' ||
      this.currentState === 'FAILED' ||
      this.currentState === 'CANCELLED'
    );
  }

  public canTransitionTo(target: AgentState): boolean {
    const allowed = VALID_TRANSITIONS[this.currentState];
    return allowed !== undefined && allowed.includes(target);
  }

  public transition(
    to: AgentState,
    reason: string,
    evidenceRef?: string | undefined
  ): StateTransitionRecord {
    if (!this.canTransitionTo(to)) {
      throw new InvalidStateTransitionError(this.currentState, to, reason);
    }

    const record: StateTransitionRecord = {
      from: this.currentState,
      to,
      reason,
      timestamp: Date.now(),
      runId: this.runId,
      ...(evidenceRef !== undefined ? { evidenceRef } : {})
    };

    this.history.push(record);
    this.currentState = to;
    return record;
  }
}
