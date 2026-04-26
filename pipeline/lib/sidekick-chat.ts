import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.ts";
import { Sentry } from "./sentry.ts";
import {
  SIDEKICK_PROMPT_VERSION,
  buildSidekickSystemPrompt,
} from "./sidekick-system-prompt.ts";
import {
  SIDEKICK_REASONING_TOOLS,
  executeSidekickReasoningTool,
  type ToolContext,
  type ToolResult,
} from "./sidekick-reasoning-tools.ts";

/**
 * Sidekick Chat Mode — T-922.
 *
 * Engine-side implementation of the full Sidekick chat turn. Today the Board
 * hosts ~400 lines of chat logic client-side (`src/lib/sidekick/ai.ts`): system
 * prompt, Claude-SDK invocation, SSE streaming, tool-call loop, persistence.
 * That only works inside the browser — the terminal sidekick has no access.
 *
 * This module moves the chat-turn into the engine so Browser and Terminal
 * share one implementation. The endpoint `POST /api/sidekick/chat` returns an
 * SSE stream with the following event types:
 *
 *   - `delta`         : token-level text delta for the in-flight assistant message
 *   - `tool_call`     : model requested a tool (name + args)
 *   - `tool_result`   : engine-side tool execution result (tool_use_id + result)
 *   - `message`       : final assistant message (id + full text)
 *   - `error`         : terminal error (message + code)
 *
 * Out of scope (landing in sibling child tickets of the parent epic):
 *   - Child #2 — tool implementations. This module's tool-loop is structural;
 *     `allowedTools` is empty today. The loop path is exercised by tests via
 *     the `_internal.callChatModel` seam so plugging real tools in later
 *     requires no shape change.
 *   - Child #3 — thread persistence. Conversation/thread state lives in an
 *     in-memory Map with a 24h TTL. The child ticket swaps that for a DB-
 *     backed store; the public request/response shape stays stable.
 *   - Child #4 — attachments/image upload.
 *   - Child #5 — Board UI switchover.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ChatAttachment {
  /** URL to an already-uploaded asset. Passed through verbatim today; Child #4
   *  swaps this for proper multimodal content blocks. */
  url: string;
  /** Optional mime hint for logs + future routing. */
  mime?: string;
}

export interface ChatContext {
  page_url?: string;
  page_title?: string;
}

export interface ChatRequest {
  /**
   * Persistent thread identifier. On the first turn the caller may omit this
   * and the server assigns one in the initial `message` event's thread_id.
   * Callers SHOULD echo it back on follow-up turns.
   *
   * `conversation_id` is accepted as an alias for backwards-compat with the
   * Board route.ts shape (which predated the epic rename).
   */
  thread_id?: string;
  /** The new user message. Required, non-empty, <= 16_000 chars. */
  user_text: string;
  /** Project scope — used for rate-limit keying and context. */
  project_id: string;
  /** User session bearer — used as the rate-limit key per AC. */
  user_id?: string;
  /** Optional asset URLs. Passed through; multimodal lands in Child #4. */
  attachments?: ChatAttachment[];
  /** Optional UI context (page the user is on). */
  context?: ChatContext;
}

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; result: unknown; is_error?: boolean }
  | { type: "message"; id: string; thread_id: string; text: string }
  | { type: "error"; message: string; code?: string };

/**
 * Abstract SSE sink — the HTTP handler adapts an `http.ServerResponse` to this
 * interface, and tests substitute a memory collector. Keeps the processing
 * code free of Node HTTP specifics.
 */
export interface ChatSink {
  send(event: ChatEvent): void;
  /** Whether the client is still connected. */
  isOpen(): boolean;
  /** Close the stream once processing finishes or aborts. */
  close(): void;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_USER_TEXT = 16_000;
const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_URL_LEN = 2_048;

export class ChatValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatValidationError";
  }
}

export function validateChatRequest(raw: unknown): ChatRequest {
  if (typeof raw !== "object" || raw === null) {
    throw new ChatValidationError("body: must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;

  const userText = obj.user_text;
  if (typeof userText !== "string" || !userText.trim()) {
    throw new ChatValidationError("user_text: must be a non-empty string");
  }
  const trimmedText = userText.trim();
  if (trimmedText.length > MAX_USER_TEXT) {
    throw new ChatValidationError(`user_text: must be <= ${MAX_USER_TEXT} chars`);
  }

  const projectId = obj.project_id;
  if (typeof projectId !== "string" || !projectId.trim()) {
    throw new ChatValidationError("project_id: must be a non-empty string");
  }

  // thread_id OR legacy conversation_id — accept either, canonicalise to thread_id.
  // We never treat thread_id + conversation_id as mutually exclusive at the input
  // level: if both are present and differ, thread_id wins (it's the canonical
  // field) rather than throwing, because a buggy client echoing both should
  // still make progress rather than dead-end.
  let threadId: string | undefined;
  if (typeof obj.thread_id === "string" && obj.thread_id.trim()) {
    threadId = obj.thread_id.trim();
  } else if (typeof obj.conversation_id === "string" && obj.conversation_id.trim()) {
    threadId = obj.conversation_id.trim();
  } else if (obj.thread_id !== undefined || obj.conversation_id !== undefined) {
    throw new ChatValidationError("thread_id/conversation_id: must be a non-empty string when provided");
  }

  const userId = obj.user_id;
  if (userId !== undefined && (typeof userId !== "string" || !userId.trim())) {
    throw new ChatValidationError("user_id: must be a non-empty string when provided");
  }

  const attachmentsRaw = obj.attachments;
  let attachments: ChatAttachment[] | undefined;
  if (attachmentsRaw !== undefined) {
    if (!Array.isArray(attachmentsRaw)) {
      throw new ChatValidationError("attachments: must be an array when provided");
    }
    if (attachmentsRaw.length > MAX_ATTACHMENTS) {
      throw new ChatValidationError(`attachments: at most ${MAX_ATTACHMENTS} entries`);
    }
    attachments = attachmentsRaw.map((a, i) => {
      if (typeof a !== "object" || a === null) {
        throw new ChatValidationError(`attachments[${i}]: must be an object`);
      }
      const aObj = a as Record<string, unknown>;
      const url = aObj.url;
      if (typeof url !== "string" || !url.trim()) {
        throw new ChatValidationError(`attachments[${i}].url: must be a non-empty string`);
      }
      const trimmedUrl = url.trim();
      if (trimmedUrl.length > MAX_ATTACHMENT_URL_LEN) {
        throw new ChatValidationError(`attachments[${i}].url: must be <= ${MAX_ATTACHMENT_URL_LEN} chars`);
      }
      // Scheme check. The URL is embedded verbatim into the LLM prompt (and
      // one day — Child #4 — downloaded for multimodal content blocks), so
      // we must reject schemes that could exfiltrate local resources or
      // hijack browser navigation: javascript:, data:, file://, relative
      // paths, plain strings. Only http(s) is safe to pass through.
      let parsed: URL;
      try {
        parsed = new URL(trimmedUrl);
      } catch {
        throw new ChatValidationError(`attachments[${i}].url: must be a valid absolute URL`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new ChatValidationError(`attachments[${i}].url: only http(s) URLs are allowed`);
      }
      const mime = aObj.mime;
      if (mime !== undefined && (typeof mime !== "string" || !mime.trim())) {
        throw new ChatValidationError(`attachments[${i}].mime: must be a non-empty string when provided`);
      }
      return { url: trimmedUrl, ...(typeof mime === "string" ? { mime: mime.trim() } : {}) };
    });
  }

  const contextRaw = obj.context;
  let context: ChatContext | undefined;
  if (contextRaw !== undefined) {
    if (typeof contextRaw !== "object" || contextRaw === null) {
      throw new ChatValidationError("context: must be an object when provided");
    }
    const cObj = contextRaw as Record<string, unknown>;
    const pageUrl = typeof cObj.page_url === "string" ? cObj.page_url.trim() : undefined;
    const pageTitle = typeof cObj.page_title === "string" ? cObj.page_title.trim() : undefined;
    context = {
      ...(pageUrl ? { page_url: pageUrl } : {}),
      ...(pageTitle ? { page_title: pageTitle } : {}),
    };
  }

  return {
    user_text: trimmedText,
    project_id: projectId.trim(),
    ...(threadId ? { thread_id: threadId } : {}),
    ...(userId ? { user_id: (userId as string).trim() } : {}),
    ...(attachments ? { attachments } : {}),
    ...(context ? { context } : {}),
  };
}

// ---------------------------------------------------------------------------
// Thread store — in-memory, TTL 24h. Child #3 replaces with a DB-backed store.
// ---------------------------------------------------------------------------

const THREAD_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_THREADS = 10_000;

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  id?: string;
}

interface ThreadState {
  id: string;
  projectId: string;
  messages: ChatMessage[];
  createdAt: number;
  lastSeenAt: number;
  /**
   * Concurrent-turn guard. The store is a single-node in-memory Map with no
   * lock — two overlapping requests for the same thread_id would otherwise
   * double-push the user turn, interleave assistant deltas, and corrupt the
   * transcript. Mirrors `sidekick-converse.ts`'s `inFlight` pattern; the
   * server maps the surfaced error to HTTP 409.
   */
  inFlight: boolean;
}

/**
 * Raised when a second concurrent request arrives for a thread that is still
 * processing its previous turn. The server maps this to HTTP 409.
 */
export class ChatThreadBusyError extends Error {
  constructor(threadId: string) {
    super(`thread ${threadId} is already processing a turn`);
    this.name = "ChatThreadBusyError";
  }
}

const threads = new Map<string, ThreadState>();

function evictExpiredThreads(now: number): void {
  if (threads.size < MAX_THREADS) return;
  for (const [id, t] of threads) {
    if (now - t.lastSeenAt > THREAD_TTL_MS) threads.delete(id);
  }
  if (threads.size >= MAX_THREADS) {
    // Still over cap after TTL sweep — drop the oldest. Only under abuse; the
    // rate limiter gates normal traffic.
    const oldest = [...threads.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt)[0];
    if (oldest) threads.delete(oldest[0]);
  }
}

function getOrCreateThread(req: ChatRequest, now: number): ThreadState {
  const existingId = req.thread_id;
  if (existingId) {
    const t = threads.get(existingId);
    // Only reuse the thread if BOTH the TTL is still valid AND the thread
    // belongs to the caller's project. A thread_id guessed or leaked from
    // another project must never surface its history — silently starting a
    // fresh thread avoids both the data-leak and an oracle-style 404/409
    // that would confirm the id exists elsewhere.
    if (t && now - t.lastSeenAt <= THREAD_TTL_MS && t.projectId === req.project_id) {
      t.lastSeenAt = now;
      return t;
    }
    // Expired id → drop it. Foreign-project id → DO NOT drop (that would let
    // any caller evict another project's thread by guessing its id). In both
    // cases we fall through and create a brand-new thread with a fresh uuid.
    if (t && now - t.lastSeenAt > THREAD_TTL_MS) threads.delete(existingId);
  }
  evictExpiredThreads(now);
  // If the caller supplied a thread_id but it was unknown, expired, or owned
  // by another project, assign a brand-new uuid so we never reuse an id that
  // could collide with another project's thread. The caller's reply will
  // echo this new id back.
  const existing = existingId ? threads.get(existingId) : undefined;
  const canReuseId = !existingId || !existing;
  const id = canReuseId && existingId ? existingId : randomUUID();
  const state: ThreadState = {
    id,
    projectId: req.project_id,
    messages: [],
    createdAt: now,
    lastSeenAt: now,
    inFlight: false,
  };
  threads.set(id, state);
  return state;
}

/** Exposed for tests — never call from production code. */
export function _resetChatThreadsForTests(): void {
  threads.clear();
}

/** Exposed for tests — inspect the thread store without mutating it. */
export function _getChatThreadForTests(id: string): ChatMessage[] | null {
  return threads.get(id)?.messages.slice() ?? null;
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function buildPrompt(thread: ThreadState, newUserText: string, ctx: ChatContext | undefined, attachments: ChatAttachment[] | undefined): string {
  // The base prompt — including the seven-tool roster, role-address heuristics,
  // and the few-shot corpus — comes from `sidekick-system-prompt.ts`. We append
  // per-turn context (page URL, attachments) and the running transcript here;
  // the prompt module's `buildSidekickSystemPrompt` handles the project/page
  // context block so the snapshot-tested base prompt stays untouched.
  const baseWithContext = buildSidekickSystemPrompt({
    ...(ctx?.page_url ? { pageUrl: ctx.page_url } : {}),
    ...(ctx?.page_title ? { pageTitle: ctx.page_title } : {}),
  });

  // Attachments pass through as URL hints until proper multimodal lands.
  // The model can reference the URL in its reply but cannot inspect the
  // asset content — this is documented behaviour, not a bug.
  const attachmentBlock = attachments && attachments.length > 0
    ? `\n\n# Attachments\n${attachments.map(a => a.url).join("\n")}`
    : "";

  const historyBlock = thread.messages.length === 0
    ? ""
    : `\n\n# Conversation so far\n${thread.messages
        .map(m => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.text}`)
        .join("\n")}`;

  return `${baseWithContext}${attachmentBlock}${historyBlock}

# New user turn
USER: ${newUserText}

Respond directly. Use tools if helpful.`;
}

// ---------------------------------------------------------------------------
// Model invocation — a test seam so tests can substitute a fake stream.
// ---------------------------------------------------------------------------

/**
 * Shape of a single event from the model layer. This is a neutral, test-
 * friendly subset of the Claude Agent SDK's `SDKMessage` — production uses the
 * SDK adapter below; tests push in canned sequences via the `_internal` seam.
 */
export type ModelEvent =
  | { kind: "text_delta"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; tool_use_id: string; result: unknown; is_error?: boolean }
  | { kind: "assistant_final"; id: string; text: string }
  | { kind: "error"; message: string; code?: string };

export interface ModelRunner {
  (prompt: string, signal: AbortSignal, ctx: ToolContext | null): AsyncIterable<ModelEvent>;
}

/**
 * Feature flag: read at call-time so tests can flip the env var per-test
 * without re-importing the module. Truthy values: "1", "true", "yes" (case-
 * insensitive). Anything else (including unset) is false.
 *
 * Default OFF in production. Engine deployments and dev environments that
 * want the reasoning-first chat opt in by setting `SIDEKICK_REASONING_ENABLED=1`.
 */
export function isSidekickReasoningEnabled(): boolean {
  const raw = process.env.SIDEKICK_REASONING_ENABLED;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Build the in-process MCP server that exposes the eight reasoning tools to
 * the SDK. The same `ToolContext` is captured by every handler in this server,
 * so workspace/user credentials are scoped to a single chat turn and never
 * leak to a subsequent turn that may have a different user.
 *
 * Exported for testability — the chat tests stub the server when they need to
 * verify the wiring shape without spinning up the SDK.
 */
export function buildSidekickMcpServer(ctx: ToolContext): McpSdkServerConfigWithInstance {
  // Each registry entry's schema is a `z.object({...})` — `.shape` gives the
  // ZodRawShape the SDK's `tool()` helper expects. We dispatch through
  // `executeSidekickReasoningTool` rather than calling `t.execute` directly
  // so the same Zod-validation + error-shape contract used by the unit tests
  // applies on the live path.
  //
  // The `tool()` helper is generic over a specific ZodRawShape. We index the
  // registry by string name at runtime, so the static type for any one entry
  // is `ZodTypeAny` — we cast to a generic `Record<string, unknown>` shape
  // for the SDK signature, which matches the runtime contract: handlers
  // receive a `Record<string, unknown>` and validate with their own schema.
  type SdkTool = ReturnType<typeof tool<Record<string, never>>>;
  const tools: SdkTool[] = Object.values(SIDEKICK_REASONING_TOOLS).map((t) => {
    const shape = (t.schema as unknown as { shape: Record<string, never> }).shape;
    return tool<Record<string, never>>(
      t.name,
      t.description,
      shape,
      async (args) => {
        const result: ToolResult = await executeSidekickReasoningTool(t.name, ctx, args);
        // MCP CallToolResult contract: `content` is an array of text blocks;
        // tool failures get `isError: true` so the model can recognise the
        // outcome and either retry, swap tools, or fall back to a plain reply.
        // We serialise the structured result so the model can echo numbers /
        // urls back to the user verbatim.
        const text = JSON.stringify(result);
        if (result.ok) {
          return { content: [{ type: "text", text }] };
        }
        return { content: [{ type: "text", text }], isError: true };
      },
    );
  });

  return createSdkMcpServer({
    name: "sidekick",
    version: "1.0.0",
    tools,
  });
}

/**
 * Compute the SDK `allowedTools` array for the reasoning-first chat path.
 * MCP tools surface to the SDK with the prefix `mcp__<server>__<toolname>`.
 * Exported for the CI grep-guard test — it imports this function to verify
 * the array is non-empty when the feature flag is on.
 */
export function buildSidekickAllowedTools(): string[] {
  return Object.keys(SIDEKICK_REASONING_TOOLS).map((name) => `mcp__sidekick__${name}`);
}

async function* defaultModelRunner(
  prompt: string,
  signal: AbortSignal,
  ctx: ToolContext | null,
): AsyncIterable<ModelEvent> {
  // Production path — delegate to the Claude Agent SDK. With a ToolContext and
  // the feature flag on we wire the eight reasoning tools as in-process MCP
  // tools; without either, fall back to the legacy tool-less stream so the
  // shadow rollout never breaks pre-existing deployments. Both branches emit
  // the same delta/tool/final event shape, so downstream sink code is uniform.
  const reasoningOn = ctx !== null && isSidekickReasoningEnabled();
  const mcpServers = reasoningOn ? { sidekick: buildSidekickMcpServer(ctx) } : undefined;
  const allowedTools = reasoningOn ? buildSidekickAllowedTools() : [];
  // The reasoning-first path needs more than one turn — the SDK runs the
  // tool-use loop internally, and one turn = one model API call. Three turns
  // covers tool_use → tool_result → final reply with one fix-up turn budgeted
  // for retries / chained tool calls. The legacy tool-less path stays at
  // maxTurns: 1 because there is no loop to budget for.
  const maxTurns = reasoningOn ? 4 : 1;

  let finalText = "";
  let assistantUuid: string | null = null;

  try {
    const iterator = query({
      prompt,
      options: {
        model: "sonnet",
        maxTurns,
        // CI-AUDIT-EXEMPT: reasoning-flag-off path is the legacy shadow-mode
        // default — see T-1020 ACs. The grep guard whitelists this line.
        allowedTools,
        permissionMode: "auto",
        includePartialMessages: true,
        ...(mcpServers ? { mcpServers } : {}),
      },
    });

    for await (const message of iterator) {
      if (signal.aborted) {
        // Abort the upstream generator so the SDK can release resources.
        // The claude-agent-sdk's AsyncGenerator honours .return().
        try {
          await (iterator as AsyncGenerator<unknown>).return?.(undefined);
        } catch (err) {
          // Best-effort cleanup — the upstream may have already closed.
          logger.debug({ err: err instanceof Error ? err.message : String(err) }, "chat: upstream return threw");
        }
        return;
      }

      if (message.type === "stream_event") {
        const ev = message.event;
        if (ev?.type === "content_block_delta" && ev.delta) {
          const delta = ev.delta as { type?: string; text?: string };
          if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
            yield { kind: "text_delta", text: delta.text };
          }
        }
        continue;
      }

      if (message.type === "assistant") {
        assistantUuid = message.uuid;
        const content = (message.message as { content?: unknown })?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as { type?: string; id?: string; name?: string; input?: unknown; text?: string };
            if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
              yield { kind: "tool_use", id: b.id, name: b.name, input: b.input };
            } else if (b.type === "text" && typeof b.text === "string") {
              // The final text arrives as a content block on the assistant
              // message. Cache it for the assistant_final event below.
              finalText += b.text;
            }
          }
        }
        continue;
      }

      if (message.type === "user") {
        // User messages in the SDK stream carry tool_result blocks — these
        // represent the engine-side execution result of a prior tool_use.
        const content = (message.message as { content?: unknown })?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
            if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
              yield {
                kind: "tool_result",
                tool_use_id: b.tool_use_id,
                result: b.content,
                ...(b.is_error ? { is_error: true } : {}),
              };
            }
          }
        }
        continue;
      }

      if (message.type === "result") {
        if (message.subtype === "success") {
          yield {
            kind: "assistant_final",
            id: assistantUuid ?? message.uuid,
            text: finalText || (message as unknown as { result?: string }).result || "",
          };
        } else {
          yield {
            kind: "error",
            message: (message as unknown as { errors?: string[] }).errors?.[0] ?? "model returned error result",
            code: message.subtype,
          };
        }
        return;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    yield { kind: "error", message: msg };
  }
}

/** Test seam — tests replace `callChatModel` with a scripted async generator. */
export const _internal: { callChatModel: ModelRunner } = {
  callChatModel: defaultModelRunner,
};

// ---------------------------------------------------------------------------
// Public entry point — drive the SSE stream from a validated request.
// ---------------------------------------------------------------------------

/**
 * Provides the per-request `ToolContext` (board credentials, workspace, user)
 * that the reasoning tools need to talk to the board API and the threads-store.
 *
 * The chat module deliberately does NOT read `serverConfig` directly — that
 * would make the unit tests of `processChat` either spin up a real server
 * config or stub it via module mocks. Instead the HTTP handler builds a
 * provider closure from `serverConfig` once, and the test path supplies a
 * canned context.
 *
 * Returning `null` or omitting the provider entirely keeps the legacy
 * "no tools" behaviour — the chat still streams replies, just without the
 * reasoning-first tool-call loop. This is the production default until the
 * shadow rollout flips.
 */
export type ToolContextProvider = (
  req: ChatRequest,
) => ToolContext | null | Promise<ToolContext | null>;

export interface ProcessChatOptions {
  /**
   * Abort signal for the model call. The HTTP handler wires this to the
   * response's close event so a disconnected client cancels the upstream.
   */
  signal: AbortSignal;
  /**
   * When set AND the reasoning-tools feature flag is enabled, the chat turn
   * runs with the eight reasoning tools wired into the SDK as MCP tools.
   * When omitted or returning null, the chat falls back to the legacy
   * tool-less stream — preserving production behaviour during the shadow
   * rollout (T-1020 AC: Default in Production: alt).
   */
  toolContextProvider?: ToolContextProvider;
}

/**
 * Run one chat turn and pump events to `sink`. Resolves once the stream is
 * complete or the client disconnected. Never throws — all failures become
 * `error` events and are swallowed here.
 */
export async function processChat(
  req: ChatRequest,
  sink: ChatSink,
  opts: ProcessChatOptions,
): Promise<void> {
  const startedAt = Date.now();
  const thread = getOrCreateThread(req, startedAt);

  // Concurrent-turn guard. Without this, two overlapping requests for the
  // same thread_id would both push a user turn, both call the model, and
  // both try to write an assistant reply — corrupting the transcript and
  // returning interleaved SSE streams to whichever client still holds a
  // socket. The HTTP handler maps this error to 409.
  if (thread.inFlight) {
    throw new ChatThreadBusyError(thread.id);
  }
  thread.inFlight = true;

  // Resolve the ToolContext up front so a provider error short-circuits the
  // turn before we commit a user message we'd then have to roll back. A
  // null/undefined provider, or a provider returning null, keeps the legacy
  // tool-less path active — that is the production default during the
  // shadow rollout.
  let toolCtx: ToolContext | null = null;
  if (opts.toolContextProvider) {
    try {
      toolCtx = (await opts.toolContextProvider(req)) ?? null;
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), threadId: thread.id, projectId: req.project_id },
        "chat: toolContextProvider threw — falling back to tool-less stream",
      );
      Sentry.captureException(err, {
        tags: { area: "sidekick-chat", phase: "tool_context_provider" },
        extra: { threadId: thread.id, projectId: req.project_id },
      });
      toolCtx = null;
    }
  }

  // Commit the user turn up front so that even if the model call errors we
  // keep a coherent transcript (matching the Board's existing behaviour).
  // We snapshot the index we just wrote so we can roll it back on failure,
  // keeping the next turn's prompt clean.
  const userTurnIndex = thread.messages.push({ role: "user", text: req.user_text }) - 1;

  const prompt = buildPrompt(thread, req.user_text, req.context, req.attachments);

  let finalText = "";
  let finalId: string | null = null;
  let sawError = false;

  try {
    for await (const ev of _internal.callChatModel(prompt, opts.signal, toolCtx)) {
      if (!sink.isOpen()) {
        logger.info(
          { threadId: thread.id, projectId: req.project_id, reason: "client_disconnect" },
          "chat: stopping stream — client disconnected",
        );
        break;
      }

      switch (ev.kind) {
        case "text_delta":
          finalText += ev.text;
          sink.send({ type: "delta", text: ev.text });
          break;
        case "tool_use":
          sink.send({ type: "tool_call", id: ev.id, name: ev.name, input: ev.input });
          break;
        case "tool_result":
          sink.send({
            type: "tool_result",
            tool_use_id: ev.tool_use_id,
            result: ev.result,
            ...(ev.is_error ? { is_error: true } : {}),
          });
          break;
        case "assistant_final":
          finalText = ev.text || finalText;
          finalId = ev.id;
          break;
        case "error":
          sawError = true;
          sink.send({ type: "error", message: ev.message, ...(ev.code ? { code: ev.code } : {}) });
          break;
      }
    }

    // Only emit the final message if the turn actually completed — if the
    // upstream was aborted (client disconnect, explicit signal) there is no
    // assistant reply to report, and writing an empty `message` event would
    // mislead the client into rendering a blank bubble.
    if (!sawError && sink.isOpen() && !opts.signal.aborted && finalId !== null) {
      thread.messages.push({ role: "assistant", text: finalText, id: finalId });
      thread.lastSeenAt = Date.now();
      sink.send({ type: "message", id: finalId, thread_id: thread.id, text: finalText });
    } else {
      // Turn did not complete (aborted, error, or disconnect). Roll back the
      // user turn we optimistically pushed up front. Otherwise the next turn
      // on this thread would carry an orphaned user message with no matching
      // assistant reply, confusing the model and duplicating the user text
      // if the client auto-retries the same request.
      if (userTurnIndex === thread.messages.length - 1
          && thread.messages[userTurnIndex]?.role === "user") {
        thread.messages.pop();
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { err: msg, threadId: thread.id, projectId: req.project_id },
      "chat: unexpected error in stream loop",
    );
    Sentry.captureException(err, {
      tags: { prompt_version: SIDEKICK_PROMPT_VERSION, area: "sidekick-chat" },
      extra: { threadId: thread.id, projectId: req.project_id },
    });
    if (sink.isOpen()) {
      sink.send({ type: "error", message: "internal_error" });
    }
    // Roll back the orphaned user turn on unexpected errors too — same
    // reasoning as the non-completing path above.
    if (userTurnIndex === thread.messages.length - 1
        && thread.messages[userTurnIndex]?.role === "user") {
      thread.messages.pop();
    }
  } finally {
    // Always release the concurrent-turn lock, even if the thread was evicted
    // mid-call. Reading thread.inFlight on a stale reference is safe because
    // the object is still held in this closure.
    thread.inFlight = false;
    logger.info(
      {
        threadId: thread.id,
        projectId: req.project_id,
        userId: req.user_id,
        promptVersion: SIDEKICK_PROMPT_VERSION,
        durationMs: Date.now() - startedAt,
        clientOpen: sink.isOpen(),
        sawError,
      },
      "chat: turn finished",
    );
    sink.close();
  }
}
