import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  SIDEKICK_REASONING_TOOLS,
  executeSidekickReasoningTool,
  toolSchemas,
  listSidekickReasoningToolNames,
  zodToJsonSchema,
  CreateTicketSchema,
  CreateEpicSchema,
  CreateProjectSchema,
  StartConversationThreadSchema,
  RunExpertAuditSchema,
  ConsultExpertSchema,
  StartSparringSchema,
  EXPERT_SKILLS,
  type ToolContext,
} from "./sidekick-reasoning-tools.ts";

// ---------------------------------------------------------------------------
// Test env — threads-store uses supabase-rest which reads these env vars.
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
// Mock fetch — can script a queue of responses and inspect the calls made.
// Covers both Board API (artifact tools) and Supabase REST (thread tool).
// ---------------------------------------------------------------------------

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

interface ScriptedResponse {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
  throwMessage?: string;
}

function makeMockFetch(script: ScriptedResponse[]): {
  fn: typeof fetch;
  calls: RecordedCall[];
} {
  const queue = [...script];
  const calls: RecordedCall[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const rawBody = init?.body;
    const body = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    calls.push({ url, method, headers: { ...headers }, body });

    const next = queue.shift();
    if (!next) throw new Error(`mock fetch: no scripted response for ${method} ${url}`);
    if (next.throwMessage) throw new Error(next.throwMessage);

    return new Response(next.body !== undefined ? JSON.stringify(next.body) : null, {
      status: next.status ?? (next.ok === false ? 500 : 200),
      statusText: next.statusText ?? "OK",
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return { fn, calls };
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    apiUrl: "https://board.test.io",
    apiKey: "pipeline-key-abc",
    workspaceId: "00000000-0000-0000-0000-000000000001",
    projectId: "22222222-2222-2222-2222-222222222222",
    userId: "11111111-1111-1111-1111-111111111111",
    boardUrl: "https://board.test.io",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Registry + schema shape
// ---------------------------------------------------------------------------

describe("SIDEKICK_REASONING_TOOLS registry", () => {
  it("exposes the eight reasoning tools — seven from the plan plus update_thread_status (T-1020)", () => {
    const names = listSidekickReasoningToolNames();
    expect(names).toEqual([
      "create_ticket",
      "create_epic",
      "create_project",
      "start_conversation_thread",
      "update_thread_status",
      "run_expert_audit",
      "consult_expert",
      "start_sparring",
    ]);
    expect(Object.keys(SIDEKICK_REASONING_TOOLS)).toEqual(names);
  });

  it("every tool has a name, description, schema, and execute handler", () => {
    for (const name of listSidekickReasoningToolNames()) {
      const tool = SIDEKICK_REASONING_TOOLS[name];
      expect(tool.name).toBe(name);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.schema).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("exposes the eight expert skills as a stable enum", () => {
    // The plan explicitly names eight skills as the parameter surface.
    expect(EXPERT_SKILLS).toEqual([
      "design-lead",
      "product-cto",
      "backend",
      "frontend-design",
      "creative-design",
      "data-engineer",
      "ux-planning",
      "ticket-writer",
    ]);
  });
});

describe("toolSchemas() — Anthropic SDK tool-use payload", () => {
  it("emits JSON Schema objects the SDK can consume", () => {
    const schemas = toolSchemas();
    expect(schemas).toHaveLength(8);
    for (const s of schemas) {
      expect(typeof s.name).toBe("string");
      expect(typeof s.description).toBe("string");
      expect(s.input_schema).toMatchObject({
        type: "object",
        properties: expect.any(Object),
        additionalProperties: false,
      });
      // $schema must be stripped so the SDK's strict schema doesn't reject it.
      expect((s.input_schema as Record<string, unknown>).$schema).toBeUndefined();
    }
  });

  it("create_project requires `confirmed: true` as a literal", () => {
    const cp = toolSchemas().find((s) => s.name === "create_project");
    expect(cp).toBeDefined();
    const props = (cp!.input_schema as { properties: Record<string, unknown> }).properties;
    expect(props.confirmed).toEqual({ type: "boolean", const: true });
    expect(
      ((cp!.input_schema as { required?: string[] }).required ?? []),
    ).toContain("confirmed");
  });

  it("create_epic schema has no project_id field on tool surface (T-1049)", () => {
    // Cross-project epics are no longer reachable from the Page-Sidekick tool
    // surface — project_id is server-stamped via ctx.projectId. The validator
    // for cross-project epics (validateCreateRequest) is preserved as a
    // library function for a future workspace-scoped Sidekick tool.
    const ep = toolSchemas().find((s) => s.name === "create_epic");
    expect(ep).toBeDefined();
    const props = (ep!.input_schema as { properties: Record<string, unknown> }).properties;
    expect(props.project_id).toBeUndefined();
  });

  it("run_expert_audit constrains expert_skill to the eight-value enum", () => {
    const audit = toolSchemas().find((s) => s.name === "run_expert_audit");
    const props = (audit!.input_schema as { properties: Record<string, unknown> }).properties;
    expect(props.expert_skill).toMatchObject({ type: "string", enum: EXPERT_SKILLS });
  });
});

// ---------------------------------------------------------------------------
// Direct Zod schema validation — proves the schemas reject obviously-wrong
// inputs so the tool-use loop sees invalid_args before hitting I/O.
// ---------------------------------------------------------------------------

describe("Zod schemas reject invalid inputs", () => {
  it("CreateTicketSchema rejects missing title", () => {
    expect(CreateTicketSchema.safeParse({ body: "x", project_id: "p" }).success).toBe(false);
  });

  it("CreateEpicSchema rejects an empty children array", () => {
    expect(
      CreateEpicSchema.safeParse({
        title: "Epic",
        body: "body",
        children: [],
        project_id: "p",
      }).success,
    ).toBe(false);
  });

  it("CreateProjectSchema rejects confirmed=false", () => {
    expect(
      CreateProjectSchema.safeParse({
        name: "X",
        description: "Y",
        workspace_id: "w",
        confirmed: false,
      }).success,
    ).toBe(false);
  });

  it("RunExpertAuditSchema rejects an unknown expert skill", () => {
    expect(
      RunExpertAuditSchema.safeParse({
        scope: "Mobile",
        expert_skill: "marketing-lead",
        project_id: "p",
      }).success,
    ).toBe(false);
  });

  it("ConsultExpertSchema rejects an empty question", () => {
    expect(
      ConsultExpertSchema.safeParse({
        question: "   ",
        expert_skill: "design-lead",
        project_id: "p",
      }).success,
    ).toBe(false);
  });

  it("StartSparringSchema rejects zero experts", () => {
    expect(
      StartSparringSchema.safeParse({
        topic: "Roadmap",
        experts: [],
        project_id: "p",
      }).success,
    ).toBe(false);
  });

  it("StartConversationThreadSchema rejects missing initial_context", () => {
    expect(
      StartConversationThreadSchema.safeParse({
        topic: "Idea",
        project_id: "p",
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// executeSidekickReasoningTool — dispatch + validation layer
// ---------------------------------------------------------------------------

describe("executeSidekickReasoningTool", () => {
  it("returns unknown_tool for an unregistered name", async () => {
    const ctx = makeCtx({ fetchFn: makeMockFetch([]).fn });
    const res = await executeSidekickReasoningTool("nope", ctx, {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("unknown_tool");
  });

  it("returns invalid_args for schema-violating input without calling fetch", async () => {
    const { fn, calls } = makeMockFetch([]);
    const ctx = makeCtx({ fetchFn: fn });
    const res = await executeSidekickReasoningTool("create_ticket", ctx, { title: "" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_args");
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Artifact tools
// ---------------------------------------------------------------------------

describe("create_ticket", () => {
  it("creates a ticket via the Board API and returns a shaped result (happy path)", async () => {
    const { fn, calls } = makeMockFetch([
      {
        body: {
          data: { id: "t-uuid-1", number: 999, title: "Fix header typo" },
        },
      },
    ]);
    const ctx = makeCtx({ fetchFn: fn });
    const res = await executeSidekickReasoningTool("create_ticket", ctx, {
      title: "Fix header typo",
      body: "Typo on homepage header",
      priority: "medium",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result).toMatchObject({
        number: 999,
        id: "t-uuid-1",
        title: "Fix header typo",
        url: "https://board.test.io/t/999",
      });
    }
    expect(calls[0].url).toBe("https://board.test.io/api/tickets");
    expect(calls[0].headers["X-Pipeline-Key"]).toBe("pipeline-key-abc");
    // T-1049: project_id is server-stamped from ctx, not passed in args.
    expect((calls[0].body as { project_id: string }).project_id).toBe(ctx.projectId);
  });

  it("returns a board_400 failure when the Board API rejects the request (error path)", async () => {
    const { fn } = makeMockFetch([
      { ok: false, status: 400, statusText: "Bad Request", body: { error: "invalid" } },
    ]);
    const ctx = makeCtx({ fetchFn: fn });
    const res = await executeSidekickReasoningTool("create_ticket", ctx, {
      title: "X",
      body: "Y",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("board_400");
  });
});

describe("create_epic", () => {
  it("creates an epic + children in parallel and returns shaped results", async () => {
    const { fn, calls } = makeMockFetch([
      // Epic row
      { body: { data: { id: "ep-1", number: 100, title: "Feature X" } } },
      // Children — `Promise.allSettled` fans out; ordering via our queue matches
      // the fan-out order because the mock is FIFO and the handler awaits all.
      { body: { data: { id: "c-1", number: 101, title: "Child A" } } },
      { body: { data: { id: "c-2", number: 102, title: "Child B" } } },
    ]);
    const ctx = makeCtx({ fetchFn: fn });
    const res = await executeSidekickReasoningTool("create_epic", ctx, {
      title: "Feature X",
      body: "Container",
      children: [
        { title: "Child A", body: "A body" },
        { title: "Child B", body: "B body" },
      ],
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const result = res.result as {
        epic: { number: number };
        children: { number: number }[];
      };
      expect(result.epic.number).toBe(100);
      expect(result.children.map((c) => c.number)).toEqual([101, 102]);
    }
    // Epic call carries ticket_type: "epic" to satisfy the board CHECK branch.
    expect((calls[0].body as { ticket_type?: string }).ticket_type).toBe("epic");
    // T-1049: epic body carries the server-stamped project_id from ctx.
    expect((calls[0].body as { project_id?: string }).project_id).toBe(ctx.projectId);
  });

  // T-1049 deletes the previous "workspace-scoped epic without per-child
  // project_ids" test: cross-project epics are no longer reachable from the
  // Page-Sidekick tool surface. The underlying validateCreateRequest invariant
  // (T-903) is preserved as a library function and is exercised in
  // sidekick-create.test.ts.
});

describe("create_project", () => {
  it("creates project + init-epic + 3 child tickets when confirmed (happy path)", async () => {
    const { fn, calls } = makeMockFetch([
      // Project row
      { body: { data: { id: "prj-1", name: "Aime Coach", slug: "aime-coach" } } },
      // Init epic
      { body: { data: { id: "ep-1", number: 500, title: "[Epic] Projekt-Grundgeruest Aime Coach" } } },
      // 3 children (in parallel — queue order matches fan-out order)
      { body: { data: { id: "c-1", number: 501, title: "Projekt-Scope klären: Aime Coach" } } },
      { body: { data: { id: "c-2", number: 502, title: "Tech-Stack-Entscheidung: Aime Coach" } } },
      { body: { data: { id: "c-3", number: 503, title: "Erste User-Journey bauen: Aime Coach" } } },
    ]);
    const ctx = makeCtx({ fetchFn: fn });
    const res = await executeSidekickReasoningTool("create_project", ctx, {
      name: "Aime Coach",
      description: "AI accountability coach for therapists",
      workspace_id: "ws-1",
      confirmed: true,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const r = res.result as {
        project: { slug: string };
        epic: { number: number };
        children: { number: number }[];
      };
      expect(r.project.slug).toBe("aime-coach");
      expect(r.epic.number).toBe(500);
      expect(r.children).toHaveLength(3);
    }
    expect(calls[0].url).toBe("https://board.test.io/api/projects");
  });

  it("rejects confirmed=false at the schema layer without any API call (error path)", async () => {
    const { fn, calls } = makeMockFetch([]);
    const ctx = makeCtx({ fetchFn: fn });
    const res = await executeSidekickReasoningTool("create_project", ctx, {
      name: "New",
      description: "Idea",
      workspace_id: "ws-1",
      confirmed: false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_args");
    expect(calls).toHaveLength(0);
  });
});

describe("start_conversation_thread", () => {
  it("inserts a thread row via Supabase REST and returns a shaped result (happy path)", async () => {
    const row = {
      id: "th-uuid-1",
      workspace_id: "00000000-0000-0000-0000-000000000001",
      project_id: "22222222-2222-2222-2222-222222222222",
      user_id: "11111111-1111-1111-1111-111111111111",
      title: "Analytics idea",
      status: "draft",
      classification: null,
      pending_questions: [{ role: "user", content: "Rough idea" }],
      last_activity_at: "2026-04-23T00:00:00Z",
      created_at: "2026-04-23T00:00:00Z",
    };
    const { fn, calls } = makeMockFetch([{ body: row }]);
    const ctx = makeCtx({ fetchFn: fn });

    const res = await executeSidekickReasoningTool("start_conversation_thread", ctx, {
      topic: "Analytics idea",
      initial_context: "Rough idea — not sure if we need it",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result).toMatchObject({
        id: "th-uuid-1",
        status: "draft",
        title: "Analytics idea",
        url: "https://board.test.io/threads/th-uuid-1",
      });
    }
    // Call goes to Supabase REST, not Board API.
    expect(calls[0].url).toBe(`${TEST_SUPABASE_URL}/rest/v1/threads?select=*`);
    expect(calls[0].headers.apikey).toBe(TEST_SUPABASE_KEY);
    // T-1049: thread row carries ctx.projectId, not args.project_id.
    expect((calls[0].body as { project_id: string }).project_id).toBe(ctx.projectId);
  });

  it("returns not_authenticated when ctx.userId is missing (error path)", async () => {
    const { fn, calls } = makeMockFetch([]);
    const ctx = makeCtx({ fetchFn: fn });
    delete (ctx as { userId?: string }).userId;

    const res = await executeSidekickReasoningTool("start_conversation_thread", ctx, {
      topic: "Idea",
      initial_context: "rough thought",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("not_authenticated");
    expect(calls).toHaveLength(0);
  });

  it("returns invalid_args when ctx.workspaceId is not a UUID (error path)", async () => {
    const { fn, calls } = makeMockFetch([]);
    const ctx = makeCtx({ fetchFn: fn, workspaceId: "not-a-uuid" });

    const res = await executeSidekickReasoningTool("start_conversation_thread", ctx, {
      topic: "Idea",
      initial_context: "rough thought",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_args");
    expect(calls).toHaveLength(0);
  });

  it("returns invalid_args when ctx.userId is not a UUID (error path)", async () => {
    const { fn, calls } = makeMockFetch([]);
    const ctx = makeCtx({ fetchFn: fn, userId: "not-a-uuid" });

    const res = await executeSidekickReasoningTool("start_conversation_thread", ctx, {
      topic: "Idea",
      initial_context: "rough thought",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_args");
    expect(calls).toHaveLength(0);
  });

  it("returns invalid_args when ctx.projectId is not a UUID (error path)", async () => {
    // T-1049: project_id is now sourced from ctx.projectId (server-stamped),
    // not from tool args. The UUID guard at the tool boundary checks ctx.
    const { fn, calls } = makeMockFetch([]);
    const ctx = makeCtx({ fetchFn: fn, projectId: "not-a-uuid" });

    const res = await executeSidekickReasoningTool("start_conversation_thread", ctx, {
      topic: "Idea",
      initial_context: "rough thought",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_args");
    expect(calls).toHaveLength(0);
  });

  it("passes an empty pending_questions array on creation (no user-message leak)", async () => {
    const row = {
      id: "th-uuid-2",
      workspace_id: "00000000-0000-0000-0000-000000000001",
      project_id: "22222222-2222-2222-2222-222222222222",
      user_id: "11111111-1111-1111-1111-111111111111",
      title: "Analytics idea",
      status: "draft",
      classification: null,
      pending_questions: [],
      last_activity_at: "2026-04-23T00:00:00Z",
      created_at: "2026-04-23T00:00:00Z",
    };
    const { fn, calls } = makeMockFetch([{ body: row }]);
    const ctx = makeCtx({ fetchFn: fn });

    const res = await executeSidekickReasoningTool("start_conversation_thread", ctx, {
      topic: "Analytics idea",
      initial_context: "Rough idea — not sure if we need it",
    });

    expect(res.ok).toBe(true);
    const body = calls[0].body as { pending_questions: unknown };
    expect(body.pending_questions).toEqual([]);
  });
});

describe("update_thread_status (T-1020)", () => {
  const THREAD_ID = "33333333-3333-3333-3333-333333333333";
  const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

  it("transitions a thread from draft → ready_to_plan when the workspace owns it (happy path)", async () => {
    const draftRow = {
      id: THREAD_ID,
      workspace_id: WORKSPACE_ID,
      project_id: "22222222-2222-2222-2222-222222222222",
      user_id: "11111111-1111-1111-1111-111111111111",
      title: "Analytics idea",
      status: "draft",
      classification: null,
      pending_questions: [],
      last_activity_at: "2026-04-23T00:00:00Z",
      created_at: "2026-04-23T00:00:00Z",
    };
    const updatedRow = { ...draftRow, status: "ready_to_plan" };
    // First call = getThread; second call = getThread again (transition validation reads current),
    // third call = PATCH. We need to script enough fetches to cover both store calls.
    const { fn, calls } = makeMockFetch([
      { body: [draftRow] },          // getThread (initial fetch in tool handler)
      { body: [draftRow] },          // getThread inside updateThread (transition check)
      { body: [updatedRow] },        // PATCH response
    ]);
    const ctx = makeCtx({ fetchFn: fn });

    const res = await executeSidekickReasoningTool("update_thread_status", ctx, {
      thread_id: THREAD_ID,
      status: "ready_to_plan",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result).toMatchObject({
        id: THREAD_ID,
        status: "ready_to_plan",
        previous_status: "draft",
      });
    }
    // Last call must be the PATCH against the threads endpoint.
    expect(calls.at(-1)?.method).toBe("PATCH");
    expect(calls.at(-1)?.url).toContain(`/rest/v1/threads?id=eq.${encodeURIComponent(THREAD_ID)}`);
  });

  it("rejects cross-workspace status updates with `forbidden` (security)", async () => {
    const foreignRow = {
      id: THREAD_ID,
      workspace_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      project_id: "22222222-2222-2222-2222-222222222222",
      user_id: "11111111-1111-1111-1111-111111111111",
      title: "Foreign thread",
      status: "draft",
      classification: null,
      pending_questions: [],
      last_activity_at: "2026-04-23T00:00:00Z",
      created_at: "2026-04-23T00:00:00Z",
    };
    const { fn, calls } = makeMockFetch([{ body: [foreignRow] }]);
    const ctx = makeCtx({ fetchFn: fn });

    const res = await executeSidekickReasoningTool("update_thread_status", ctx, {
      thread_id: THREAD_ID,
      status: "ready_to_plan",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("forbidden");
    // Crucially: no PATCH was issued. The only call was the GET.
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("returns thread_not_found when the thread does not exist", async () => {
    const { fn } = makeMockFetch([{ body: [] }]); // empty rows = ThreadNotFoundError
    const ctx = makeCtx({ fetchFn: fn });

    const res = await executeSidekickReasoningTool("update_thread_status", ctx, {
      thread_id: THREAD_ID,
      status: "ready_to_plan",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("thread_not_found");
  });

  it("returns invalid_transition when the requested status is not allowed from current", async () => {
    // closed → anything is forbidden by the transition map.
    const closedRow = {
      id: THREAD_ID,
      workspace_id: WORKSPACE_ID,
      project_id: "22222222-2222-2222-2222-222222222222",
      user_id: "11111111-1111-1111-1111-111111111111",
      title: "Closed thread",
      status: "closed",
      classification: null,
      pending_questions: [],
      last_activity_at: "2026-04-23T00:00:00Z",
      created_at: "2026-04-23T00:00:00Z",
    };
    const { fn } = makeMockFetch([
      { body: [closedRow] }, // getThread (handler)
      { body: [closedRow] }, // getThread inside updateThread → triggers ThreadTransitionError
    ]);
    const ctx = makeCtx({ fetchFn: fn });

    const res = await executeSidekickReasoningTool("update_thread_status", ctx, {
      thread_id: THREAD_ID,
      status: "draft",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_transition");
  });

  it("rejects invalid_args when thread_id is not a UUID", async () => {
    const { fn, calls } = makeMockFetch([]);
    const ctx = makeCtx({ fetchFn: fn });

    const res = await executeSidekickReasoningTool("update_thread_status", ctx, {
      thread_id: "not-a-uuid",
      status: "ready_to_plan",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_args");
    expect(calls).toHaveLength(0);
  });

  it("rejects invalid_args when status is not in the THREAD_STATUSES enum", async () => {
    const { fn, calls } = makeMockFetch([]);
    const ctx = makeCtx({ fetchFn: fn });

    const res = await executeSidekickReasoningTool("update_thread_status", ctx, {
      thread_id: THREAD_ID,
      status: "shipped", // not a valid status
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_args");
    expect(calls).toHaveLength(0);
  });

  it("short-circuits to a no-op success when the thread is already in the requested status", async () => {
    const draftRow = {
      id: THREAD_ID,
      workspace_id: WORKSPACE_ID,
      project_id: "22222222-2222-2222-2222-222222222222",
      user_id: "11111111-1111-1111-1111-111111111111",
      title: "Already draft",
      status: "draft",
      classification: null,
      pending_questions: [],
      last_activity_at: "2026-04-23T00:00:00Z",
      created_at: "2026-04-23T00:00:00Z",
    };
    const { fn, calls } = makeMockFetch([{ body: [draftRow] }]);
    const ctx = makeCtx({ fetchFn: fn });

    const res = await executeSidekickReasoningTool("update_thread_status", ctx, {
      thread_id: THREAD_ID,
      status: "draft",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result).toMatchObject({
        id: THREAD_ID,
        status: "draft",
        previous_status: "draft",
      });
    }
    // No PATCH was issued — short-circuit avoids unnecessary writes (and
    // keeps the model out of a retry loop on a redundant tool call).
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Expert tools
//
// - `run_expert_audit` is wired to the real runtime as of T-985. Its
//   happy-path + runtime behavior lives in `audit-runtime.test.ts`
//   (with SDK injection via `queryFn`). Here we only verify the tool
//   registry's validation surface — the bits that must reject bad input
//   BEFORE any runtime call happens.
// - `consult_expert` and `start_sparring` still return a stable
//   `expert_runtime_not_implemented` failure (they land in follow-up
//   tickets). We keep their stub coverage here until their runtimes ship.
// ---------------------------------------------------------------------------

describe("expert tools — tool-layer validation", () => {
  it("run_expert_audit rejects invalid_args for an empty scope", async () => {
    const { fn, calls } = makeMockFetch([]);
    const ctx = makeCtx({ fetchFn: fn });
    const res = await executeSidekickReasoningTool("run_expert_audit", ctx, {
      scope: "",
      expert_skill: "design-lead",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_args");
    expect(calls).toHaveLength(0);
  });

  it("run_expert_audit rejects invalid_args for an unknown expert_skill", async () => {
    const { fn, calls } = makeMockFetch([]);
    const ctx = makeCtx({ fetchFn: fn });
    const res = await executeSidekickReasoningTool("run_expert_audit", ctx, {
      scope: "Mobile Experience",
      expert_skill: "cto-principal",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_args");
    expect(calls).toHaveLength(0);
  });

  it("consult_expert returns expert_runtime_not_implemented (happy path — stub)", async () => {
    const ctx = makeCtx({ fetchFn: makeMockFetch([]).fn });
    const res = await executeSidekickReasoningTool("consult_expert", ctx, {
      question: "How should we structure the auth token refresh?",
      expert_skill: "product-cto",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("expert_runtime_not_implemented");
  });

  it("consult_expert rejects invalid_args when expert_skill is unknown (error path)", async () => {
    const { fn, calls } = makeMockFetch([]);
    const ctx = makeCtx({ fetchFn: fn });
    const res = await executeSidekickReasoningTool("consult_expert", ctx, {
      question: "Q",
      expert_skill: "cto-principal",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_args");
    expect(calls).toHaveLength(0);
  });

  it("start_sparring returns expert_runtime_not_implemented (happy path — stub)", async () => {
    const ctx = makeCtx({ fetchFn: makeMockFetch([]).fn });
    const res = await executeSidekickReasoningTool("start_sparring", ctx, {
      topic: "Pricing strategy",
      experts: ["design-lead", "product-cto"],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("expert_runtime_not_implemented");
  });

  it("start_sparring rejects invalid_args for more than 4 experts (error path)", async () => {
    const { fn, calls } = makeMockFetch([]);
    const ctx = makeCtx({ fetchFn: fn });
    const res = await executeSidekickReasoningTool("start_sparring", ctx, {
      topic: "Topic",
      experts: [
        "design-lead",
        "product-cto",
        "backend",
        "frontend-design",
        "data-engineer",
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_args");
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// zodToJsonSchema — strips the $schema draft URI so the Anthropic SDK's
// strict tool-schema validator doesn't reject the payload.
// ---------------------------------------------------------------------------

describe("zodToJsonSchema", () => {
  it("strips $schema meta key from Zod's native JSON Schema output", () => {
    const out = zodToJsonSchema(CreateTicketSchema);
    expect(out.$schema).toBeUndefined();
    expect(out.type).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// T-1049 — Schema project_id stripping (backward compatibility)
//
// The five "stempelbaren" tools (create_ticket, create_epic,
// start_conversation_thread, run_expert_audit, consult_expert,
// start_sparring) no longer expose project_id on the tool surface. Zod's
// default `.strip()` mode silently drops the field if a legacy caller
// (e.g. conversation history with old tool_use blocks) still passes it.
// These tests document the contract: legacy args are tolerated, never
// rejected with a ZodError.
// ---------------------------------------------------------------------------

describe("Schema project_id stripping (T-1049 backward compat)", () => {
  it("CreateTicketSchema strips legacy project_id", () => {
    const parsed = CreateTicketSchema.parse({
      title: "x",
      body: "y",
      project_id: "00000000-0000-0000-0000-000000000000",
    });
    expect((parsed as Record<string, unknown>).project_id).toBeUndefined();
    expect(parsed.title).toBe("x");
  });

  it("CreateEpicSchema strips legacy project_id (top-level + children)", () => {
    const parsed = CreateEpicSchema.parse({
      title: "x",
      body: "y",
      children: [{
        title: "c1",
        body: "b1",
        project_id: "11111111-1111-1111-1111-111111111111",
      }],
      project_id: "00000000-0000-0000-0000-000000000000",
    });
    expect((parsed as Record<string, unknown>).project_id).toBeUndefined();
    expect((parsed.children[0] as Record<string, unknown>).project_id).toBeUndefined();
  });

  it("StartConversationThreadSchema strips legacy project_id", () => {
    const parsed = StartConversationThreadSchema.parse({
      topic: "x",
      initial_context: "y",
      project_id: "00000000-0000-0000-0000-000000000000",
    });
    expect((parsed as Record<string, unknown>).project_id).toBeUndefined();
  });

  it("RunExpertAuditSchema strips legacy project_id", () => {
    const parsed = RunExpertAuditSchema.parse({
      scope: "x",
      expert_skill: "design-lead",
      project_id: "00000000-0000-0000-0000-000000000000",
    });
    expect((parsed as Record<string, unknown>).project_id).toBeUndefined();
  });

  it("ConsultExpertSchema strips legacy project_id", () => {
    const parsed = ConsultExpertSchema.parse({
      question: "x",
      expert_skill: "design-lead",
      project_id: "00000000-0000-0000-0000-000000000000",
    });
    expect((parsed as Record<string, unknown>).project_id).toBeUndefined();
  });

  it("StartSparringSchema strips legacy project_id", () => {
    const parsed = StartSparringSchema.parse({
      topic: "x",
      experts: ["design-lead"],
      project_id: "00000000-0000-0000-0000-000000000000",
    });
    expect((parsed as Record<string, unknown>).project_id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T-1049 — Handler stamps ctx.projectId
//
// The five project-scoped artifact handlers attach project_id from
// ctx.projectId (server-stamped) onto the outgoing Board API / threads-store
// request. The model never writes a project_id; the field is invisible on
// the tool surface.
// ---------------------------------------------------------------------------

describe("Handler stamps ctx.projectId (T-1049)", () => {
  const ACTIVE_PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  it("execCreateTicket stamps ctx.projectId, ignores legacy args.project_id", async () => {
    const { fn, calls } = makeMockFetch([
      { body: { data: { id: "t-1", number: 1, title: "Fix typo" } } },
    ]);
    const ctx = makeCtx({ projectId: ACTIVE_PROJECT, fetchFn: fn });
    // Legacy callers may still ship `project_id` in args (Zod strips it).
    // Even when supplied, the handler stamps ctx.projectId on the outgoing
    // Board request — never the legacy arg.
    const result = await executeSidekickReasoningTool("create_ticket", ctx, {
      title: "Fix typo",
      body: "details",
      project_id: "legacy-from-history",
    });
    expect(result.ok).toBe(true);
    const body = calls[0]!.body as { project_id: string };
    expect(body.project_id).toBe(ACTIVE_PROJECT);
  });

  it("execCreateEpic stamps ctx.projectId on the epic, no per-child project_id", async () => {
    const { fn, calls } = makeMockFetch([
      { body: { data: { id: "ep-1", number: 100, title: "Notifications" } } },
      { body: { data: { id: "c-1", number: 101, title: "Bell" } } },
    ]);
    const ctx = makeCtx({ projectId: ACTIVE_PROJECT, fetchFn: fn });
    const result = await executeSidekickReasoningTool("create_epic", ctx, {
      title: "Notifications",
      body: "epic body",
      children: [{ title: "Bell", body: "child body" }],
    });
    expect(result.ok).toBe(true);
    // Epic body carries ctx.projectId.
    const epicBody = calls[0]!.body as { project_id: string; ticket_type?: string };
    expect(epicBody.project_id).toBe(ACTIVE_PROJECT);
    // The Board's `createFromClassification` primitive propagates project_id
    // from the epic to each child row, so children also land in the active
    // project. The tool no longer accepts a per-child project_id on the
    // surface — children inherit ctx.projectId uniformly.
    const childBody = calls[1]!.body as { project_id: string };
    expect(childBody.project_id).toBe(ACTIVE_PROJECT);
  });

  it("execStartConversationThread stamps ctx.projectId on the thread row", async () => {
    const row = {
      id: "th-1",
      workspace_id: "00000000-0000-0000-0000-000000000001",
      project_id: ACTIVE_PROJECT,
      user_id: "11111111-1111-1111-1111-111111111111",
      title: "Idea",
      status: "draft",
      classification: null,
      pending_questions: [],
      last_activity_at: "2026-04-23T00:00:00Z",
      created_at: "2026-04-23T00:00:00Z",
    };
    const { fn, calls } = makeMockFetch([{ body: row }]);
    const ctx = makeCtx({ projectId: ACTIVE_PROJECT, fetchFn: fn });
    const result = await executeSidekickReasoningTool("start_conversation_thread", ctx, {
      topic: "Idea",
      initial_context: "rough",
    });
    expect(result.ok).toBe(true);
    const body = calls[0]!.body as { project_id: string };
    expect(body.project_id).toBe(ACTIVE_PROJECT);
  });
});
