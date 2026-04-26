import { z } from "zod";
import { logger } from "./logger.ts";
import { Sentry } from "./sentry.ts";
import {
  createFromClassification,
  createProjectFromIdea,
  validateCreateRequest,
  BoardApiError,
  ValidationError,
  type BoardClientConfig,
  type CreateRequest,
  type CreateResult,
  type CreatedTicket,
  type CreatedProject,
} from "./sidekick-create.ts";
import {
  createThread as createThreadRow,
  getThread as getThreadRow,
  updateThread as updateThreadRow,
  THREAD_STATUSES,
  ThreadNotFoundError,
  ThreadTransitionError,
  ThreadValidationError,
  type Thread,
  type ThreadStatus,
} from "./threads-store.ts";
import { runAuditAsTool } from "./audit-runtime.ts";

/**
 * Sidekick reasoning-first tool layer — T-983 (child of T-978).
 *
 * Defines the seven tools the reasoning-first Sidekick orchestrator exposes
 * to Claude via tool-use. Replaces the classifier-first model that lived in
 * `sidekick-tools.ts` — the old classifier path was removed in T-979.
 *
 * Four artifact tools produce persistent board state; three expert tools
 * spawn read-only specialist agents. Each tool has a Zod schema for runtime
 * validation and an async handler. Expert-tool handlers return a stable
 * `not_implemented` error until T-980 ("Audit agent runtime") lands — this
 * is explicitly called out in the ticket's out-of-scope section.
 *
 * Plan: docs/superpowers/plans/2026-04-23-sidekick-reasoning-architecture.md
 * Section 3.1 defines the seven tools; section 3.6 the thread scoping.
 */

// ---------------------------------------------------------------------------
// Expert-skill enum — passed as a parameter to expert tools, not as a tool.
// Keeps the tool surface narrow and the specialist surface extensible.
// ---------------------------------------------------------------------------

export const EXPERT_SKILLS = [
  "design-lead",
  "product-cto",
  "backend",
  "frontend-design",
  "creative-design",
  "data-engineer",
  "ux-planning",
  "ticket-writer",
] as const;

export type ExpertSkill = (typeof EXPERT_SKILLS)[number];

// ---------------------------------------------------------------------------
// Zod schemas — one per tool. Input validation lives on these; handlers
// receive the already-parsed, typed value. The JSON Schema payload for the
// Anthropic SDK is derived from the Zod schema (see toolSchemas()).
// ---------------------------------------------------------------------------

const zProjectId = z.string().min(1, "project_id is required");
const zWorkspaceId = z.string().min(1, "workspace_id is required");
const zTitle = z.string().trim().min(1).max(200);
const zBody = z.string().trim().min(1).max(20_000);
const zPriority = z.enum(["high", "medium", "low"]);
const zTags = z.array(z.string()).optional();
const zExpertSkill = z.enum(EXPERT_SKILLS);

export const CreateTicketSchema = z.object({
  title: zTitle,
  body: zBody,
  priority: zPriority.default("medium"),
  project_id: zProjectId,
  tags: zTags,
});

const zChildTicket = z.object({
  title: zTitle,
  body: zBody,
  priority: zPriority.optional(),
  tags: zTags,
  // T-903: per-child project override — required when the epic is
  // cross-project (`project_id: null` at the top level).
  project_id: z.string().min(1).optional(),
});

export const CreateEpicSchema = z.object({
  title: zTitle,
  body: zBody,
  children: z.array(zChildTicket).min(1).max(20),
  // `null` = workspace-scoped cross-project epic. Every child MUST then carry
  // its own project_id; the artifact handler forwards to the sidekick-create
  // primitive, which enforces this invariant (see validateCreateRequest).
  project_id: z.union([zProjectId, z.null()]),
  priority: zPriority.default("medium"),
  tags: zTags,
});

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(2_000),
  workspace_id: zWorkspaceId,
  // Strict literal-true gate. The Sidekick asks the user exactly once for
  // confirmation before creating a project (the single exception to the
  // no-confirm rule from T-876). Any other value rejects the call so a buggy
  // orchestrator cannot sidestep the confirmation.
  confirmed: z.literal(true),
});

export const StartConversationThreadSchema = z.object({
  topic: zTitle,
  initial_context: z.string().trim().min(1).max(10_000),
  project_id: zProjectId,
});

// `update_thread_status` — drive the thread state machine from the chat.
// Uses the canonical THREAD_STATUSES enum so adding a status to the store
// automatically widens the tool surface (and the snapshot test on the
// system prompt forces a version bump if descriptions drift).
const zThreadStatus = z.enum(THREAD_STATUSES);

export const UpdateThreadStatusSchema = z.object({
  thread_id: z.string().trim().min(1),
  status: zThreadStatus,
});

const zAuditScope = z.string().trim().min(1).max(500);

export const RunExpertAuditSchema = z.object({
  scope: zAuditScope,
  expert_skill: zExpertSkill,
  project_id: zProjectId,
});

export const ConsultExpertSchema = z.object({
  question: z.string().trim().min(1).max(2_000),
  expert_skill: zExpertSkill,
  project_id: zProjectId,
});

export const StartSparringSchema = z.object({
  topic: zTitle,
  experts: z.array(zExpertSkill).min(1).max(4),
  project_id: zProjectId.optional(),
});

// ---------------------------------------------------------------------------
// Tool result + failure shape
// ---------------------------------------------------------------------------

export interface ToolSuccess<T = unknown> { ok: true; result: T }
export interface ToolFailure { ok: false; error: string; code: string }
export type ToolResult<T = unknown> = ToolSuccess<T> | ToolFailure;

export interface ToolContext {
  /** Board API base URL, e.g. "https://board.just-ship.io". No trailing slash. */
  apiUrl: string;
  /** Board pipeline key (workspace- or project-scoped). */
  apiKey: string;
  /** Active workspace uuid — stamped onto created threads. */
  workspaceId: string;
  /** User uuid — stamped onto created threads; required for thread creation. */
  userId?: string;
  /** Board web base URL, used to build `url` fields in artifact responses. */
  boardUrl?: string;
  /** Request timeout in ms for Board API calls. Defaults to 10_000. */
  timeoutMs?: number;
  /** Injected for tests. Defaults to global fetch. */
  fetchFn?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Artifact tool: create_ticket
// ---------------------------------------------------------------------------

export interface CreatedTicketResult {
  number: number;
  id: string;
  title: string;
  url: string;
}

async function execCreateTicket(
  ctx: ToolContext,
  args: z.infer<typeof CreateTicketSchema>,
): Promise<ToolResult<CreatedTicketResult>> {
  const req: CreateRequest = {
    category: "ticket",
    project_id: args.project_id,
    ...(ctx.boardUrl ? { board_url: ctx.boardUrl } : {}),
    ticket: {
      title: args.title,
      body: args.body,
      priority: args.priority,
      ...(args.tags && args.tags.length > 0 ? { tags: args.tags } : {}),
    },
  };

  const cfg = toBoardCfg(ctx);

  try {
    const res = await createFromClassification(req, cfg);
    if (res.category !== "ticket") {
      // Unreachable by construction — we requested "ticket", but guard against
      // a future branch in the primitive.
      throw new Error(`unexpected create result category: ${res.category}`);
    }
    return { ok: true, result: toCreatedTicketResult(res.ticket) };
  } catch (err) {
    return handleToolError("create_ticket", err, ctx);
  }
}

// ---------------------------------------------------------------------------
// Artifact tool: create_epic
// ---------------------------------------------------------------------------

export interface CreatedEpicResult {
  epic: CreatedTicketResult;
  children: CreatedTicketResult[];
  failed_children?: Array<{ index: number; title: string; reason: string }>;
}

async function execCreateEpic(
  ctx: ToolContext,
  args: z.infer<typeof CreateEpicSchema>,
): Promise<ToolResult<CreatedEpicResult>> {
  const req: CreateRequest = {
    category: "epic",
    project_id: args.project_id,
    ...(ctx.boardUrl ? { board_url: ctx.boardUrl } : {}),
    epic: {
      title: args.title,
      body: args.body,
      priority: args.priority,
      ...(args.tags && args.tags.length > 0 ? { tags: args.tags } : {}),
    },
    children: args.children.map((c) => ({
      title: c.title,
      body: c.body,
      ...(c.priority ? { priority: c.priority } : {}),
      ...(c.tags && c.tags.length > 0 ? { tags: c.tags } : {}),
      ...(c.project_id ? { project_id: c.project_id } : {}),
    })),
  };

  const cfg = toBoardCfg(ctx);

  try {
    // Workspace-scoped epic invariant (T-903): when project_id is null, every
    // child MUST carry its own project_id. The primitive's validator enforces
    // this — run it first so we fail fast with `validation_error` instead of
    // waking the Board API and relying on its CHECK constraint.
    validateCreateRequest(req);
    const res: CreateResult = await createFromClassification(req, cfg);
    if (res.category !== "epic") {
      throw new Error(`unexpected create result category: ${res.category}`);
    }
    return {
      ok: true,
      result: {
        epic: toCreatedTicketResult(res.epic),
        children: res.children.map(toCreatedTicketResult),
        ...(res.failed_children ? { failed_children: res.failed_children } : {}),
      },
    };
  } catch (err) {
    return handleToolError("create_epic", err, ctx);
  }
}

// ---------------------------------------------------------------------------
// Artifact tool: create_project
// ---------------------------------------------------------------------------

export interface CreatedProjectResult {
  project: CreatedProject;
  epic: CreatedTicketResult;
  children: CreatedTicketResult[];
  failed_children?: Array<{ index: number; title: string; reason: string }>;
}

async function execCreateProject(
  ctx: ToolContext,
  args: z.infer<typeof CreateProjectSchema>,
): Promise<ToolResult<CreatedProjectResult>> {
  const cfg = toBoardCfg(ctx);

  try {
    const res = await createProjectFromIdea(
      {
        workspace_id: args.workspace_id,
        project_name: args.name,
        description: args.description,
        confirmed: true,
        ...(ctx.boardUrl ? { board_url: ctx.boardUrl } : {}),
      },
      cfg,
    );
    return {
      ok: true,
      result: {
        project: res.project,
        epic: toCreatedTicketResult(res.epic),
        children: res.children.map(toCreatedTicketResult),
        ...(res.failed_children ? { failed_children: res.failed_children } : {}),
      },
    };
  } catch (err) {
    return handleToolError("create_project", err, ctx);
  }
}

// ---------------------------------------------------------------------------
// Artifact tool: start_conversation_thread
// ---------------------------------------------------------------------------

export interface StartedThreadResult {
  id: string;
  status: Thread["status"];
  title: string;
  project_id: string;
  workspace_id: string;
  /** Board URL for the thread when boardUrl is configured; otherwise the raw id. */
  url: string;
}

async function execStartConversationThread(
  ctx: ToolContext,
  args: z.infer<typeof StartConversationThreadSchema>,
): Promise<ToolResult<StartedThreadResult>> {
  // Threads are user-scoped rows in the Engine-DB. A project_id alone cannot
  // determine which user owns the conversation, so we require ctx.userId.
  // The Sidekick chat endpoint (T-981) provides this from the authenticated
  // request context.
  if (!ctx.userId) {
    return {
      ok: false,
      error: "start_conversation_thread requires an authenticated user (ctx.userId missing)",
      code: "not_authenticated",
    };
  }

  // UUID guards at the tool boundary — the threads table has UUID columns, so
  // a non-UUID value would otherwise surface as a confusing Supabase 400 with
  // a raw Postgres error. The Sidekick chat endpoint (T-981) will supply
  // authenticated UUIDs; this is a defense-in-depth check against a caller
  // that wires `ctx` incorrectly or receives a non-UUID `project_id` from the
  // model's tool arguments.
  if (!isUuid(ctx.workspaceId)) {
    return {
      ok: false,
      error: "workspace_id: must be a valid UUID",
      code: "invalid_args",
    };
  }
  if (!isUuid(ctx.userId)) {
    return {
      ok: false,
      error: "user_id: must be a valid UUID",
      code: "invalid_args",
    };
  }
  if (!isUuid(args.project_id)) {
    return {
      ok: false,
      error: "project_id: must be a valid UUID",
      code: "invalid_args",
    };
  }

  // We don't stamp a `classification` on the thread row because the
  // threads-store enum is a T-shirt-sizer ("xs".."xl", "status_query") —
  // legacy of the classifier era — and the reasoning-first Sidekick has no
  // analogous concept. Leaving it null tells downstream consumers "this
  // thread came through the new orchestrator".
  //
  // `pending_questions` stays empty on creation. The field's semantic purpose
  // is "questions the PM is waiting on the CEO for" — seeding it with the
  // user's opening message would misuse it and confuse any code that reads
  // pending_questions expecting actual outstanding questions. The initial
  // context is passed to T-981's orchestrator via the tool-call arguments
  // themselves; it appends proper messages to the thread-messages table as
  // the conversation progresses.
  try {
    const row = await createThreadRow(
      {
        workspace_id: ctx.workspaceId,
        project_id: args.project_id,
        user_id: ctx.userId,
        title: args.topic,
        status: "draft",
        pending_questions: [],
      },
      ctx.fetchFn ? { fetchFn: ctx.fetchFn } : {},
    );

    return {
      ok: true,
      result: {
        id: row.id,
        status: row.status,
        title: row.title,
        project_id: row.project_id,
        workspace_id: row.workspace_id,
        url: buildThreadUrl(ctx.boardUrl, row.id),
      },
    };
  } catch (err) {
    return handleToolError("start_conversation_thread", err, ctx);
  }
}

function buildThreadUrl(boardUrl: string | undefined, threadId: string): string {
  if (!boardUrl) return threadId;
  return `${boardUrl.replace(/\/+$/, "")}/threads/${threadId}`;
}

// ---------------------------------------------------------------------------
// Artifact tool: update_thread_status
//
// Drives the thread state machine from the chat (e.g. "ready_to_plan" once the
// user signs off, "delivered" when the artifact is shipped). The handler
// enforces workspace-level ownership before delegating to the threads-store —
// the chat caller's workspace is in `ctx.workspaceId`, but the row's
// `workspace_id` is authoritative; mismatch fails closed with `forbidden`
// rather than silently writing across workspaces. We deliberately do NOT
// return `thread_not_found` for foreign rows: the chat is already
// authenticated to a workspace, so leaking "this UUID exists but elsewhere"
// is a controlled disclosure (the alternative would mask a misconfigured
// caller as a missing-row case, which is a worse debugging story).
// ---------------------------------------------------------------------------

export interface UpdatedThreadStatusResult {
  id: string;
  status: ThreadStatus;
  previous_status: ThreadStatus;
  title: string;
  url: string;
}

async function execUpdateThreadStatus(
  ctx: ToolContext,
  args: z.infer<typeof UpdateThreadStatusSchema>,
): Promise<ToolResult<UpdatedThreadStatusResult>> {
  if (!isUuid(args.thread_id)) {
    return { ok: false, error: "thread_id: must be a valid UUID", code: "invalid_args" };
  }

  const restDeps = ctx.fetchFn ? { fetchFn: ctx.fetchFn } : {};

  let current: Thread;
  try {
    current = await getThreadRow(args.thread_id, restDeps);
  } catch (err) {
    if (err instanceof ThreadNotFoundError) {
      return { ok: false, error: err.message, code: "thread_not_found" };
    }
    return handleToolError("update_thread_status", err, ctx);
  }

  // Workspace ownership check — never let a chat session in workspace A drive
  // a thread that lives in workspace B. The threads-store does not enforce
  // this at the SQL layer (PATCH by id is workspace-agnostic), so it must
  // happen here before the write. Sentry-captured because a cross-workspace
  // attempt is either a configuration bug or an attack — both warrant a
  // visible signal in the error tracker, not just a log line.
  if (current.workspace_id !== ctx.workspaceId) {
    logger.warn(
      { threadId: args.thread_id, expectedWorkspace: ctx.workspaceId, actualWorkspace: current.workspace_id },
      "update_thread_status: cross-workspace attempt rejected",
    );
    Sentry.captureMessage("update_thread_status: cross-workspace attempt rejected", {
      level: "warning",
      tags: { tool: "update_thread_status", area: "sidekick-reasoning-tools", outcome: "forbidden" },
      extra: {
        threadId: args.thread_id,
        expectedWorkspace: ctx.workspaceId,
        actualWorkspace: current.workspace_id,
      },
    });
    return { ok: false, error: "thread does not belong to this workspace", code: "forbidden" };
  }

  // No-op short circuit. Returning success keeps the model out of a retry
  // loop if it requests the same status the thread is already in.
  if (current.status === args.status) {
    return {
      ok: true,
      result: {
        id: current.id,
        status: current.status,
        previous_status: current.status,
        title: current.title,
        url: buildThreadUrl(ctx.boardUrl, current.id),
      },
    };
  }

  let updated: Thread;
  try {
    updated = await updateThreadRow(args.thread_id, { status: args.status }, restDeps);
  } catch (err) {
    if (err instanceof ThreadTransitionError) {
      return { ok: false, error: err.message, code: "invalid_transition" };
    }
    if (err instanceof ThreadValidationError) {
      return { ok: false, error: err.message, code: "validation_error" };
    }
    if (err instanceof ThreadNotFoundError) {
      return { ok: false, error: err.message, code: "thread_not_found" };
    }
    return handleToolError("update_thread_status", err, ctx);
  }

  return {
    ok: true,
    result: {
      id: updated.id,
      status: updated.status,
      previous_status: current.status,
      title: updated.title,
      url: buildThreadUrl(ctx.boardUrl, updated.id),
    },
  };
}

// Format-only UUID check — matches threads-store's existing private helper so
// behavior stays in lockstep. We intentionally do NOT enforce the RFC-4122
// version/variant nibbles because test fixtures and legacy IDs in the codebase
// use all-zero or all-repeated UUIDs that don't set those bits, and the
// Postgres uuid column itself is version-agnostic.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// ---------------------------------------------------------------------------
// Expert tools — spawn read-only specialist agents. The actual audit runtime
// (T-980) is not part of this ticket; handlers return a stable
// `not_implemented` failure so the orchestrator sees a clean error and
// recovers gracefully. This matches the pattern used in the old
// `sidekick-tools.ts` for unwired board endpoints (see its module doc).
//
// When T-980 lands it replaces the body of these three handlers; the schemas,
// registry entry, and ToolResult shape stay stable.
// ---------------------------------------------------------------------------

const EXPERT_RUNTIME_PENDING_CODE = "expert_runtime_not_implemented";
const EXPERT_RUNTIME_PENDING_MSG =
  "expert runtime is not yet available — audit/consult/sparring tools will be wired in T-980";

export interface AuditFinding {
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  evidence?: { files?: string[]; lines?: string; quote?: string };
  suggested_fix?: string;
}

export interface AuditReport {
  scope: string;
  expert: ExpertSkill;
  findings: AuditFinding[];
  summary: string;
}

async function execRunExpertAudit(
  _ctx: ToolContext,
  args: z.infer<typeof RunExpertAuditSchema>,
): Promise<ToolResult<AuditReport>> {
  // Delegates to the audit runtime in `audit-runtime.ts`. The runtime owns the
  // read-only tool whitelist, the canUseTool callback, the 5-minute hard cap,
  // and the Sentry instrumentation. Keeping this handler thin means the tool
  // registry stays focused on the tool-use API surface; the runtime can evolve
  // (add caching, swap model, change prompt) without touching this file.
  //
  // ctx is intentionally unused — the audit agent has no board access, no
  // pipeline key, and no user bearer. That's the whole point of the read-only
  // contract (see .claude/rules/expert-audit-scope.md).
  return runAuditAsTool({
    scope: args.scope,
    expertSkill: args.expert_skill,
    projectId: args.project_id,
  });
}

export interface ConsultResponse {
  expert: ExpertSkill;
  answer: string;
}

async function execConsultExpert(
  _ctx: ToolContext,
  _args: z.infer<typeof ConsultExpertSchema>,
): Promise<ToolResult<ConsultResponse>> {
  return { ok: false, error: EXPERT_RUNTIME_PENDING_MSG, code: EXPERT_RUNTIME_PENDING_CODE };
}

export interface StartedSparringResult {
  thread_id: string;
  topic: string;
  experts: ExpertSkill[];
}

async function execStartSparring(
  _ctx: ToolContext,
  _args: z.infer<typeof StartSparringSchema>,
): Promise<ToolResult<StartedSparringResult>> {
  return { ok: false, error: EXPERT_RUNTIME_PENDING_MSG, code: EXPERT_RUNTIME_PENDING_CODE };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function toBoardCfg(ctx: ToolContext): BoardClientConfig {
  return {
    apiUrl: ctx.apiUrl,
    apiKey: ctx.apiKey,
    ...(ctx.timeoutMs ? { timeoutMs: ctx.timeoutMs } : {}),
    ...(ctx.fetchFn ? { fetchFn: ctx.fetchFn } : {}),
  };
}

function toCreatedTicketResult(t: CreatedTicket): CreatedTicketResult {
  return { number: t.number, id: t.id, title: t.title, url: t.url };
}

function handleToolError(toolName: string, err: unknown, ctx: ToolContext): ToolFailure {
  const message = err instanceof Error ? err.message : String(err);
  const status = err instanceof BoardApiError ? err.status : undefined;
  let code: string;
  if (err instanceof BoardApiError) {
    code = `board_${status ?? "error"}`;
  } else if (err instanceof ValidationError) {
    code = "validation_error";
  } else {
    code = "tool_error";
  }

  logger.error(
    { err: message, tool: toolName, workspaceId: ctx.workspaceId, status },
    `sidekick-reasoning-tools: ${toolName} failed`,
  );
  Sentry.captureException(err, {
    tags: { tool: toolName, area: "sidekick-reasoning-tools" },
    extra: { workspaceId: ctx.workspaceId, status },
  });

  return { ok: false, error: message, code };
}

// ---------------------------------------------------------------------------
// Tool registry — single place that lists all seven tools with their schemas
// and handlers. Consumed by the Sidekick orchestrator (T-981) via
// `toolSchemas()` (JSON Schema for the Anthropic SDK tool-use contract) and
// `executeSidekickReasoningTool()` (dispatch by name).
// ---------------------------------------------------------------------------

type AnyToolSchema = z.ZodTypeAny;

export interface ToolDefinition<S extends AnyToolSchema = AnyToolSchema> {
  name: string;
  description: string;
  schema: S;
  execute(ctx: ToolContext, args: z.infer<S>): Promise<ToolResult>;
}

// `satisfies` keeps each entry's schema/execute typed without widening the
// overall record type. Order matches the plan's section 3.1: artifact tools
// first (persistent), expert tools second (spawn specialists).
export const SIDEKICK_REASONING_TOOLS = {
  create_ticket: {
    name: "create_ticket",
    description:
      "Create a single ticket for one concrete change with a clear outcome (bug fix, copy tweak, one feature add). Do NOT ask the user to confirm — the CEO steers the product, the team ships artifacts.",
    schema: CreateTicketSchema,
    execute: execCreateTicket,
  },
  create_epic: {
    name: "create_epic",
    description:
      "Create an epic plus its child tickets when the user wants multiple connected changes (feature with several parts, cross-cutting initiative). Pass `project_id: null` for workspace-scoped cross-project epics; every child must then carry its own project_id.",
    schema: CreateEpicSchema,
    execute: execCreateEpic,
  },
  create_project: {
    name: "create_project",
    description:
      "Create a new project when the user pitches a genuinely new product or audience. REQUIRES `confirmed: true` — the Sidekick must ask the user once before calling this tool (the only exception to the no-confirm rule).",
    schema: CreateProjectSchema,
    execute: execCreateProject,
  },
  start_conversation_thread: {
    name: "start_conversation_thread",
    description:
      "Open a persistent conversation thread for multi-turn dialog when direction is uncertain and needs shaping (user has an idea, unsure scope, wants to sketch). Maps to the Engine thread status machine (draft → waiting_for_input → ready_to_plan → delivered).",
    schema: StartConversationThreadSchema,
    execute: execStartConversationThread,
  },
  update_thread_status: {
    name: "update_thread_status",
    description:
      "Move a thread along the state machine (e.g. draft → ready_to_plan once scope is locked, in_progress → delivered when shipped). Pass the thread's UUID and the target status. Allowed transitions are enforced by the store; the tool returns invalid_transition for any non-allowed jump.",
    schema: UpdateThreadStatusSchema,
    execute: execUpdateThreadStatus,
  },
  run_expert_audit: {
    name: "run_expert_audit",
    description:
      "Spawn a read-only specialist agent for analysis, review, or consistency check (\"schau dir X an\", \"audit\", \"review\"). Returns a structured findings report. The specialist cannot edit files or create tickets — it reports, and the Sidekick decides what to ship.",
    schema: RunExpertAuditSchema,
    execute: execRunExpertAudit,
  },
  consult_expert: {
    name: "consult_expert",
    description:
      "Ask a specialist a knowledge or diagnosis question (\"wie denkst du über X\", \"warum passiert Y\", \"best practice für Z\"). Returns the expert's answer as text. No file access, no artifact creation.",
    schema: ConsultExpertSchema,
    execute: execConsultExpert,
  },
  start_sparring: {
    name: "start_sparring",
    description:
      "Open a sparring session with one or more specialists as peers when the user wants to think through a strategic question. Loads the sparring skill with the named experts. Thread-backed so the discussion can pause and resume.",
    schema: StartSparringSchema,
    execute: execStartSparring,
  },
} satisfies Record<string, ToolDefinition<AnyToolSchema>>;

export type SidekickReasoningToolName = keyof typeof SIDEKICK_REASONING_TOOLS;

/**
 * Convert a Zod schema to a JSON-Schema payload consumable by the Anthropic
 * SDK's tool-use contract. Zod v4 ships `z.toJSONSchema` natively and it
 * produces the shape the SDK expects (properties/required/additionalProperties)
 * — we wrap it in a thin adapter so the rest of the module doesn't depend on
 * Zod's output exactly matching the SDK's input type.
 *
 * The SDK-accepted subset we rely on: strings (with minLength/maxLength),
 * numbers, booleans, enums, literals (emitted as `const`), arrays (with
 * minItems/maxItems), objects with `properties`/`required`/`additionalProperties`,
 * and string-or-null unions (emitted as `anyOf`).
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const out = z.toJSONSchema(schema) as Record<string, unknown>;
  // Strip the `$schema` meta field — the Anthropic SDK rejects unexpected
  // top-level keys in `input_schema`, and the draft URI adds noise without
  // changing semantics.
  delete out.$schema;
  return out;
}

/**
 * Return all seven tools in the shape the Anthropic SDK expects for its
 * tool-use loop: `{ name, description, input_schema }`. Pass the result
 * directly into `client.messages.create({ tools: ... })` in T-981.
 */
export function toolSchemas(): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return Object.values(SIDEKICK_REASONING_TOOLS).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: zodToJsonSchema(t.schema),
  }));
}

/**
 * Dispatch a tool call by name. Validates the arguments with the tool's Zod
 * schema before handing them to the handler — invalid shapes return a
 * structured `ToolFailure` rather than throwing, so the tool-use loop sees
 * a recoverable error and the model can retry.
 *
 * The cast to `z.ZodTypeAny` / `unknown` is load-bearing: TypeScript cannot
 * prove that the schema for tool X produces args that X's handler accepts
 * because we index by runtime name. The cast collapses the union — runtime
 * validation via `schema.parse` provides the actual safety.
 */
export async function executeSidekickReasoningTool(
  name: string,
  ctx: ToolContext,
  rawArgs: unknown,
): Promise<ToolResult> {
  const tool = (SIDEKICK_REASONING_TOOLS as Record<string, ToolDefinition<z.ZodTypeAny>>)[name];
  if (!tool) {
    return { ok: false, error: `unknown tool '${name}'`, code: "unknown_tool" };
  }

  const parsed = tool.schema.safeParse(rawArgs);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return {
      ok: false,
      error: `${path}: ${issue.message}`,
      code: "invalid_args",
    };
  }

  return tool.execute(ctx, parsed.data as never);
}

/** List of tool names in registry order. */
export function listSidekickReasoningToolNames(): SidekickReasoningToolName[] {
  return Object.keys(SIDEKICK_REASONING_TOOLS) as SidekickReasoningToolName[];
}
