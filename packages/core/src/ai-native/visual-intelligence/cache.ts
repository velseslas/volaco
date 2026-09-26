/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-011)
 * Visual Intelligence - Bounded LRU Snapshot Cache
 */

import type { VisualSnapshot } from './types.js';

export class VisualIntelligenceLruCache {
  private readonly cache = new Map<string, VisualSnapshot>();

  constructor(private readonly maxEntries = 100) {}

  public get(key: string): VisualSnapshot | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    // Refresh position for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  public set(key: string, snapshot: VisualSnapshot): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, snapshot);
  }

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  public clear(): void {
    this.cache.clear();
  }

  public get size(): number {
    return this.cache.size;
  }
}
