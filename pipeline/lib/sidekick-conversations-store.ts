/**
 * CRUD store for sidekick_conversations + sidekick_messages in the Engine-DB (Supabase).
 * Assumes migration 005_sidekick_threads.sql has been applied.
 *
 * Test seam: each exported function accepts an optional `deps` arg with a custom
 * `fetchFn`. This lets tests mock the HTTP layer at the supabase-rest level without
 * needing a live Supabase instance. Preferred over module-level injection because
 * it keeps functions pure and composable in tests.
 */

import { supabaseGet, supabasePost, type SupabaseRestOptions } from "./supabase-rest.ts";
import { logger } from "./logger.ts";

// ---------------------------------------------------------------------------
// UUID validation
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Conversation {
  id: string;
  workspace_id: string;
  project_id: string;
  user_id: string;
  title: string | null;
  page_url: string | null;
  page_title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  context: unknown;
  ticket_id: string | null;
  search_results: unknown;
  image_urls: string[] | null;
  created_at: string;
}

export interface CreateConversationInput {
  workspace_id: string;
  project_id: string;
  user_id: string;
  title?: string;
  page_url?: string;
  page_title?: string;
}

export interface ListMessagesOptions {
  limit?: number;
  offset?: number;
}

export interface ListMessagesResult {
  messages: ConversationMessage[];
  has_more: boolean;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class ConversationNotFoundError extends Error {
  constructor(id: string) {
    super(`conversation ${id} not found`);
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationValidationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ConversationValidationError";
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_TITLE_LEN = 500;
const MAX_PAGE_URL_LEN = 2048;
const MAX_PAGE_TITLE_LEN = 500;

const LIST_LIMIT_MIN = 1;
const LIST_LIMIT_MAX = 200;
const LIST_LIMIT_DEFAULT = 50;
const LIST_OFFSET_DEFAULT = 0;

export function validateCreateConversationRequest(body: unknown): CreateConversationInput {
  if (typeof body !== "object" || body === null) {
    throw new ConversationValidationError("body must be a JSON object");
  }
  const obj = body as Record<string, unknown>;

  if (!isUuid(obj.workspace_id)) {
    throw new ConversationValidationError("workspace_id: must be a valid UUID");
  }
  if (!isUuid(obj.project_id)) {
    throw new ConversationValidationError("project_id: must be a valid UUID");
  }
  if (!isUuid(obj.user_id)) {
    throw new ConversationValidationError("user_id: must be a valid UUID");
  }

  const title = obj.title;
  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      throw new ConversationValidationError("title: must be a non-empty string when provided");
    }
    if (title.length > MAX_TITLE_LEN) {
      throw new ConversationValidationError(`title: must be <= ${MAX_TITLE_LEN} chars`);
    }
  }

  const page_url = obj.page_url;
  if (page_url !== undefined) {
    if (typeof page_url !== "string" || !page_url.trim()) {
      throw new ConversationValidationError("page_url: must be a non-empty string when provided");
    }
    if (page_url.length > MAX_PAGE_URL_LEN) {
      throw new ConversationValidationError(`page_url: must be <= ${MAX_PAGE_URL_LEN} chars`);
    }
  }

  const page_title = obj.page_title;
  if (page_title !== undefined) {
    if (typeof page_title !== "string" || !page_title.trim()) {
      throw new ConversationValidationError("page_title: must be a non-empty string when provided");
    }
    if (page_title.length > MAX_PAGE_TITLE_LEN) {
      throw new ConversationValidationError(`page_title: must be <= ${MAX_PAGE_TITLE_LEN} chars`);
    }
  }

  return {
    workspace_id: obj.workspace_id as string,
    project_id: obj.project_id as string,
    user_id: obj.user_id as string,
    ...(title !== undefined ? { title: (title as string).trim() } : {}),
    ...(page_url !== undefined ? { page_url: (page_url as string).trim() } : {}),
    ...(page_title !== undefined ? { page_title: (page_title as string).trim() } : {}),
  };
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

export interface ConversationStoreDeps {
  fetchFn?: typeof fetch;
}

/**
 * Create a new conversation row in sidekick_conversations.
 * Throws ConversationValidationError on input violation.
 * Throws Error on unexpected Supabase failure.
 */
export async function createConversation(
  input: CreateConversationInput,
  deps: ConversationStoreDeps = {},
): Promise<Conversation> {
  const opts: SupabaseRestOptions = { expectSingle: true, ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}) };

  const row = await supabasePost<Conversation>(
    "/rest/v1/sidekick_conversations?select=*",
    {
      workspace_id: input.workspace_id,
      project_id: input.project_id,
      user_id: input.user_id,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.page_url !== undefined ? { page_url: input.page_url } : {}),
      ...(input.page_title !== undefined ? { page_title: input.page_title } : {}),
    },
    opts,
  );

  if (!row) {
    const err = new Error("Failed to create conversation — Supabase returned null");
    logger.error({ input }, err.message);
    throw err;
  }

  logger.info({ conversationId: row.id, projectId: input.project_id }, "Created sidekick conversation");
  return row;
}

/**
 * List messages for a conversation, paginated by created_at ASC.
 * Throws ConversationNotFoundError if the conversation does not exist.
 * limit: 1-200 (default 50), offset: >= 0 (default 0).
 */
export async function listConversationMessages(
  conversationId: string,
  opts: ListMessagesOptions = {},
  deps: ConversationStoreDeps = {},
): Promise<ListMessagesResult> {
  const restOpts: SupabaseRestOptions = deps.fetchFn ? { fetchFn: deps.fetchFn } : {};

  const limit = Math.min(
    LIST_LIMIT_MAX,
    Math.max(LIST_LIMIT_MIN, opts.limit ?? LIST_LIMIT_DEFAULT),
  );
  const offset = Math.max(0, opts.offset ?? LIST_OFFSET_DEFAULT);

  // Check conversation existence
  const existenceCheck = await supabaseGet<Conversation[]>(
    `/rest/v1/sidekick_conversations?id=eq.${encodeURIComponent(conversationId)}&select=id&limit=1`,
    restOpts,
  );

  if (!existenceCheck || existenceCheck.length === 0) {
    throw new ConversationNotFoundError(conversationId);
  }

  // Fetch limit+1 rows to detect has_more
  const fetchLimit = limit + 1;
  const rows = await supabaseGet<ConversationMessage[]>(
    `/rest/v1/sidekick_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&order=created_at.asc&limit=${fetchLimit}&offset=${offset}`,
    restOpts,
  );

  const allRows = rows ?? [];
  const has_more = allRows.length > limit;
  const messages = has_more ? allRows.slice(0, limit) : allRows;

  return { messages, has_more };
}
