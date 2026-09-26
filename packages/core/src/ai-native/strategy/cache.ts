/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * AI Strategy Optimizer Engine - Multi-Tenant LRU Cache
 */

import type { StrategyOptimizationReport } from './types.js';

export interface StrategyCacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  sets: number;
  hitRatio: number;
}

export class StrategyLruCache {
  private readonly maxEntries: number;
  private readonly cache = new Map<string, StrategyOptimizationReport>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private sets = 0;

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  private buildKey(tenantId: string, projectId: string, hash: string): string {
    return `${tenantId}::${projectId}::${hash}`;
  }

  public get(tenantId: string, projectId: string, hash: string): StrategyOptimizationReport | undefined {
    const key = this.buildKey(tenantId, projectId, hash);
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Refresh position for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry;
  }

  public set(tenantId: string, projectId: string, hash: string, report: StrategyOptimizationReport): void {
    const key = this.buildKey(tenantId, projectId, hash);

    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.evictions++;
      }
    }

    this.cache.set(key, report);
    this.sets++;
  }

  public has(tenantId: string, projectId: string, hash: string): boolean {
    return this.cache.has(this.buildKey(tenantId, projectId, hash));
  }

  public clearTenant(tenantId: string): void {
    const prefix = `${tenantId}::`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  public clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.sets = 0;
  }

  public getMetrics(): StrategyCacheMetrics {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      sets: this.sets,
      hitRatio: total > 0 ? Number((this.hits / total).toFixed(4)) : 0
    };
  }

  public size(): number {
    return this.cache.size;
  }
}
