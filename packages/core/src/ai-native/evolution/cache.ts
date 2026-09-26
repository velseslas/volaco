/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Evolution Optimizer Engine - Multi-Tenant LRU Cache
 */

import type { EvolutionAnalysisReport } from './types.js';

export interface EvolutionCacheMetrics {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly sets: number;
  readonly hitRatio: number;
}

export class EvolutionLruCache {
  private readonly maxEntries: number;
  private readonly cache = new Map<string, EvolutionAnalysisReport>();

  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private sets = 0;

  constructor(capacity = 50) {
    this.maxEntries = capacity;
  }

  private buildKey(tenantId: string, projectId: string, hash: string): string {
    return `${tenantId}::${projectId}::${hash}`;
  }

  public get(keyOrTenant: string, projectId?: string, hash?: string): EvolutionAnalysisReport | undefined {
    const key = projectId && hash ? this.buildKey(keyOrTenant, projectId, hash) : keyOrTenant;
    const entry = this.cache.get(key);
    if (entry === undefined) {
      this.misses++;
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry;
  }

  public set(keyOrTenant: string, projectIdOrReport: string | EvolutionAnalysisReport, hashOrUndefined?: string, maybeReport?: EvolutionAnalysisReport): void {
    let key: string;
    let report: EvolutionAnalysisReport;

    if (typeof projectIdOrReport === 'object') {
      key = keyOrTenant;
      report = projectIdOrReport;
    } else {
      key = this.buildKey(keyOrTenant, projectIdOrReport, hashOrUndefined!);
      report = maybeReport!;
    }

    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this.evictions++;
      }
    }
    this.cache.set(key, report);
    this.sets++;
  }

  public has(tenantId: string, projectId: string, hash: string): boolean {
    return this.cache.has(this.buildKey(tenantId, projectId, hash));
  }

  public delete(tenantId: string, projectId: string, hash: string): void {
    this.cache.delete(this.buildKey(tenantId, projectId, hash));
  }

  public clearTenant(tenantId: string): void {
    const prefix = `${tenantId}::`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  public clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.sets = 0;
  }

  public getMetrics(): EvolutionCacheMetrics {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      sets: this.sets,
      hitRatio: total > 0 ? Number((this.hits / total).toFixed(4)) : 0,
    };
  }

  public size(): number {
    return this.cache.size;
  }
}
