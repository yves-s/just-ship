import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RateLimiter } from "./rate-limiter.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Advance fake time by `ms` milliseconds. */
function tick(ms: number) {
  vi.advanceTimersByTime(ms);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests within the limit", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 3 });

    expect(limiter.check("key1").allowed).toBe(true);
    expect(limiter.check("key1").allowed).toBe(true);
    expect(limiter.check("key1").allowed).toBe(true);

    limiter.destroy();
  });

  it("blocks requests that exceed the limit", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });

    expect(limiter.check("key1").allowed).toBe(true);
    expect(limiter.check("key1").allowed).toBe(true);
    expect(limiter.check("key1").allowed).toBe(false);

    limiter.destroy();
  });

  it("returns correct remaining counts", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 5 });

    expect(limiter.check("key1").remaining).toBe(4);
    expect(limiter.check("key1").remaining).toBe(3);
    expect(limiter.check("key1").remaining).toBe(2);

    limiter.destroy();
  });

  it("returns remaining 0 when at limit", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });

    limiter.check("key1"); // 1st
    expect(limiter.check("key1").remaining).toBe(0); // 2nd — hits limit

    limiter.destroy();
  });

  it("returns retryAfterSec > 0 when blocked", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });

    limiter.check("key1"); // consumes the only slot

    const result = limiter.check("key1");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThan(0);

    limiter.destroy();
  });

  it("returns retryAfterSec 0 when allowed", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 5 });

    const result = limiter.check("key1");
    expect(result.allowed).toBe(true);
    expect(result.retryAfterSec).toBe(0);

    limiter.destroy();
  });

  it("retryAfterSec is ceil of remaining window time for oldest entry", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });

    // First request at t=0
    limiter.check("key1");

    // Advance 10 seconds — oldest entry is 10s old, window is 60s → ~50s left
    tick(10_000);

    const result = limiter.check("key1");
    expect(result.allowed).toBe(false);
    // Oldest entry was at t=0, window = 60s → retry after 60-10 = 50s
    expect(result.retryAfterSec).toBe(50);

    limiter.destroy();
  });

  it("old window expires — new requests are allowed after window passes", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });

    limiter.check("key1"); // t=0
    limiter.check("key1"); // t=0 — at limit

    // Not allowed yet
    expect(limiter.check("key1").allowed).toBe(false);

    // Advance just past the window
    tick(60_001);

    // Both old timestamps are now expired — should be allowed again
    expect(limiter.check("key1").allowed).toBe(true);
    expect(limiter.check("key1").allowed).toBe(true);
    expect(limiter.check("key1").allowed).toBe(false);

    limiter.destroy();
  });

  it("different keys are tracked independently", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });

    limiter.check("project-a");
    limiter.check("project-a"); // project-a is at limit

    // project-b starts fresh
    expect(limiter.check("project-b").allowed).toBe(true);
    expect(limiter.check("project-b").allowed).toBe(true);

    // project-a still blocked
    expect(limiter.check("project-a").allowed).toBe(false);

    limiter.destroy();
  });

  it("destroy() stops the cleanup interval without error", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 10 });

    limiter.check("key1");

    // Should not throw
    expect(() => limiter.destroy()).not.toThrow();

    // Interval is cleared — advancing time should not cause issues
    tick(120_000);
  });

  it("handles maxRequests: 1 correctly", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });

    const first = limiter.check("single");
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(0);

    const second = limiter.check("single");
    expect(second.allowed).toBe(false);
    expect(second.remaining).toBe(0);
    expect(second.retryAfterSec).toBeGreaterThan(0);

    limiter.destroy();
  });

  it("sliding window: requests from beginning of window expire first", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });

    limiter.check("key1"); // t=0
    tick(30_000);
    limiter.check("key1"); // t=30s — 2 in window, at limit

    expect(limiter.check("key1").allowed).toBe(false);

    // Advance to t=61s — first entry (t=0) is now expired, second (t=30s) still in window
    tick(31_000);

    // One slot freed (the t=0 entry expired), one still occupied (t=30s)
    const result = limiter.check("key1"); // t=61s — should be allowed (1 slot freed)
    expect(result.allowed).toBe(true);

    limiter.destroy();
  });
});
