/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-008)
 * Application Understanding Multi-Tenant LRU Cache
 */

import type { ApplicationSemanticModel, UnderstandingCacheMetrics } from './types.js';

export class UnderstandingLruCache {
  private readonly cache = new Map<string, ApplicationSemanticModel>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(private readonly maxEntries: number = 100) {}

  public static buildKey(tenantId: string, projectId: string, graphHash: string): string {
    return `${tenantId}:${projectId}:${graphHash}`;
  }

  public get(key: string): ApplicationSemanticModel | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    // Refresh LRU order (delete & re-insert)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry;
  }

  public set(key: string, model: ApplicationSemanticModel): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this.evictions++;
      }
    }
    this.cache.set(key, model);
  }

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  public delete(key: string): boolean {
    return this.cache.delete(key);
  }

  public invalidateProject(tenantId: string, projectId: string): number {
    const prefix = `${tenantId}:${projectId}:`;
    let count = 0;
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  public clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  public getMetrics(): UnderstandingCacheMetrics {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      entryCount: this.cache.size,
      maxEntries: this.maxEntries
    };
  }
}
