/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Strategy State Machine - Governs optimization engine lifecycle transitions
 */

export type StrategyOptimizationState =
  | 'INITIALIZING'
  | 'AGGREGATING'
  | 'PRIORITIZING'
  | 'PLANNING'
  | 'OPTIMIZED'
  | 'ERROR';

export class StrategyStateMachine {
  private currentState: StrategyOptimizationState = 'INITIALIZING';
  private readonly validTransitions: Record<StrategyOptimizationState, StrategyOptimizationState[]> = {
    INITIALIZING: ['AGGREGATING', 'ERROR'],
    AGGREGATING: ['PRIORITIZING', 'ERROR'],
    PRIORITIZING: ['PLANNING', 'ERROR'],
    PLANNING: ['OPTIMIZED', 'ERROR'],
    OPTIMIZED: ['INITIALIZING', 'AGGREGATING'],
    ERROR: ['INITIALIZING']
  };

  public getState(): StrategyOptimizationState {
    return this.currentState;
  }

  public transitionTo(nextState: StrategyOptimizationState): void {
    const allowed = this.validTransitions[this.currentState] || [];
    if (!allowed.includes(nextState)) {
      throw new Error(`Transition d état invalide: ${this.currentState} -> ${nextState}`);
    }
    this.currentState = nextState;
  }

  public reset(): void {
    this.currentState = 'INITIALIZING';
  }
}
