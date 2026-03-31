import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkBudget } from "./budget.ts";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const config = {
  apiUrl: "https://board.example.com",
  apiKey: "test-key-123",
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe("checkBudget", () => {
  it("returns allowed: true when no ceiling is set (NULL = no limit)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { budget_ceiling_usd: null } }),
    });

    const result = await checkBudget(config, "ws-123");

    expect(result.allowed).toBe(true);
    // Should not call costs endpoint when no ceiling
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns allowed: true when ceiling is undefined (backward compat)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: {} }),
    });

    const result = await checkBudget(config, "ws-123");

    expect(result.allowed).toBe(true);
  });

  it("returns allowed: true when under budget", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { budget_ceiling_usd: 100, budget_alert_threshold: 0.8 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { total_cost_usd: 50 } }),
      });

    const result = await checkBudget(config, "ws-123");

    expect(result.allowed).toBe(true);
    expect(result.currentCost).toBe(50);
    expect(result.ceiling).toBe(100);
    expect(result.thresholdReached).toBe(false);
  });

  it("returns allowed: false when budget exceeded", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { budget_ceiling_usd: 100, budget_alert_threshold: 0.8 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { total_cost_usd: 105 } }),
      });

    const result = await checkBudget(config, "ws-123");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Budget exceeded");
    expect(result.reason).toContain("105.00");
    expect(result.reason).toContain("100.00");
    expect(result.currentCost).toBe(105);
    expect(result.ceiling).toBe(100);
  });

  it("returns allowed: false when cost equals ceiling exactly", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { budget_ceiling_usd: 100, budget_alert_threshold: 0.8 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { total_cost_usd: 100 } }),
      });

    const result = await checkBudget(config, "ws-123");

    expect(result.allowed).toBe(false);
  });

  it("sets thresholdReached when at 80% of ceiling", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { budget_ceiling_usd: 100, budget_alert_threshold: 0.8 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { total_cost_usd: 80 } }),
      });

    const result = await checkBudget(config, "ws-123");

    expect(result.allowed).toBe(true);
    expect(result.thresholdReached).toBe(true);
  });

  it("does not set thresholdReached when below 80%", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { budget_ceiling_usd: 100, budget_alert_threshold: 0.8 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { total_cost_usd: 79 } }),
      });

    const result = await checkBudget(config, "ws-123");

    expect(result.allowed).toBe(true);
    expect(result.thresholdReached).toBe(false);
  });

  it("uses custom threshold from workspace config", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { budget_ceiling_usd: 100, budget_alert_threshold: 0.5 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { total_cost_usd: 55 } }),
      });

    const result = await checkBudget(config, "ws-123");

    expect(result.allowed).toBe(true);
    expect(result.thresholdReached).toBe(true);
  });

  it("defaults threshold to 0.8 when not set in workspace", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { budget_ceiling_usd: 100 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { total_cost_usd: 85 } }),
      });

    const result = await checkBudget(config, "ws-123");

    expect(result.thresholdReached).toBe(true);
  });

  // --- Fail-open behavior ---
  it("fails open on workspace fetch error (network)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    const result = await checkBudget(config, "ws-123");

    expect(result.allowed).toBe(true);
  });

  it("fails open on workspace fetch HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await checkBudget(config, "ws-123");

    expect(result.allowed).toBe(true);
  });

  it("fails open on costs fetch HTTP error", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { budget_ceiling_usd: 100, budget_alert_threshold: 0.8 },
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await checkBudget(config, "ws-123");

    expect(result.allowed).toBe(true);
  });

  it("fails open on costs fetch network error", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { budget_ceiling_usd: 100, budget_alert_threshold: 0.8 },
        }),
      })
      .mockRejectedValueOnce(new Error("timeout"));

    const result = await checkBudget(config, "ws-123");

    expect(result.allowed).toBe(true);
  });

  // --- API response format flexibility ---
  it("handles response without data wrapper", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ budget_ceiling_usd: 100, budget_alert_threshold: 0.8 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ total_cost_usd: 50 }),
      });

    const result = await checkBudget(config, "ws-123");

    expect(result.allowed).toBe(true);
    expect(result.currentCost).toBe(50);
  });
});
