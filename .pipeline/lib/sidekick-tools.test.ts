import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  executeSidekickTool,
  listSidekickToolSchemas,
  SIDEKICK_TOOLS,
  _resetSidekickToolsCacheForTests,
  type ToolContext,
  type ToolResult,
} from "./sidekick-tools.ts";

// The create primitive is stubbed so create_ticket tests don't reach the board.
vi.mock("./sidekick-create.ts", async (orig) => {
  const actual = await orig<typeof import("./sidekick-create.ts")>();
  return {
    ...actual,
    createFromClassification: vi.fn(async (req: unknown) => {
      // Minimal happy response matching CreateTicketResult shape.
      const r = req as { category: string; board_url?: string };
      if (r.category !== "ticket") throw new Error("unexpected in test");
      return {
        category: "ticket",
        ticket: {
          id: "11111111-1111-1111-1111-111111111111",
          number: 501,
          title: "Test ticket",
          url: r.board_url ? `${r.board_url}/t/501` : "T-501",
        },
      };
    }),
  };
});

import * as createModule from "./sidekick-create.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    apiUrl: "https://board.example.test",
    apiKey: "pipeline-key",
    workspaceId: "ws-1",
    projectId: "proj-1",
    boardUrl: "https://board.example.test",
    ...overrides,
  };
}

function mockFetch(responses: Array<{ status: number; json: unknown } | Error>): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const step = responses[i++];
    if (!step) throw new Error("no more mock responses");
    if (step instanceof Error) throw step;
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      statusText: `status-${step.status}`,
      json: async () => step.json,
      text: async () => JSON.stringify(step.json),
    } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  _resetSidekickToolsCacheForTests();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Registry shape
// ---------------------------------------------------------------------------

describe("SIDEKICK_TOOLS registry", () => {
  it("exports exactly the 6 expected tools with the board-parity names", () => {
    const names = Object.keys(SIDEKICK_TOOLS).sort();
    expect(names).toEqual(
      [
        "create_ticket",
        "create_thread",
        "get_project_status",
        "list_my_tickets",
        "search_tickets",
        "update_thread",
      ].sort(),
    );
  });

  it("listSidekickToolSchemas returns one schema per tool, all with object input_schema", () => {
    const schemas = listSidekickToolSchemas();
    expect(schemas).toHaveLength(6);
    for (const s of schemas) {
      expect(typeof s.name).toBe("string");
      expect(typeof s.description).toBe("string");
      expect(s.input_schema.type).toBe("object");
    }
  });

  it("returns unknown_tool for names not in the registry", async () => {
    const result = await executeSidekickTool("fly_to_mars", baseCtx(), {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unknown_tool");
  });
});

// ---------------------------------------------------------------------------
// create_ticket
// ---------------------------------------------------------------------------

describe("create_ticket", () => {
  it("delegates to createFromClassification and returns the ticket row on success", async () => {
    const ctx = baseCtx();
    const result = await executeSidekickTool(
      "create_ticket",
      ctx,
      { title: "Fix bug", description: "Body text", priority: "high", tags: ["ui"] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.result as { number: number; title: string; url?: string };
    expect(row.number).toBe(501);
    expect(row.title).toBe("Test ticket");
    expect(row.url).toBe("https://board.example.test/t/501");
    expect(createModule.createFromClassification).toHaveBeenCalledOnce();
  });

  it("returns a tool failure with code 'invalid_args' when title missing", async () => {
    const result = await executeSidekickTool(
      "create_ticket",
      baseCtx(),
      { description: "body only" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_args");
  });

  it("surfaces board errors via handleToolError, never throws", async () => {
    vi.mocked(createModule.createFromClassification).mockRejectedValueOnce(
      new createModule.BoardApiError("HTTP 500", 500),
    );
    const result = await executeSidekickTool(
      "create_ticket",
      baseCtx(),
      { title: "x", description: "y" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("board_500");
    expect(result.error).toContain("HTTP 500");
  });
});

// ---------------------------------------------------------------------------
// search_tickets
// ---------------------------------------------------------------------------

describe("search_tickets", () => {
  it("returns hits from the board on success", async () => {
    const ctx = baseCtx({
      fetchFn: mockFetch([
        {
          status: 200,
          json: { data: { tickets: [{ number: 10, title: "Found", status: "backlog", tags: [], created_at: "2026-01-01" }] } },
        },
      ]),
    });
    const result = await executeSidekickTool("search_tickets", ctx, { query: "Found" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hits = result.result as Array<{ number: number; title: string }>;
    expect(hits).toHaveLength(1);
    expect(hits[0].number).toBe(10);
  });

  it("returns invalid_args when query missing", async () => {
    const result = await executeSidekickTool("search_tickets", baseCtx(), {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_args");
  });

  it("returns a board error when the API returns non-2xx", async () => {
    const ctx = baseCtx({
      fetchFn: mockFetch([{ status: 500, json: { error: "boom" } }]),
    });
    const result = await executeSidekickTool("search_tickets", ctx, { query: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("board_500");
  });
});

// ---------------------------------------------------------------------------
// list_my_tickets
// ---------------------------------------------------------------------------

describe("list_my_tickets", () => {
  it("requires a user bearer — returns not_authenticated when missing", async () => {
    const result = await executeSidekickTool("list_my_tickets", baseCtx(), {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_authenticated");
  });

  it("uses the user bearer and returns the user's tickets on success", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit | undefined) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer user-token");
      expect(headers["X-Pipeline-Key"]).toBeUndefined();
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          data: {
            tickets: [
              { number: 7, title: "Mine", status: "backlog", tags: [], priority: "medium", created_at: "2026-01-01" },
            ],
          },
        }),
        text: async () => "",
      } as Response;
    });

    const ctx = baseCtx({ userBearer: "user-token", fetchFn: fetchFn as unknown as typeof fetch });
    const result = await executeSidekickTool("list_my_tickets", ctx, { status: "backlog" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tickets = result.result as Array<{ number: number }>;
    expect(tickets).toHaveLength(1);
    expect(tickets[0].number).toBe(7);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("returns a board error when the API rejects the bearer", async () => {
    const ctx = baseCtx({
      userBearer: "bad-token",
      fetchFn: mockFetch([{ status: 401, json: { error: "unauthenticated" } }]),
    });
    const result = await executeSidekickTool("list_my_tickets", ctx, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("board_401");
  });
});

// ---------------------------------------------------------------------------
// create_thread
// ---------------------------------------------------------------------------

describe("create_thread", () => {
  it("posts to /api/threads and returns the created row", async () => {
    const ctx = baseCtx({
      fetchFn: mockFetch([
        {
          status: 200,
          json: {
            data: {
              id: "tid-1",
              title: "T",
              status: "draft",
              classification: null,
              created_at: "2026-01-01",
            },
          },
        },
      ]),
    });
    const result = await executeSidekickTool(
      "create_thread",
      ctx,
      { title: "T", first_message: "hello" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.result as { id: string };
    expect(row.id).toBe("tid-1");
  });

  it("returns invalid_args when title missing", async () => {
    const result = await executeSidekickTool(
      "create_thread",
      baseCtx(),
      { first_message: "only message" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_args");
  });
});

// ---------------------------------------------------------------------------
// update_thread
// ---------------------------------------------------------------------------

describe("update_thread", () => {
  it("patches /api/threads/{id} with only the provided fields", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit | undefined) => {
      expect(url).toContain("/api/threads/tid-1");
      expect(init?.method).toBe("PATCH");
      const body = JSON.parse((init?.body as string) ?? "{}");
      expect(body).toEqual({ status: "resolved" });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ data: { id: "tid-1", title: "T", status: "resolved", classification: null } }),
        text: async () => "",
      } as Response;
    });

    const ctx = baseCtx({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await executeSidekickTool(
      "update_thread",
      ctx,
      { thread_id: "tid-1", status: "resolved" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.result as { status: string };
    expect(row.status).toBe("resolved");
  });

  it("returns invalid_args when thread_id missing", async () => {
    const result = await executeSidekickTool("update_thread", baseCtx(), { status: "resolved" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_args");
  });
});

// ---------------------------------------------------------------------------
// get_project_status — happy + cache-hit + error
// ---------------------------------------------------------------------------

describe("get_project_status", () => {
  it("calls the board once and returns the aggregated status", async () => {
    const payload = {
      data: {
        total_tickets: 42,
        by_status: { backlog: 10, done: 32 },
        in_progress: [],
        recently_completed: [],
        recent_agent_activity: [],
      },
    };
    const fetchFn = mockFetch([{ status: 200, json: payload }]);
    const ctx = baseCtx({ fetchFn });
    const result = await executeSidekickTool("get_project_status", ctx, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const status = result.result as { total_tickets: number };
    expect(status.total_tickets).toBe(42);
  });

  it("caches the result for 30s — second call within TTL hits cache, third after expiry refetches", async () => {
    const payload1 = { data: { total_tickets: 10, by_status: { backlog: 10 }, in_progress: [], recently_completed: [], recent_agent_activity: [] } };
    const payload2 = { data: { total_tickets: 99, by_status: { done: 99 }, in_progress: [], recently_completed: [], recent_agent_activity: [] } };

    const fetchFn = vi.fn();
    fetchFn
      .mockResolvedValueOnce({
        ok: true, status: 200, statusText: "OK",
        json: async () => payload1, text: async () => "",
      } as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200, statusText: "OK",
        json: async () => payload2, text: async () => "",
      } as Response);

    const ctx = baseCtx({ fetchFn: fetchFn as unknown as typeof fetch });

    // Turn on fake timers so we can fast-forward past the TTL without waiting.
    vi.useFakeTimers();
    try {
      const r1 = await executeSidekickTool("get_project_status", ctx, {});
      expect((r1 as ToolResult<{ total_tickets: number }> & { ok: true }).result.total_tickets).toBe(10);

      // Second call immediately — same cache key, should NOT re-issue the fetch.
      const r2 = await executeSidekickTool("get_project_status", ctx, {});
      expect((r2 as ToolResult<{ total_tickets: number }> & { ok: true }).result.total_tickets).toBe(10);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Advance past the 30s TTL; the third call should refetch.
      vi.advanceTimersByTime(31_000);
      const r3 = await executeSidekickTool("get_project_status", ctx, {});
      expect((r3 as ToolResult<{ total_tickets: number }> & { ok: true }).result.total_tickets).toBe(99);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("separates cache entries by workspace_id:project_id key", async () => {
    const payloadA = { data: { total_tickets: 1, by_status: {}, in_progress: [], recently_completed: [], recent_agent_activity: [] } };
    const payloadB = { data: { total_tickets: 2, by_status: {}, in_progress: [], recently_completed: [], recent_agent_activity: [] } };

    const fetchFn = vi.fn();
    fetchFn
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK", json: async () => payloadA, text: async () => "" } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK", json: async () => payloadB, text: async () => "" } as Response);

    const ctxA = baseCtx({ workspaceId: "ws-A", projectId: "proj-A", fetchFn: fetchFn as unknown as typeof fetch });
    const ctxB = baseCtx({ workspaceId: "ws-B", projectId: "proj-B", fetchFn: fetchFn as unknown as typeof fetch });

    const rA = await executeSidekickTool("get_project_status", ctxA, {});
    const rB = await executeSidekickTool("get_project_status", ctxB, {});
    expect((rA as ToolResult<{ total_tickets: number }> & { ok: true }).result.total_tickets).toBe(1);
    expect((rB as ToolResult<{ total_tickets: number }> & { ok: true }).result.total_tickets).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("bounds the cache size so long-running workers don't leak memory", async () => {
    // 201 distinct workspace:project keys → cache cap (200) should evict the
    // oldest entry, so the very first key must MISS on a re-fetch after the
    // fill even though every entry is still within the 30s TTL.
    const successPayload = { data: { total_tickets: 1, by_status: {}, in_progress: [], recently_completed: [], recent_agent_activity: [] } };
    const fetchFn = vi.fn(async () => ({
      ok: true, status: 200, statusText: "OK",
      json: async () => successPayload, text: async () => "",
    } as Response));

    // Fill the cache to exactly the cap with 200 distinct keys.
    for (let i = 0; i < 200; i++) {
      const ctx = baseCtx({ workspaceId: `ws-${i}`, projectId: `proj-${i}`, fetchFn: fetchFn as unknown as typeof fetch });
      await executeSidekickTool("get_project_status", ctx, {});
    }
    expect(fetchFn).toHaveBeenCalledTimes(200);

    // Writing one more key should evict the oldest (ws-0:proj-0).
    const ctxN = baseCtx({ workspaceId: "ws-200", projectId: "proj-200", fetchFn: fetchFn as unknown as typeof fetch });
    await executeSidekickTool("get_project_status", ctxN, {});
    expect(fetchFn).toHaveBeenCalledTimes(201);

    // Re-fetching the first key must MISS and re-issue a 202nd network call
    // because its entry was evicted.
    const ctx0 = baseCtx({ workspaceId: "ws-0", projectId: "proj-0", fetchFn: fetchFn as unknown as typeof fetch });
    await executeSidekickTool("get_project_status", ctx0, {});
    expect(fetchFn).toHaveBeenCalledTimes(202);

    // But re-fetching the most recent key should still HIT (no extra call).
    await executeSidekickTool("get_project_status", ctxN, {});
    expect(fetchFn).toHaveBeenCalledTimes(202);
  });

  it("returns a board error when the API returns non-2xx (and does not cache failures)", async () => {
    const fetchFn = vi.fn();
    fetchFn.mockResolvedValueOnce({
      ok: false, status: 503, statusText: "Service Unavailable",
      json: async () => ({ error: "down" }), text: async () => "",
    } as Response);
    const ctx = baseCtx({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await executeSidekickTool("get_project_status", ctx, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("board_503");

    // Next call should also issue a fetch (no negative caching).
    fetchFn.mockResolvedValueOnce({
      ok: true, status: 200, statusText: "OK",
      json: async () => ({ data: { total_tickets: 0, by_status: {}, in_progress: [], recently_completed: [], recent_agent_activity: [] } }),
      text: async () => "",
    } as Response);
    const r2 = await executeSidekickTool("get_project_status", ctx, {});
    expect(r2.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
