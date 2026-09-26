/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * LRU Cache for Orchestration Runs
 */

import type { OrchestrationRun } from './types.js';

export class AIOrchestratorLruCache {
  private readonly cache = new Map<string, OrchestrationRun>();

  constructor(private readonly maxEntries = 100) {}

  public get(orchestrationId: string): OrchestrationRun | undefined {
    const run = this.cache.get(orchestrationId);
    if (!run) return undefined;
    // Refresh position
    this.cache.delete(orchestrationId);
    this.cache.set(orchestrationId, run);
    return run;
  }

  public set(run: OrchestrationRun): void {
    if (this.cache.has(run.orchestrationId)) {
      this.cache.delete(run.orchestrationId);
    } else if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(run.orchestrationId, run);
  }

  public has(orchestrationId: string): boolean {
    return this.cache.has(orchestrationId);
  }

  public clear(): void {
    this.cache.clear();
  }

  public get size(): number {
    return this.cache.size;
  }
}
