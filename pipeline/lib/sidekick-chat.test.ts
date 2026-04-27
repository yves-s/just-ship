import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  validateChatRequest,
  processChat,
  ChatValidationError,
  ChatThreadBusyError,
  _resetChatThreadsForTests,
  _getChatThreadForTests,
  _internal,
  isSidekickReasoningEnabled,
  buildSidekickAllowedTools,
  type ChatEvent,
  type ChatSink,
  type ModelEvent,
  type ToolContextProvider,
} from "./sidekick-chat.ts";
import type { ToolContext } from "./sidekick-reasoning-tools.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Collect all events sent to a sink; honour the optional disconnect-after-N. */
function memorySink(opts: { disconnectAfter?: number } = {}): {
  sink: ChatSink;
  events: ChatEvent[];
  closed: () => boolean;
} {
  const events: ChatEvent[] = [];
  let open = true;
  let isClosed = false;
  const disconnectAfter = opts.disconnectAfter;
  return {
    events,
    closed: () => isClosed,
    sink: {
      send(event) {
        if (!open) return;
        events.push(event);
        if (disconnectAfter !== undefined && events.length >= disconnectAfter) {
          // Simulate a mid-stream client disconnect.
          open = false;
        }
      },
      isOpen() {
        return open;
      },
      close() {
        open = false;
        isClosed = true;
      },
    },
  };
}

/**
 * Mock the model runner with a fixed sequence of events. The stub respects
 * the AbortSignal so the disconnect test can observe cancellation.
 */
function mockModel(events: ModelEvent[]): {
  calls: number;
  lastSignalAborted: () => boolean;
  lastCtx: () => unknown;
} {
  let calls = 0;
  let lastSignal: AbortSignal | null = null;
  let lastCtx: unknown = undefined;
  vi.spyOn(_internal, "callChatModel").mockImplementation(async function* (_prompt, signal, ctx) {
    calls++;
    lastSignal = signal;
    lastCtx = ctx;
    for (const ev of events) {
      if (signal.aborted) return;
      yield ev;
    }
  });
  return {
    get calls() {
      return calls;
    },
    lastSignalAborted: () => lastSignal?.aborted ?? false,
    lastCtx: () => lastCtx,
  };
}

beforeEach(() => {
  _resetChatThreadsForTests();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// validateChatRequest
// ---------------------------------------------------------------------------

describe("validateChatRequest", () => {
  const base = { project_id: "proj-1", user_text: "hello" };

  it("accepts minimal request", () => {
    const v = validateChatRequest(base);
    expect(v.user_text).toBe("hello");
    expect(v.project_id).toBe("proj-1");
    expect(v.thread_id).toBeUndefined();
  });

  it("trims user_text and project_id", () => {
    const v = validateChatRequest({ user_text: "  hi  ", project_id: " p " });
    expect(v.user_text).toBe("hi");
    expect(v.project_id).toBe("p");
  });

  it("accepts thread_id", () => {
    const v = validateChatRequest({ ...base, thread_id: "t-1" });
    expect(v.thread_id).toBe("t-1");
  });

  it("accepts legacy conversation_id as thread_id", () => {
    const v = validateChatRequest({ ...base, conversation_id: "legacy-id" });
    expect(v.thread_id).toBe("legacy-id");
  });

  it("prefers thread_id over conversation_id when both are provided", () => {
    const v = validateChatRequest({ ...base, thread_id: "new", conversation_id: "legacy" });
    expect(v.thread_id).toBe("new");
  });

  it("rejects non-object body", () => {
    expect(() => validateChatRequest("nope")).toThrow(ChatValidationError);
    expect(() => validateChatRequest(null)).toThrow(ChatValidationError);
  });

  it("rejects missing user_text", () => {
    expect(() => validateChatRequest({ project_id: "p" })).toThrow(/user_text/);
  });

  it("rejects whitespace-only user_text", () => {
    expect(() => validateChatRequest({ project_id: "p", user_text: "   " })).toThrow(/user_text/);
  });

  it("rejects user_text over 16k chars", () => {
    const bigText = "x".repeat(16_001);
    expect(() => validateChatRequest({ project_id: "p", user_text: bigText })).toThrow(/<= 16000/);
  });

  it("rejects missing project_id", () => {
    expect(() => validateChatRequest({ user_text: "hi" })).toThrow(/project_id/);
  });

  it("rejects empty thread_id when provided", () => {
    expect(() => validateChatRequest({ ...base, thread_id: "   " })).toThrow(/thread_id/);
  });

  it("accepts valid attachments", () => {
    const v = validateChatRequest({
      ...base,
      attachments: [{ url: "https://cdn.example/img.png", mime: "image/png" }],
    });
    expect(v.attachments).toEqual([{ url: "https://cdn.example/img.png", mime: "image/png" }]);
  });

  it("rejects attachments over the limit", () => {
    const atts = Array.from({ length: 9 }, (_, i) => ({ url: `https://x/${i}` }));
    expect(() => validateChatRequest({ ...base, attachments: atts })).toThrow(/at most 8/);
  });

  it("rejects attachment without url", () => {
    expect(() => validateChatRequest({ ...base, attachments: [{ mime: "image/png" }] })).toThrow(/url/);
  });

  it("rejects attachment urls with non-http(s) schemes", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
    ]) {
      expect(() => validateChatRequest({ ...base, attachments: [{ url }] })).toThrow(/http\(s\)/);
    }
  });

  it("rejects relative / non-URL attachment urls", () => {
    for (const url of ["/relative/path.png", "img.png", "not a url"]) {
      expect(() => validateChatRequest({ ...base, attachments: [{ url }] })).toThrow(/valid absolute URL|http\(s\)/);
    }
  });

  it("accepts http and https attachment urls", () => {
    const a = validateChatRequest({ ...base, attachments: [{ url: "https://cdn.example/x.png" }] });
    const b = validateChatRequest({ ...base, attachments: [{ url: "http://cdn.example/x.png" }] });
    expect(a.attachments?.[0]?.url).toBe("https://cdn.example/x.png");
    expect(b.attachments?.[0]?.url).toBe("http://cdn.example/x.png");
  });

  it("accepts context", () => {
    const v = validateChatRequest({
      ...base,
      context: { page_url: "https://board.just-ship.io/t/1", page_title: "T-1" },
    });
    expect(v.context).toEqual({ page_url: "https://board.just-ship.io/t/1", page_title: "T-1" });
  });
});

// ---------------------------------------------------------------------------
// processChat — happy path
// ---------------------------------------------------------------------------

describe("processChat happy path", () => {
  it("streams delta events then a final message", async () => {
    mockModel([
      { kind: "text_delta", text: "Hello" },
      { kind: "text_delta", text: ", world" },
      { kind: "assistant_final", id: "msg-1", text: "Hello, world" },
    ]);

    const { sink, events, closed } = memorySink();
    await processChat(
      { user_text: "hi", project_id: "p-1" },
      sink,
      { signal: new AbortController().signal },
    );

    expect(events.filter(e => e.type === "delta").map(e => (e as any).text)).toEqual([
      "Hello",
      ", world",
    ]);
    const finalMsg = events.find(e => e.type === "message");
    expect(finalMsg).toBeDefined();
    expect((finalMsg as any).text).toBe("Hello, world");
    expect((finalMsg as any).id).toBe("msg-1");
    expect((finalMsg as any).thread_id).toBeTruthy();
    expect(closed()).toBe(true);
  });

  it("persists assistant reply in the thread store and reuses it across turns", async () => {
    // Turn 1 — create thread and assistant reply
    mockModel([{ kind: "assistant_final", id: "msg-1", text: "hi there" }]);
    const first = memorySink();
    await processChat(
      { user_text: "hello", project_id: "p-1" },
      first.sink,
      { signal: new AbortController().signal },
    );
    const finalEvent = first.events.find(e => e.type === "message")! as Extract<ChatEvent, { type: "message" }>;
    const threadId = finalEvent.thread_id;

    const stored = _getChatThreadForTests(threadId);
    expect(stored).toEqual([
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi there", id: "msg-1" },
    ]);

    // Turn 2 — echo thread_id, verify the history is preserved and grows
    vi.restoreAllMocks();
    mockModel([{ kind: "assistant_final", id: "msg-2", text: "follow-up" }]);
    const second = memorySink();
    await processChat(
      { user_text: "tell me more", project_id: "p-1", thread_id: threadId },
      second.sink,
      { signal: new AbortController().signal },
    );

    const storedAfter = _getChatThreadForTests(threadId);
    expect(storedAfter).toHaveLength(4);
    expect(storedAfter?.[2]).toEqual({ role: "user", text: "tell me more" });
    expect(storedAfter?.[3]?.role).toBe("assistant");
    expect(storedAfter?.[3]?.text).toBe("follow-up");
  });
});

// ---------------------------------------------------------------------------
// processChat — tool-call loop
// ---------------------------------------------------------------------------

describe("processChat tool-call loop", () => {
  it("emits tool_call, tool_result, delta, and final message in order", async () => {
    mockModel([
      { kind: "tool_use", id: "tu-1", name: "get_ticket", input: { number: 42 } },
      { kind: "tool_result", tool_use_id: "tu-1", result: { title: "Sample" } },
      { kind: "text_delta", text: "Ticket title: Sample" },
      { kind: "assistant_final", id: "msg-1", text: "Ticket title: Sample" },
    ]);

    const { sink, events } = memorySink();
    await processChat(
      { user_text: "what's T-42?", project_id: "p-1" },
      sink,
      { signal: new AbortController().signal },
    );

    const types = events.map(e => e.type);
    expect(types).toEqual(["tool_call", "tool_result", "delta", "message"]);

    const toolCall = events[0] as Extract<ChatEvent, { type: "tool_call" }>;
    expect(toolCall.id).toBe("tu-1");
    expect(toolCall.name).toBe("get_ticket");
    expect(toolCall.input).toEqual({ number: 42 });

    const toolResult = events[1] as Extract<ChatEvent, { type: "tool_result" }>;
    expect(toolResult.tool_use_id).toBe("tu-1");
    expect(toolResult.result).toEqual({ title: "Sample" });
  });

  it("surfaces tool_result with is_error=true when the tool failed", async () => {
    mockModel([
      { kind: "tool_use", id: "tu-x", name: "fetch", input: {} },
      { kind: "tool_result", tool_use_id: "tu-x", result: "boom", is_error: true },
      { kind: "assistant_final", id: "m", text: "sorry, the tool failed" },
    ]);

    const { sink, events } = memorySink();
    await processChat(
      { user_text: "try it", project_id: "p-1" },
      sink,
      { signal: new AbortController().signal },
    );
    const toolResult = events.find(e => e.type === "tool_result") as any;
    expect(toolResult.is_error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// processChat — disconnect handling
// ---------------------------------------------------------------------------

describe("processChat disconnect", () => {
  it("stops emitting events once the sink reports closed and skips final message", async () => {
    const model = mockModel([
      { kind: "text_delta", text: "A" },
      { kind: "text_delta", text: "B" },
      { kind: "text_delta", text: "C" },
      { kind: "assistant_final", id: "m", text: "ABC" },
    ]);

    // Simulate disconnect after 2 events delivered.
    const { sink, events } = memorySink({ disconnectAfter: 2 });
    await processChat(
      { user_text: "stream me", project_id: "p-1" },
      sink,
      { signal: new AbortController().signal },
    );

    // Client saw 2 deltas before disconnecting, and no final message.
    expect(events.length).toBe(2);
    expect(events.every(e => e.type === "delta")).toBe(true);
    expect(events.find(e => e.type === "message")).toBeUndefined();
    expect(model.calls).toBe(1);
  });

  it("respects an external abort signal — model runner stops early and no final message lands", async () => {
    // Model runner that checks the signal between each yield, mirroring the
    // real SDK adapter's behaviour.
    vi.spyOn(_internal, "callChatModel").mockImplementation(async function* (_p, signal) {
      const events: ModelEvent[] = [
        { kind: "text_delta", text: "1" },
        { kind: "text_delta", text: "2" },
        { kind: "assistant_final", id: "x", text: "12" },
      ];
      for (const ev of events) {
        if (signal.aborted) return;
        yield ev;
        // Yield microtask so the abort flip lands between events.
        await new Promise(r => setImmediate(r));
      }
    });

    const ctrl = new AbortController();
    const { sink, events } = memorySink();
    // Abort before kicking off — the runner will see signal.aborted on its
    // first loop iteration and return immediately.
    ctrl.abort();
    await processChat({ user_text: "x", project_id: "p-1" }, sink, { signal: ctrl.signal });

    // No events should have made it through, and certainly no final message.
    expect(events.find(e => e.type === "message")).toBeUndefined();
    expect(events.filter(e => e.type === "delta").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// processChat — error path
// ---------------------------------------------------------------------------

describe("processChat errors", () => {
  it("forwards a model error event and skips the final message", async () => {
    mockModel([
      { kind: "text_delta", text: "partial" },
      { kind: "error", message: "model_overloaded", code: "rate_limit" },
    ]);

    const { sink, events } = memorySink();
    await processChat(
      { user_text: "hi", project_id: "p-1" },
      sink,
      { signal: new AbortController().signal },
    );

    const err = events.find(e => e.type === "error") as any;
    expect(err).toBeDefined();
    expect(err.message).toBe("model_overloaded");
    expect(err.code).toBe("rate_limit");
    // No final message after an error — the transcript state is left pending.
    expect(events.find(e => e.type === "message")).toBeUndefined();
  });

  it("emits an internal_error event when the runner throws", async () => {
    vi.spyOn(_internal, "callChatModel").mockImplementation(async function* () {
      throw new Error("kaboom");
      // eslint-disable-next-line no-unreachable
      yield { kind: "assistant_final", id: "x", text: "" };
    });

    const { sink, events } = memorySink();
    await processChat(
      { user_text: "hi", project_id: "p-1" },
      sink,
      { signal: new AbortController().signal },
    );

    const err = events.find(e => e.type === "error") as any;
    expect(err).toBeDefined();
    expect(err.message).toBe("internal_error");
    expect(events.find(e => e.type === "message")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// processChat — attachment / context pass-through
// ---------------------------------------------------------------------------

describe("processChat pass-through", () => {
  it("passes attachments + context through to the model prompt", async () => {
    let capturedPrompt = "";
    vi.spyOn(_internal, "callChatModel").mockImplementation(async function* (prompt, _s) {
      capturedPrompt = prompt;
      yield { kind: "assistant_final", id: "m", text: "ok" };
    });

    const { sink } = memorySink();
    await processChat(
      {
        user_text: "what is this?",
        project_id: "p-1",
        attachments: [{ url: "https://cdn.example/screenshot.png", mime: "image/png" }],
        context: { page_url: "https://board.just-ship.io/t/42", page_title: "T-42" },
      },
      sink,
      { signal: new AbortController().signal },
    );

    expect(capturedPrompt).toContain("https://cdn.example/screenshot.png");
    expect(capturedPrompt).toContain("https://board.just-ship.io/t/42");
    expect(capturedPrompt).toContain("T-42");
  });
});

// ---------------------------------------------------------------------------
// processChat — cross-project isolation (security)
// ---------------------------------------------------------------------------

describe("processChat project isolation", () => {
  it("does not leak thread history when a different project supplies the same thread_id", async () => {
    // Turn 1 — project A creates a thread with secret content.
    mockModel([{ kind: "assistant_final", id: "a1", text: "secret content for project A" }]);
    const a = memorySink();
    await processChat(
      { user_text: "hello from A", project_id: "project-A" },
      a.sink,
      { signal: new AbortController().signal },
    );
    const aThreadId = (a.events.find(e => e.type === "message") as Extract<ChatEvent, { type: "message" }>).thread_id;

    // Turn 2 — project B tries to reuse A's thread_id. The server must NOT
    // splice A's history into B's prompt, and must issue a new thread_id.
    let capturedPrompt = "";
    vi.restoreAllMocks();
    vi.spyOn(_internal, "callChatModel").mockImplementation(async function* (prompt) {
      capturedPrompt = prompt;
      yield { kind: "assistant_final", id: "b1", text: "ok" };
    });
    const b = memorySink();
    await processChat(
      { user_text: "hello from B", project_id: "project-B", thread_id: aThreadId },
      b.sink,
      { signal: new AbortController().signal },
    );

    expect(capturedPrompt).not.toContain("secret content for project A");
    expect(capturedPrompt).not.toContain("hello from A");
    const bFinal = b.events.find(e => e.type === "message") as Extract<ChatEvent, { type: "message" }>;
    expect(bFinal.thread_id).not.toBe(aThreadId);

    // And A's thread must still exist untouched.
    const aStored = _getChatThreadForTests(aThreadId);
    expect(aStored).not.toBeNull();
    expect(aStored?.[0]?.text).toBe("hello from A");
  });
});

// ---------------------------------------------------------------------------
// processChat — concurrent-turn guard
// ---------------------------------------------------------------------------

describe("processChat concurrent-turn guard", () => {
  it("rejects a second overlapping request for the same thread_id with ChatThreadBusyError", async () => {
    // First call — seed a thread we can then hit concurrently.
    mockModel([{ kind: "assistant_final", id: "m1", text: "first" }]);
    const first = memorySink();
    await processChat(
      { user_text: "turn 1", project_id: "p-1" },
      first.sink,
      { signal: new AbortController().signal },
    );
    const threadId = (first.events.find(e => e.type === "message") as Extract<ChatEvent, { type: "message" }>).thread_id;

    // Now fire two turns against the same thread where the first one pauses
    // mid-stream (never yields its final event until we release it). The
    // second turn must throw before emitting anything on its own.
    vi.restoreAllMocks();
    let releaseFirst: (() => void) | null = null;
    const firstDone = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });

    vi.spyOn(_internal, "callChatModel").mockImplementation(async function* () {
      yield { kind: "text_delta", text: "..." };
      await firstDone;
      yield { kind: "assistant_final", id: "m2", text: "done" };
    });

    const slow = memorySink();
    const slowPromise = processChat(
      { user_text: "turn 2", project_id: "p-1", thread_id: threadId },
      slow.sink,
      { signal: new AbortController().signal },
    );

    // Give the first call a microtask to enter the loop and claim the lock.
    await new Promise(r => setImmediate(r));

    const racing = memorySink();
    await expect(
      processChat(
        { user_text: "turn 2 racer", project_id: "p-1", thread_id: threadId },
        racing.sink,
        { signal: new AbortController().signal },
      ),
    ).rejects.toBeInstanceOf(ChatThreadBusyError);

    // Release the first and clean up.
    releaseFirst!();
    await slowPromise;
  });

  it("releases the concurrent-turn lock on error so subsequent turns succeed", async () => {
    // Seed the thread.
    mockModel([{ kind: "assistant_final", id: "m1", text: "first" }]);
    const first = memorySink();
    await processChat(
      { user_text: "turn 1", project_id: "p-1" },
      first.sink,
      { signal: new AbortController().signal },
    );
    const threadId = (first.events.find(e => e.type === "message") as Extract<ChatEvent, { type: "message" }>).thread_id;

    // Turn that throws mid-stream. inFlight must be reset in the finally
    // block; otherwise the thread is permanently locked.
    vi.restoreAllMocks();
    vi.spyOn(_internal, "callChatModel").mockImplementation(async function* () {
      throw new Error("boom");
      // eslint-disable-next-line no-unreachable
      yield { kind: "assistant_final", id: "x", text: "" };
    });
    const errSink = memorySink();
    await processChat(
      { user_text: "turn 2", project_id: "p-1", thread_id: threadId },
      errSink.sink,
      { signal: new AbortController().signal },
    );
    expect(errSink.events.find(e => e.type === "error")).toBeDefined();

    // Third turn should succeed — the lock was released.
    vi.restoreAllMocks();
    mockModel([{ kind: "assistant_final", id: "m3", text: "recovered" }]);
    const third = memorySink();
    await processChat(
      { user_text: "turn 3", project_id: "p-1", thread_id: threadId },
      third.sink,
      { signal: new AbortController().signal },
    );
    expect((third.events.find(e => e.type === "message") as any).text).toBe("recovered");
  });
});

// ---------------------------------------------------------------------------
// processChat — orphaned user-turn rollback
// ---------------------------------------------------------------------------

describe("processChat rollback on failure", () => {
  it("does not leave the failed user turn in the thread transcript", async () => {
    // Turn 1 — succeed normally.
    mockModel([{ kind: "assistant_final", id: "m1", text: "ok" }]);
    const first = memorySink();
    await processChat(
      { user_text: "first", project_id: "p-1" },
      first.sink,
      { signal: new AbortController().signal },
    );
    const threadId = (first.events.find(e => e.type === "message") as Extract<ChatEvent, { type: "message" }>).thread_id;

    // Turn 2 — model errors, user turn must be rolled back.
    vi.restoreAllMocks();
    mockModel([
      { kind: "error", message: "upstream_overloaded", code: "rate_limit" },
    ]);
    const second = memorySink();
    await processChat(
      { user_text: "RETRY_ME", project_id: "p-1", thread_id: threadId },
      second.sink,
      { signal: new AbortController().signal },
    );

    const stored = _getChatThreadForTests(threadId);
    expect(stored?.map(m => m.text)).toEqual(["first", "ok"]);
    expect(stored?.some(m => m.text === "RETRY_ME")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reasoning-tools wiring (T-1020)
//
// The chat module's job is to forward a ToolContext from the HTTP handler
// to the model runner. The actual SDK call lives in `defaultModelRunner`
// — these tests stub `_internal.callChatModel` to verify the plumbing,
// not the SDK behaviour. The SDK behaviour is tested separately via the
// reasoning-tools registry (and the audit-runtime tests for run_expert_audit).
// ---------------------------------------------------------------------------

describe("isSidekickReasoningEnabled (T-1020 feature flag)", () => {
  const ORIG = process.env.SIDEKICK_REASONING_ENABLED;
  afterAll(() => {
    if (ORIG === undefined) delete process.env.SIDEKICK_REASONING_ENABLED;
    else process.env.SIDEKICK_REASONING_ENABLED = ORIG;
  });

  it("is off by default (production safety)", () => {
    delete process.env.SIDEKICK_REASONING_ENABLED;
    expect(isSidekickReasoningEnabled()).toBe(false);
  });

  it("recognises canonical truthy values", () => {
    for (const v of ["1", "true", "yes", "on", "TRUE", "Yes"]) {
      process.env.SIDEKICK_REASONING_ENABLED = v;
      expect(isSidekickReasoningEnabled()).toBe(true);
    }
  });

  it("treats other values as off", () => {
    for (const v of ["0", "false", "no", "off", "", "  "]) {
      process.env.SIDEKICK_REASONING_ENABLED = v;
      expect(isSidekickReasoningEnabled()).toBe(false);
    }
  });
});

describe("buildSidekickAllowedTools (T-1020)", () => {
  it("returns one MCP-prefixed entry per registry tool, never empty", () => {
    const allowed = buildSidekickAllowedTools();
    expect(allowed.length).toBeGreaterThan(0);
    for (const name of allowed) {
      expect(name.startsWith("mcp__sidekick__")).toBe(true);
    }
    // Spot-check: the eight reasoning tools must surface as allowedTools.
    expect(allowed).toContain("mcp__sidekick__create_ticket");
    expect(allowed).toContain("mcp__sidekick__update_thread_status");
    expect(allowed).toContain("mcp__sidekick__run_expert_audit");
  });
});

describe("processChat — toolContextProvider plumbing (T-1020)", () => {
  function makeProviderCtx(): ToolContext {
    return {
      apiUrl: "https://board.test.io",
      apiKey: "test-key",
      workspaceId: "00000000-0000-0000-0000-000000000001",
      projectId: "22222222-2222-2222-2222-222222222222",
      userId: "11111111-1111-1111-1111-111111111111",
      boardUrl: "https://board.test.io",
    };
  }

  it("forwards the provider's ToolContext to the model runner", async () => {
    const m = mockModel([{ kind: "assistant_final", id: "x", text: "ok" }]);
    const expectedCtx = makeProviderCtx();
    const provider: ToolContextProvider = () => expectedCtx;

    const { sink } = memorySink();
    await processChat(
      { user_text: "hi", project_id: "p-1" },
      sink,
      { signal: new AbortController().signal, toolContextProvider: provider },
    );

    expect(m.lastCtx()).toBe(expectedCtx);
  });

  it("passes null to the runner when no provider is configured (legacy path)", async () => {
    const m = mockModel([{ kind: "assistant_final", id: "x", text: "ok" }]);

    const { sink } = memorySink();
    await processChat(
      { user_text: "hi", project_id: "p-1" },
      sink,
      { signal: new AbortController().signal },
    );

    expect(m.lastCtx()).toBeNull();
  });

  it("treats a provider returning null as the legacy path", async () => {
    const m = mockModel([{ kind: "assistant_final", id: "x", text: "ok" }]);
    const provider: ToolContextProvider = () => null;

    const { sink } = memorySink();
    await processChat(
      { user_text: "hi", project_id: "p-1" },
      sink,
      { signal: new AbortController().signal, toolContextProvider: provider },
    );

    expect(m.lastCtx()).toBeNull();
  });

  it("falls back to legacy path and still completes the turn when the provider throws", async () => {
    const m = mockModel([{ kind: "assistant_final", id: "x", text: "ok" }]);
    const provider: ToolContextProvider = () => {
      throw new Error("creds resolution failed");
    };

    const { sink, events } = memorySink();
    await processChat(
      { user_text: "hi", project_id: "p-1" },
      sink,
      { signal: new AbortController().signal, toolContextProvider: provider },
    );

    expect(m.lastCtx()).toBeNull();
    // Crucially: the chat turn still ships a final message — a provider
    // failure must not break the user-facing path. Tools are best-effort.
    expect(events.find(e => e.type === "message")).toBeDefined();
  });

  it("supports an async provider", async () => {
    const m = mockModel([{ kind: "assistant_final", id: "x", text: "ok" }]);
    const expectedCtx = makeProviderCtx();
    const provider: ToolContextProvider = async () => {
      await new Promise((r) => setImmediate(r));
      return expectedCtx;
    };

    const { sink } = memorySink();
    await processChat(
      { user_text: "hi", project_id: "p-1" },
      sink,
      { signal: new AbortController().signal, toolContextProvider: provider },
    );

    expect(m.lastCtx()).toBe(expectedCtx);
  });
});
