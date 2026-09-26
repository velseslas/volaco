/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Application Audit & Global Quality Intelligence Engine - LRU Cache
 */

import type { ApplicationAuditReport } from './types.js';

export class ApplicationAuditLruCache {
  private readonly cache = new Map<string, ApplicationAuditReport>();
  private readonly capacity: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(capacity = 50) {
    this.capacity = capacity;
  }

  public get(key: string): ApplicationAuditReport | undefined {
    const item = this.cache.get(key);
    if (item) {
      this.hits++;
      // Refresh recency
      this.cache.delete(key);
      this.cache.set(key, item);
      return item;
    }
    this.misses++;
    return undefined;
  }

  public set(key: string, value: ApplicationAuditReport): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Evict oldest (first key in Map iterator)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.evictions++;
      }
    }
    this.cache.set(key, value);
  }

  public clear(): void {
    this.cache.clear();
  }

  public size(): number {
    return this.cache.size;
  }

  public getMetrics(): { hits: number; misses: number; evictions: number; size: number; capacity: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      size: this.cache.size,
      capacity: this.capacity
    };
  }
}
