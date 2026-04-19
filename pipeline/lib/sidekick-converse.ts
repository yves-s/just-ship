import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.ts";
import { Sentry } from "./sentry.ts";
import {
  createFromClassification,
  ValidationError,
  BoardApiError,
  type BoardClientConfig,
  type CreateResult,
  type CreatedTicket,
  type TicketInput,
} from "./sidekick-create.ts";
import {
  FORBIDDEN_QUESTION_TOPICS as POLICY_FORBIDDEN_TOPICS,
  detectImplementationLeak,
} from "./sidekick-policy.ts";

/**
 * Sidekick Conversation Mode — T-878.
 *
 * When the classifier (T-875) lands on "conversation" — direction unclear,
 * missing business context, exploratory tone — the Sidekick enters this
 * short-turn mode. Rules:
 *
 * - **Max 3 turns.** Every session terminates by turn 3 with a created
 *   artifact (Ticket, Epic, or Spike). No open-ended chats.
 * - **Business questions only.** The assistant may ask about audience,
 *   timing, scope, replaces-vs-adds, success criteria. It MUST NOT ask
 *   about stack, components, visual, flow patterns, or any "how it is
 *   built" concern (those are Decision Authority violations — T-871).
 * - **Forced artifact.** If after 3 turns the request is still unclear,
 *   the Sidekick creates a Spike ticket that documents the open question
 *   instead of asking a fourth time.
 * - **Stateful session.** The session id is returned on the first turn
 *   and echoed back by the caller, so the user can close the tab and
 *   come back. Sessions live in memory with a 24h TTL.
 *
 * Experts (product-cto, design-lead) are consulted internally during the
 * finalisation step — their output flows into the artifact body but is
 * never streamed to the user. The user only ever sees the Sidekick.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConverseTurnMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ConverseRequest {
  /** Undefined on the very first turn — server assigns a fresh session id. */
  session_id?: string;
  /** The new user turn. */
  user_text: string;
  /** Project scope for artifact creation + context for the model. */
  project_id: string;
  /** Board URL — used to build the artifact URL in the final reply. */
  board_url?: string;
  /** Optional project-level context passed through to the model. */
  project_context?: {
    projectName?: string;
    projectSlug?: string;
    projectType?: string;
  };
}

export interface ConverseContinueResponse {
  status: "continue";
  session_id: string;
  turn: number;
  /** The Sidekick's next question — business-scoped per T-871. */
  assistant_text: string;
}

export interface ConverseFinalResponse {
  status: "final";
  session_id: string;
  turn: number;
  /** Short user-facing wrap: "{Zusammenfassung}. Ich lege {Artefakt} an: {url}". */
  assistant_text: string;
  /** The artifact kind the Sidekick decided on. */
  artifact_kind: "ticket" | "epic" | "spike";
  /** Echoed from the create endpoint for observability. */
  artifact: {
    category: "ticket" | "epic";
    ticket?: CreatedTicket;
    epic?: CreatedTicket;
    children?: CreatedTicket[];
    failed_children?: Array<{ index: number; title: string; reason: string }>;
  };
}

export type ConverseResponse = ConverseContinueResponse | ConverseFinalResponse;

// ---------------------------------------------------------------------------
// Session store — in-memory, TTL 24h, single-node
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 10_000;

interface SessionState {
  id: string;
  projectId: string;
  boardUrl?: string;
  projectContext?: ConverseRequest["project_context"];
  history: ConverseTurnMessage[];
  /** Number of completed user→assistant exchanges. Caps at 3. */
  turn: number;
  createdAt: number;
  lastSeenAt: number;
  /**
   * Guard against concurrent processing on the same session_id. The store is
   * a single-node in-memory Map with no lock, so two overlapping requests for
   * the same session would otherwise corrupt history + turn counter. We reject
   * the second call with a 409-like error instead.
   */
  inFlight: boolean;
}

/**
 * Raised when a second concurrent request arrives for a session that is still
 * processing its previous turn. The server maps this to HTTP 409.
 */
export class SessionBusyError extends Error {
  constructor(sessionId: string) {
    super(`session ${sessionId} is already processing a turn`);
    this.name = "SessionBusyError";
  }
}

const sessions = new Map<string, SessionState>();

function evictExpired(now: number): void {
  if (sessions.size < MAX_SESSIONS) {
    // Lazy eviction — only sweep when full. Individual reads still honor TTL.
    return;
  }
  for (const [id, s] of sessions) {
    if (now - s.lastSeenAt > SESSION_TTL_MS) sessions.delete(id);
  }
  if (sessions.size >= MAX_SESSIONS) {
    // Still full after TTL sweep — drop the oldest by lastSeenAt. This only
    // kicks in under abuse; normal traffic is capped by the rate limiter.
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt)[0];
    if (oldest) sessions.delete(oldest[0]);
  }
}

function getSession(id: string | undefined, now: number): SessionState | null {
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (now - s.lastSeenAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return null;
  }
  return s;
}

function createSession(req: ConverseRequest, now: number): SessionState {
  evictExpired(now);
  const id = randomUUID();
  const state: SessionState = {
    id,
    projectId: req.project_id,
    boardUrl: req.board_url,
    projectContext: req.project_context,
    history: [],
    turn: 0,
    createdAt: now,
    lastSeenAt: now,
    inFlight: false,
  };
  sessions.set(id, state);
  return state;
}

/** Exposed for tests — never call from production code. */
export function _resetSessionsForTests(): void {
  sessions.clear();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_TURNS = 3;
const MAX_USER_TEXT = 4_000;
const MAX_ASSISTANT_TEXT = 2_000;

export function validateConverseRequest(req: unknown): ConverseRequest {
  if (typeof req !== "object" || req === null) {
    throw new ValidationError("body: must be a JSON object");
  }
  const obj = req as Record<string, unknown>;

  const userText = obj.user_text;
  if (typeof userText !== "string" || !userText.trim()) {
    throw new ValidationError("user_text: must be a non-empty string");
  }
  // Measure after trim — leading/trailing whitespace is stripped before
  // storage anyway, so the effective payload length is what matters.
  if (userText.trim().length > MAX_USER_TEXT) {
    throw new ValidationError(`user_text: must be <= ${MAX_USER_TEXT} chars`);
  }

  const projectId = obj.project_id;
  if (typeof projectId !== "string" || !projectId.trim()) {
    throw new ValidationError("project_id: must be a non-empty string");
  }

  const sessionId = obj.session_id;
  if (sessionId !== undefined) {
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new ValidationError("session_id: must be a non-empty string when provided");
    }
  }

  const boardUrl = obj.board_url;
  if (boardUrl !== undefined && (typeof boardUrl !== "string" || !boardUrl.trim())) {
    throw new ValidationError("board_url: must be a non-empty string when provided");
  }

  const projectContext = obj.project_context;
  let validatedContext: ConverseRequest["project_context"] | undefined;
  if (projectContext !== undefined) {
    if (typeof projectContext !== "object" || projectContext === null) {
      throw new ValidationError("project_context: must be an object when provided");
    }
    const pc = projectContext as Record<string, unknown>;
    const name = typeof pc.projectName === "string" ? pc.projectName : undefined;
    const slug = typeof pc.projectSlug === "string" ? pc.projectSlug : undefined;
    const type = typeof pc.projectType === "string" ? pc.projectType : undefined;
    validatedContext = { projectName: name, projectSlug: slug, projectType: type };
  }

  return {
    user_text: userText.trim(),
    project_id: projectId.trim(),
    ...(sessionId ? { session_id: (sessionId as string).trim() } : {}),
    ...(boardUrl ? { board_url: (boardUrl as string).trim() } : {}),
    ...(validatedContext ? { project_context: validatedContext } : {}),
  };
}

// ---------------------------------------------------------------------------
// Prompting
// ---------------------------------------------------------------------------

/**
 * Forbidden-question patterns — T-871 Decision Authority. The assistant is
 * banned from asking any of these. They describe HOW something is built, not
 * WHAT it does for the user, and the engineering team decides them later.
 *
 * Re-exported from `sidekick-policy` so the existing public surface stays
 * stable (tests and external callers still import it from here). The single
 * source of truth is the policy module — see T-879.
 */
export const FORBIDDEN_QUESTION_TOPICS = POLICY_FORBIDDEN_TOPICS;

const SYSTEM_PROMPT = `You are the Sidekick Conversation Mode for the just-ship platform.

A user has shared a fuzzy idea. Your job is to shape it into ONE of three artifacts, in at most 3 turns total, by asking only business-level questions.

## Hard rules

1. **At most 3 user turns.** You will be told which turn you are on. Turn 1 and turn 2 may ask one question. Turn 3 MUST produce a final artifact — no more questions.
2. **Only ask business questions.** Allowed topics:
   - Target audience (who uses this, for which job)
   - Timing / urgency (now, after launch, not yet)
   - Scope (is this one change or several, MVP or full)
   - Replaces-vs-augments (does this replace something or add a new surface)
   - Success criteria (what does "done" look like from the user's perspective)
3. **NEVER ask implementation questions.** Anything about HOW it is built — framework, stack, database, component library, hosting, deployment target, colors, fonts, layout choice (modal vs sheet, kanban vs list), navigation placement, API shape, auth flow, caching — is FORBIDDEN. The engineering team decides those autonomously later. If you catch yourself drafting an implementation question, replace it with a business question.
4. **Max one question per turn.** If you need clarity on two things, pick the most load-bearing one.
5. **Keep questions under 200 characters.** Plain language. No PM jargon ("acceptance criteria", "user story", "epic"). Sound like a thoughtful peer, not a product manager.

## Output contract

You respond with a JSON object on a single line, no code fences, no prose around it. Schema:

{"kind":"question" | "finalize", "text":"<your message to the user>", "artifact"?: {...}}

- "kind": "question" — you are asking one more business question. Use only on turns 1 and 2.
- "kind": "finalize" — you are done. Produce "artifact". Use on turn 3, or earlier if the idea is already clear enough.

When kind is "finalize", include an "artifact" object:

{
  "kind": "ticket" | "epic" | "spike",
  "title": "<<= 200 chars, no leading emoji>",
  "body":  "<markdown body — Problem / Desired Behavior / Acceptance Criteria / Out of Scope / Size>",
  "priority"?: "high" | "medium" | "low",
  "children"?: [{"title":"...", "body":"..."}, ...]   // only for kind "epic", 2-5 children
}

- Use "ticket" when the 3 turns have narrowed this to a single concrete change.
- Use "epic" when it's multi-part (2-5 related child tickets). "children" required when kind is "epic".
- Use "spike" when after 3 turns the direction is STILL fuzzy — document the open question(s) in the body so the next pass can resolve them. This is the fallback on turn 3, not a failure.

The "text" field is the message shown to the user. For finalize, it must be a short wrap like:
"Alles klar — {1-sentence summary}. Ich lege {Artefakt} an."

Do not include URLs in "text" — the server appends the artifact URL.

## Anti-examples (never produce these)

- "Sollen wir das als Modal oder Bottom-Sheet bauen?" — implementation, forbidden.
- "Welche Farben passen zu dem Feature?" — implementation, forbidden.
- "React oder Vue?" — implementation, forbidden.
- "Ist das eher Kanban oder Liste?" — implementation, forbidden.
- "Brauchen wir einen Empty-State?" — design, forbidden (the team decides, and the answer is always yes).

## Good examples

- "Für wen genau ist das — für die User, die Admins, oder beide?" — business (audience).
- "Soll das die bestehende Suche ersetzen oder daneben leben?" — business (replaces vs augments).
- "Muss das noch vor Launch stehen oder danach?" — business (timing).
- "Was genau merkt der User, wenn das Feature da ist?" — business (success criterion).`;

function buildTurnPromptWithPending(
  session: SessionState,
  nextTurnNumber: number,
  pendingUserTurn: ConverseTurnMessage,
): string {
  const ctxLine = session.projectContext?.projectName
    ? `Active project: "${session.projectContext.projectName}"${session.projectContext.projectType ? ` (${session.projectContext.projectType})` : ""}`
    : "No active project context.";

  // Render transcript from committed history + the pending (in-flight) user
  // turn. The pending turn is NOT yet in session.history — see processTurn
  // for why (retry-safety after mid-flight throws).
  const transcript = [...session.history, pendingUserTurn];
  const historyBlock = transcript.length === 1
    ? `USER: ${pendingUserTurn.text}`
    : transcript
        .map(m => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.text}`)
        .join("\n");

  const turnInstruction = nextTurnNumber >= MAX_TURNS
    ? `This is turn ${nextTurnNumber} of ${MAX_TURNS} — the FINAL turn. You MUST respond with kind:"finalize". No more questions.`
    : `This is turn ${nextTurnNumber} of ${MAX_TURNS}. You may ask ONE business question (kind:"question"), OR finalize early if the idea is clear (kind:"finalize"). After turn ${MAX_TURNS}, questions are not allowed.`;

  return `${SYSTEM_PROMPT}

## Context
${ctxLine}

## Conversation so far
${historyBlock}

## Turn instruction
${turnInstruction}

Respond now with a single JSON object on one line.`;
}

// ---------------------------------------------------------------------------
// Model output parsing
// ---------------------------------------------------------------------------

interface ParsedQuestion {
  kind: "question";
  text: string;
}

interface ParsedArtifact {
  kind: "ticket" | "epic" | "spike";
  title: string;
  body: string;
  priority?: "high" | "medium" | "low";
  children?: Array<{ title: string; body: string }>;
}

interface ParsedFinalize {
  kind: "finalize";
  text: string;
  artifact: ParsedArtifact;
}

type ParsedResponse = ParsedQuestion | ParsedFinalize;

export function parseModelResponse(raw: string): ParsedResponse {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Sidekick converse response did not contain a JSON object");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch (err) {
    throw new Error(`Sidekick converse response was not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Sidekick converse response was not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  const kind = obj.kind;
  const text = obj.text;

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Sidekick converse response had missing or empty text");
  }
  if (text.length > MAX_ASSISTANT_TEXT) {
    throw new Error(`Sidekick converse response text exceeded ${MAX_ASSISTANT_TEXT} chars`);
  }

  if (kind === "question") {
    return { kind: "question", text: text.trim() };
  }
  if (kind === "finalize") {
    const artifact = obj.artifact;
    if (typeof artifact !== "object" || artifact === null) {
      throw new Error("Sidekick converse finalize response missing artifact");
    }
    return { kind: "finalize", text: text.trim(), artifact: validateParsedArtifact(artifact) };
  }
  throw new Error(`Sidekick converse response had invalid kind: ${JSON.stringify(kind)}`);
}

function validateParsedArtifact(raw: unknown): ParsedArtifact {
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;
  if (kind !== "ticket" && kind !== "epic" && kind !== "spike") {
    throw new Error(`artifact.kind must be ticket|epic|spike (got ${JSON.stringify(kind)})`);
  }
  const title = obj.title;
  const body = obj.body;
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("artifact.title must be a non-empty string");
  }
  if (typeof body !== "string" || !body.trim()) {
    throw new Error("artifact.body must be a non-empty string");
  }

  const priority = obj.priority;
  if (priority !== undefined && priority !== "high" && priority !== "medium" && priority !== "low") {
    throw new Error("artifact.priority must be high|medium|low");
  }

  const children = obj.children;
  let validatedChildren: Array<{ title: string; body: string }> | undefined;
  if (kind === "epic") {
    if (!Array.isArray(children) || children.length < 2 || children.length > 5) {
      throw new Error("epic artifact.children must be an array of 2-5 entries");
    }
    validatedChildren = children.map((c, i) => {
      if (typeof c !== "object" || c === null) {
        throw new Error(`artifact.children[${i}] must be an object`);
      }
      const co = c as Record<string, unknown>;
      if (typeof co.title !== "string" || !co.title.trim()) {
        throw new Error(`artifact.children[${i}].title must be a non-empty string`);
      }
      if (typeof co.body !== "string" || !co.body.trim()) {
        throw new Error(`artifact.children[${i}].body must be a non-empty string`);
      }
      return { title: co.title.trim(), body: co.body.trim() };
    });
  } else if (children !== undefined) {
    throw new Error(`artifact.children is only allowed for kind "epic"`);
  }

  return {
    kind,
    title: title.trim(),
    body: body.trim(),
    ...(priority ? { priority: priority as ParsedArtifact["priority"] } : {}),
    ...(validatedChildren ? { children: validatedChildren } : {}),
  };
}

// ---------------------------------------------------------------------------
// Fallback (model/SDK failure → forced spike on turn 3)
// ---------------------------------------------------------------------------

function buildFallbackSpike(session: SessionState, userTextThisTurn: string): ParsedArtifact {
  const transcript = [
    ...session.history.map(m => `**${m.role === "user" ? "User" : "Sidekick"}:** ${m.text}`),
    `**User:** ${userTextThisTurn}`,
  ].join("\n\n");
  const title = `Spike: unklare Anfrage aus Sidekick-Konversation`;
  const body =
    `## Problem\n\nDie Sidekick-Konversation hat nach ${MAX_TURNS} Turns keine klare Richtung produziert. ` +
    `Dieses Spike-Ticket dokumentiert die offene Frage, damit sie in einem nächsten Pass aufgelöst werden kann.\n\n` +
    `## Transkript\n\n${transcript}\n\n` +
    `## Nächster Schritt\n\n` +
    `- Besprechung mit dem CEO oder einem Produkt-Peer zur Klärung\n` +
    `- Entscheidung, ob das ein Ticket, Epic oder eine andere Form werden soll\n` +
    `- Dann Re-Entry über die Sidekick-Klassifikation\n\n` +
    `## Size: XS`;
  return { kind: "spike", title, body, priority: "low" };
}

// ---------------------------------------------------------------------------
// Model invocation
// ---------------------------------------------------------------------------

async function callModel(prompt: string): Promise<string> {
  let out = "";
  for await (const message of query({
    prompt,
    options: {
      model: "sonnet",
      maxTurns: 1,
      allowedTools: [],
      permissionMode: "auto",
    },
  })) {
    if (message.type === "result" && message.subtype === "success") {
      out = message.result;
    }
  }
  return out;
}

/** Test seam — replaceable by vitest.spyOn on the module. */
export const _internal = { callModel };

// ---------------------------------------------------------------------------
// Implementation-leak telemetry (T-879)
// ---------------------------------------------------------------------------

interface LeakReportContext {
  /** The user-visible assistant text to check. */
  assistantText: string;
  sessionId: string;
  turn: number;
  projectId: string;
  /** Which user-visible surface produced the text — kept as a log tag so
   *  dashboards can distinguish leaked questions from leaked finalise wraps. */
  surface: "question" | "finalize";
}

/**
 * Run the post-generation leak check on a user-visible assistant turn and, if
 * a forbidden topic was matched, emit a structured warning + Sentry breadcrumb.
 *
 * Extracted from the question/finalize branches so both paths enforce the
 * T-879 policy identically. Any new user-visible surface the Sidekick gains
 * should funnel through this helper.
 */
function reportImplementationLeak(ctx: LeakReportContext): ReturnType<typeof detectImplementationLeak> {
  const leak = detectImplementationLeak(ctx.assistantText);
  if (!leak.leak) return leak;

  logger.warn(
    {
      sessionId: ctx.sessionId,
      turn: ctx.turn,
      projectId: ctx.projectId,
      implementationLeak: true,
      leakMatched: leak.matched,
      leakSurface: ctx.surface,
      assistantTextPreview: ctx.assistantText.slice(0, 200),
    },
    "Sidekick converse leaked implementation topic",
  );
  try {
    Sentry.captureMessage("sidekick.implementation_leak", {
      level: "warning",
      extra: {
        sessionId: ctx.sessionId,
        turn: ctx.turn,
        surface: ctx.surface,
        matched: leak.matched,
        assistantTextPreview: ctx.assistantText.slice(0, 500),
      },
    });
  } catch (err) {
    // Sentry is a best-effort telemetry sink — a failure here must never
    // take down the user turn. Log and continue.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), sessionId: ctx.sessionId },
      "Sentry.captureMessage failed while reporting implementation leak",
    );
  }
  return leak;
}

// ---------------------------------------------------------------------------
// Artifact creation
// ---------------------------------------------------------------------------

function toTicketInput(a: ParsedArtifact): TicketInput {
  return {
    title: a.title.slice(0, 200),
    body: a.body.slice(0, 20_000),
    ...(a.priority ? { priority: a.priority } : {}),
  };
}

async function createArtifact(
  session: SessionState,
  parsed: ParsedArtifact,
  cfg: BoardClientConfig,
): Promise<CreateResult> {
  if (parsed.kind === "epic") {
    return createFromClassification({
      category: "epic",
      project_id: session.projectId,
      ...(session.boardUrl ? { board_url: session.boardUrl } : {}),
      epic: toTicketInput(parsed),
      children: (parsed.children ?? []).map(c => ({
        title: c.title.slice(0, 200),
        body: c.body.slice(0, 20_000),
      })),
    }, cfg);
  }
  // ticket or spike → both become a single ticket; spike gets a tag so
  // downstream consumers (board filter, /develop) can treat it specially.
  const ticket = toTicketInput(parsed);
  if (parsed.kind === "spike") {
    ticket.tags = ["spike", "sidekick-converse"];
  }
  return createFromClassification({
    category: "ticket",
    project_id: session.projectId,
    ...(session.boardUrl ? { board_url: session.boardUrl } : {}),
    ticket,
  }, cfg);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Process one turn of the Sidekick conversation.
 *
 * On turn 1-2, the model either asks a business question (→ "continue"
 * response) or decides it has enough and finalises early (→ "final"
 * response with an artifact).
 *
 * On turn 3 the model is required to finalise. If the model still tries
 * to ask a question, or if the model/SDK errors out, we fall back to a
 * Spike ticket that captures the transcript verbatim.
 */
export async function processTurn(
  req: ConverseRequest,
  cfg: BoardClientConfig,
): Promise<ConverseResponse> {
  const startedAt = Date.now();
  const now = startedAt;

  // Resolve or create session.
  let session = getSession(req.session_id, now);
  if (!session) {
    session = createSession(req, now);
  } else {
    // Concurrent-turn guard — the session store is in-memory without a lock,
    // so we must refuse a second overlapping request for the same session
    // instead of corrupting history and the turn counter.
    if (session.inFlight) {
      throw new SessionBusyError(session.id);
    }
    session.lastSeenAt = now;
    // Update pass-through fields — the caller may legitimately refine
    // board_url or project_context between turns.
    if (req.board_url) session.boardUrl = req.board_url;
    if (req.project_context) session.projectContext = req.project_context;
  }

  // Refuse if the session has already been finalised on a previous call.
  // Finalised sessions are deleted below; if a caller echoes an old id,
  // getSession returns null and we start a fresh session. This is the
  // desired behaviour — no way to drive past turn 3 on a single session.

  session.inFlight = true;
  try {
    return await processTurnInner(session, req, cfg, startedAt);
  } finally {
    // Always release the lock. The session itself may have been deleted
    // (success path) — that is fine, the flag just goes out of scope.
    session.inFlight = false;
  }
}

async function processTurnInner(
  session: SessionState,
  req: ConverseRequest,
  cfg: BoardClientConfig,
  startedAt: number,
): Promise<ConverseResponse> {
  const nextTurn = session.turn + 1;

  // Build a prompt-time view of the transcript that INCLUDES the current
  // user message, without mutating session.history. We only commit the
  // user turn to session.history once the assistant turn also lands, so
  // retries after a mid-flight throw do not accumulate duplicate user
  // messages in the transcript.
  const pendingUserTurn: ConverseTurnMessage = { role: "user", text: req.user_text };
  const prompt = buildTurnPromptWithPending(session, nextTurn, pendingUserTurn);

  let parsed: ParsedResponse | null = null;
  let modelError: Error | null = null;
  try {
    const raw = await _internal.callModel(prompt);
    if (!raw) throw new Error("model returned empty result");
    parsed = parseModelResponse(raw);
  } catch (err) {
    modelError = err instanceof Error ? err : new Error(String(err));
    logger.error(
      { err: modelError.message, sessionId: session.id, turn: nextTurn },
      "Sidekick converse model call failed",
    );
    Sentry.captureException(modelError, { extra: { sessionId: session.id, turn: nextTurn } });
  }

  // Enforce the 3-turn hard cap: if we are on the final turn, any non-
  // finalise response (question, parse error, SDK error) is replaced by
  // a Spike artifact. This is the "never hang on the user" guarantee.
  const mustFinalise = nextTurn >= MAX_TURNS;

  if (!parsed || (mustFinalise && parsed.kind === "question")) {
    const fallback: ParsedFinalize = {
      kind: "finalize",
      text: mustFinalise
        ? "Alles klar — ich lege ein Spike-Ticket an, damit wir die offene Frage strukturiert weiterdenken können. Ich lege das Ticket an."
        : "Hmm, ich sortier das gerade — ich lege dafür erstmal ein Spike-Ticket an, damit nichts verloren geht. Ich lege das Ticket an.",
      artifact: buildFallbackSpike(session, req.user_text),
    };
    parsed = fallback;
  }

  if (parsed.kind === "question") {
    // Still inside the window — commit both the pending user turn and the
    // assistant turn atomically. (If we crashed between the two, retrying
    // with the same session_id would double-push the user message.)
    session.turn = nextTurn;
    session.history.push(pendingUserTurn);
    session.history.push({ role: "assistant", text: parsed.text });

    // T-879 — classify every assistant question post-generation. The system
    // prompt forbids implementation questions, but we also measure leakage at
    // runtime: if a model slip ever ships one, the metric fires and Sentry
    // captures it so we can tighten the prompt or block the turn.
    const leak = reportImplementationLeak({
      assistantText: parsed.text,
      sessionId: session.id,
      turn: nextTurn,
      projectId: session.projectId,
      surface: "question",
    });

    logger.info(
      {
        sessionId: session.id,
        turn: nextTurn,
        projectId: session.projectId,
        implementationLeak: leak.leak,
        durationMs: Date.now() - startedAt,
      },
      "Sidekick converse continue",
    );
    return {
      status: "continue",
      session_id: session.id,
      turn: nextTurn,
      assistant_text: parsed.text,
    };
  }

  // Finalise — create the artifact, then wrap up and drop the session.
  let createResult: CreateResult;
  try {
    createResult = await createArtifact(session, parsed.artifact, cfg);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error(
      { err: reason, sessionId: session.id, turn: nextTurn, artifactKind: parsed.artifact.kind },
      "Sidekick converse artifact creation failed",
    );
    Sentry.captureException(err, { extra: { sessionId: session.id, artifactKind: parsed.artifact.kind } });
    // Keep the session alive so a retry can be made with the same id.
    if (err instanceof BoardApiError) throw err;
    throw new BoardApiError(`artifact creation failed: ${reason}`);
  }

  // Success path — commit the pending user turn and the assistant turn
  // together, then drop the session. Committing after artifact creation
  // succeeds means a failed createArtifact leaves session.history untouched,
  // so a retry with the same session_id does not double-push the user.
  session.turn = nextTurn;
  session.history.push(pendingUserTurn);
  session.history.push({ role: "assistant", text: parsed.text });
  sessions.delete(session.id);

  const url = createResult.category === "ticket"
    ? createResult.ticket.url
    : createResult.epic.url;

  const wrap = `${parsed.text.trim()} ${url}`.trim();

  // T-879 — the finalize wrap is also user-visible. The policy says every
  // user-visible turn must be checked; questions already funnel through
  // reportImplementationLeak above, and the finalize branch gets the same
  // treatment here. In practice the wrap is a short summary + URL, but a
  // model slip can still smuggle forbidden phrasing ("Ich lege den Modal-
  // oder-Bottom-Sheet-Flow an") into the user-visible text.
  const finalizeLeak = reportImplementationLeak({
    assistantText: parsed.text,
    sessionId: session.id,
    turn: nextTurn,
    projectId: session.projectId,
    surface: "finalize",
  });

  logger.info(
    {
      sessionId: session.id,
      turn: nextTurn,
      projectId: session.projectId,
      artifactKind: parsed.artifact.kind,
      category: createResult.category,
      number: createResult.category === "ticket" ? createResult.ticket.number : createResult.epic.number,
      childrenCount: createResult.category === "epic" ? createResult.children.length : 0,
      implementationLeak: finalizeLeak.leak,
      durationMs: Date.now() - startedAt,
    },
    "Sidekick converse finalised",
  );

  return {
    status: "final",
    session_id: session.id,
    turn: nextTurn,
    assistant_text: wrap,
    artifact_kind: parsed.artifact.kind,
    artifact: {
      category: createResult.category,
      ...(createResult.category === "ticket"
        ? { ticket: createResult.ticket }
        : {
            epic: createResult.epic,
            children: createResult.children,
            ...(createResult.failed_children ? { failed_children: createResult.failed_children } : {}),
          }),
    },
  };
}
