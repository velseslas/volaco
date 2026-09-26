/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature Intelligence High-Performance LRU Cache
 */

import type { FeatureIntelligenceReport } from './types.js';

export interface FeatureCacheMetrics {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly size: number;
  readonly capacity: number;
}

export class FeatureIntelligenceLruCache {
  private readonly capacity: number;
  private readonly store = new Map<string, FeatureIntelligenceReport>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(capacity = 50) {
    if (capacity <= 0) {
      throw new Error('La capacité du cache doit être strictement supérieure à zéro.');
    }
    this.capacity = capacity;
  }

  public get(key: string): FeatureIntelligenceReport | undefined {
    const item = this.store.get(key);
    if (!item) {
      this.misses++;
      return undefined;
    }

    this.hits++;
    // Re-insert to refresh recency in Map iteration order
    this.store.delete(key);
    this.store.set(key, item);
    return item;
  }

  public set(key: string, value: FeatureIntelligenceReport): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.capacity) {
      // Evict oldest entry (first key in map iterator)
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
        this.evictions++;
      }
    }

    this.store.set(key, value);
  }

  public has(key: string): boolean {
    return this.store.has(key);
  }

  public clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  public getMetrics(): FeatureCacheMetrics {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      size: this.store.size,
      capacity: this.capacity
    };
  }
}
