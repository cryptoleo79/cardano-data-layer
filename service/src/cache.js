// Minimal in-memory TTL cache. Single-process; good enough for an MVP read
// layer in front of rate-limited upstreams. Swap for Redis if the service
// is ever horizontally scaled.

export class TtlCache {
  constructor() {
    /** @type {Map<string, {value: any, expires: number}>} */
    this.store = new Map();
  }

  get(key) {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires !== 0 && hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value, ttlMs) {
    this.store.set(key, { value, expires: ttlMs > 0 ? Date.now() + ttlMs : 0 });
    return value;
  }

  /**
   * Return cached value or compute, cache, and return it.
   * On computation error, a stale value (if any) is returned rather than throwing.
   */
  async getOrSet(key, ttlMs, fn) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    try {
      const value = await fn();
      return this.set(key, value, ttlMs);
    } catch (err) {
      const stale = this.store.get(key);
      if (stale) return stale.value;
      throw err;
    }
  }

  delete(key) { return this.store.delete(key); }
  clear() { this.store.clear(); }
}

export default TtlCache;
