/**
 * Standard interface for consumer-side idempotency storage to guarantee
 * exactly-once processing on top of at-least-once webhook delivery.
 */
export interface IdempotencyStore {
  /**
   * Checks whether an event ID has already been processed.
   */
  has(eventId: string): Promise<boolean> | boolean;

  /**
   * Records an event ID as processed with an optional expiration time in seconds.
   */
  set(eventId: string, ttlSeconds?: number): Promise<void> | void;
}

/**
 * In-memory sliding-window idempotency store with automatic eviction and cleanup.
 * Suitable for single-instance consumer services and test environments.
 */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<string, number>();
  private readonly defaultTtlMs: number;
  private readonly maxSize: number;

  constructor(options?: { ttlSeconds?: number; maxSize?: number }) {
    this.defaultTtlMs = (options?.ttlSeconds ?? 86400) * 1000; // 24 hours default
    this.maxSize = options?.maxSize ?? 10000;
  }

  has(eventId: string): boolean {
    const expiresAt = this.store.get(eventId);
    if (expiresAt === undefined) {
      return false;
    }
    if (Date.now() > expiresAt) {
      this.store.delete(eventId);
      return false;
    }
    return true;
  }

  set(eventId: string, ttlSeconds?: number): void {
    if (this.store.size >= this.maxSize) {
      this.prune();
    }
    const ttlMs = ttlSeconds !== undefined ? ttlSeconds * 1000 : this.defaultTtlMs;
    this.store.set(eventId, Date.now() + ttlMs);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.store.entries()) {
      if (now > expiresAt) {
        this.store.delete(key);
      }
    }
    // If still at or over capacity, evict oldest entries
    if (this.store.size >= this.maxSize) {
      const keysToDelete = Array.from(this.store.keys()).slice(0, Math.floor(this.maxSize * 0.2));
      for (const k of keysToDelete) {
        this.store.delete(k);
      }
    }
  }
}
