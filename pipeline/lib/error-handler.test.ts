// pipeline/lib/error-handler.test.ts
import { describe, it, expect } from "vitest";
import { classifyError, executeAutoHeal } from "./error-handler.ts";

describe("classifyError", () => {
  it("classifies timeout as recovery", () => {
    const result = classifyError({
      error: new Error("Timeout nach 30 Minuten"),
      ticketId: "123",
      exitCode: 1,
      timedOut: true,
    });
    expect(result.action).toBe("recovery");
    expect(result.reason).toContain("timeout");
  });

  it("classifies abort signal as recovery", () => {
    const result = classifyError({
      error: new Error("AbortError"),
      ticketId: "123",
      exitCode: 1,
      timedOut: false,
      aborted: true,
    });
    expect(result.action).toBe("recovery");
  });

  it("classifies unknown errors as escalate by default", () => {
    const result = classifyError({
      error: new Error("Something completely unexpected"),
      ticketId: "123",
      exitCode: 1,
      timedOut: false,
    });
    expect(result.action).toBe("escalate");
  });

  it("classifies git conflict as auto_heal", () => {
    const result = classifyError({
      error: new Error("git merge conflict in worktree"),
      ticketId: "456",
      exitCode: 1,
      timedOut: false,
    });
    expect(result.action).toBe("auto_heal");
    expect(result.shouldCreateTicket).toBe(true);
  });

  it("classifies watchdog timeout as recovery", () => {
    const result = classifyError({
      error: new Error("Watchdog timeout: T-123 executePipeline did not complete within 35 minutes"),
      ticketId: "123",
      exitCode: 1,
      timedOut: false,
    });
    expect(result.action).toBe("recovery");
    expect(result.reason).toContain("watchdog");
  });
});

describe("executeAutoHeal", () => {
  const baseCtx = {
    error: new Error("git merge conflict in worktree"),
    ticketId: "456",
    exitCode: 1,
    timedOut: false,
    branch: "feature/test",
  };

  it("returns early with healed: false for non-auto-heal classification", async () => {
    const classification = classifyError({
      error: new Error("Something unexpected"),
      ticketId: "123",
      exitCode: 1,
      timedOut: false,
    });
    const boardApi = {
      createTicket: async () => 99,
      patchTicket: async () => true,
    };
    const result = await executeAutoHeal(baseCtx, classification, boardApi);
    expect(result.healed).toBe(false);
    expect(result.summary).toContain("Not auto-healable");
  });

  it("creates ticket and returns healed: true on happy path", async () => {
    const classification = classifyError(baseCtx);
    expect(classification.action).toBe("auto_heal");

    const boardApi = {
      createTicket: async () => 42,
      patchTicket: async () => true,
    };
    const result = await executeAutoHeal(baseCtx, classification, boardApi);
    expect(result.healed).toBe(true);
    expect(result.ticketNumber).toBe(42);
    expect(result.summary).toContain("T-42");
    expect(result.summary).toContain("created and resolved");
  });

  it("returns healed: false when createTicket returns null", async () => {
    const classification = classifyError(baseCtx);

    const boardApi = {
      createTicket: async () => null,
      patchTicket: async () => true,
    };
    const result = await executeAutoHeal(baseCtx, classification, boardApi);
    expect(result.healed).toBe(false);
    expect(result.summary).toContain("Failed to create");
  });

  it("reports patch failure in summary when patchTicket returns false", async () => {
    const classification = classifyError(baseCtx);

    const boardApi = {
      createTicket: async () => 77,
      patchTicket: async () => false,
    };
    const result = await executeAutoHeal(baseCtx, classification, boardApi);
    expect(result.healed).toBe(true);
    expect(result.ticketNumber).toBe(77);
    expect(result.summary).toContain("status update failed");
  });
});
