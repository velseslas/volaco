/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-004)
 * Deterministic In-Memory LRU Cache for Semantic Code Graphs
 */

import type { SemanticCodeGraph, SemanticGraphCacheMetrics } from './types.js';

export class SemanticGraphLruCache {
  private readonly maxEntries: number;
  private readonly cache = new Map<string, SemanticCodeGraph>();

  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(maxEntries = 150) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  public computeCacheKey(
    tenantId: string,
    projectId: string,
    treeHash: string,
    requestHash: string,
    assemblerVersion: string
  ): string {
    return `${tenantId}:${projectId}:${treeHash}:${requestHash}:${assemblerVersion}`;
  }

  public get(key: string): SemanticCodeGraph | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    // Refresh position for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry;
  }

  public set(key: string, graph: SemanticCodeGraph): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      // Evict oldest entry (first item in Map iteration order)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this.evictions++;
      }
    }

    this.cache.set(key, graph);
  }

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  public clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  public getMetrics(): SemanticGraphCacheMetrics {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      entryCount: this.cache.size,
      maxEntries: this.maxEntries
    };
  }
}
