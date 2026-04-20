import { logger } from "./logger.ts";
import { Sentry } from "./sentry.ts";
import { classify, type ClassificationInput, type ClassificationResult } from "./sidekick-classifier.ts";
import { createFromClassification, BoardApiError, ValidationError, type CreateRequest, type CreateResult, type BoardClientConfig } from "./sidekick-create.ts";

/**
 * Sidekick Tool-Registry — T-923 (child #2 of Epic T-921).
 *
 * The Board used to host these 7 tools client-side in
 * `just-ship-board/src/lib/sidekick/tools.ts`. For channel parity between the
 * Browser widget and the Terminal sidekick, both must invoke the exact same
 * tool set — so the tools now live here in the engine, behind an HTTP-callable
 * shape that the chat endpoint (T-922) consumes.
 *
 * The tool SCHEMAS (what Claude sees — name, input_schema, description) are
 * identical to the Board's previous definitions; the Board client continues to
 * work unchanged. The EXECUTION moved from direct Supabase calls to Board API
 * HTTP calls because the engine has no Supabase SDK in its dependency graph —
 * it talks to the board exclusively via the REST API, which already enforces
 * RLS, pipeline-key auth, and workspace scoping.
 *
 * Auth model:
 *   - Pipeline key (X-Pipeline-Key) — used for workspace-scoped writes and
 *     reads that operate on behalf of the engine (create_ticket, create_thread,
 *     update_thread, search_tickets, get_project_status).
 *   - User bearer (Authorization: Bearer) — when present, user-scoped tools
 *     (`list_my_tickets`) use it so the board filters by the caller's identity.
 *     Without a bearer, `list_my_tickets` returns an error (the tool is
 *     inherently user-scoped; there is no sensible default).
 *
 * Out of scope (belongs to sibling children):
 *   - Wiring these tools into `sidekick-chat.ts`'s `allowedTools` array —
 *     that integration lands in a follow-up PR after T-923 merges.
 *   - Thread schema migration — Child #3 creates the `threads` and
 *     `thread_messages` tables. This module calls them optimistically via the
 *     Board API; until Child #3 ships, `create_thread`/`update_thread` will
 *     return a BoardApiError, surfaced to the model as a tool error so the
 *     conversation can recover gracefully.
 *   - Attachments — Child #4.
 *   - Board UI migration — Child #5.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Shape of JSON Schema subset we emit for each tool. Matches the Claude
 * tool-use contract: `type`, `description`, `input_schema`. We keep this
 * locally typed rather than importing from the SDK to avoid coupling the
 * registry to a specific SDK version.
 */
export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

/**
 * Context passed to every tool. Provided once per chat turn by the caller
 * (the chat endpoint — T-922 integration). The caller is responsible for
 * resolving `workspace_id` from the `project_id` before constructing the
 * context; tools do not re-resolve it per call.
 */
export interface ToolContext {
  /** Board API base URL, e.g. "https://board.just-ship.io". No trailing slash. */
  apiUrl: string;
  /** Board pipeline key (workspace- or project-scoped). */
  apiKey: string;
  /**
   * Optional user bearer token propagated from the chat request. When set,
   * user-scoped tools (`list_my_tickets`) attach it in the Authorization
   * header so the board can filter by the caller's identity.
   */
  userBearer?: string;
  /** Active workspace uuid. */
  workspaceId: string;
  /** Active project uuid. Required by every tool in this registry today. */
  projectId: string;
  /** User uuid — stamped into created thread rows and ticket metadata. */
  userId?: string;
  /**
   * Board web base URL (used to build `url` fields in created-ticket
   * responses). If omitted, URLs fall back to `T-{number}` tokens.
   */
  boardUrl?: string;
  /** Request timeout for outgoing board calls. Defaults to 10_000 ms. */
  timeoutMs?: number;
  /** Injected for tests. Defaults to global fetch. */
  fetchFn?: typeof fetch;
}

/** A successful tool execution wraps the raw return value. */
export interface ToolSuccess<T = unknown> {
  ok: true;
  result: T;
}

/**
 * A failed tool execution is converted to a user-friendly message for the
 * model. The chat endpoint emits these as `tool_result` events with
 * `is_error: true` so Claude can recover on the next turn instead of
 * terminating the conversation.
 */
export interface ToolFailure {
  ok: false;
  error: string;
  /** Machine-friendly code for logs + Sentry tagging. */
  code?: string;
}

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolFailure;

export interface ToolDefinition {
  schema: ToolSchema;
  execute(ctx: ToolContext, args: unknown): Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Schemas — kept API-identical to the Board's previous tool definitions so
// the browser client does not need to re-ship. Each `name` matches the
// Board's snake_case convention.
// ---------------------------------------------------------------------------

const SCHEMAS = {
  create_ticket: {
    name: "create_ticket",
    description:
      "Create a new ticket in the active project. Use when the user describes one concrete change to ship.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Short imperative title (max 200 chars)." },
        description: { type: "string", description: "Ticket body — problem, desired behavior, ACs." },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional labels. Defaults to empty.",
        },
        priority: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "Priority. Defaults to medium.",
        },
        thread_id: {
          type: "string",
          description: "Optional — links the new ticket back to a conversation thread.",
        },
        image_urls: {
          type: "array",
          items: { type: "string" },
          description: "Legacy — list of image URLs attached as markdown.",
        },
        images: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string" },
              name: { type: "string" },
            },
            required: ["url", "name"],
          },
          description: "Preferred attachment form with filenames for alt text.",
        },
      },
      required: ["title", "description"],
      additionalProperties: false,
    },
  },

  search_tickets: {
    name: "search_tickets",
    description:
      "Search tickets in the active workspace by keyword. Returns up to 10 matches.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search string matched against title and body." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },

  list_my_tickets: {
    name: "list_my_tickets",
    description:
      "List tickets the current user created. Requires a logged-in user (Bearer token).",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          description: "Optional status filter (e.g. 'ready_to_develop', 'in_progress').",
        },
      },
      additionalProperties: false,
    },
  },

  create_thread: {
    name: "create_thread",
    description:
      "Start a persistent Sidekick conversation thread. Use when the user wants to revisit the discussion later.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Short thread title." },
        first_message: { type: "string", description: "The CEO's opening message." },
        classification: {
          type: "string",
          description: "Optional category from the Sidekick classifier (ticket|epic|conversation|project).",
        },
      },
      required: ["title", "first_message"],
      additionalProperties: false,
    },
  },

  update_thread: {
    name: "update_thread",
    description:
      "Patch an existing thread — change status, add a message, record classification or pending questions.",
    input_schema: {
      type: "object" as const,
      properties: {
        thread_id: { type: "string" },
        status: { type: "string" },
        classification: { type: "string" },
        pending_questions: { type: "array", items: {} },
        message: { type: "string", description: "Optional — appended as a new message." },
        message_role: {
          type: "string",
          description: "Role for the appended message (default: 'pm').",
        },
      },
      required: ["thread_id"],
      additionalProperties: false,
    },
  },

  classify_input: {
    name: "classify_input",
    description:
      "Classify a user input into one of four Sidekick categories (ticket|epic|conversation|project). Returns category + confidence + reasoning.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "The user's raw message to classify." },
        affected_areas: {
          type: "array",
          items: { type: "string" },
          description: "Optional hint — domains this touches (auth, board, ...).",
        },
        has_dependencies: {
          type: "boolean",
          description: "Optional hint — does this depend on other unshipped work?",
        },
        clarity: {
          type: "string",
          enum: ["clear", "mostly_clear", "vague", "very_vague"],
          description: "Optional hint — how concrete the request is.",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },

  get_project_status: {
    name: "get_project_status",
    description:
      "Return ticket counts by status, recent agent activity, in-progress and recently-completed tickets for the active project.",
    input_schema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
} satisfies Record<string, ToolSchema>;

// ---------------------------------------------------------------------------
// In-memory cache for get_project_status
// ---------------------------------------------------------------------------

interface CachedEntry<T> {
  value: T;
  expiresAt: number;
}

const PROJECT_STATUS_CACHE_TTL_MS = 30_000;
const projectStatusCache = new Map<string, CachedEntry<ProjectStatusResult>>();

/**
 * Test seam — reset the cache so one test's success doesn't satisfy another
 * test's hit-check. Not exported publicly.
 */
export function _resetSidekickToolsCacheForTests(): void {
  projectStatusCache.clear();
}

// ---------------------------------------------------------------------------
// Tool result shapes. These match the Board's previous return values so the
// model's expectations carry over. We keep them explicit rather than inferring
// from function bodies because they are part of the tool's public contract.
// ---------------------------------------------------------------------------

export interface CreatedTicketRow {
  id: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  tags: string[];
  created_at: string;
  url?: string;
}

export interface TicketSearchHit {
  number: number;
  title: string;
  status: string;
  tags: string[];
  created_at: string;
}

export interface MyTicket {
  number: number;
  title: string;
  status: string;
  tags: string[];
  priority: string;
  created_at: string;
}

export interface ThreadRow {
  id: string;
  title: string;
  status: string;
  classification: string | null;
  pending_questions?: unknown[] | null;
  last_activity_at?: string;
  created_at?: string;
}

export interface ProjectStatusResult {
  total_tickets: number;
  by_status: Record<string, number>;
  in_progress: Array<{ number: number; title: string; status: string; assigned_agents: string[] | null }>;
  recently_completed: Array<{ number: number; title: string; updated_at: string }>;
  recent_agent_activity: Array<{ agent_type: string; event_type: string; created_at: string; ticket_id: string | null }>;
}

// ---------------------------------------------------------------------------
// HTTP helpers — thin wrappers so each tool doesn't re-implement fetch plumbing
// ---------------------------------------------------------------------------

interface HttpCallOpts {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
  userBearer?: boolean;
}

async function callBoard(ctx: ToolContext, opts: HttpCallOpts): Promise<unknown> {
  const fetchFn = ctx.fetchFn ?? fetch;
  const timeoutMs = ctx.timeoutMs ?? 10_000;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // User-scoped calls use the bearer; everything else uses the pipeline key.
  // Tools may not mix both — the Board would accept only one, and mixing them
  // would make it ambiguous whose context is active.
  if (opts.userBearer) {
    if (!ctx.userBearer) {
      throw new BoardApiError("user bearer required for user-scoped tool", 401);
    }
    headers["Authorization"] = `Bearer ${ctx.userBearer}`;
  } else {
    headers["X-Pipeline-Key"] = ctx.apiKey;
  }

  const url = `${ctx.apiUrl.replace(/\/+$/, "")}${opts.path}`;

  let res: Response;
  try {
    res = await fetchFn(url, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new BoardApiError(`Board API ${opts.method} ${opts.path} failed: ${reason}`);
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch { /* non-critical */ }
    throw new BoardApiError(
      `Board API ${opts.method} ${opts.path} returned HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      res.status,
    );
  }

  try {
    return await res.json();
  } catch (err) {
    throw new BoardApiError(`Board API ${opts.method} ${opts.path} returned invalid JSON: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Tool: create_ticket
// ---------------------------------------------------------------------------

interface CreateTicketArgs {
  title: string;
  description: string;
  tags?: string[];
  priority?: string;
  thread_id?: string;
  image_urls?: string[];
  images?: { url: string; name: string }[];
}

function isCreateTicketArgs(x: unknown): x is CreateTicketArgs {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.title === "string" && typeof o.description === "string";
}

async function execCreateTicket(ctx: ToolContext, rawArgs: unknown): Promise<ToolResult<CreatedTicketRow>> {
  if (!isCreateTicketArgs(rawArgs)) {
    return { ok: false, error: "title and description are required strings", code: "invalid_args" };
  }
  const args = rawArgs;

  // Assemble the body the same way the Board used to: append markdown image
  // references so the rendered ticket shows attachments inline. Preserves the
  // Board's behavior exactly — images (with filenames) win over image_urls.
  let body = args.description;
  if (args.images?.length) {
    body += "\n\n## Attachments\n\n";
    body += args.images
      .map((img) => {
        const altText = img.name.replace(/\.[^.]+$/, "");
        return `![${altText}](${img.url})`;
      })
      .join("\n\n");
  } else if (args.image_urls?.length) {
    body += "\n\n## Attachments\n\n";
    body += args.image_urls
      .map((url, i) => {
        const urlName = url.split("/").pop() ?? "";
        const altText = urlName.includes(".") ? urlName.replace(/\.[^.]+$/, "") : `Attachment ${i + 1}`;
        return `![${altText}](${url})`;
      })
      .join("\n\n");
  }

  // Delegate to runCreate — same path T-876's HTTP endpoint uses. Keeps
  // the "sidekick creates via the shared creation primitive" invariant from
  // the epic, and we inherit validation + error-shape for free.
  const priority = args.priority === "high" || args.priority === "medium" || args.priority === "low"
    ? args.priority
    : "medium";

  const createReq: CreateRequest = {
    category: "ticket",
    project_id: ctx.projectId,
    ...(ctx.boardUrl ? { board_url: ctx.boardUrl } : {}),
    ticket: {
      title: args.title,
      body,
      priority,
      ...(args.tags && args.tags.length > 0 ? { tags: args.tags } : {}),
    },
  };

  const cfg: BoardClientConfig = {
    apiUrl: ctx.apiUrl,
    apiKey: ctx.apiKey,
    ...(ctx.timeoutMs ? { timeoutMs: ctx.timeoutMs } : {}),
    ...(ctx.fetchFn ? { fetchFn: ctx.fetchFn } : {}),
  };

  try {
    const result: CreateResult = await createFromClassification(createReq, cfg);
    if (result.category !== "ticket") {
      // createFromClassification switches on category; we requested "ticket"
      // so this should be unreachable, but guard against a future branch
      // added elsewhere.
      throw new Error(`unexpected createFromClassification response category: ${result.category}`);
    }

    // If the model supplied a thread_id, best-effort append a system message.
    // Failures here don't invalidate the ticket creation — the ticket is real
    // and useful even if the thread link fails. We log but don't surface.
    if (args.thread_id) {
      try {
        await callBoard(ctx, {
          method: "POST",
          path: `/api/threads/${encodeURIComponent(args.thread_id)}/messages`,
          body: {
            role: "system",
            content: `Ticket T-${result.ticket.number} erstellt: ${result.ticket.title}`,
            metadata: { ticket_id: result.ticket.id, ticket_number: result.ticket.number },
          },
        });
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), threadId: args.thread_id },
          "sidekick-tools: create_ticket — thread cross-reference failed",
        );
      }
    }

    return {
      ok: true,
      result: {
        id: result.ticket.id,
        number: result.ticket.number,
        title: result.ticket.title,
        status: "backlog",
        priority,
        tags: args.tags ?? [],
        created_at: new Date().toISOString(),
        ...(result.ticket.url ? { url: result.ticket.url } : {}),
      },
    };
  } catch (err) {
    return handleToolError("create_ticket", err, ctx);
  }
}

// ---------------------------------------------------------------------------
// Tool: search_tickets
// ---------------------------------------------------------------------------

interface SearchTicketsArgs { query: string }

function isSearchArgs(x: unknown): x is SearchTicketsArgs {
  return typeof x === "object" && x !== null && typeof (x as Record<string, unknown>).query === "string";
}

async function execSearchTickets(ctx: ToolContext, rawArgs: unknown): Promise<ToolResult<TicketSearchHit[]>> {
  if (!isSearchArgs(rawArgs)) {
    return { ok: false, error: "query is required and must be a string", code: "invalid_args" };
  }
  const q = rawArgs.query.trim();
  if (!q) {
    return { ok: false, error: "query must be non-empty", code: "invalid_args" };
  }

  try {
    const json = await callBoard(ctx, {
      method: "GET",
      path: `/api/tickets?search=${encodeURIComponent(q)}&limit=10`,
    }) as { data?: { tickets?: TicketSearchHit[] } | null };

    const hits = json?.data?.tickets ?? [];
    return { ok: true, result: hits };
  } catch (err) {
    return handleToolError("search_tickets", err, ctx);
  }
}

// ---------------------------------------------------------------------------
// Tool: list_my_tickets
// ---------------------------------------------------------------------------

interface ListMyTicketsArgs { status?: string }

function isListArgs(x: unknown): x is ListMyTicketsArgs {
  // Missing args or explicit `null` are treated as "no filter" — the tool
  // has no required fields. Any non-object at runtime (string, number, array)
  // is an invalid shape and must be rejected so we don't silently ignore
  // the caller's intent.
  if (x === undefined || x === null) return true;
  if (typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return o.status === undefined || typeof o.status === "string";
}

async function execListMyTickets(ctx: ToolContext, rawArgs: unknown): Promise<ToolResult<MyTicket[]>> {
  if (!ctx.userBearer) {
    return {
      ok: false,
      error: "not signed in — ask the user to sign in before listing their tickets",
      code: "not_authenticated",
    };
  }
  if (!isListArgs(rawArgs)) {
    return { ok: false, error: "status must be a string when provided", code: "invalid_args" };
  }
  const args = rawArgs ?? {};

  const qs = new URLSearchParams({ scope: "mine", limit: "20" });
  if (args.status) qs.set("status", args.status);

  try {
    const json = await callBoard(ctx, {
      method: "GET",
      path: `/api/tickets?${qs.toString()}`,
      userBearer: true,
    }) as { data?: { tickets?: MyTicket[] } | null };

    const tickets = json?.data?.tickets ?? [];
    return { ok: true, result: tickets };
  } catch (err) {
    return handleToolError("list_my_tickets", err, ctx);
  }
}

// ---------------------------------------------------------------------------
// Tool: create_thread
// ---------------------------------------------------------------------------

interface CreateThreadArgs { title: string; first_message: string; classification?: string }

function isCreateThreadArgs(x: unknown): x is CreateThreadArgs {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.title === "string" && typeof o.first_message === "string";
}

async function execCreateThread(ctx: ToolContext, rawArgs: unknown): Promise<ToolResult<ThreadRow>> {
  if (!isCreateThreadArgs(rawArgs)) {
    return { ok: false, error: "title and first_message are required strings", code: "invalid_args" };
  }
  const args = rawArgs;

  try {
    const json = await callBoard(ctx, {
      method: "POST",
      path: "/api/threads",
      body: {
        workspace_id: ctx.workspaceId,
        project_id: ctx.projectId,
        user_id: ctx.userId,
        title: args.title,
        classification: args.classification ?? null,
        first_message: args.first_message,
      },
    }) as { data?: ThreadRow | null };

    if (!json?.data) {
      throw new BoardApiError("board returned no thread data");
    }
    return { ok: true, result: json.data };
  } catch (err) {
    return handleToolError("create_thread", err, ctx);
  }
}

// ---------------------------------------------------------------------------
// Tool: update_thread
// ---------------------------------------------------------------------------

interface UpdateThreadArgs {
  thread_id: string;
  status?: string;
  classification?: string;
  pending_questions?: unknown[];
  message?: string;
  message_role?: string;
}

function isUpdateThreadArgs(x: unknown): x is UpdateThreadArgs {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.thread_id === "string" && o.thread_id.length > 0;
}

async function execUpdateThread(ctx: ToolContext, rawArgs: unknown): Promise<ToolResult<ThreadRow>> {
  if (!isUpdateThreadArgs(rawArgs)) {
    return { ok: false, error: "thread_id is required", code: "invalid_args" };
  }
  const args = rawArgs;

  try {
    const json = await callBoard(ctx, {
      method: "PATCH",
      path: `/api/threads/${encodeURIComponent(args.thread_id)}`,
      body: {
        ...(args.status !== undefined ? { status: args.status } : {}),
        ...(args.classification !== undefined ? { classification: args.classification } : {}),
        ...(args.pending_questions !== undefined ? { pending_questions: args.pending_questions } : {}),
        ...(args.message !== undefined
          ? { message: args.message, message_role: args.message_role ?? "pm" }
          : {}),
      },
    }) as { data?: ThreadRow | null };

    if (!json?.data) {
      throw new BoardApiError("board returned no thread data");
    }
    return { ok: true, result: json.data };
  } catch (err) {
    return handleToolError("update_thread", err, ctx);
  }
}

// ---------------------------------------------------------------------------
// Tool: classify_input
// ---------------------------------------------------------------------------

interface ClassifyInputArgs {
  text: string;
  affected_areas?: string[];
  has_dependencies?: boolean;
  clarity?: "clear" | "mostly_clear" | "vague" | "very_vague";
}

function isClassifyArgs(x: unknown): x is ClassifyInputArgs {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.text === "string" && o.text.length > 0;
}

async function execClassifyInput(ctx: ToolContext, rawArgs: unknown): Promise<ToolResult<ClassificationResult>> {
  if (!isClassifyArgs(rawArgs)) {
    return { ok: false, error: "text is required and must be a non-empty string", code: "invalid_args" };
  }

  const input: ClassificationInput = {
    text: rawArgs.text,
    // project context is pulled from the active ctx — we don't let the model
    // override workspace/project scope via tool args, because classification
    // results shape the next user-visible action.
  };

  try {
    // In-process call — the classifier lives in the same process as the chat
    // endpoint, so an HTTP hop would just add latency and a failure surface.
    // Mirrors how `sidekick-create.ts` dispatches `createFromClassification`
    // directly without a self-HTTP-hop.
    const result = await classify(input);
    return { ok: true, result };
  } catch (err) {
    return handleToolError("classify_input", err, ctx);
  }
}

// ---------------------------------------------------------------------------
// Tool: get_project_status
// ---------------------------------------------------------------------------

async function execGetProjectStatus(ctx: ToolContext): Promise<ToolResult<ProjectStatusResult>> {
  const cacheKey = `${ctx.workspaceId}:${ctx.projectId}`;
  const now = Date.now();
  const cached = projectStatusCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { ok: true, result: cached.value };
  }

  try {
    // Single Board endpoint that aggregates everything — we don't issue
    // parallel queries here because the board-side aggregate route already
    // batches them and returns a consistent snapshot.
    const json = await callBoard(ctx, {
      method: "GET",
      path: `/api/projects/${encodeURIComponent(ctx.projectId)}/status`,
    }) as { data?: ProjectStatusResult | null };

    if (!json?.data) {
      throw new BoardApiError("board returned no project status data");
    }

    projectStatusCache.set(cacheKey, { value: json.data, expiresAt: now + PROJECT_STATUS_CACHE_TTL_MS });
    return { ok: true, result: json.data };
  } catch (err) {
    return handleToolError("get_project_status", err, ctx);
  }
}

// ---------------------------------------------------------------------------
// Error handling — consistent Sentry + logger path for every tool.
// ---------------------------------------------------------------------------

function handleToolError(toolName: string, err: unknown, ctx: ToolContext): ToolFailure {
  const message = err instanceof Error ? err.message : String(err);
  const status = err instanceof BoardApiError ? err.status : undefined;
  const code = err instanceof BoardApiError
    ? `board_${status ?? "error"}`
    : err instanceof ValidationError
      ? "validation_error"
      : "tool_error";

  logger.error(
    { err: message, tool: toolName, projectId: ctx.projectId, workspaceId: ctx.workspaceId, status },
    `sidekick-tools: ${toolName} failed`,
  );
  Sentry.captureException(err, {
    tags: { tool: toolName, area: "sidekick-tools" },
    extra: { projectId: ctx.projectId, workspaceId: ctx.workspaceId, status },
  });

  return { ok: false, error: message, code };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SIDEKICK_TOOLS: Record<string, ToolDefinition> = {
  create_ticket: {
    schema: SCHEMAS.create_ticket,
    execute: (ctx, args) => execCreateTicket(ctx, args),
  },
  search_tickets: {
    schema: SCHEMAS.search_tickets,
    execute: (ctx, args) => execSearchTickets(ctx, args),
  },
  list_my_tickets: {
    schema: SCHEMAS.list_my_tickets,
    execute: (ctx, args) => execListMyTickets(ctx, args),
  },
  create_thread: {
    schema: SCHEMAS.create_thread,
    execute: (ctx, args) => execCreateThread(ctx, args),
  },
  update_thread: {
    schema: SCHEMAS.update_thread,
    execute: (ctx, args) => execUpdateThread(ctx, args),
  },
  classify_input: {
    schema: SCHEMAS.classify_input,
    execute: (ctx, args) => execClassifyInput(ctx, args),
  },
  get_project_status: {
    schema: SCHEMAS.get_project_status,
    execute: (ctx, _args) => execGetProjectStatus(ctx),
  },
};

/** List of tool schemas ready to pass into a Claude tool-use call. */
export function listSidekickToolSchemas(): ToolSchema[] {
  return Object.values(SIDEKICK_TOOLS).map(t => t.schema);
}

/**
 * Execute a named tool call. Returns a `ToolResult` — never throws. The chat
 * endpoint converts `ToolFailure` into a `tool_result` event with
 * `is_error: true` so the model sees the error and can recover.
 */
export async function executeSidekickTool(
  name: string,
  ctx: ToolContext,
  args: unknown,
): Promise<ToolResult> {
  const tool = SIDEKICK_TOOLS[name];
  if (!tool) {
    return {
      ok: false,
      error: `unknown tool '${name}'`,
      code: "unknown_tool",
    };
  }
  return tool.execute(ctx, args);
}
