/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-001)
 * Deterministic LRU Cache with Deep Freeze
 */

import type { CacheMetrics, FileAnalysis } from './types.js';

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const value = (obj as Record<string, unknown>)[name];
    if (value && typeof value === 'object') {
      deepFreeze(value);
    }
  }

  return Object.freeze(obj);
}

export class AnalysisLruCache {
  private map = new Map<string, FileAnalysis>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(private readonly maxEntries: number = 500) {
    if (maxEntries <= 0) {
      throw new Error('maxEntries must be greater than 0');
    }
  }

  public static buildKey(
    tenantId: string,
    projectId: string,
    filePath: string,
    fileHash: string,
    analyzerVersion: string
  ): string {
    return `${tenantId}:${projectId}:${filePath}:${fileHash}:${analyzerVersion}`;
  }

  public get(key: string): FileAnalysis | null {
    const existing = this.map.get(key);
    if (!existing) {
      this.misses++;
      return null;
    }

    // Refresh LRU order: remove and re-insert at end
    this.map.delete(key);
    this.map.set(key, existing);
    this.hits++;
    return existing;
  }

  public set(key: string, value: FileAnalysis): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      // Evict oldest entry (first item in Map iterator)
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
        this.evictions++;
      }
    }

    const immutable = deepFreeze(value);
    this.map.set(key, immutable);
  }

  public clear(): void {
    this.map.clear();
  }

  public getMetrics(): CacheMetrics {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      entryCount: this.map.size,
      maxEntries: this.maxEntries
    };
  }
}
