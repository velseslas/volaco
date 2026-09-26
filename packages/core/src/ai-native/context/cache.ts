/**
 * VibeCore - AI-Native Engineering Tier (AINT-003)
 * Context Pack Deterministic LRU Cache
 */

import type { ContextCacheMetrics, ContextPack } from './types.js';

export class ContextLruCache {
  private readonly maxEntries: number;
  private readonly cache = new Map<string, ContextPack>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(maxEntries: number = 150) {
    this.maxEntries = maxEntries > 0 ? maxEntries : 150;
  }

  public static buildKey(
    tenantId: string,
    projectId: string,
    treeHash: string,
    requestHash: string,
    assemblerVersion: string
  ): string {
    return `${tenantId}:${projectId}:${treeHash}:${requestHash}:${assemblerVersion}`;
  }

  public get(key: string): ContextPack | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    this.hits++;
    // Refresh LRU position
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  public set(key: string, value: ContextPack): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this.evictions++;
      }
    }

    this.cache.set(key, value);
  }

  public clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  public getMetrics(): ContextCacheMetrics {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      entryCount: this.cache.size,
      maxEntries: this.maxEntries
    };
  }
}
