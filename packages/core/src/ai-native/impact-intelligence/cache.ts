/**
 * VibeCore Core - AI-Native Engineering Tier (AINT-005)
 * Tenant-Isolated Deterministic Impact LRU Cache
 */

import { createHash } from 'node:crypto';
import { canonicalObject } from '../context/engine/base.js';
import type { ImpactAnalysis, ImpactCacheMetrics } from './types.js';

export class ImpactLruCache {
  private readonly cache = new Map<string, ImpactAnalysis>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(private readonly maxEntries: number = 150) {}

  /**
   * Computes a deterministic cache key isolated by tenant, project, graphHash, and request.
   */
  public computeCacheKey(
    tenantId: string,
    projectId: string,
    graphHash: string,
    analyzerVersion: string,
    request: Record<string, unknown>
  ): string {
    const canonicalReq = canonicalObject(request);
    const reqHash = createHash('sha256').update(JSON.stringify(canonicalReq)).digest('hex');
    return `${tenantId}:${projectId}:${graphHash}:${analyzerVersion}:${reqHash}`;
  }

  public get(key: string): ImpactAnalysis | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Refresh LRU order
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry;
  }

  public set(key: string, analysis: ImpactAnalysis): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      // Evict oldest entry (first key in iteration order)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this.evictions++;
      }
    }

    this.cache.set(key, analysis);
  }

  public clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  public getMetrics(): ImpactCacheMetrics {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      entryCount: this.cache.size,
      maxEntries: this.maxEntries
    };
  }
}
