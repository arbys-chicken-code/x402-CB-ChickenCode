/**
 * In-memory sliding-window rate limiter keyed by payer (wallet) and service.
 *
 * This protects paid services from abuse even before settlement happens. In a
 * multi-instance production deployment you would back this with Redis or a
 * facilitator-side policy; the interface here is intentionally small so it can
 * be swapped without touching call sites.
 */

interface WindowState {
  count: number;
  resetAt: number;
}

/**
 * Outcome of a rate-limit check.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
}

/**
 * Fixed-window rate limiter with periodic pruning of expired keys.
 */
export class RateLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly buckets = new Map<string, WindowState>();
  private readonly sweepInterval: ReturnType<typeof setInterval>;

  /**
   * Create a rate limiter.
   *
   * @param max - Maximum allowed events per key within a window.
   * @param windowMs - Window duration in milliseconds.
   */
  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
    // Periodically prune expired buckets so memory does not grow unbounded.
    this.sweepInterval = setInterval(() => this.sweep(), windowMs);
    // Do not keep the event loop alive solely for the sweep timer.
    if (typeof this.sweepInterval.unref === "function") {
      this.sweepInterval.unref();
    }
  }

  /**
   * Record an event for a key and report whether it is within the limit.
   *
   * @param key - Composite identifier, typically `${service}:${payer}`.
   * @returns The {@link RateLimitResult} describing the current window.
   */
  check(key: string): RateLimitResult {
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      const resetAt = now + this.windowMs;
      this.buckets.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: this.max - 1, limit: this.max, resetAt };
    }

    existing.count += 1;
    const allowed = existing.count <= this.max;
    return {
      allowed,
      remaining: Math.max(0, this.max - existing.count),
      limit: this.max,
      resetAt: existing.resetAt,
    };
  }

  /**
   * Stop the background sweep timer. Call during graceful shutdown.
   */
  stop(): void {
    clearInterval(this.sweepInterval);
  }

  /**
   * Remove expired buckets to bound memory usage.
   */
  private sweep(): void {
    const now = Date.now();
    for (const [key, state] of this.buckets.entries()) {
      if (state.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
