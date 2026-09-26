/**
 * VibeCode Core - Intelligence Pool
 * Shared LRU cache — remplace les 16 caches redondants des packages
 * strategy/evolution/feature-intelligence/etc.
 *
 * Phase 9.5 : bounded LRU avec eviction oldest-first.
 */

export class IntelligenceLruCache<K, V> {
  private readonly store = new Map<K, V>();
  private readonly maxSize: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  public get(key: K): V | undefined {
    if (!this.store.has(key)) {
      this.misses++;
      return undefined;
    }
    // Move to end (most recently used)
    const value = this.store.get(key)!;
    this.store.delete(key);
    this.store.set(key, value);
    this.hits++;
    return value;
  }

  public set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
        this.evictions++;
      }
    }
    this.store.set(key, value);
  }

  public has(key: K): boolean {
    return this.store.has(key);
  }

  public clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  public get size(): number {
    return this.store.size;
  }

  public get metrics() {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      activeEntries: this.store.size,
      maxEntries: this.maxSize
    };
  }
}
