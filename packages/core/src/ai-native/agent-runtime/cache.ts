/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Multi-Tenant Isolated LRU Cache
 */

export interface CacheEntry<T> {
  readonly value: T;
  readonly createdAt: number;
}

export class AgentRuntimeLruCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(private readonly maxEntries = 200) {}

  private makeKey(tenantId: string, projectId: string, key: string): string {
    return `${tenantId}:${projectId}:${key}`;
  }

  public get(tenantId: string, projectId: string, key: string): T | undefined {
    const compositeKey = this.makeKey(tenantId, projectId, key);
    const entry = this.entries.get(compositeKey);
    if (!entry) return undefined;

    // Refresh LRU order
    this.entries.delete(compositeKey);
    this.entries.set(compositeKey, entry);
    return entry.value;
  }

  public set(tenantId: string, projectId: string, key: string, value: T): void {
    const compositeKey = this.makeKey(tenantId, projectId, key);
    if (this.entries.has(compositeKey)) {
      this.entries.delete(compositeKey);
    } else if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(compositeKey, {
      value,
      createdAt: Date.now()
    });
  }

  public invalidateTenant(tenantId: string): void {
    for (const k of Array.from(this.entries.keys())) {
      if (k.startsWith(`${tenantId}:`)) {
        this.entries.delete(k);
      }
    }
  }

  public clear(): void {
    this.entries.clear();
  }

  public size(): number {
    return this.entries.size;
  }
}
