import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  validateConverseRequest,
  parseModelResponse,
  processTurn,
  _resetSessionsForTests,
  _internal,
  FORBIDDEN_QUESTION_TOPICS,
  SessionBusyError,
  type ConverseRequest,
  type ConverseResponse,
} from "./sidekick-converse.ts";
import { ValidationError, type BoardClientConfig } from "./sidekick-create.ts";

// ---------------------------------------------------------------------------
// Fetch mock (board API for artifact creation)
// ---------------------------------------------------------------------------

function ticketRow(number: number, title = "auto-title") {
  return { data: { id: `id-${number}`, number, title } };
}

function mockFetchCreatesTickets(): { fetch: typeof fetch; callCount: () => number } {
  let n = 500;
  let callCount = 0;
  const fetchFn: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    callCount++;
    if (url.endsWith("/api/tickets")) {
      const row = ticketRow(n++);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() { return row; },
        async text() { return JSON.stringify(row); },
      } as unknown as Response;
    }
    throw new Error(`unexpected fetch to ${url}`);
  };
  return { fetch: fetchFn, callCount: () => callCount };
}

function cfgWith(fetchFn: typeof fetch): BoardClientConfig {
  return { apiUrl: "https://board.test", apiKey: "pk-test", fetchFn };
}

// ---------------------------------------------------------------------------
// Model mock — we spy on _internal.callModel so we don't hit the SDK
// ---------------------------------------------------------------------------

function mockModelResponses(...outputs: string[]): void {
  let i = 0;
  vi.spyOn(_internal, "callModel").mockImplementation(async () => {
    const out = outputs[i] ?? outputs[outputs.length - 1];
    i++;
    return out;
  });
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetSessionsForTests();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// validateConverseRequest
// ---------------------------------------------------------------------------

describe("validateConverseRequest", () => {
  const base = { project_id: "proj-1", user_text: "hi" };

  it("accepts a minimal first-turn request", () => {
    const v = validateConverseRequest(base);
    expect(v.project_id).toBe("proj-1");
    expect(v.user_text).toBe("hi");
    expect(v.session_id).toBeUndefined();
  });

  it("accepts a follow-up with session_id", () => {
    const v = validateConverseRequest({ ...base, session_id: "s-1" });
    expect(v.session_id).toBe("s-1");
  });

  it("rejects non-object body", () => {
    expect(() => validateConverseRequest("not json")).toThrow(ValidationError);
  });

  it("rejects empty user_text", () => {
    expect(() => validateConverseRequest({ ...base, user_text: "   " })).toThrow(/user_text/);
  });

  it("rejects user_text over 4000 chars", () => {
    expect(() => validateConverseRequest({ ...base, user_text: "x".repeat(4001) })).toThrow(/<= 4000/);
  });

  it("rejects missing project_id", () => {
    expect(() => validateConverseRequest({ user_text: "hi" })).toThrow(/project_id/);
  });

  it("rejects empty session_id if provided", () => {
    expect(() => validateConverseRequest({ ...base, session_id: "" })).toThrow(/session_id/);
  });

  it("rejects malformed project_context", () => {
    expect(() => validateConverseRequest({ ...base, project_context: "nope" })).toThrow(/project_context/);
  });

  it("trims whitespace on all string fields", () => {
    const v = validateConverseRequest({ project_id: "  p  ", user_text: "  hi  ", session_id: "  s  " });
    expect(v.project_id).toBe("p");
    expect(v.user_text).toBe("hi");
    expect(v.session_id).toBe("s");
  });
});

// ---------------------------------------------------------------------------
// parseModelResponse
// ---------------------------------------------------------------------------

describe("parseModelResponse", () => {
  it("parses a question response", () => {
    const p = parseModelResponse(`{"kind":"question","text":"Für wen genau?"}`);
    expect(p.kind).toBe("question");
    if (p.kind === "question") expect(p.text).toBe("Für wen genau?");
  });

  it("tolerates surrounding prose and code fences", () => {
    const p = parseModelResponse("Here you go:\n```json\n{\"kind\":\"question\",\"text\":\"ok?\"}\n```\n");
    expect(p.kind).toBe("question");
  });

  it("parses a ticket finalize", () => {
    const raw = JSON.stringify({
      kind: "finalize",
      text: "Alles klar. Ich lege ein Ticket an.",
      artifact: { kind: "ticket", title: "T", body: "## Problem\nX" },
    });
    const p = parseModelResponse(raw);
    expect(p.kind).toBe("finalize");
    if (p.kind === "finalize") {
      expect(p.artifact.kind).toBe("ticket");
      expect(p.artifact.title).toBe("T");
    }
  });

  it("parses an epic finalize with children", () => {
    const raw = JSON.stringify({
      kind: "finalize",
      text: "Ok. Ich lege ein Epic an.",
      artifact: {
        kind: "epic",
        title: "[Epic] Notifications",
        body: "body",
        children: [
          { title: "Bell icon", body: "body1" },
          { title: "Email digest", body: "body2" },
        ],
      },
    });
    const p = parseModelResponse(raw);
    expect(p.kind).toBe("finalize");
    if (p.kind === "finalize") expect(p.artifact.children?.length).toBe(2);
  });

  it("rejects epic with fewer than 2 children", () => {
    const raw = JSON.stringify({
      kind: "finalize",
      text: "Ok",
      artifact: { kind: "epic", title: "E", body: "b", children: [{ title: "c", body: "b" }] },
    });
    expect(() => parseModelResponse(raw)).toThrow(/2-5/);
  });

  it("rejects epic with more than 5 children", () => {
    const raw = JSON.stringify({
      kind: "finalize",
      text: "Ok",
      artifact: {
        kind: "epic",
        title: "E",
        body: "b",
        children: Array.from({ length: 6 }, (_, i) => ({ title: `c${i}`, body: "b" })),
      },
    });
    expect(() => parseModelResponse(raw)).toThrow(/2-5/);
  });

  it("rejects children on non-epic artifacts", () => {
    const raw = JSON.stringify({
      kind: "finalize",
      text: "Ok",
      artifact: { kind: "ticket", title: "T", body: "b", children: [{ title: "c", body: "b" }] },
    });
    expect(() => parseModelResponse(raw)).toThrow(/only allowed for kind "epic"/);
  });

  it("rejects invalid priority", () => {
    const raw = JSON.stringify({
      kind: "finalize",
      text: "Ok",
      artifact: { kind: "ticket", title: "T", body: "b", priority: "urgent" },
    });
    expect(() => parseModelResponse(raw)).toThrow(/priority/);
  });

  it("rejects invalid top-level kind", () => {
    expect(() => parseModelResponse(`{"kind":"whatever","text":"x"}`)).toThrow(/invalid kind/);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseModelResponse("not json at all")).toThrow(/JSON/);
  });

  it("rejects finalize missing artifact", () => {
    expect(() => parseModelResponse(`{"kind":"finalize","text":"ok"}`)).toThrow(/artifact/);
  });

  it("rejects assistant text over 2000 chars", () => {
    const longText = "x".repeat(2001);
    expect(() => parseModelResponse(`{"kind":"question","text":"${longText}"}`)).toThrow(/2000/);
  });
});

// ---------------------------------------------------------------------------
// processTurn — the full conversation flow
// ---------------------------------------------------------------------------

describe("processTurn — 3-turn hard cap", () => {
  it("allows a question on turn 1 and returns continue", async () => {
    mockModelResponses(`{"kind":"question","text":"Für wen genau ist das?"}`);
    const { fetch } = mockFetchCreatesTickets();
    const res = await processTurn(
      { project_id: "p", user_text: "Ich hab eine Idee" },
      cfgWith(fetch),
    );
    expect(res.status).toBe("continue");
    if (res.status === "continue") {
      expect(res.turn).toBe(1);
      expect(res.session_id).toBeTruthy();
      expect(res.assistant_text).toContain("Für wen");
    }
  });

  it("allows early finalize on turn 1 (clear idea)", async () => {
    mockModelResponses(JSON.stringify({
      kind: "finalize",
      text: "Klar, ich lege ein Ticket an.",
      artifact: { kind: "ticket", title: "T", body: "body" },
    }));
    const { fetch, callCount } = mockFetchCreatesTickets();
    const res = await processTurn(
      {
        project_id: "p",
        user_text: "Ändere den Button-Text von A auf B",
        board_url: "https://board.test",
      },
      cfgWith(fetch),
    );
    expect(res.status).toBe("final");
    if (res.status === "final") {
      expect(res.turn).toBe(1);
      expect(res.artifact_kind).toBe("ticket");
      expect(res.assistant_text).toMatch(/https?:\/\//);
    }
    expect(callCount()).toBe(1);
  });

  it("continues through turn 2, finalises on turn 3", async () => {
    mockModelResponses(
      `{"kind":"question","text":"Für wen genau?"}`,
      `{"kind":"question","text":"Muss das vor Launch fertig sein?"}`,
      JSON.stringify({
        kind: "finalize",
        text: "Ok, dann lege ich ein Ticket an.",
        artifact: { kind: "ticket", title: "T", body: "body" },
      }),
    );
    const { fetch } = mockFetchCreatesTickets();

    const r1 = await processTurn({ project_id: "p", user_text: "Idee X" }, cfgWith(fetch));
    expect(r1.status).toBe("continue");
    const sid = (r1 as Extract<ConverseResponse, { status: "continue" }>).session_id;

    const r2 = await processTurn({ project_id: "p", user_text: "Für Admins", session_id: sid }, cfgWith(fetch));
    expect(r2.status).toBe("continue");
    if (r2.status === "continue") expect(r2.turn).toBe(2);

    const r3 = await processTurn({ project_id: "p", user_text: "vor Launch", session_id: sid }, cfgWith(fetch));
    expect(r3.status).toBe("final");
    if (r3.status === "final") expect(r3.turn).toBe(3);
  });

  it("forces Spike fallback on turn 3 if model tries to ask again", async () => {
    mockModelResponses(
      `{"kind":"question","text":"q1"}`,
      `{"kind":"question","text":"q2"}`,
      `{"kind":"question","text":"q3 — should have been finalize"}`,
    );
    const { fetch } = mockFetchCreatesTickets();

    const r1 = await processTurn({ project_id: "p", user_text: "u1" }, cfgWith(fetch));
    const sid = (r1 as Extract<ConverseResponse, { status: "continue" }>).session_id;
    await processTurn({ project_id: "p", user_text: "u2", session_id: sid }, cfgWith(fetch));
    const r3 = await processTurn({ project_id: "p", user_text: "u3", session_id: sid }, cfgWith(fetch));

    expect(r3.status).toBe("final");
    if (r3.status === "final") {
      expect(r3.artifact_kind).toBe("spike");
      expect(r3.turn).toBe(3);
    }
  });

  it("creates a Spike when the model throws", async () => {
    vi.spyOn(_internal, "callModel").mockRejectedValue(new Error("SDK exploded"));
    const { fetch } = mockFetchCreatesTickets();

    const r1 = await processTurn({ project_id: "p", user_text: "u1" }, cfgWith(fetch));
    expect(r1.status).toBe("final");
    if (r1.status === "final") expect(r1.artifact_kind).toBe("spike");
  });

  it("drops session after finalisation so the id cannot be reused", async () => {
    mockModelResponses(
      JSON.stringify({
        kind: "finalize",
        text: "Klar, Ticket.",
        artifact: { kind: "ticket", title: "T", body: "b" },
      }),
      JSON.stringify({
        kind: "finalize",
        text: "Klar zweites Ticket.",
        artifact: { kind: "ticket", title: "T2", body: "b" },
      }),
    );
    const { fetch } = mockFetchCreatesTickets();
    const r1 = await processTurn({ project_id: "p", user_text: "u1" }, cfgWith(fetch));
    const sid = (r1 as Extract<ConverseResponse, { status: "final" }>).session_id;

    // Reusing a finalised session id must start a fresh session on turn 1.
    const r2 = await processTurn(
      { project_id: "p", user_text: "u2", session_id: sid },
      cfgWith(fetch),
    );
    expect(r2.status).toBe("final");
    if (r2.status === "final") expect(r2.turn).toBe(1);
  });

  it("creates an epic with children when the model finalises as epic", async () => {
    mockModelResponses(JSON.stringify({
      kind: "finalize",
      text: "Ok, Epic.",
      artifact: {
        kind: "epic",
        title: "[Epic] Notifications",
        body: "body",
        children: [
          { title: "Bell", body: "b1" },
          { title: "Digest", body: "b2" },
        ],
      },
    }));
    const { fetch, callCount } = mockFetchCreatesTickets();
    const r = await processTurn({ project_id: "p", user_text: "u1" }, cfgWith(fetch));
    expect(r.status).toBe("final");
    if (r.status === "final") {
      expect(r.artifact_kind).toBe("epic");
      expect(r.artifact.epic).toBeTruthy();
      expect(r.artifact.children?.length).toBe(2);
    }
    // 1 epic + 2 children = 3 board calls
    expect(callCount()).toBe(3);
  });

  it("includes spike tags on forced Spike tickets", async () => {
    mockModelResponses(`{"kind":"question","text":"nope"}`);
    const calls: unknown[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.endsWith("/api/tickets")) {
        calls.push(JSON.parse(init!.body as string));
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async json() { return ticketRow(700); },
          async text() { return ""; },
        } as unknown as Response;
      }
      throw new Error(`unexpected ${url}`);
    };

    // Force a turn-3 spike.
    const r1 = await processTurn({ project_id: "p", user_text: "u1" }, cfgWith(fetchFn));
    const sid = (r1 as Extract<ConverseResponse, { status: "continue" }>).session_id;
    await processTurn({ project_id: "p", user_text: "u2", session_id: sid }, cfgWith(fetchFn));
    const r3 = await processTurn({ project_id: "p", user_text: "u3", session_id: sid }, cfgWith(fetchFn));
    expect(r3.status).toBe("final");

    const spikeCall = calls.find(c => (c as { tags?: string[] }).tags?.includes("spike"));
    expect(spikeCall).toBeTruthy();
    expect((spikeCall as { tags: string[] }).tags).toEqual(
      expect.arrayContaining(["spike", "sidekick-converse"]),
    );
  });
});

// ---------------------------------------------------------------------------
// Decision Authority — the forbidden-question guarantee
// ---------------------------------------------------------------------------

describe("processTurn — concurrency + retry safety", () => {
  it("refuses a second concurrent request for the same session_id", async () => {
    // First call never resolves while the second call arrives. The session
    // store is in-memory and lock-less, so without a guard the second call
    // would corrupt history and the turn counter.
    let releaseFirst: (v: string) => void = () => {};
    vi.spyOn(_internal, "callModel").mockImplementationOnce(
      () => new Promise<string>(resolve => {
        releaseFirst = resolve;
      }),
    );
    const { fetch } = mockFetchCreatesTickets();

    // Kick off turn 1 without awaiting.
    const p1 = processTurn({ project_id: "p", user_text: "u1" }, cfgWith(fetch));

    // Give p1 a tick to register the session + set inFlight=true.
    await new Promise(r => setImmediate(r));

    // Mine the session id from the in-flight request. Because the first
    // call is still pending, the session is in the store; but we don't
    // have direct access. Instead, we finish turn 1, grab the id, let it
    // deliver a question (so session stays alive), then race a second turn.
    releaseFirst(`{"kind":"question","text":"q1"}`);
    const r1 = await p1;
    expect(r1.status).toBe("continue");
    const sid = (r1 as Extract<ConverseResponse, { status: "continue" }>).session_id;

    // Now queue two slow model calls for turn 2 and race them.
    let releaseA: (v: string) => void = () => {};
    let released = false;
    vi.spyOn(_internal, "callModel").mockImplementation(
      () => new Promise<string>(resolve => {
        if (!released) {
          released = true;
          releaseA = resolve;
        } else {
          resolve(`{"kind":"question","text":"q2"}`);
        }
      }),
    );

    const pA = processTurn(
      { project_id: "p", user_text: "u2a", session_id: sid },
      cfgWith(fetch),
    );
    // Let pA enter the critical section.
    await new Promise(r => setImmediate(r));

    // Second concurrent call must be rejected.
    await expect(
      processTurn({ project_id: "p", user_text: "u2b", session_id: sid }, cfgWith(fetch)),
    ).rejects.toBeInstanceOf(SessionBusyError);

    // Release pA so the test cleans up.
    releaseA(`{"kind":"question","text":"q2"}`);
    await pA;
  });

  it("does not duplicate the user turn in the next prompt after a mid-flight throw", async () => {
    // Scenario: turn 1 lands a question successfully. Turn 2 finalizes, but
    // the board API throws. The session stays alive. When the caller retries
    // turn 2, the user message for that turn must appear EXACTLY ONCE in the
    // transcript — not twice.
    const prompts: string[] = [];
    let modelCall = 0;
    vi.spyOn(_internal, "callModel").mockImplementation(async (prompt: string) => {
      prompts.push(prompt);
      modelCall++;
      if (modelCall === 1) return `{"kind":"question","text":"q1"}`;
      // Turn 2 — attempt 1: finalize (board will throw).
      // Turn 2 — attempt 2 (retry): finalize (board succeeds).
      return JSON.stringify({
        kind: "finalize",
        text: "Ok, Ticket.",
        artifact: { kind: "ticket", title: "T", body: "body" },
      });
    });

    let fetchCall = 0;
    const fetchFn: typeof fetch = async (input) => {
      fetchCall++;
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.endsWith("/api/tickets")) {
        if (fetchCall === 1) throw new Error("board is down");
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async json() { return ticketRow(500); },
          async text() { return ""; },
        } as unknown as Response;
      }
      throw new Error(`unexpected ${url}`);
    };

    const r1 = await processTurn({ project_id: "p", user_text: "turn1msg" }, cfgWith(fetchFn));
    expect(r1.status).toBe("continue");
    const sid = (r1 as Extract<ConverseResponse, { status: "continue" }>).session_id;

    // Turn 2 — first attempt. Artifact creation throws, session kept alive.
    await expect(
      processTurn({ project_id: "p", user_text: "retryMsgXYZ", session_id: sid }, cfgWith(fetchFn)),
    ).rejects.toThrow(/board is down|artifact creation failed/);

    // Turn 2 — retry. Must succeed. The prompt for the retry should contain
    // "retryMsgXYZ" exactly once — not twice.
    const r2 = await processTurn(
      { project_id: "p", user_text: "retryMsgXYZ", session_id: sid },
      cfgWith(fetchFn),
    );
    expect(r2.status).toBe("final");

    const retryPrompt = prompts[prompts.length - 1];
    const occurrences = retryPrompt.split("retryMsgXYZ").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("FORBIDDEN_QUESTION_TOPICS", () => {
  it("is a non-empty frozen list", () => {
    expect(FORBIDDEN_QUESTION_TOPICS.length).toBeGreaterThan(5);
    expect(Object.isFrozen(FORBIDDEN_QUESTION_TOPICS)).toBe(true);
  });

  it("covers the main implementation categories from T-871", () => {
    const joined = FORBIDDEN_QUESTION_TOPICS.join(" ").toLowerCase();
    // Representative forbidden categories from CLAUDE.md "Anti-patterns".
    expect(joined).toMatch(/framework|stack/);
    expect(joined).toMatch(/database/);
    expect(joined).toMatch(/hosting|deployment/);
    expect(joined).toMatch(/modal|sheet/);
    expect(joined).toMatch(/kanban|list/);
    expect(joined).toMatch(/font|color/);
    expect(joined).toMatch(/layout/);
    expect(joined).toMatch(/auth/);
  });
});
