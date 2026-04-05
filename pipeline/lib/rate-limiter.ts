export interface RateLimitConfig {
  windowMs: number;    // Time window in ms (e.g. 60000 = 1 minute)
  maxRequests: number; // Max requests per window per key
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number; // seconds until oldest entry leaves the window; 0 if allowed
}

/**
 * Sliding Window Counter rate limiter.
 *
 * Stores per-key arrays of request timestamps. On each check(), expired
 * timestamps are pruned before counting — giving true sliding behaviour
 * without approximation error.
 *
 * In-memory only (single-VPS, state does not survive restarts — intentional).
 */
export class RateLimiter {
  private readonly config: RateLimitConfig;
  private readonly store = new Map<string, number[]>();
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor(config: RateLimitConfig) {
    this.config = config;

    // Periodic cleanup of fully-expired keys to prevent unbounded Map growth.
    // unref() keeps the process from being held alive by this interval alone.
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60_000);
    this.cleanupInterval.unref();
  }

  /**
   * Check whether the given key is within the rate limit, and record the
   * request if allowed.
   */
  check(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Prune expired timestamps for this key
    const timestamps = (this.store.get(key) ?? []).filter(ts => ts > windowStart);

    if (timestamps.length >= this.config.maxRequests) {
      // Oldest timestamp in the window determines when space frees up
      const oldestTs = timestamps[0]; // array is time-ordered (push appends)
      const retryAfterMs = oldestTs + this.config.windowMs - now;
      const retryAfterSec = Math.ceil(Math.max(retryAfterMs, 0) / 1000);

      // Persist the pruned (no new request added) array
      this.store.set(key, timestamps);

      return { allowed: false, remaining: 0, retryAfterSec };
    }

    // Allow: record this request
    timestamps.push(now);
    this.store.set(key, timestamps);

    const remaining = this.config.maxRequests - timestamps.length;
    return { allowed: true, remaining, retryAfterSec: 0 };
  }

  /** Remove entries where all timestamps have expired. */
  private cleanup(): void {
    const cutoff = Date.now() - this.config.windowMs;
    for (const [key, timestamps] of Array.from(this.store.entries())) {
      if (timestamps.every(ts => ts <= cutoff)) {
        this.store.delete(key);
      }
    }
  }

  /** Stop the background cleanup interval (for tests and graceful shutdown). */
  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}
