/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Reasoning Budget Tracker & Enforcement
 */

import { BudgetExceededError, type ReasoningBudget, type ReasoningBudgetUsage } from '../types.js';

export const DEFAULT_REASONING_BUDGET: ReasoningBudget = {
  maxIterations: 10,
  maxToolCalls: 20,
  maxTokens: 50000,
  maxCost: 1.0, // $1.00 USD
  maxExecutionTimeMs: 60000, // 60s
  maxRepairAttempts: 3
};

export class BudgetTracker {
  private readonly budget: ReasoningBudget;
  private currentIterations = 0;
  private currentToolCalls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private currentRepairAttempts = 0;
  private readonly startTime: number;

  constructor(budget?: Partial<ReasoningBudget> | undefined) {
    this.budget = {
      ...DEFAULT_REASONING_BUDGET,
      ...budget
    };
    this.startTime = Date.now();
  }

  public recordIteration(): void {
    this.currentIterations++;
    this.checkLimits();
  }

  public recordToolCall(): void {
    this.currentToolCalls++;
    this.checkLimits();
  }

  public recordTokens(input: number, output: number): void {
    this.inputTokens += input;
    this.outputTokens += output;
    this.checkLimits();
  }

  public recordRepairAttempt(): void {
    this.currentRepairAttempts++;
    if (this.currentRepairAttempts > this.budget.maxRepairAttempts) {
      throw new BudgetExceededError('maxRepairAttempts', this.budget.maxRepairAttempts, this.currentRepairAttempts);
    }
  }

  private calculateCost(): number {
    // Estimating $0.001 per 1000 input tokens and $0.002 per 1000 output tokens
    const costInput = (this.inputTokens / 1000) * 0.001;
    const costOutput = (this.outputTokens / 1000) * 0.002;
    return Number((costInput + costOutput).toFixed(4));
  }

  public checkLimits(): void {
    if (this.currentIterations > this.budget.maxIterations) {
      throw new BudgetExceededError('maxIterations', this.budget.maxIterations, this.currentIterations);
    }

    if (this.currentToolCalls > this.budget.maxToolCalls) {
      throw new BudgetExceededError('maxToolCalls', this.budget.maxToolCalls, this.currentToolCalls);
    }

    const totalTokens = this.inputTokens + this.outputTokens;
    if (totalTokens > this.budget.maxTokens) {
      throw new BudgetExceededError('maxTokens', this.budget.maxTokens, totalTokens);
    }

    const cost = this.calculateCost();
    if (cost > this.budget.maxCost) {
      throw new BudgetExceededError('maxCost', this.budget.maxCost, cost);
    }

    const elapsed = Date.now() - this.startTime;
    if (elapsed > this.budget.maxExecutionTimeMs) {
      throw new BudgetExceededError('maxExecutionTimeMs', this.budget.maxExecutionTimeMs, elapsed);
    }
  }

  public getBudget(): ReasoningBudget {
    return { ...this.budget };
  }

  public getUsage(): ReasoningBudgetUsage {
    return {
      currentIterations: this.currentIterations,
      currentToolCalls: this.currentToolCalls,
      currentTokens: {
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        totalTokens: this.inputTokens + this.outputTokens
      },
      currentCost: this.calculateCost(),
      elapsedTimeMs: Date.now() - this.startTime,
      currentRepairAttempts: this.currentRepairAttempts
    };
  }
}
