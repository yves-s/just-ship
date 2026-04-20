import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  THREAD_STATUSES,
  THREAD_ALLOWED_TRANSITIONS,
  isAllowedTransition,
  validateCreateThreadRequest,
  validateUpdateThreadRequest,
  createThread,
  updateThread,
  listThreadMessages,
  listThreads,
  ThreadValidationError,
  ThreadTransitionError,
  ThreadNotFoundError,
  type ThreadStatus,
  type Thread,
  type ThreadMessage,
} from "./threads-store.ts";

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

const TEST_SUPABASE_URL = "https://engine.test.supabase.co";
const TEST_SUPABASE_KEY = "test-service-key";

beforeEach(() => {
  process.env.SUPABASE_URL = TEST_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_KEY = TEST_SUPABASE_KEY;
});

afterEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function createMockFetch(responses: Response[]): {
  fn: typeof fetch;
  calls: RecordedCall[];
} {
  const queue = [...responses];
  const calls: RecordedCall[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const rawHeaders = (init?.headers ?? {}) as Record<string, string>;
    const bodyStr = typeof init?.body === "string" ? init.body : undefined;
    const body = bodyStr ? JSON.parse(bodyStr) : undefined;
    calls.push({ url, method, headers: { ...rawHeaders }, body });

    if (queue.length === 0) {
      throw new Error(`createMockFetch: queue overflow on call ${calls.length} (${method} ${url})`);
    }
    return queue.shift()!;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID_A = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_B = "22222222-2222-4222-8222-222222222222";
const VALID_UUID_C = "33333333-3333-4333-8333-333333333333";
const VALID_UUID_D = "44444444-4444-4444-8444-444444444444";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: VALID_UUID_D,
    workspace_id: VALID_UUID_A,
    project_id: VALID_UUID_B,
    user_id: VALID_UUID_C,
    title: "Thread",
    status: "draft",
    classification: null,
    pending_questions: null,
    last_activity_at: "2026-04-20T10:00:00Z",
    next_reminder_at: null,
    reminder_count: 0,
    created_at: "2026-04-20T10:00:00Z",
    updated_at: "2026-04-20T10:00:00Z",
    ...overrides,
  };
}

function makeThreadMessage(id: string, createdAt: string): ThreadMessage {
  return {
    id,
    thread_id: VALID_UUID_D,
    role: "ceo",
    content: "msg",
    attachments: null,
    metadata: null,
    created_at: createdAt,
  };
}

// ---------------------------------------------------------------------------
// isAllowedTransition — exhaustive matrix
// ---------------------------------------------------------------------------

describe("isAllowedTransition", () => {
  it("returns the expected boolean for every (from, to) pair in THREAD_STATUSES", () => {
    for (const from of THREAD_STATUSES) {
      for (const to of THREAD_STATUSES) {
        const expected = (THREAD_ALLOWED_TRANSITIONS[from] as readonly string[]).includes(to);
        expect(isAllowedTransition(from, to)).toBe(expected);
      }
    }
  });

  it("closed has zero outbound transitions", () => {
    for (const to of THREAD_STATUSES) {
      expect(isAllowedTransition("closed", to)).toBe(false);
    }
  });

  it("parked can go back to draft, waiting_for_input, ready_to_plan, and closed", () => {
    const parkedOutbound: ThreadStatus[] = ["draft", "waiting_for_input", "ready_to_plan", "closed"];
    for (const to of parkedOutbound) {
      expect(isAllowedTransition("parked", to)).toBe(true);
    }
    // Negative check: parked -> parked (self) is not allowed
    expect(isAllowedTransition("parked", "parked")).toBe(false);
    expect(isAllowedTransition("parked", "in_progress")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateCreateThreadRequest
// ---------------------------------------------------------------------------

describe("validateCreateThreadRequest", () => {
  const base = {
    workspace_id: VALID_UUID_A,
    project_id: VALID_UUID_B,
    user_id: VALID_UUID_C,
    title: "Hello thread",
  };

  it("rejects non-object body", () => {
    expect(() => validateCreateThreadRequest(null)).toThrow(ThreadValidationError);
  });

  it("rejects missing workspace_id / project_id / user_id", () => {
    expect(() => validateCreateThreadRequest({ ...base, workspace_id: undefined })).toThrow(ThreadValidationError);
    expect(() => validateCreateThreadRequest({ ...base, project_id: undefined })).toThrow(ThreadValidationError);
    expect(() => validateCreateThreadRequest({ ...base, user_id: undefined })).toThrow(ThreadValidationError);
  });

  it("rejects non-UUID workspace_id", () => {
    expect(() => validateCreateThreadRequest({ ...base, workspace_id: "not-a-uuid" })).toThrow(
      ThreadValidationError,
    );
  });

  it("rejects empty or oversized title", () => {
    expect(() => validateCreateThreadRequest({ ...base, title: "" })).toThrow(ThreadValidationError);
    expect(() => validateCreateThreadRequest({ ...base, title: "   " })).toThrow(ThreadValidationError);
    expect(() => validateCreateThreadRequest({ ...base, title: "x".repeat(201) })).toThrow(ThreadValidationError);
  });

  it("rejects invalid status", () => {
    expect(() => validateCreateThreadRequest({ ...base, status: "foo" })).toThrow(ThreadValidationError);
  });

  it("rejects invalid classification", () => {
    expect(() => validateCreateThreadRequest({ ...base, classification: "xxl" })).toThrow(ThreadValidationError);
  });

  it("rejects non-array pending_questions", () => {
    expect(() => validateCreateThreadRequest({ ...base, pending_questions: { not: "array" } })).toThrow(
      ThreadValidationError,
    );
  });

  it("accepts minimal valid input", () => {
    const out = validateCreateThreadRequest(base);
    expect(out.title).toBe("Hello thread");
    expect(out.workspace_id).toBe(VALID_UUID_A);
    expect(out.status).toBeUndefined();
    expect(out.classification).toBeUndefined();
  });

  it("accepts input with optional status/classification/pending_questions", () => {
    const out = validateCreateThreadRequest({
      ...base,
      status: "draft",
      classification: "s",
      pending_questions: [{ q: "hi" }],
    });
    expect(out.status).toBe("draft");
    expect(out.classification).toBe("s");
    expect(out.pending_questions).toEqual([{ q: "hi" }]);
  });
});

// ---------------------------------------------------------------------------
// validateUpdateThreadRequest
// ---------------------------------------------------------------------------

describe("validateUpdateThreadRequest", () => {
  it("accepts empty object", () => {
    expect(validateUpdateThreadRequest({})).toEqual({});
  });

  it("rejects invalid status", () => {
    expect(() => validateUpdateThreadRequest({ status: "foo" })).toThrow(ThreadValidationError);
  });

  it("rejects invalid classification (unless null)", () => {
    expect(() => validateUpdateThreadRequest({ classification: "xxl" })).toThrow(ThreadValidationError);
  });

  it("accepts classification: null (explicit clear)", () => {
    const out = validateUpdateThreadRequest({ classification: null });
    expect(out.classification).toBeNull();
  });

  it("rejects title > 200 chars", () => {
    expect(() => validateUpdateThreadRequest({ title: "x".repeat(201) })).toThrow(ThreadValidationError);
  });

  it("accepts each optional field alone", () => {
    expect(validateUpdateThreadRequest({ status: "draft" })).toEqual({ status: "draft" });
    expect(validateUpdateThreadRequest({ title: "new title" })).toEqual({ title: "new title" });
    expect(validateUpdateThreadRequest({ pending_questions: [] })).toEqual({ pending_questions: [] });
    expect(validateUpdateThreadRequest({ next_reminder_at: null })).toEqual({ next_reminder_at: null });
    expect(validateUpdateThreadRequest({ next_reminder_at: "2026-04-20T12:00:00Z" })).toEqual({
      next_reminder_at: "2026-04-20T12:00:00Z",
    });
    expect(validateUpdateThreadRequest({ reminder_count: 3 })).toEqual({ reminder_count: 3 });
  });
});

// ---------------------------------------------------------------------------
// createThread (happy path)
// ---------------------------------------------------------------------------

describe("createThread", () => {
  it("POSTs to /rest/v1/threads and returns the parsed row", async () => {
    const row = makeThread({ title: "New thread", status: "draft" });
    const { fn, calls } = createMockFetch([jsonResponse(row)]);

    const result = await createThread(
      {
        workspace_id: VALID_UUID_A,
        project_id: VALID_UUID_B,
        user_id: VALID_UUID_C,
        title: "New thread",
      },
      { fetchFn: fn },
    );

    expect(result).toEqual(row);
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.method).toBe("POST");
    expect(c.url).toBe(`${TEST_SUPABASE_URL}/rest/v1/threads?select=*`);
    expect(c.body).toMatchObject({
      workspace_id: VALID_UUID_A,
      project_id: VALID_UUID_B,
      user_id: VALID_UUID_C,
      title: "New thread",
      status: "draft",
    });
  });
});

// ---------------------------------------------------------------------------
// updateThread
// ---------------------------------------------------------------------------

describe("updateThread", () => {
  it("throws ThreadTransitionError BEFORE any PATCH on illegal transition", async () => {
    // Current status = "closed" (no outbound). Attempt to move to "draft" -> illegal.
    const current = makeThread({ status: "closed" });
    const { fn, calls } = createMockFetch([jsonResponse([current])]);

    await expect(
      updateThread(VALID_UUID_D, { status: "draft" }, { fetchFn: fn }),
    ).rejects.toBeInstanceOf(ThreadTransitionError);

    // Exactly one call: the GET. No PATCH fired.
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls.find((c) => c.method === "PATCH")).toBeUndefined();
  });

  it("legal transition: GETs current then PATCHes and returns the updated row", async () => {
    const current = makeThread({ status: "draft" });
    const updated = makeThread({ status: "ready_to_plan" });
    const { fn, calls } = createMockFetch([jsonResponse([current]), jsonResponse([updated])]);

    const result = await updateThread(VALID_UUID_D, { status: "ready_to_plan" }, { fetchFn: fn });

    expect(result).toEqual(updated);
    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe("GET");
    expect(calls[1].method).toBe("PATCH");
    expect(calls[1].body).toEqual({ status: "ready_to_plan" });
  });

  it("skips transition check when patch has no status field", async () => {
    // draft has no "draft -> draft" transition; updating only the title must still pass
    // because the transition check should be skipped when status is not in the patch.
    const current = makeThread({ status: "draft" });
    const updated = makeThread({ status: "draft", title: "Renamed" });
    const { fn, calls } = createMockFetch([jsonResponse([current]), jsonResponse([updated])]);

    const result = await updateThread(VALID_UUID_D, { title: "Renamed" }, { fetchFn: fn });
    expect(result.title).toBe("Renamed");
    expect(calls).toHaveLength(2);
    expect(calls[1].method).toBe("PATCH");
    expect(calls[1].body).toEqual({ title: "Renamed" });
  });

  it("throws ThreadNotFoundError when the thread does not exist", async () => {
    const { fn } = createMockFetch([jsonResponse([])]);
    await expect(
      updateThread(VALID_UUID_D, { title: "x" }, { fetchFn: fn }),
    ).rejects.toBeInstanceOf(ThreadNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// listThreadMessages — pagination parity with conversation messages
// ---------------------------------------------------------------------------

describe("listThreadMessages", () => {
  it("throws ThreadNotFoundError when existence check returns empty", async () => {
    const { fn } = createMockFetch([jsonResponse([])]);
    await expect(
      listThreadMessages(VALID_UUID_D, {}, { fetchFn: fn }),
    ).rejects.toBeInstanceOf(ThreadNotFoundError);
  });

  it("returns has_more=true when server returns limit+1 rows", async () => {
    const existence = jsonResponse([{ id: VALID_UUID_D }]);
    const rows = [
      makeThreadMessage("m1", "2026-04-20T10:00:00Z"),
      makeThreadMessage("m2", "2026-04-20T10:01:00Z"),
      makeThreadMessage("m3", "2026-04-20T10:02:00Z"),
    ];
    const { fn, calls } = createMockFetch([existence, jsonResponse(rows)]);

    const res = await listThreadMessages(VALID_UUID_D, { limit: 2 }, { fetchFn: fn });
    expect(res.has_more).toBe(true);
    expect(res.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(calls[1].url).toContain("limit=3");
    expect(calls[1].url).toContain("offset=0");
  });

  it("returns has_more=false when server returns <= limit rows", async () => {
    const existence = jsonResponse([{ id: VALID_UUID_D }]);
    const rows = [
      makeThreadMessage("m1", "2026-04-20T10:00:00Z"),
      makeThreadMessage("m2", "2026-04-20T10:01:00Z"),
    ];
    const { fn } = createMockFetch([existence, jsonResponse(rows)]);

    const res = await listThreadMessages(VALID_UUID_D, { limit: 2 }, { fetchFn: fn });
    expect(res.has_more).toBe(false);
    expect(res.messages).toHaveLength(2);
  });

  it("forwards offset to the URL", async () => {
    const existence = jsonResponse([{ id: VALID_UUID_D }]);
    const { fn, calls } = createMockFetch([existence, jsonResponse([])]);

    await listThreadMessages(VALID_UUID_D, { limit: 10, offset: 25 }, { fetchFn: fn });
    expect(calls[1].url).toContain("offset=25");
    expect(calls[1].url).toContain("limit=11");
  });
});

// ---------------------------------------------------------------------------
// listThreads (T-926)
// ---------------------------------------------------------------------------

describe("listThreads", () => {
  it("rejects a fully-empty filter set — listing all threads cross-workspace is unsafe", async () => {
    await expect(listThreads({})).rejects.toThrow(ThreadValidationError);
  });

  it("rejects non-UUID project_id / user_id / workspace_id", async () => {
    await expect(listThreads({ project_id: "nope" })).rejects.toThrow(ThreadValidationError);
    await expect(listThreads({ user_id: "nope" })).rejects.toThrow(ThreadValidationError);
    await expect(listThreads({ workspace_id: "nope" })).rejects.toThrow(ThreadValidationError);
  });

  it("rejects unknown status values", async () => {
    await expect(
      listThreads({ project_id: VALID_UUID_B, status: "foo" as ThreadStatus }),
    ).rejects.toThrow(ThreadValidationError);
    await expect(
      listThreads({ project_id: VALID_UUID_B, status: ["draft", "bogus" as ThreadStatus] }),
    ).rejects.toThrow(ThreadValidationError);
  });

  it("queries with project_id filter and orders by last_activity_at desc", async () => {
    const row = makeThread();
    const { fn, calls } = createMockFetch([jsonResponse([row])]);

    const res = await listThreads({ project_id: VALID_UUID_B }, { fetchFn: fn });
    expect(res.has_more).toBe(false);
    expect(res.threads).toEqual([row]);
    expect(calls[0].url).toContain(`project_id=eq.${VALID_UUID_B}`);
    expect(calls[0].url).toContain("order=last_activity_at.desc");
    expect(calls[0].url).toContain("select=*");
  });

  it("combines multiple filters and status list into an in.() clause", async () => {
    const { fn, calls } = createMockFetch([jsonResponse([])]);

    await listThreads(
      {
        project_id: VALID_UUID_B,
        user_id: VALID_UUID_C,
        workspace_id: VALID_UUID_A,
        status: ["draft", "in_progress"],
      },
      { fetchFn: fn },
    );

    const url = calls[0].url;
    expect(url).toContain(`project_id=eq.${VALID_UUID_B}`);
    expect(url).toContain(`user_id=eq.${VALID_UUID_C}`);
    expect(url).toContain(`workspace_id=eq.${VALID_UUID_A}`);
    // Status list may be encoded with percent-escapes; match either literal or encoded.
    expect(/status=in\.%28draft%2Cin_progress%29|status=in\.\(draft,in_progress\)/.test(url)).toBe(true);
  });

  it("returns has_more=true when rows exceed limit", async () => {
    const extra = [makeThread({ id: VALID_UUID_A }), makeThread({ id: VALID_UUID_B }), makeThread({ id: VALID_UUID_C })];
    const { fn } = createMockFetch([jsonResponse(extra)]);

    const res = await listThreads({ project_id: VALID_UUID_B, limit: 2 }, { fetchFn: fn });
    expect(res.has_more).toBe(true);
    expect(res.threads).toHaveLength(2);
  });

  it("clamps limit to the allowed bounds", async () => {
    const { fn, calls } = createMockFetch([jsonResponse([]), jsonResponse([])]);

    await listThreads({ project_id: VALID_UUID_B, limit: 9999 }, { fetchFn: fn });
    // limit+1 from a clamped value of 200
    expect(calls[0].url).toContain("limit=201");

    await listThreads({ project_id: VALID_UUID_B, limit: -5 }, { fetchFn: fn });
    // floor of 1 + 1
    expect(calls[1].url).toContain("limit=2");
  });
});
