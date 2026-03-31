import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateCheckpoint, clearCheckpoint, type PipelineCheckpoint } from "./checkpoint.ts";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const config = {
  apiUrl: "https://board.example.com",
  apiKey: "test-key-123",
  ticketNumber: "42",
};

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true });
});

describe("updateCheckpoint", () => {
  it("writes checkpoint via PATCH to Board API", async () => {
    const update: Partial<PipelineCheckpoint> = {
      phase: "triage",
      branch_name: "feature/42-test",
    };

    await updateCheckpoint(config, null, update);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://board.example.com/api/tickets/42");
    expect(opts.method).toBe("PATCH");
    expect(opts.headers["X-Pipeline-Key"]).toBe("test-key-123");

    const body = JSON.parse(opts.body);
    expect(body.pipeline_checkpoint.phase).toBe("triage");
    expect(body.pipeline_checkpoint.branch_name).toBe("feature/42-test");
    expect(body.pipeline_checkpoint.last_updated).toBeDefined();
  });

  it("merges update with current checkpoint", async () => {
    const current: PipelineCheckpoint = {
      phase: "triage",
      completed_agents: ["backend"],
      pending_agents: ["frontend"],
      branch_name: "feature/42-test",
      started_at: "2024-01-01T00:00:00.000Z",
      last_updated: "2024-01-01T00:00:00.000Z",
      attempt: 1,
    };

    await updateCheckpoint(config, current, { phase: "planning" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.pipeline_checkpoint.phase).toBe("planning");
    expect(body.pipeline_checkpoint.branch_name).toBe("feature/42-test");
    expect(body.pipeline_checkpoint.completed_agents).toEqual(["backend"]);
    expect(body.pipeline_checkpoint.started_at).toBe("2024-01-01T00:00:00.000Z");
  });

  it("does not throw on fetch failure (best-effort)", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    await expect(
      updateCheckpoint(config, null, { phase: "triage" }),
    ).resolves.toBeUndefined();
  });

  it("uses AbortSignal.timeout for request timeout", async () => {
    await updateCheckpoint(config, null, { phase: "triage" });

    const opts = mockFetch.mock.calls[0][1];
    expect(opts.signal).toBeDefined();
  });

  it("does not include secrets in checkpoint body", async () => {
    await updateCheckpoint(config, null, {
      phase: "planning",
      branch_name: "feature/42-test",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const checkpoint = body.pipeline_checkpoint;

    // Checkpoint data must not contain API keys or secrets
    const serialized = JSON.stringify(checkpoint);
    expect(serialized).not.toContain("test-key-123");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("api_key");
  });
});

describe("clearCheckpoint", () => {
  it("sets pipeline_checkpoint to null", async () => {
    await clearCheckpoint(config);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://board.example.com/api/tickets/42");
    expect(opts.method).toBe("PATCH");

    const body = JSON.parse(opts.body);
    expect(body.pipeline_checkpoint).toBeNull();
  });

  it("does not throw on fetch failure (best-effort)", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    await expect(clearCheckpoint(config)).resolves.toBeUndefined();
  });
});
