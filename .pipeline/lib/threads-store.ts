/**
 * CRUD store for threads + thread_messages in the Engine-DB (Supabase).
 * Assumes migration 005_sidekick_threads.sql has been applied.
 *
 * Test seam: each exported function accepts an optional `deps` arg with a custom
 * `fetchFn`. This lets tests stub the HTTP layer without a live Supabase instance.
 * See sidekick-conversations-store.ts for the same pattern and rationale.
 */

import { supabaseGet, supabasePost, supabasePatch, type SupabaseRestOptions } from "./supabase-rest.ts";
import { logger } from "./logger.ts";

// ---------------------------------------------------------------------------
// UUID validation (same regex as conversations store)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// ---------------------------------------------------------------------------
// Status + classification enums
// ---------------------------------------------------------------------------

export const THREAD_STATUSES = [
  "draft",
  "waiting_for_input",
  "ready_to_plan",
  "planned",
  "approved",
  "in_progress",
  "delivered",
  "closed",
  "parked",
] as const;

export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export const THREAD_CLASSIFICATIONS = [
  "xs",
  "s",
  "m",
  "l",
  "xl",
  "status_query",
] as const;

export type ThreadClassification = (typeof THREAD_CLASSIFICATIONS)[number];

// ---------------------------------------------------------------------------
// Transition map
// ---------------------------------------------------------------------------

export const THREAD_ALLOWED_TRANSITIONS: Readonly<Record<ThreadStatus, readonly ThreadStatus[]>> = {
  draft:               ["waiting_for_input", "ready_to_plan", "parked", "closed"],
  waiting_for_input:   ["draft", "ready_to_plan", "parked", "closed"],
  ready_to_plan:       ["planned", "waiting_for_input", "parked", "closed"],
  planned:             ["approved", "waiting_for_input", "parked", "closed"],
  approved:            ["in_progress", "planned", "parked", "closed"],
  in_progress:         ["delivered", "approved", "parked", "closed"],
  delivered:           ["closed", "in_progress", "parked"],
  parked:              ["draft", "waiting_for_input", "ready_to_plan", "closed"],
  closed:              [],
};

export function isAllowedTransition(from: ThreadStatus, to: ThreadStatus): boolean {
  return (THREAD_ALLOWED_TRANSITIONS[from] as readonly string[]).includes(to);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Thread {
  id: string;
  workspace_id: string;
  project_id: string;
  user_id: string;
  title: string;
  status: ThreadStatus;
  classification: ThreadClassification | null;
  pending_questions: unknown;
  last_activity_at: string;
  next_reminder_at: string | null;
  reminder_count: number;
  created_at: string;
  updated_at: string;
}

export interface ThreadMessage {
  id: string;
  thread_id: string;
  role: "ceo" | "pm" | "system";
  content: string;
  attachments: unknown;
  metadata: unknown;
  created_at: string;
}

export interface CreateThreadInput {
  workspace_id: string;
  project_id: string;
  user_id: string;
  title: string;
  status?: ThreadStatus;
  classification?: ThreadClassification;
  pending_questions?: unknown;
}

export interface UpdateThreadInput {
  status?: ThreadStatus;
  classification?: ThreadClassification | null;
  title?: string;
  pending_questions?: unknown;
  next_reminder_at?: string | null;
  reminder_count?: number;
}

export interface ListThreadMessagesOptions {
  limit?: number;
  offset?: number;
}

export interface ListThreadMessagesResult {
  messages: ThreadMessage[];
  has_more: boolean;
}

export interface ListThreadsOptions {
  project_id?: string;
  user_id?: string;
  workspace_id?: string;
  status?: ThreadStatus | ThreadStatus[];
  limit?: number;
  offset?: number;
}

export interface ListThreadsResult {
  threads: Thread[];
  has_more: boolean;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class ThreadNotFoundError extends Error {
  constructor(id: string) {
    super(`thread ${id} not found`);
    this.name = "ThreadNotFoundError";
  }
}

export class ThreadValidationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ThreadValidationError";
  }
}

export class ThreadTransitionError extends Error {
  constructor(
    public readonly from: ThreadStatus,
    public readonly to: ThreadStatus,
  ) {
    super(`illegal transition: ${from} -> ${to}`);
    this.name = "ThreadTransitionError";
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const TITLE_MIN = 1;
const TITLE_MAX = 200;
const LIST_LIMIT_MIN = 1;
const LIST_LIMIT_MAX = 200;
const LIST_LIMIT_DEFAULT = 50;
const LIST_OFFSET_DEFAULT = 0;

export function validateCreateThreadRequest(body: unknown): CreateThreadInput {
  if (typeof body !== "object" || body === null) {
    throw new ThreadValidationError("body must be a JSON object");
  }
  const obj = body as Record<string, unknown>;

  if (!isUuid(obj.workspace_id)) {
    throw new ThreadValidationError("workspace_id: must be a valid UUID");
  }
  if (!isUuid(obj.project_id)) {
    throw new ThreadValidationError("project_id: must be a valid UUID");
  }
  if (!isUuid(obj.user_id)) {
    throw new ThreadValidationError("user_id: must be a valid UUID");
  }

  const title = obj.title;
  if (typeof title !== "string" || title.trim().length < TITLE_MIN) {
    throw new ThreadValidationError("title: must be a non-empty string");
  }
  if (title.length > TITLE_MAX) {
    throw new ThreadValidationError(`title: must be <= ${TITLE_MAX} chars`);
  }

  const status = obj.status;
  if (status !== undefined && !(THREAD_STATUSES as readonly unknown[]).includes(status)) {
    throw new ThreadValidationError(
      `status: must be one of ${THREAD_STATUSES.join(", ")}`,
    );
  }

  const classification = obj.classification;
  if (
    classification !== undefined &&
    !(THREAD_CLASSIFICATIONS as readonly unknown[]).includes(classification)
  ) {
    throw new ThreadValidationError(
      `classification: must be one of ${THREAD_CLASSIFICATIONS.join(", ")}`,
    );
  }

  const pending_questions = obj.pending_questions;
  if (pending_questions !== undefined && !Array.isArray(pending_questions)) {
    throw new ThreadValidationError("pending_questions: must be an array when provided");
  }

  return {
    workspace_id: obj.workspace_id as string,
    project_id: obj.project_id as string,
    user_id: obj.user_id as string,
    title: title.trim(),
    ...(status !== undefined ? { status: status as ThreadStatus } : {}),
    ...(classification !== undefined ? { classification: classification as ThreadClassification } : {}),
    ...(pending_questions !== undefined ? { pending_questions } : {}),
  };
}

export function validateUpdateThreadRequest(body: unknown): UpdateThreadInput {
  if (typeof body !== "object" || body === null) {
    throw new ThreadValidationError("body must be a JSON object");
  }
  const obj = body as Record<string, unknown>;

  const out: UpdateThreadInput = {};

  if (obj.status !== undefined) {
    if (!(THREAD_STATUSES as readonly unknown[]).includes(obj.status)) {
      throw new ThreadValidationError(
        `status: must be one of ${THREAD_STATUSES.join(", ")}`,
      );
    }
    out.status = obj.status as ThreadStatus;
  }

  if ("classification" in obj) {
    const c = obj.classification;
    if (c === null) {
      out.classification = null;
    } else if ((THREAD_CLASSIFICATIONS as readonly unknown[]).includes(c)) {
      out.classification = c as ThreadClassification;
    } else {
      throw new ThreadValidationError(
        `classification: must be one of ${THREAD_CLASSIFICATIONS.join(", ")} or null`,
      );
    }
  }

  if (obj.title !== undefined) {
    if (typeof obj.title !== "string" || obj.title.trim().length < TITLE_MIN) {
      throw new ThreadValidationError("title: must be a non-empty string when provided");
    }
    if (obj.title.length > TITLE_MAX) {
      throw new ThreadValidationError(`title: must be <= ${TITLE_MAX} chars`);
    }
    out.title = obj.title.trim();
  }

  if (obj.pending_questions !== undefined) {
    if (!Array.isArray(obj.pending_questions)) {
      throw new ThreadValidationError("pending_questions: must be an array when provided");
    }
    out.pending_questions = obj.pending_questions;
  }

  if ("next_reminder_at" in obj) {
    const nra = obj.next_reminder_at;
    if (nra === null) {
      out.next_reminder_at = null;
    } else if (typeof nra === "string") {
      out.next_reminder_at = nra;
    } else {
      throw new ThreadValidationError("next_reminder_at: must be an ISO string or null");
    }
  }

  if (obj.reminder_count !== undefined) {
    if (typeof obj.reminder_count !== "number" || !Number.isInteger(obj.reminder_count) || obj.reminder_count < 0) {
      throw new ThreadValidationError("reminder_count: must be a non-negative integer");
    }
    out.reminder_count = obj.reminder_count;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Store dependencies (test seam)
// ---------------------------------------------------------------------------

export interface ThreadStoreDeps {
  fetchFn?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

/**
 * Create a new thread row. Defaults status to "draft" when not provided.
 * Throws ThreadValidationError on input violation.
 * Throws Error on unexpected Supabase failure.
 */
export async function createThread(
  input: CreateThreadInput,
  deps: ThreadStoreDeps = {},
): Promise<Thread> {
  const opts: SupabaseRestOptions = {
    expectSingle: true,
    ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
  };

  const row = await supabasePost<Thread>(
    "/rest/v1/threads?select=*",
    {
      workspace_id: input.workspace_id,
      project_id: input.project_id,
      user_id: input.user_id,
      title: input.title,
      status: input.status ?? "draft",
      ...(input.classification !== undefined ? { classification: input.classification } : {}),
      ...(input.pending_questions !== undefined ? { pending_questions: input.pending_questions } : {}),
    },
    opts,
  );

  if (!row) {
    const err = new Error("Failed to create thread — Supabase returned null");
    logger.error({ input }, err.message);
    throw err;
  }

  logger.info({ threadId: row.id, projectId: input.project_id, status: row.status }, "Created thread");
  return row;
}

/**
 * Fetch a single thread by ID.
 * Throws ThreadNotFoundError if it does not exist.
 */
export async function getThread(id: string, deps: ThreadStoreDeps = {}): Promise<Thread> {
  const opts: SupabaseRestOptions = deps.fetchFn ? { fetchFn: deps.fetchFn } : {};

  const rows = await supabaseGet<Thread[]>(
    `/rest/v1/threads?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    opts,
  );

  if (!rows || rows.length === 0) {
    throw new ThreadNotFoundError(id);
  }

  return rows[0];
}

/**
 * Update thread fields. Validates status transitions before PATCHing.
 * Throws ThreadNotFoundError, ThreadTransitionError, ThreadValidationError.
 */
export async function updateThread(
  id: string,
  patch: UpdateThreadInput,
  deps: ThreadStoreDeps = {},
): Promise<Thread> {
  // Read current state to validate the transition.
  // TOCTOU note: the GET-then-PATCH pattern is not atomic at the DB level. Two
  // concurrent PATCHes can both read the same current status, both pass the
  // transition check, and both write a new status. This is an accepted tradeoff:
  //   - Thread status transitions are low-frequency and human-initiated.
  //   - The Sidekick UI serialises transitions per-thread per-user in practice.
  //   - A true atomic check would require a Supabase stored procedure or a CHECK
  //     constraint that references the old row — neither is worth the added
  //     schema complexity at this stage.
  // If two concurrent callers race and both win, the second write wins; the
  // resulting status is still valid (it was allowed from the same source state).
  const current = await getThread(id, deps);

  if (patch.status !== undefined && patch.status !== current.status) {
    if (!isAllowedTransition(current.status, patch.status)) {
      throw new ThreadTransitionError(current.status, patch.status);
    }
  }

  const opts: SupabaseRestOptions = {
    expectSingle: false,
    ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
  };

  // Build the PATCH body — only send fields that are present in the patch.
  // `classification` and `next_reminder_at` can be null (explicit clear).
  const patchBody: Record<string, unknown> = {};
  if (patch.status !== undefined) patchBody.status = patch.status;
  if ("classification" in patch) patchBody.classification = patch.classification;
  if (patch.title !== undefined) patchBody.title = patch.title;
  if (patch.pending_questions !== undefined) patchBody.pending_questions = patch.pending_questions;
  if ("next_reminder_at" in patch) patchBody.next_reminder_at = patch.next_reminder_at;
  if (patch.reminder_count !== undefined) patchBody.reminder_count = patch.reminder_count;

  const rows = await supabasePatch<Thread[]>(
    `/rest/v1/threads?id=eq.${encodeURIComponent(id)}&select=*`,
    patchBody,
    opts,
  );

  if (!rows || rows.length === 0) {
    throw new ThreadNotFoundError(id);
  }

  logger.info({ threadId: id, patch: Object.keys(patchBody) }, "Updated thread");
  return rows[0];
}

/**
 * List messages for a thread, paginated by created_at ASC.
 * Throws ThreadNotFoundError if the thread does not exist.
 * limit: 1-200 (default 50), offset: >= 0 (default 0).
 */
export async function listThreadMessages(
  threadId: string,
  opts: ListThreadMessagesOptions = {},
  deps: ThreadStoreDeps = {},
): Promise<ListThreadMessagesResult> {
  const restOpts: SupabaseRestOptions = deps.fetchFn ? { fetchFn: deps.fetchFn } : {};

  const limit = Math.min(
    LIST_LIMIT_MAX,
    Math.max(LIST_LIMIT_MIN, opts.limit ?? LIST_LIMIT_DEFAULT),
  );
  const offset = Math.max(0, opts.offset ?? LIST_OFFSET_DEFAULT);

  // Verify thread exists
  const existenceCheck = await supabaseGet<Thread[]>(
    `/rest/v1/threads?id=eq.${encodeURIComponent(threadId)}&select=id&limit=1`,
    restOpts,
  );

  if (!existenceCheck || existenceCheck.length === 0) {
    throw new ThreadNotFoundError(threadId);
  }

  // Fetch limit+1 to detect has_more
  const fetchLimit = limit + 1;
  const rows = await supabaseGet<ThreadMessage[]>(
    `/rest/v1/thread_messages?thread_id=eq.${encodeURIComponent(threadId)}&order=created_at.asc&limit=${fetchLimit}&offset=${offset}`,
    restOpts,
  );

  const allRows = rows ?? [];
  const has_more = allRows.length > limit;
  const messages = has_more ? allRows.slice(0, limit) : allRows;

  return { messages, has_more };
}

/**
 * List threads with optional filters. At least one of project_id / user_id /
 * workspace_id must be provided — an unfiltered listing across the whole table
 * would surface other workspaces' threads. `status` is an optional single value
 * or an array of statuses (e.g. all non-closed for an "open threads" view).
 * Ordered by last_activity_at DESC so the most recently-touched threads surface
 * first — which is what a user scanning "my open threads" expects.
 */
export async function listThreads(
  opts: ListThreadsOptions,
  deps: ThreadStoreDeps = {},
): Promise<ListThreadsResult> {
  if (!opts.project_id && !opts.user_id && !opts.workspace_id) {
    throw new ThreadValidationError(
      "listThreads requires at least one of: project_id, user_id, workspace_id",
    );
  }
  if (opts.project_id !== undefined && !isUuid(opts.project_id)) {
    throw new ThreadValidationError("project_id: must be a valid UUID");
  }
  if (opts.user_id !== undefined && !isUuid(opts.user_id)) {
    throw new ThreadValidationError("user_id: must be a valid UUID");
  }
  if (opts.workspace_id !== undefined && !isUuid(opts.workspace_id)) {
    throw new ThreadValidationError("workspace_id: must be a valid UUID");
  }

  const statusList: ThreadStatus[] | undefined = Array.isArray(opts.status)
    ? opts.status
    : opts.status !== undefined
    ? [opts.status]
    : undefined;
  if (statusList) {
    for (const s of statusList) {
      if (!(THREAD_STATUSES as readonly unknown[]).includes(s)) {
        throw new ThreadValidationError(
          `status: must be one of ${THREAD_STATUSES.join(", ")}`,
        );
      }
    }
  }

  const restOpts: SupabaseRestOptions = deps.fetchFn ? { fetchFn: deps.fetchFn } : {};

  const limit = Math.min(
    LIST_LIMIT_MAX,
    Math.max(LIST_LIMIT_MIN, opts.limit ?? LIST_LIMIT_DEFAULT),
  );
  const offset = Math.max(0, opts.offset ?? LIST_OFFSET_DEFAULT);

  const filters: string[] = [];
  if (opts.workspace_id) filters.push(`workspace_id=eq.${encodeURIComponent(opts.workspace_id)}`);
  if (opts.project_id) filters.push(`project_id=eq.${encodeURIComponent(opts.project_id)}`);
  if (opts.user_id) filters.push(`user_id=eq.${encodeURIComponent(opts.user_id)}`);
  if (statusList && statusList.length > 0) {
    filters.push(`status=in.(${statusList.map(encodeURIComponent).join(",")})`);
  }

  // Fetch limit+1 to detect has_more
  const fetchLimit = limit + 1;
  const query =
    filters.join("&") +
    `&order=last_activity_at.desc&limit=${fetchLimit}&offset=${offset}&select=*`;

  const rows = await supabaseGet<Thread[]>(`/rest/v1/threads?${query}`, restOpts);

  const allRows = rows ?? [];
  const has_more = allRows.length > limit;
  const threads = has_more ? allRows.slice(0, limit) : allRows;

  return { threads, has_more };
}
