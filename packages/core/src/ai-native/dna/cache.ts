/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-002)
 * Application DNA Deterministic LRU Cache
 */

import type { ApplicationDNA, DnaCacheMetrics } from './types.js';

export class DnaLruCache {
  private readonly maxEntries: number;
  private readonly cache = new Map<string, ApplicationDNA>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(maxEntries: number = 200) {
    this.maxEntries = maxEntries > 0 ? maxEntries : 200;
  }

  public static buildKey(
    tenantId: string,
    projectId: string,
    treeHash: string,
    analyzerVersion: string
  ): string {
    return `${tenantId}:${projectId}:${treeHash}:${analyzerVersion}`;
  }

  public get(key: string): ApplicationDNA | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    this.hits++;
    // Re-insert to refresh LRU order
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  public set(key: string, value: ApplicationDNA): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      // Evict oldest (first inserted in Map)
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

  public getMetrics(): DnaCacheMetrics {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      entryCount: this.cache.size,
      maxEntries: this.maxEntries
    };
  }
}
