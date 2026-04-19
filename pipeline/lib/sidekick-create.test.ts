import { describe, it, expect } from "vitest";
import {
  validateCreateRequest,
  validateUpdateRequest,
  createFromClassification,
  updateFromCorrection,
  ValidationError,
  BoardApiError,
  type BoardClientConfig,
} from "./sidekick-create.ts";

// ---------------------------------------------------------------------------
// Helpers: mock fetch that inspects the request and returns scripted responses
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

interface MockResponse {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
  throwOn?: "send" | "json";
  errorMessage?: string;
}

function makeMockFetch(responses: MockResponse[]): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let callIndex = 0;

  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const bodyStr = init?.body as string | undefined;
    calls.push({
      url,
      method,
      headers,
      body: bodyStr ? JSON.parse(bodyStr) : undefined,
    });

    const resp = responses[callIndex++] ?? { ok: true, body: {} };

    if (resp.throwOn === "send") {
      throw new Error(resp.errorMessage ?? "simulated network error");
    }

    return {
      ok: resp.ok ?? true,
      status: resp.status ?? 200,
      statusText: resp.statusText ?? "OK",
      async json() {
        if (resp.throwOn === "json") {
          throw new Error(resp.errorMessage ?? "invalid json");
        }
        return resp.body;
      },
      async text() {
        return typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body ?? {});
      },
    } as unknown as Response;
  };

  return { fetch: mockFetch, calls };
}

function cfgWith(fetchFn: typeof fetch): BoardClientConfig {
  return {
    apiUrl: "https://board.example.com",
    apiKey: "pk-test",
    fetchFn,
  };
}

// ---------------------------------------------------------------------------
// validateCreateRequest
// ---------------------------------------------------------------------------

describe("validateCreateRequest", () => {
  it("accepts a minimal ticket request", () => {
    const req = validateCreateRequest({
      category: "ticket",
      project_id: "p-1",
      ticket: { title: "Fix login", body: "Login is broken when…" },
    });
    expect(req.category).toBe("ticket");
    if (req.category === "ticket") {
      expect(req.ticket.title).toBe("Fix login");
    }
  });

  it("accepts an epic request with children", () => {
    const req = validateCreateRequest({
      category: "epic",
      project_id: "p-1",
      epic: { title: "Notifications", body: "We need notifications across the board" },
      children: [
        { title: "Settings page", body: "…" },
        { title: "Bell icon", body: "…" },
      ],
    });
    expect(req.category).toBe("epic");
    if (req.category === "epic") {
      expect(req.children).toHaveLength(2);
    }
  });

  it("rejects unknown category", () => {
    expect(() => validateCreateRequest({ category: "foo" })).toThrow(ValidationError);
  });

  it("rejects missing project_id", () => {
    expect(() =>
      validateCreateRequest({ category: "ticket", ticket: { title: "x", body: "y" } }),
    ).toThrow(/project_id/);
  });

  it("rejects empty title", () => {
    expect(() =>
      validateCreateRequest({
        category: "ticket",
        project_id: "p-1",
        ticket: { title: "", body: "y" },
      }),
    ).toThrow(/title/);
  });

  it("rejects body longer than max", () => {
    expect(() =>
      validateCreateRequest({
        category: "ticket",
        project_id: "p-1",
        ticket: { title: "x", body: "y".repeat(20_001) },
      }),
    ).toThrow(/body/);
  });

  it("rejects epic with zero children", () => {
    expect(() =>
      validateCreateRequest({
        category: "epic",
        project_id: "p-1",
        epic: { title: "e", body: "b" },
        children: [],
      }),
    ).toThrow(/children/);
  });

  it("rejects epic with too many children", () => {
    const children = Array.from({ length: 25 }, (_, i) => ({ title: `c${i}`, body: "b" }));
    expect(() =>
      validateCreateRequest({
        category: "epic",
        project_id: "p-1",
        epic: { title: "e", body: "b" },
        children,
      }),
    ).toThrow(/at most 20/);
  });

  it("rejects invalid priority", () => {
    expect(() =>
      validateCreateRequest({
        category: "ticket",
        project_id: "p-1",
        ticket: { title: "x", body: "y", priority: "urgent" },
      }),
    ).toThrow(/priority/);
  });

  it("rejects invalid board_url type", () => {
    expect(() =>
      validateCreateRequest({
        category: "ticket",
        project_id: "p-1",
        board_url: "",
        ticket: { title: "x", body: "y" },
      }),
    ).toThrow(/board_url/);
  });

  it("trims whitespace from board_url", () => {
    const req = validateCreateRequest({
      category: "ticket",
      project_id: "p-1",
      board_url: "  https://board.just-ship.io  ",
      ticket: { title: "x", body: "y" },
    });
    if (req.category === "ticket") {
      expect(req.board_url).toBe("https://board.just-ship.io");
    }
  });

  it("rejects non-string board_url (number)", () => {
    expect(() =>
      validateCreateRequest({
        category: "ticket",
        project_id: "p-1",
        board_url: 42,
        ticket: { title: "x", body: "y" },
      }),
    ).toThrow(/board_url/);
  });
});

// ---------------------------------------------------------------------------
// validateUpdateRequest
// ---------------------------------------------------------------------------

describe("validateUpdateRequest", () => {
  it("accepts a patch with only a title", () => {
    const req = validateUpdateRequest({ ticket_number: 42, patch: { title: "New title" } });
    expect(req.patch.title).toBe("New title");
  });

  it("accepts a patch with multiple fields", () => {
    const req = validateUpdateRequest({
      ticket_number: 42,
      patch: { title: "T", body: "B", priority: "high", tags: ["bug"] },
    });
    expect(req.patch.priority).toBe("high");
    expect(req.patch.tags).toEqual(["bug"]);
  });

  it("rejects non-integer ticket_number", () => {
    expect(() => validateUpdateRequest({ ticket_number: "42", patch: { title: "x" } })).toThrow();
    expect(() => validateUpdateRequest({ ticket_number: 3.14, patch: { title: "x" } })).toThrow();
    expect(() => validateUpdateRequest({ ticket_number: 0, patch: { title: "x" } })).toThrow();
  });

  it("rejects empty patch", () => {
    expect(() => validateUpdateRequest({ ticket_number: 42, patch: {} })).toThrow(/at least one field/);
  });

  it("rejects invalid priority", () => {
    expect(() =>
      validateUpdateRequest({ ticket_number: 42, patch: { priority: "urgent" } }),
    ).toThrow(/priority/);
  });

  it("trims title", () => {
    const req = validateUpdateRequest({ ticket_number: 1, patch: { title: "  spaced  " } });
    expect(req.patch.title).toBe("spaced");
  });

  it("accepts and trims a valid board_url", () => {
    const req = validateUpdateRequest({
      ticket_number: 1,
      board_url: "  https://board.just-ship.io  ",
      patch: { title: "x" },
    });
    expect(req.board_url).toBe("https://board.just-ship.io");
  });

  it("rejects non-string board_url", () => {
    expect(() =>
      validateUpdateRequest({ ticket_number: 1, board_url: 42, patch: { title: "x" } }),
    ).toThrow(/board_url/);
  });

  it("rejects whitespace-only board_url", () => {
    expect(() =>
      validateUpdateRequest({ ticket_number: 1, board_url: "   ", patch: { title: "x" } }),
    ).toThrow(/board_url/);
  });
});

// ---------------------------------------------------------------------------
// createFromClassification — ticket
// ---------------------------------------------------------------------------

describe("createFromClassification — ticket", () => {
  it("posts a single ticket and returns it with a URL", async () => {
    const { fetch: mf, calls } = makeMockFetch([
      { body: { data: { id: "u-1", number: 501, title: "Fix login" } } },
    ]);

    const result = await createFromClassification(
      {
        category: "ticket",
        project_id: "p-1",
        board_url: "https://board.just-ship.io",
        ticket: { title: "Fix login", body: "The login page …" },
      },
      cfgWith(mf),
    );

    expect(result.category).toBe("ticket");
    if (result.category === "ticket") {
      expect(result.ticket.number).toBe(501);
      expect(result.ticket.url).toBe("https://board.just-ship.io/t/501");
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://board.example.com/api/tickets");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["X-Pipeline-Key"]).toBe("pk-test");
    const body = calls[0].body as Record<string, unknown>;
    expect(body.title).toBe("Fix login");
    expect(body.status).toBe("backlog");
    expect(body.project_id).toBe("p-1");
  });

  it("includes priority and tags when provided", async () => {
    const { fetch: mf, calls } = makeMockFetch([
      { body: { data: { id: "u-1", number: 10, title: "t" } } },
    ]);
    await createFromClassification(
      {
        category: "ticket",
        project_id: "p-1",
        ticket: { title: "t", body: "b", priority: "high", tags: ["bug"] },
      },
      cfgWith(mf),
    );
    const body = calls[0].body as Record<string, unknown>;
    expect(body.priority).toBe("high");
    expect(body.tags).toEqual(["bug"]);
  });

  it("uses T-N placeholder URL when board_url is missing", async () => {
    const { fetch: mf } = makeMockFetch([
      { body: { data: { id: "u-1", number: 7, title: "t" } } },
    ]);
    const result = await createFromClassification(
      {
        category: "ticket",
        project_id: "p-1",
        ticket: { title: "t", body: "b" },
      },
      cfgWith(mf),
    );
    if (result.category === "ticket") {
      expect(result.ticket.url).toBe("T-7");
    }
  });

  it("throws BoardApiError on non-OK HTTP response", async () => {
    const { fetch: mf } = makeMockFetch([
      { ok: false, status: 500, statusText: "Internal Server Error", body: "boom" },
    ]);
    await expect(
      createFromClassification(
        { category: "ticket", project_id: "p-1", ticket: { title: "t", body: "b" } },
        cfgWith(mf),
      ),
    ).rejects.toThrow(BoardApiError);
  });

  it("throws BoardApiError on network failure", async () => {
    const { fetch: mf } = makeMockFetch([{ throwOn: "send", errorMessage: "econnrefused" }]);
    await expect(
      createFromClassification(
        { category: "ticket", project_id: "p-1", ticket: { title: "t", body: "b" } },
        cfgWith(mf),
      ),
    ).rejects.toThrow(/econnrefused/);
  });

  it("throws BoardApiError when response shape is invalid", async () => {
    const { fetch: mf } = makeMockFetch([{ body: { data: { id: "x" } } }]); // missing number, title
    await expect(
      createFromClassification(
        { category: "ticket", project_id: "p-1", ticket: { title: "t", body: "b" } },
        cfgWith(mf),
      ),
    ).rejects.toThrow(/missing required fields/);
  });
});

// ---------------------------------------------------------------------------
// createFromClassification — epic
// ---------------------------------------------------------------------------

describe("createFromClassification — epic", () => {
  it("creates epic then all children with parent_ticket_id", async () => {
    const { fetch: mf, calls } = makeMockFetch([
      { body: { data: { id: "e-id", number: 200, title: "Notifications" } } },
      { body: { data: { id: "c-id-1", number: 201, title: "Settings page" } } },
      { body: { data: { id: "c-id-2", number: 202, title: "Bell icon" } } },
    ]);

    const result = await createFromClassification(
      {
        category: "epic",
        project_id: "p-1",
        board_url: "https://board.just-ship.io",
        epic: { title: "Notifications", body: "Epic body" },
        children: [
          { title: "Settings page", body: "c1" },
          { title: "Bell icon", body: "c2" },
        ],
      },
      cfgWith(mf),
    );

    expect(result.category).toBe("epic");
    if (result.category === "epic") {
      expect(result.epic.number).toBe(200);
      expect(result.children).toHaveLength(2);
      expect(result.children[0].number).toBe(201);
      expect(result.failed_children).toBeUndefined();
    }

    // First call is the epic (no parent_ticket_id)
    const epicBody = calls[0].body as Record<string, unknown>;
    expect(epicBody.parent_ticket_id).toBeUndefined();

    // Children all have parent_ticket_id = epic.id
    for (const call of calls.slice(1)) {
      const body = call.body as Record<string, unknown>;
      expect(body.parent_ticket_id).toBe("e-id");
    }
  });

  it("collects partial child failures into failed_children but still returns success", async () => {
    const { fetch: mf } = makeMockFetch([
      { body: { data: { id: "e-id", number: 300, title: "Epic" } } },
      { body: { data: { id: "c-id-1", number: 301, title: "c1" } } },
      { ok: false, status: 500, body: "child 2 boom" },
      { body: { data: { id: "c-id-3", number: 303, title: "c3" } } },
    ]);

    const result = await createFromClassification(
      {
        category: "epic",
        project_id: "p-1",
        epic: { title: "E", body: "eb" },
        children: [
          { title: "c1", body: "b1" },
          { title: "c2", body: "b2" },
          { title: "c3", body: "b3" },
        ],
      },
      cfgWith(mf),
    );

    if (result.category === "epic") {
      expect(result.epic.number).toBe(300);
      expect(result.children).toHaveLength(2); // c1 + c3
      expect(result.failed_children).toHaveLength(1);
      expect(result.failed_children?.[0].index).toBe(1);
      expect(result.failed_children?.[0].title).toBe("c2");
      expect(result.failed_children?.[0].reason).toMatch(/HTTP 500/);
    }
  });

  it("throws when the epic itself fails (children never run)", async () => {
    const { fetch: mf, calls } = makeMockFetch([
      { ok: false, status: 500, body: "epic boom" },
    ]);
    await expect(
      createFromClassification(
        {
          category: "epic",
          project_id: "p-1",
          epic: { title: "e", body: "b" },
          children: [{ title: "c1", body: "b1" }],
        },
        cfgWith(mf),
      ),
    ).rejects.toThrow(BoardApiError);
    expect(calls).toHaveLength(1); // only the epic attempt
  });
});

// ---------------------------------------------------------------------------
// updateFromCorrection
// ---------------------------------------------------------------------------

describe("updateFromCorrection", () => {
  it("patches only the provided fields and returns the updated ticket", async () => {
    const { fetch: mf, calls } = makeMockFetch([
      { body: { data: { id: "u-1", number: 42, title: "New title" } } },
    ]);

    const result = await updateFromCorrection(
      { ticket_number: 42, patch: { title: "New title" } },
      cfgWith(mf),
      "https://board.just-ship.io",
    );

    expect(result.ticket.number).toBe(42);
    expect(result.ticket.url).toBe("https://board.just-ship.io/t/42");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toBe("https://board.example.com/api/tickets/42");
    expect(calls[0].body).toEqual({ title: "New title" });
  });

  it("throws when patch returns non-OK", async () => {
    const { fetch: mf } = makeMockFetch([{ ok: false, status: 404, body: "not found" }]);
    await expect(
      updateFromCorrection({ ticket_number: 999, patch: { title: "x" } }, cfgWith(mf)),
    ).rejects.toThrow(BoardApiError);
  });
});
