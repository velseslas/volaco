/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Conversation Session LRU Cache
 */

import type { ConversationCacheMetrics, ConversationSession } from './types.js';

export class ConversationSessionLruCache {
  private readonly cache = new Map<string, ConversationSession>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(private readonly maxEntries: number = 100) {}

  public static buildKey(tenantId: string, projectId: string, sessionId: string): string {
    return `${tenantId}:${projectId}:${sessionId}`;
  }

  public get(key: string): ConversationSession | undefined {
    const item = this.cache.get(key);
    if (item) {
      this.hits++;
      // Re-insert to mark as most recently used
      this.cache.delete(key);
      this.cache.set(key, item);
      return item;
    }
    this.misses++;
    return undefined;
  }

  public set(key: string, value: ConversationSession): void {
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

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  public delete(key: string): boolean {
    return this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
  }

  public getMetrics(): ConversationCacheMetrics {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      activeSessions: this.cache.size,
      maxEntries: this.maxEntries
    };
  }
}
