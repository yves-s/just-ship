import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  validateChatRequest,
  processChat,
  ChatValidationError,
  _resetChatThreadsForTests,
  _getChatThreadForTests,
  _internal,
  type ChatEvent,
  type ChatSink,
  type ModelEvent,
} from "./sidekick-chat.ts";

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
function mockModel(events: ModelEvent[]): { calls: number; lastSignalAborted: () => boolean } {
  let calls = 0;
  let lastSignal: AbortSignal | null = null;
  vi.spyOn(_internal, "callChatModel").mockImplementation(async function* (_prompt, signal) {
    calls++;
    lastSignal = signal;
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
