/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-012)
 * Design Harmony Engine - In-Memory LRU Cache
 */

import type { DesignHarmonyReport } from './types.js';

export class DesignHarmonyLruCache {
  private readonly map = new Map<string, DesignHarmonyReport>();

  constructor(public readonly maxEntries = 100) {}

  public get(key: string): DesignHarmonyReport | undefined {
    const val = this.map.get(key);
    if (!val) return undefined;
    // Refresh recency
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  public set(key: string, report: DesignHarmonyReport): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, report);
  }

  public has(key: string): boolean {
    return this.map.has(key);
  }

  public delete(key: string): boolean {
    return this.map.delete(key);
  }

  public clear(): void {
    this.map.clear();
  }

  public get size(): number {
    return this.map.size;
  }
}
