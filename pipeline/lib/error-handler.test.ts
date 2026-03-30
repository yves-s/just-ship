// pipeline/lib/error-handler.test.ts
import { describe, it, expect } from "vitest";
import { classifyError, type ErrorClassification } from "./error-handler.ts";

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
