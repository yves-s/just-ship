import { describe, it, expect, vi } from "vitest";
import { superviseAgent } from "./supervisor.ts";

describe("superviseAgent", () => {
  it("returns result on success within timeout", async () => {
    const result = await superviseAgent({
      agentName: "test-agent",
      execute: async () => "done",

      maxRetries: 3,
    });

    expect(result.status).toBe("completed");
    expect(result.result).toBe("done");
    expect(result.attempts).toBe(1);
    expect(result.agentName).toBe("test-agent");
  });

  it("retries on timeout up to maxRetries then succeeds", async () => {
    let callCount = 0;
    const execute = async () => {
      callCount++;
      if (callCount <= 2) throw new Error("Request timed out");
      return "recovered";
    };

    const result = await superviseAgent({
      agentName: "flaky-agent",
      execute,

      maxRetries: 3,
    });

    expect(result.status).toBe("completed");
    expect(result.result).toBe("recovered");
    expect(result.attempts).toBe(3);
  });

  it("skips agent after maxRetries exhausted", async () => {
    const execute = async () => {
      throw new Error("timeout");
    };

    const result = await superviseAgent({
      agentName: "stuck-agent",
      execute,

      maxRetries: 2,
    });

    expect(result.status).toBe("skipped");
    expect(result.attempts).toBe(2);
    expect(result.reason).toContain("timed out");
    expect(result.reason).toContain("2");
    expect(result.agentName).toBe("stuck-agent");
  });

  it("does not retry on non-timeout errors", async () => {
    let callCount = 0;
    const execute = async () => {
      callCount++;
      throw new SyntaxError("Unexpected token");
    };

    const result = await superviseAgent({
      agentName: "broken-agent",
      execute,

      maxRetries: 3,
    });

    expect(result.status).toBe("failed");
    expect(result.attempts).toBe(1);
    expect(result.reason).toContain("Unexpected token");
    expect(callCount).toBe(1);
  });

  it("calls onTimeout callback on each timeout", async () => {
    const onTimeout = vi.fn();
    const execute = async () => {
      throw new Error("aborted");
    };

    await superviseAgent({
      agentName: "timeout-agent",
      execute,

      maxRetries: 3,
      onTimeout,
    });

    expect(onTimeout).toHaveBeenCalledTimes(3);
    expect(onTimeout).toHaveBeenNthCalledWith(1, 1);
    expect(onTimeout).toHaveBeenNthCalledWith(2, 2);
    expect(onTimeout).toHaveBeenNthCalledWith(3, 3);
  });

  it("calls onSkip callback when agent is skipped", async () => {
    const onSkip = vi.fn();
    const execute = async () => {
      throw new Error("timed out waiting for response");
    };

    const result = await superviseAgent({
      agentName: "skip-agent",
      execute,

      maxRetries: 2,
      onSkip,
    });

    expect(result.status).toBe("skipped");
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
