import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  validateCreateConversationRequest,
  createConversation,
  listConversationMessages,
  ConversationValidationError,
  ConversationNotFoundError,
  type Conversation,
  type ConversationMessage,
} from "./sidekick-conversations-store.ts";

// ---------------------------------------------------------------------------
// Env (supabase-rest.ts reads these at call time via getConfig)
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

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: VALID_UUID_D,
    workspace_id: VALID_UUID_A,
    project_id: VALID_UUID_B,
    user_id: VALID_UUID_C,
    title: null,
    page_url: null,
    page_title: null,
    created_at: "2026-04-20T10:00:00Z",
    updated_at: "2026-04-20T10:00:00Z",
    ...overrides,
  };
}

function makeMessage(id: string, createdAt: string): ConversationMessage {
  return {
    id,
    conversation_id: VALID_UUID_D,
    role: "user",
    content: "hi",
    context: null,
    ticket_id: null,
    search_results: null,
    image_urls: null,
    created_at: createdAt,
  };
}

// ---------------------------------------------------------------------------
// validateCreateConversationRequest
// ---------------------------------------------------------------------------

describe("validateCreateConversationRequest", () => {
  const base = { workspace_id: VALID_UUID_A, project_id: VALID_UUID_B, user_id: VALID_UUID_C };

  it("rejects non-object body", () => {
    expect(() => validateCreateConversationRequest(null)).toThrow(ConversationValidationError);
    expect(() => validateCreateConversationRequest("string")).toThrow(ConversationValidationError);
    expect(() => validateCreateConversationRequest(42)).toThrow(ConversationValidationError);
  });

  it("rejects missing or invalid workspace_id", () => {
    expect(() => validateCreateConversationRequest({ ...base, workspace_id: undefined })).toThrow(
      ConversationValidationError,
    );
    expect(() => validateCreateConversationRequest({ ...base, workspace_id: "not-a-uuid" })).toThrow(
      ConversationValidationError,
    );
  });

  it("rejects missing or invalid project_id", () => {
    expect(() => validateCreateConversationRequest({ ...base, project_id: undefined })).toThrow(
      ConversationValidationError,
    );
    expect(() => validateCreateConversationRequest({ ...base, project_id: "nope" })).toThrow(
      ConversationValidationError,
    );
  });

  it("rejects missing or invalid user_id", () => {
    expect(() => validateCreateConversationRequest({ ...base, user_id: undefined })).toThrow(
      ConversationValidationError,
    );
    expect(() => validateCreateConversationRequest({ ...base, user_id: "nope" })).toThrow(
      ConversationValidationError,
    );
  });

  it("rejects oversized title", () => {
    expect(() =>
      validateCreateConversationRequest({ ...base, title: "x".repeat(501) }),
    ).toThrow(ConversationValidationError);
  });

  it("rejects oversized page_url", () => {
    expect(() =>
      validateCreateConversationRequest({ ...base, page_url: "x".repeat(2049) }),
    ).toThrow(ConversationValidationError);
  });

  it("rejects oversized page_title", () => {
    expect(() =>
      validateCreateConversationRequest({ ...base, page_title: "x".repeat(501) }),
    ).toThrow(ConversationValidationError);
  });

  it("accepts minimal input", () => {
    const out = validateCreateConversationRequest(base);
    expect(out).toEqual(base);
  });

  it("accepts full input", () => {
    const out = validateCreateConversationRequest({
      ...base,
      title: "Idea x",
      page_url: "https://example.com/p",
      page_title: "Page",
    });
    expect(out.title).toBe("Idea x");
    expect(out.page_url).toBe("https://example.com/p");
    expect(out.page_title).toBe("Page");
  });
});

// ---------------------------------------------------------------------------
// createConversation
// ---------------------------------------------------------------------------

describe("createConversation", () => {
  it("POSTs the correct URL, headers, and body; returns parsed row", async () => {
    const conv = makeConversation({ title: "hello" });
    const { fn, calls } = createMockFetch([jsonResponse(conv)]);

    const result = await createConversation(
      {
        workspace_id: VALID_UUID_A,
        project_id: VALID_UUID_B,
        user_id: VALID_UUID_C,
        title: "hello",
      },
      { fetchFn: fn },
    );

    expect(result).toEqual(conv);
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.method).toBe("POST");
    expect(c.url).toBe(`${TEST_SUPABASE_URL}/rest/v1/sidekick_conversations?select=*`);
    expect(c.headers.apikey).toBe(TEST_SUPABASE_KEY);
    expect(c.headers.Authorization).toBe(`Bearer ${TEST_SUPABASE_KEY}`);
    expect(c.headers.Prefer).toBe("return=representation");
    expect(c.headers.Accept).toBe("application/vnd.pgrst.object+json");
    expect(c.body).toEqual({
      workspace_id: VALID_UUID_A,
      project_id: VALID_UUID_B,
      user_id: VALID_UUID_C,
      title: "hello",
    });
  });
});

// ---------------------------------------------------------------------------
// listConversationMessages
// ---------------------------------------------------------------------------

describe("listConversationMessages", () => {
  it("throws ConversationNotFoundError when existence check returns empty", async () => {
    const { fn } = createMockFetch([jsonResponse([])]);
    await expect(
      listConversationMessages(VALID_UUID_D, {}, { fetchFn: fn }),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);
  });

  it("returns has_more=true when server returns limit+1 rows", async () => {
    const existence = jsonResponse([{ id: VALID_UUID_D }]);
    // limit=2, server returns 3 (fetchLimit=3 because limit+1)
    const rows = [
      makeMessage("m1", "2026-04-20T10:00:00Z"),
      makeMessage("m2", "2026-04-20T10:01:00Z"),
      makeMessage("m3", "2026-04-20T10:02:00Z"),
    ];
    const { fn, calls } = createMockFetch([existence, jsonResponse(rows)]);

    const res = await listConversationMessages(VALID_UUID_D, { limit: 2 }, { fetchFn: fn });
    expect(res.has_more).toBe(true);
    expect(res.messages).toHaveLength(2);
    expect(res.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    // assert fetch limit on the messages call is limit+1 = 3
    expect(calls[1].url).toContain("limit=3");
    expect(calls[1].url).toContain("offset=0");
  });

  it("returns has_more=false when server returns <= limit rows", async () => {
    const existence = jsonResponse([{ id: VALID_UUID_D }]);
    const rows = [
      makeMessage("m1", "2026-04-20T10:00:00Z"),
      makeMessage("m2", "2026-04-20T10:01:00Z"),
    ];
    const { fn } = createMockFetch([existence, jsonResponse(rows)]);

    const res = await listConversationMessages(VALID_UUID_D, { limit: 2 }, { fetchFn: fn });
    expect(res.has_more).toBe(false);
    expect(res.messages).toHaveLength(2);
  });

  it("forwards offset to the URL", async () => {
    const existence = jsonResponse([{ id: VALID_UUID_D }]);
    const { fn, calls } = createMockFetch([existence, jsonResponse([])]);

    await listConversationMessages(VALID_UUID_D, { limit: 10, offset: 25 }, { fetchFn: fn });
    expect(calls[1].url).toContain("offset=25");
    expect(calls[1].url).toContain("limit=11");
  });
});
