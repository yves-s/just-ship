import { logger } from "./logger.ts";
import { Sentry } from "./sentry.ts";

/**
 * Sidekick autonomous ticket/epic creation — T-876.
 *
 * Invariant from T-876 and Decision Authority (T-871):
 *   The Sidekick never asks the user "should I create this?". The
 *   classifier (T-875) decides the bucket, this module performs the
 *   creation, and the caller formats a short confirmation message
 *   ("Ist im Board: T-N — {title}. [Link]").
 *
 * All Board API calls go through a small fetch-backed client so tests
 * can mock the HTTP layer without pulling in the full server module.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BoardClientConfig {
  apiUrl: string;
  apiKey: string;
  /** Request timeout in ms. Defaults to 10_000. */
  timeoutMs?: number;
  /** Injected for tests. Defaults to global fetch. */
  fetchFn?: typeof fetch;
}

export interface TicketInput {
  title: string;
  body: string;
  /** Optional priority — defaults to "medium" on the Board side when omitted. */
  priority?: "high" | "medium" | "low";
  /** Optional labels/tags. */
  tags?: string[];
}

export interface CreatedTicket {
  number: number;
  id: string;
  title: string;
  url: string;
}

export interface CreateTicketRequest {
  category: "ticket";
  project_id: string;
  board_url?: string; // used to build the ticket URL shown to the user
  ticket: TicketInput;
}

export interface CreateEpicRequest {
  category: "epic";
  project_id: string;
  board_url?: string;
  epic: TicketInput;
  children: TicketInput[];
}

export type CreateRequest = CreateTicketRequest | CreateEpicRequest;

export interface UpdateRequest {
  ticket_number: number;
  /** Optional — used to build the ticket URL returned to the caller. */
  board_url?: string;
  patch: Partial<Pick<TicketInput, "title" | "body" | "priority" | "tags">> & {
    /** Allow changing status too — useful when the user clarifies "make this a backlog item". */
    status?: string;
  };
}

/**
 * T-877: Project creation request (category 4 — new product idea).
 *
 * Unlike ticket/epic, this requires explicit `confirmed: true` because a new
 * project is structurally larger than a ticket. The Sidekick asks once ("Soll
 * ich {Name} als Projekt anlegen?"); the caller forwards the confirmation.
 * The endpoint itself enforces the gate so a buggy caller cannot sidestep it.
 */
export interface CreateProjectRequest {
  workspace_id: string;
  project_name: string;
  description: string;
  confirmed: true;
  board_url?: string;
}

export interface CreatedProject {
  id: string;
  name: string;
  slug: string;
  url: string;
}

export interface CreateProjectResult {
  project: CreatedProject;
  epic: CreatedTicket;
  children: CreatedTicket[];
  /** Children that failed to create, if any. Project + epic are still a success. */
  failed_children?: Array<{ index: number; title: string; reason: string }>;
}

export interface CreateTicketResult {
  category: "ticket";
  ticket: CreatedTicket;
}

export interface CreateEpicResult {
  category: "epic";
  epic: CreatedTicket;
  children: CreatedTicket[];
  /** Children that failed to create, if any. Epic is still considered a success. */
  failed_children?: Array<{ index: number; title: string; reason: string }>;
}

export type CreateResult = CreateTicketResult | CreateEpicResult;

export interface UpdateResult {
  ticket: CreatedTicket;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_TITLE_LEN = 200;
const MAX_BODY_LEN = 20_000;
const MAX_CHILDREN = 20;
const MAX_PROJECT_NAME_LEN = 100;
const MAX_PROJECT_DESCRIPTION_LEN = 2_000;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class BoardApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "BoardApiError";
  }
}

function validateTicketInput(t: unknown, path: string): TicketInput {
  if (typeof t !== "object" || t === null) {
    throw new ValidationError(`${path}: must be an object`);
  }
  const obj = t as Record<string, unknown>;

  const title = obj.title;
  if (typeof title !== "string" || !title.trim()) {
    throw new ValidationError(`${path}.title: must be a non-empty string`);
  }
  if (title.length > MAX_TITLE_LEN) {
    throw new ValidationError(`${path}.title: must be <= ${MAX_TITLE_LEN} chars`);
  }

  const body = obj.body;
  if (typeof body !== "string" || !body.trim()) {
    throw new ValidationError(`${path}.body: must be a non-empty string`);
  }
  if (body.length > MAX_BODY_LEN) {
    throw new ValidationError(`${path}.body: must be <= ${MAX_BODY_LEN} chars`);
  }

  const priority = obj.priority;
  if (priority !== undefined && priority !== "high" && priority !== "medium" && priority !== "low") {
    throw new ValidationError(`${path}.priority: must be 'high' | 'medium' | 'low'`);
  }

  const tags = obj.tags;
  if (tags !== undefined) {
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) {
      throw new ValidationError(`${path}.tags: must be an array of strings`);
    }
  }

  return {
    title: title.trim(),
    body: body.trim(),
    ...(priority ? { priority: priority as TicketInput["priority"] } : {}),
    ...(tags ? { tags: tags as string[] } : {}),
  };
}

export function validateCreateRequest(req: unknown): CreateRequest {
  if (typeof req !== "object" || req === null) {
    throw new ValidationError("body: must be a JSON object");
  }
  const obj = req as Record<string, unknown>;

  const category = obj.category;
  if (category !== "ticket" && category !== "epic") {
    throw new ValidationError(`category: must be 'ticket' or 'epic' (got ${JSON.stringify(category)})`);
  }

  const projectId = obj.project_id;
  if (typeof projectId !== "string" || !projectId.trim()) {
    throw new ValidationError("project_id: must be a non-empty string");
  }

  const boardUrl = validateOptionalBoardUrl(obj.board_url);

  if (category === "ticket") {
    const ticket = validateTicketInput(obj.ticket, "ticket");
    return {
      category: "ticket",
      project_id: projectId.trim(),
      ...(boardUrl ? { board_url: boardUrl } : {}),
      ticket,
    };
  }

  // epic
  const epic = validateTicketInput(obj.epic, "epic");
  const children = obj.children;
  if (!Array.isArray(children) || children.length === 0) {
    throw new ValidationError("children: must be a non-empty array");
  }
  if (children.length > MAX_CHILDREN) {
    throw new ValidationError(`children: must contain at most ${MAX_CHILDREN} entries`);
  }
  const validatedChildren = children.map((c, i) => validateTicketInput(c, `children[${i}]`));

  return {
    category: "epic",
    project_id: projectId.trim(),
    ...(boardUrl ? { board_url: boardUrl } : {}),
    epic,
    children: validatedChildren,
  };
}

/**
 * Validates an optional `board_url` field. Returns the trimmed string, or
 * `undefined` when the field is absent. Throws on wrong type or empty-string.
 */
function validateOptionalBoardUrl(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ValidationError("board_url: must be a non-empty string when provided");
  }
  return raw.trim();
}

export function validateCreateProjectRequest(req: unknown): CreateProjectRequest {
  if (typeof req !== "object" || req === null) {
    throw new ValidationError("body: must be a JSON object");
  }
  const obj = req as Record<string, unknown>;

  const workspaceId = obj.workspace_id;
  if (typeof workspaceId !== "string" || !workspaceId.trim()) {
    throw new ValidationError("workspace_id: must be a non-empty string");
  }

  const projectName = obj.project_name;
  if (typeof projectName !== "string" || !projectName.trim()) {
    throw new ValidationError("project_name: must be a non-empty string");
  }
  if (projectName.length > MAX_PROJECT_NAME_LEN) {
    throw new ValidationError(`project_name: must be <= ${MAX_PROJECT_NAME_LEN} chars`);
  }

  const description = obj.description;
  if (typeof description !== "string" || !description.trim()) {
    throw new ValidationError("description: must be a non-empty string");
  }
  if (description.length > MAX_PROJECT_DESCRIPTION_LEN) {
    throw new ValidationError(`description: must be <= ${MAX_PROJECT_DESCRIPTION_LEN} chars`);
  }

  // Strict confirmation gate: the Sidekick asks once before creating a project
  // (the only exception to the "no confirmation" rule from T-876). The endpoint
  // refuses to act without an explicit boolean true so a buggy caller cannot
  // accidentally create a project.
  if (obj.confirmed !== true) {
    throw new ValidationError("confirmed: must be literal true — project creation requires explicit confirmation");
  }

  const boardUrl = validateOptionalBoardUrl(obj.board_url);

  return {
    workspace_id: workspaceId.trim(),
    project_name: projectName.trim(),
    description: description.trim(),
    confirmed: true,
    ...(boardUrl ? { board_url: boardUrl } : {}),
  };
}

export function validateUpdateRequest(req: unknown): UpdateRequest {
  if (typeof req !== "object" || req === null) {
    throw new ValidationError("body: must be a JSON object");
  }
  const obj = req as Record<string, unknown>;

  const ticketNumber = obj.ticket_number;
  if (typeof ticketNumber !== "number" || !Number.isInteger(ticketNumber) || ticketNumber <= 0) {
    throw new ValidationError("ticket_number: must be a positive integer");
  }

  const boardUrl = validateOptionalBoardUrl(obj.board_url);

  const patch = obj.patch;
  if (typeof patch !== "object" || patch === null) {
    throw new ValidationError("patch: must be an object");
  }
  const patchObj = patch as Record<string, unknown>;

  const out: UpdateRequest["patch"] = {};

  if (patchObj.title !== undefined) {
    if (typeof patchObj.title !== "string" || !patchObj.title.trim()) {
      throw new ValidationError("patch.title: must be a non-empty string when provided");
    }
    if (patchObj.title.length > MAX_TITLE_LEN) {
      throw new ValidationError(`patch.title: must be <= ${MAX_TITLE_LEN} chars`);
    }
    out.title = patchObj.title.trim();
  }
  if (patchObj.body !== undefined) {
    if (typeof patchObj.body !== "string" || !patchObj.body.trim()) {
      throw new ValidationError("patch.body: must be a non-empty string when provided");
    }
    if (patchObj.body.length > MAX_BODY_LEN) {
      throw new ValidationError(`patch.body: must be <= ${MAX_BODY_LEN} chars`);
    }
    out.body = patchObj.body.trim();
  }
  if (patchObj.priority !== undefined) {
    if (patchObj.priority !== "high" && patchObj.priority !== "medium" && patchObj.priority !== "low") {
      throw new ValidationError("patch.priority: must be 'high' | 'medium' | 'low'");
    }
    out.priority = patchObj.priority as TicketInput["priority"];
  }
  if (patchObj.tags !== undefined) {
    if (!Array.isArray(patchObj.tags) || !patchObj.tags.every((t) => typeof t === "string")) {
      throw new ValidationError("patch.tags: must be an array of strings");
    }
    out.tags = patchObj.tags as string[];
  }
  if (patchObj.status !== undefined) {
    if (typeof patchObj.status !== "string" || !patchObj.status.trim()) {
      throw new ValidationError("patch.status: must be a non-empty string when provided");
    }
    out.status = patchObj.status.trim();
  }

  if (Object.keys(out).length === 0) {
    throw new ValidationError("patch: must contain at least one field to update");
  }

  return {
    ticket_number: ticketNumber,
    ...(boardUrl ? { board_url: boardUrl } : {}),
    patch: out,
  };
}

// ---------------------------------------------------------------------------
// Board API client
// ---------------------------------------------------------------------------

interface BoardTicketRow {
  id: string;
  number: number;
  title: string;
}

function buildTicketUrl(boardUrl: string | undefined, ticketNumber: number): string {
  if (!boardUrl) return `T-${ticketNumber}`;
  const trimmed = boardUrl.replace(/\/+$/, "");
  return `${trimmed}/t/${ticketNumber}`;
}

async function postTicket(
  cfg: BoardClientConfig,
  payload: Record<string, unknown>,
): Promise<BoardTicketRow> {
  const fetchFn = cfg.fetchFn ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? 10_000;

  let res: Response;
  try {
    res = await fetchFn(`${cfg.apiUrl}/api/tickets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pipeline-Key": cfg.apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new BoardApiError(`Board API POST /api/tickets failed: ${reason}`);
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch { /* non-critical */ }
    throw new BoardApiError(
      `Board API POST /api/tickets returned HTTP ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      res.status,
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new BoardApiError(`Board API POST /api/tickets returned invalid JSON: ${(err as Error).message}`);
  }

  const data = (json as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) {
    throw new BoardApiError("Board API POST /api/tickets did not return a ticket object");
  }
  const row = data as Record<string, unknown>;
  const number = row.number;
  const id = row.id;
  const title = row.title;
  if (typeof number !== "number" || typeof id !== "string" || typeof title !== "string") {
    throw new BoardApiError("Board API POST /api/tickets returned a ticket missing required fields");
  }
  return { number, id, title };
}

async function patchTicket(
  cfg: BoardClientConfig,
  ticketNumber: number,
  payload: Record<string, unknown>,
): Promise<BoardTicketRow> {
  const fetchFn = cfg.fetchFn ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? 10_000;

  let res: Response;
  try {
    res = await fetchFn(`${cfg.apiUrl}/api/tickets/${ticketNumber}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Pipeline-Key": cfg.apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new BoardApiError(`Board API PATCH /api/tickets/${ticketNumber} failed: ${reason}`);
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch { /* non-critical */ }
    throw new BoardApiError(
      `Board API PATCH /api/tickets/${ticketNumber} returned HTTP ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      res.status,
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new BoardApiError(`Board API PATCH /api/tickets/${ticketNumber} returned invalid JSON: ${(err as Error).message}`);
  }

  const data = (json as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) {
    throw new BoardApiError(`Board API PATCH /api/tickets/${ticketNumber} did not return a ticket object`);
  }
  const row = data as Record<string, unknown>;
  const number = row.number;
  const id = row.id;
  const title = row.title;
  if (typeof number !== "number" || typeof id !== "string" || typeof title !== "string") {
    throw new BoardApiError(`Board API PATCH /api/tickets/${ticketNumber} returned a ticket missing required fields`);
  }
  return { number, id, title };
}

interface BoardProjectRow {
  id: string;
  name: string;
  slug: string;
}

function buildProjectUrl(boardUrl: string | undefined, slug: string): string {
  if (!boardUrl) return slug;
  const trimmed = boardUrl.replace(/\/+$/, "");
  return `${trimmed}/p/${slug}`;
}

async function postProject(
  cfg: BoardClientConfig,
  payload: Record<string, unknown>,
): Promise<BoardProjectRow> {
  const fetchFn = cfg.fetchFn ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? 10_000;

  let res: Response;
  try {
    res = await fetchFn(`${cfg.apiUrl}/api/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pipeline-Key": cfg.apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new BoardApiError(`Board API POST /api/projects failed: ${reason}`);
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch { /* non-critical */ }
    throw new BoardApiError(
      `Board API POST /api/projects returned HTTP ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      res.status,
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new BoardApiError(`Board API POST /api/projects returned invalid JSON: ${(err as Error).message}`);
  }

  const data = (json as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) {
    throw new BoardApiError("Board API POST /api/projects did not return a project object");
  }
  const row = data as Record<string, unknown>;
  const id = row.id;
  const name = row.name;
  const slug = row.slug;
  if (typeof id !== "string" || typeof name !== "string" || typeof slug !== "string") {
    throw new BoardApiError("Board API POST /api/projects returned a project missing required fields");
  }
  return { id, name, slug };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function toTicketPayload(input: TicketInput, projectId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: input.title,
    body: input.body,
    status: "backlog",
    project_id: projectId,
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.tags ? { tags: input.tags } : {}),
    ...extra,
  };
}

/**
 * Create a ticket or epic-with-children, based on the classifier's category.
 *
 * - category "ticket": one Board ticket in status `backlog`.
 * - category "epic":   one Epic ticket, then N children in parallel, each
 *                      with `parent_ticket_id` pointing to the Epic.
 *
 * Child creation failures are collected and returned in `failed_children`
 * — the Epic is still a successful create because the user has something
 * to look at and can correct the hierarchy. Full-failure cases (Epic
 * itself fails) throw.
 */
export async function createFromClassification(
  req: CreateRequest,
  cfg: BoardClientConfig,
): Promise<CreateResult> {
  const startedAt = Date.now();

  if (req.category === "ticket") {
    const row = await postTicket(cfg, toTicketPayload(req.ticket, req.project_id));
    const ticket: CreatedTicket = {
      number: row.number,
      id: row.id,
      title: row.title,
      url: buildTicketUrl(req.board_url, row.number),
    };
    logger.info(
      { projectId: req.project_id, ticketNumber: row.number, durationMs: Date.now() - startedAt },
      "Sidekick created ticket",
    );
    return { category: "ticket", ticket };
  }

  // Epic + children
  const epicRow = await postTicket(cfg, toTicketPayload(req.epic, req.project_id));
  const epic: CreatedTicket = {
    number: epicRow.number,
    id: epicRow.id,
    title: epicRow.title,
    url: buildTicketUrl(req.board_url, epicRow.number),
  };

  // Create children in parallel — each depends only on the Epic ID.
  const results = await Promise.allSettled(
    req.children.map((child) =>
      postTicket(cfg, toTicketPayload(child, req.project_id, { parent_ticket_id: epicRow.id })),
    ),
  );

  const children: CreatedTicket[] = [];
  const failed: Array<{ index: number; title: string; reason: string }> = [];

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      children.push({
        number: r.value.number,
        id: r.value.id,
        title: r.value.title,
        url: buildTicketUrl(req.board_url, r.value.number),
      });
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      failed.push({ index: i, title: req.children[i].title, reason });
      logger.warn(
        { epicNumber: epicRow.number, childIndex: i, childTitle: req.children[i].title, reason },
        "Sidekick epic child creation failed",
      );
      Sentry.captureMessage("Sidekick epic child creation failed", {
        level: "warning",
        extra: { epicNumber: epicRow.number, childIndex: i, reason },
      });
    }
  });

  logger.info(
    {
      projectId: req.project_id,
      epicNumber: epicRow.number,
      childrenRequested: req.children.length,
      childrenCreated: children.length,
      childrenFailed: failed.length,
      durationMs: Date.now() - startedAt,
    },
    "Sidekick created epic",
  );

  return {
    category: "epic",
    epic,
    children,
    ...(failed.length > 0 ? { failed_children: failed } : {}),
  };
}

/**
 * Update an existing ticket the Sidekick has already created.
 *
 * Used when the user corrects the Sidekick after creation ("ne anders, mach
 * aus dem Titel X") — per T-876 this is never a new-ticket flow.
 */
export async function updateFromCorrection(
  req: UpdateRequest,
  cfg: BoardClientConfig,
  boardUrl?: string,
): Promise<UpdateResult> {
  const startedAt = Date.now();
  const row = await patchTicket(cfg, req.ticket_number, req.patch as Record<string, unknown>);
  const ticket: CreatedTicket = {
    number: row.number,
    id: row.id,
    title: row.title,
    // Prefer the per-request board_url (validated) over the function-level
    // fallback, so both creation and update resolve URLs the same way.
    url: buildTicketUrl(req.board_url ?? boardUrl, row.number),
  };
  logger.info(
    {
      ticketNumber: req.ticket_number,
      fields: Object.keys(req.patch),
      durationMs: Date.now() - startedAt,
    },
    "Sidekick updated ticket",
  );
  return { ticket };
}

/**
 * T-877: Create a new project from a category-4 product idea.
 *
 * Unlike ticket/epic, this is a three-step flow:
 *   1. POST /api/projects → new project in the workspace
 *   2. POST /api/tickets → Init-Epic "Projekt-Grundgeruest {Name}" scoped to the new project
 *   3. POST /api/tickets × 3 → default child tickets (Scope, Stack, User-Journey) with parent_ticket_id set
 *
 * The project is created first because Epic + children need a valid project_id.
 * If project creation fails, the error bubbles up and nothing is created.
 * If the epic fails after the project is created, the project still exists —
 * this is an acceptable degenerate state (the user can see a new empty project
 * and the Sidekick tells them the epic failed).
 *
 * Child-level failures are collected into `failed_children` — the project +
 * epic are still a success because the user has the container they need.
 */
export async function createProjectFromIdea(
  req: CreateProjectRequest,
  cfg: BoardClientConfig,
): Promise<CreateProjectResult> {
  const startedAt = Date.now();

  // Step 1: create the project
  const projectRow = await postProject(cfg, {
    workspace_id: req.workspace_id,
    name: req.project_name,
    description: req.description,
  });
  const project: CreatedProject = {
    id: projectRow.id,
    name: projectRow.name,
    slug: projectRow.slug,
    url: buildProjectUrl(req.board_url, projectRow.slug),
  };

  // Step 2: create the Init-Epic inside the new project
  const epicTitle = `[Epic] Projekt-Grundgeruest ${req.project_name}`;
  const epicBody =
    `Container für die initialen Schritte des Projekts **${req.project_name}**.\n\n` +
    `## Projekt-Beschreibung\n\n${req.description}\n\n` +
    `## Nächste Schritte\n\n` +
    `Die Child-Tickets decken den Einstieg ab: Scope, Tech-Stack, erste User-Journey. ` +
    `Reihenfolge ist bewusst offen — die Konversation zwischen CEO und product-cto / design-lead shaped die Details.`;

  const epicRow = await postTicket(cfg, toTicketPayload(
    { title: epicTitle, body: epicBody, priority: "high" },
    projectRow.id,
  ));
  const epic: CreatedTicket = {
    number: epicRow.number,
    id: epicRow.id,
    title: epicRow.title,
    url: buildTicketUrl(req.board_url, epicRow.number),
  };

  // Step 3: create the 3 default child tickets in parallel
  const childInputs: TicketInput[] = [
    {
      title: `Projekt-Scope klären: ${req.project_name}`,
      body:
        `## Ziel\n\nDen Scope von **${req.project_name}** festzurren — was ist im MVP drin, was ist explizit draussen.\n\n` +
        `## Ausgangslage\n\n${req.description}\n\n` +
        `## Desired Behavior\n\n` +
        `- Zielgruppe benannt (wer nutzt das Produkt, wofür)\n` +
        `- Core User Journey in 3-5 Sätzen beschrieben\n` +
        `- MVP-Scope: min. 3 Must-Have-Features\n` +
        `- Out-of-Scope-Liste: min. 3 Punkte, die bewusst nicht im MVP sind\n\n` +
        `## Acceptance Criteria\n\n` +
        `- [ ] Scope-Dokument im Epic-Body ergänzt oder als separates Ticket\n` +
        `- [ ] Zielgruppe + Core Journey sind ohne Rückfragen verständlich\n` +
        `- [ ] Out-of-Scope ist explizit\n\n` +
        `## Size: S`,
    },
    {
      title: `Tech-Stack-Entscheidung: ${req.project_name}`,
      body:
        `## Ziel\n\nTech-Stack für **${req.project_name}** festlegen — Framework, Backend, Hosting, Auth.\n\n` +
        `## Desired Behavior\n\n` +
        `- Stack-Entscheidung mit kurzer Begründung (1-2 Sätze pro Komponente)\n` +
        `- Deployment-Target benannt (Coolify/Vercel/Shopify/self-hosted)\n` +
        `- Auth-Ansatz benannt (Clerk/Supabase/Auth.js/keine)\n\n` +
        `## Acceptance Criteria\n\n` +
        `- [ ] Stack in \`project.json\` oder im Epic-Body dokumentiert\n` +
        `- [ ] \`setup.sh\` wurde im neuen Repo ausgeführt (falls Repo existiert)\n` +
        `- [ ] Build läuft lokal grün\n\n` +
        `## Out of Scope\n\n- Full Infra-Provisioning (separates Ticket)\n- Repo-Setup (separates Ticket)\n\n` +
        `## Size: M`,
    },
    {
      title: `Erste User-Journey bauen: ${req.project_name}`,
      body:
        `## Ziel\n\nDie Core User Journey von **${req.project_name}** als erstes funktionierendes End-to-End durchspielen.\n\n` +
        `## Depends On\n\nTech-Stack-Entscheidung (oben).\n\n` +
        `## Desired Behavior\n\n` +
        `- Eine einzige User Journey läuft von Start bis Ziel (kein Happy-Path-Fake)\n` +
        `- UI folgt \`frontend-design\`-Standards (Tokens, Komponenten, States)\n` +
        `- Feedback-Loop vorhanden (Loading, Error, Empty, Success State)\n\n` +
        `## Acceptance Criteria\n\n` +
        `- [ ] User kann den Flow Ende-zu-Ende klicken\n` +
        `- [ ] Alle vier States (Loading/Error/Empty/Success) sind implementiert\n` +
        `- [ ] Mobile + Desktop geprüft\n\n` +
        `## Size: M`,
    },
  ];

  const results = await Promise.allSettled(
    childInputs.map((child) =>
      postTicket(cfg, toTicketPayload(child, projectRow.id, { parent_ticket_id: epicRow.id })),
    ),
  );

  const children: CreatedTicket[] = [];
  const failed: Array<{ index: number; title: string; reason: string }> = [];

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      children.push({
        number: r.value.number,
        id: r.value.id,
        title: r.value.title,
        url: buildTicketUrl(req.board_url, r.value.number),
      });
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      failed.push({ index: i, title: childInputs[i].title, reason });
      logger.warn(
        { projectId: projectRow.id, epicNumber: epicRow.number, childIndex: i, childTitle: childInputs[i].title, reason },
        "Sidekick project-init child creation failed",
      );
      Sentry.captureMessage("Sidekick project-init child creation failed", {
        level: "warning",
        extra: { projectId: projectRow.id, epicNumber: epicRow.number, childIndex: i, reason },
      });
    }
  });

  logger.info(
    {
      workspaceId: req.workspace_id,
      projectId: projectRow.id,
      projectSlug: projectRow.slug,
      epicNumber: epicRow.number,
      childrenRequested: childInputs.length,
      childrenCreated: children.length,
      childrenFailed: failed.length,
      durationMs: Date.now() - startedAt,
    },
    "Sidekick created project",
  );

  return {
    project,
    epic,
    children,
    ...(failed.length > 0 ? { failed_children: failed } : {}),
  };
}
