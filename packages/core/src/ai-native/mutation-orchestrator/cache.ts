/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-006)
 * Mutation Plan & Preflight LRU Cache
 */

import type { PlanValidationResult } from './types.js';

export class MutationPlanLruCache {
  private readonly cache = new Map<string, PlanValidationResult>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly maxEntries: number = 100) {}

  public computeCacheKey(
    tenantId: string,
    projectId: string,
    graphHash: string,
    planHash: string
  ): string {
    return `${tenantId}:${projectId}:${graphHash}:${planHash}`;
  }

  public get(key: string): PlanValidationResult | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry;
  }

  public set(key: string, result: PlanValidationResult): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, result);
  }

  public clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
