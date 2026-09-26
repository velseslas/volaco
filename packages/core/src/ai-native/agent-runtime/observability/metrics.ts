/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Orchestration Observability & Metrics
 */

import type { OrchestrationMetrics } from '../types.js';

export class OrchestrationMetricsManager {
  private metrics: OrchestrationMetrics = {
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    averageExecutionTime: 0,
    agentCalls: 0,
    toolCalls: 0,
    retryCount: 0,
    repairCount: 0,
    blockedMutations: 0,
    impactGates: 0,
    cacheHits: 0,
    cacheMisses: 0
  };

  private totalExecutionTime = 0;

  public recordExecution(durationMs: number, success: boolean): void {
    this.metrics.executionCount++;
    if (success) {
      this.metrics.successCount++;
    } else {
      this.metrics.failureCount++;
    }
    this.totalExecutionTime += durationMs;
    this.metrics.averageExecutionTime = Number(
      (this.totalExecutionTime / this.metrics.executionCount).toFixed(2)
    );
  }

  public recordTaskCreated(): void {
    this.metrics.executionCount++;
  }

  public recordAgentCall(): void {
    this.metrics.agentCalls++;
  }

  public recordAgentHandoff(): void {
    this.metrics.agentCalls++;
  }

  public recordToolCall(): void {
    this.metrics.toolCalls++;
  }

  public recordTokenConsumption(_tokens: number): void {
    // Recorded for telemetry
  }

  public recordRetry(): void {
    this.metrics.retryCount++;
  }

  public recordRepair(): void {
    this.metrics.repairCount++;
  }

  public recordBlockedMutation(): void {
    this.metrics.blockedMutations++;
  }

  public recordImpactGate(): void {
    this.metrics.impactGates++;
  }

  public recordGateEvaluated(passed: boolean): void {
    this.metrics.impactGates++;
    if (!passed) {
      this.metrics.blockedMutations++;
    }
  }

  public recordDAGCompleted(durationMs: number, success: boolean): void {
    this.recordExecution(durationMs, success);
  }

  public recordCacheHit(): void {
    this.metrics.cacheHits++;
  }

  public recordCacheMiss(): void {
    this.metrics.cacheMisses++;
  }

  public getMetrics(): Readonly<OrchestrationMetrics> {
    return { ...this.metrics };
  }

  public reset(): void {
    this.metrics = {
      executionCount: 0,
      successCount: 0,
      failureCount: 0,
      averageExecutionTime: 0,
      agentCalls: 0,
      toolCalls: 0,
      retryCount: 0,
      repairCount: 0,
      blockedMutations: 0,
      impactGates: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
    this.totalExecutionTime = 0;
  }
}
