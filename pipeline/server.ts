import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { loadProjectConfig, type ProjectConfig } from "./lib/config.ts";
import { executePipeline, resumePipeline } from "./run.ts";
import { WorktreeManager } from "./lib/worktree-manager.ts";
import { DrainManager } from "./lib/drain.ts";
import {
  loadServerConfig,
  findProjectByProjectId,
  loadProjectEnv,
  type ServerConfig,
} from "./lib/server-config.ts";

// --- Mode detection ---
const SERVER_CONFIG_PATH = process.env.SERVER_CONFIG_PATH;
const isMultiProjectMode = !!SERVER_CONFIG_PATH;

let serverConfig: ServerConfig | null = null;
let PROJECT_DIR: string;
let PIPELINE_SERVER_KEY: string;
let config: ProjectConfig;
let worktreeManager: WorktreeManager | null = null;

if (isMultiProjectMode) {
  serverConfig = loadServerConfig(SERVER_CONFIG_PATH);
  PIPELINE_SERVER_KEY = serverConfig.server.pipeline_key;
  const projectSlugs = Object.keys(serverConfig.projects);
  if (projectSlugs.length > 0) {
    const firstSlug = projectSlugs[0];
    PROJECT_DIR = serverConfig.projects[firstSlug].project_dir;
    config = loadProjectConfig(PROJECT_DIR);
  } else {
    PROJECT_DIR = "/tmp";
    config = loadProjectConfig("/tmp");
  }
} else {
  const required = ["ANTHROPIC_API_KEY", "GH_TOKEN", "PROJECT_DIR", "PIPELINE_SERVER_KEY"] as const;
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`ERROR: ${key} must be set`);
      process.exit(1);
    }
  }
  PROJECT_DIR = process.env.PROJECT_DIR!;
  PIPELINE_SERVER_KEY = process.env.PIPELINE_SERVER_KEY!;
  config = loadProjectConfig(PROJECT_DIR);
  worktreeManager = new WorktreeManager(PROJECT_DIR, config.maxWorkers);
}

const PORT = Number(process.env.PORT ?? serverConfig?.server.port ?? "3001");

// --- Logging (same style as worker.ts) ---
function log(msg: string) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

// --- In-memory running set (idempotency guard) ---
const runningTickets = new Set<number>();

interface PipelineState {
  running: {
    ticketNumber: number;
    projectSlug: string;
    startedAt: Date;
  } | null;
}
const pipelineState: PipelineState = { running: null };

// --- Drain manager (for zero-downtime updates) ---
const drainManager = new DrainManager(() => runningTickets.size);

// --- Trigger file path (for Update-Agent communication) ---
const TRIGGER_DIR = "/home/claude-dev/.just-ship/triggers";

// --- Board API helpers ---
function getApiCredentials(): { apiUrl: string; apiKey: string } {
  if (serverConfig) {
    return { apiUrl: serverConfig.workspace.board_url, apiKey: serverConfig.workspace.api_key };
  }
  return { apiUrl: config.pipeline.apiUrl, apiKey: config.pipeline.apiKey };
}

async function fetchTicket(ticketNumber: number): Promise<Record<string, unknown> | null> {
  const { apiUrl, apiKey } = getApiCredentials();
  try {
    const res = await fetch(`${apiUrl}/api/tickets/${ticketNumber}`, {
      headers: {
        "X-Pipeline-Key": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Record<string, unknown> };
    return json.data ?? null;
  } catch {
    return null;
  }
}

async function patchTicket(ticketNumber: number, body: Record<string, unknown>): Promise<boolean> {
  const { apiUrl, apiKey } = getApiCredentials();
  try {
    const res = await fetch(`${apiUrl}/api/tickets/${ticketNumber}`, {
      method: "PATCH",
      headers: {
        "X-Pipeline-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// --- HTTP helpers ---
function sendJson(res: ServerResponse, status: number, data: Record<string, unknown>) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// --- Launch logic (shared between /api/launch and /api/events) ---
async function handleLaunch(ticketNumber: number, res: ServerResponse, projectId?: string): Promise<void> {
  // 0. Drain guard — reject new runs when draining/drained
  if (!drainManager.canAcceptWork()) {
    res.setHeader("Retry-After", "60");
    sendJson(res, 503, {
      status: "unavailable",
      ticket_number: ticketNumber,
      message: "Server is draining for update — retry later",
      drain: drainManager.getStatus(),
    });
    return;
  }

  // 1. In-memory guard
  if (runningTickets.has(ticketNumber)) {
    sendJson(res, 409, {
      status: "conflict",
      ticket_number: ticketNumber,
      message: "Ticket is already being processed by this server",
    });
    return;
  }

  // 1b. Multi-project busy guard (one pipeline at a time)
  if (isMultiProjectMode && pipelineState.running) {
    sendJson(res, 429, {
      status: "busy",
      ticket_number: ticketNumber,
      message: "Server is busy processing another ticket",
      current: {
        ticket_number: pipelineState.running.ticketNumber,
        project: pipelineState.running.projectSlug,
        started_at: pipelineState.running.startedAt.toISOString(),
      },
    });
    return;
  }

  // 1c. Resolve project in multi-project mode
  let projectDir = PROJECT_DIR;
  let projectConfig = config;
  let projectEnv: Record<string, string> = {};
  let projectSlug = "";

  if (isMultiProjectMode) {
    if (!projectId) {
      sendJson(res, 400, {
        status: "bad_request",
        ticket_number: ticketNumber,
        message: "Missing required field: project_id (required in multi-project mode)",
      });
      return;
    }

    const match = findProjectByProjectId(serverConfig!, projectId);
    if (!match) {
      sendJson(res, 404, {
        status: "not_found",
        ticket_number: ticketNumber,
        message: `No project configured for project_id: ${projectId}`,
      });
      return;
    }

    projectSlug = match.slug;
    projectDir = match.project.project_dir;
    projectEnv = loadProjectEnv(match.project.env_file);
    projectConfig = loadProjectConfig(projectDir);
  }

  // 2. Fetch ticket from Board API
  const ticket = await fetchTicket(ticketNumber);
  if (!ticket) {
    sendJson(res, 404, {
      status: "not_found",
      ticket_number: ticketNumber,
      message: "Ticket not found",
    });
    return;
  }

  // 3. Check pipeline_status
  const pipelineStatus = ticket.pipeline_status as string | null;
  if (pipelineStatus === "done") {
    sendJson(res, 409, {
      status: "conflict",
      ticket_number: ticketNumber,
      pipeline_status: pipelineStatus,
      message: "Ticket already has pipeline_status: done",
    });
    return;
  }

  if (pipelineStatus === "running") {
    // If this server is actually running it → real conflict
    if (runningTickets.has(ticketNumber)) {
      sendJson(res, 409, {
        status: "conflict",
        ticket_number: ticketNumber,
        pipeline_status: pipelineStatus,
        message: "Ticket is already being processed by this server",
      });
      return;
    }
    // Zombie: DB says running but server has no record → reset and re-launch
    log(`Zombie detected: T-${ticketNumber} has pipeline_status=running but is not in runningTickets — resetting`);
  }

  if (pipelineStatus === "paused") {
    // Paused tickets can be retried (resume or restart)
    // If server has the session in memory, it's truly paused
    // If not in memory (server restart), allow re-launch to continue
    log(`Retrying paused ticket: T-${ticketNumber}`);
  }

  // 4. Reserve ticket in-memory before async PATCH to close concurrent-request race window
  // SECURITY: add before awaiting so two simultaneous requests cannot both pass step 1
  runningTickets.add(ticketNumber);

  // 5. Atomic claim via PATCH
  const claimed = await patchTicket(ticketNumber, {
    status: "in_progress",
    pipeline_status: "running",
    project_id: projectConfig.pipeline.projectId,
  });

  if (!claimed) {
    runningTickets.delete(ticketNumber);
    sendJson(res, 500, {
      status: "error",
      ticket_number: ticketNumber,
      message: "Failed to claim ticket via Board API",
    });
    return;
  }

  // 6. Respond immediately (202 Accepted)
  sendJson(res, 202, {
    status: "queued",
    ticket_number: ticketNumber,
    message: "Pipeline started",
  });

  // 7. Run pipeline in background
  const title = (ticket.title as string) ?? "Untitled";
  const body = (ticket.body as string) ?? "No description provided";
  const tags = Array.isArray(ticket.tags) ? (ticket.tags as string[]).join(",") : "";

  log(`Pipeline started: T-${ticketNumber} -- ${title}`);

  const branchSlug = title.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40);
  const branchName = `${projectConfig.conventions.branch_prefix}${ticketNumber}-${branchSlug}`;

  if (isMultiProjectMode) {
    pipelineState.running = {
      ticketNumber,
      projectSlug,
      startedAt: new Date(),
    };
  }

  (async () => {
    let slotId: number | undefined;
    try {
      let workDir: string | undefined;

      if (isMultiProjectMode) {
        // Multi-project mode: no worktree, work directly in project dir (CLI-mode git checkout)
        workDir = undefined;
      } else {
        const slot = await worktreeManager!.allocate(branchName);
        slotId = slot.slotId;
        workDir = slot.workDir;
      }

      const result = await executePipeline({
        projectDir: projectDir,
        workDir,
        branchName,
        ticket: { ticketId: String(ticketNumber), title, description: body, labels: tags },
        env: Object.keys(projectEnv).length > 0 ? projectEnv : undefined,
      });

      if (result.status === "completed") {
        log(`Pipeline completed: T-${ticketNumber} -> ${result.branch}`);
        await patchTicket(ticketNumber, { pipeline_status: "done", status: "in_review", branch: result.branch });
      } else if (result.status === "paused") {
        log(`Pipeline paused: T-${ticketNumber}`);
        await patchTicket(ticketNumber, { pipeline_status: "paused", session_id: result.sessionId });
        if (!isMultiProjectMode && slotId !== undefined) {
          await worktreeManager!.park(slotId);
          slotId = undefined;
        }
      } else {
        const reason = result.failureReason ?? `exited with code ${result.exitCode}`;
        log(`Pipeline failed: T-${ticketNumber} (${reason})`);
        await patchTicket(ticketNumber, { pipeline_status: "failed", status: "ready_to_develop", summary: `Pipeline error: ${reason}` });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      log(`Pipeline crashed: T-${ticketNumber} -- ${reason}`);
      await patchTicket(ticketNumber, { pipeline_status: "failed", status: "ready_to_develop", summary: `Server error: ${reason}` });
    } finally {
      if (!isMultiProjectMode && slotId !== undefined) await worktreeManager!.release(slotId);
      if (isMultiProjectMode) pipelineState.running = null;
      runningTickets.delete(ticketNumber);
    }
  })();
}

// --- Ship logic ---
async function handleShip(ticketNumber: number, res: ServerResponse, projectId?: string): Promise<void> {
  // Resolve project dir for execSync calls
  let shipProjectDir = PROJECT_DIR;
  if (isMultiProjectMode && projectId) {
    const match = findProjectByProjectId(serverConfig!, projectId);
    if (match) {
      shipProjectDir = match.project.project_dir;
    }
  }

  // 1. Fetch ticket
  const ticket = await fetchTicket(ticketNumber);
  if (!ticket) {
    sendJson(res, 404, { status: "not_found", ticket_number: ticketNumber, message: "Ticket not found" });
    return;
  }

  // 2. Validate status
  const status = ticket.status as string;
  if (status !== "in_review") {
    sendJson(res, 409, {
      status: "conflict",
      ticket_number: ticketNumber,
      message: `Ticket status is "${status}", expected "in_review"`,
    });
    return;
  }

  // 3. Get branch
  const branch = ticket.branch as string | null;
  if (!branch) {
    sendJson(res, 400, {
      status: "bad_request",
      ticket_number: ticketNumber,
      message: "Ticket has no branch set",
    });
    return;
  }

  // 4. Respond immediately
  sendJson(res, 202, {
    status: "accepted",
    ticket_number: ticketNumber,
    message: "Ship process started",
  });

  // 5. Merge PR in background
  log(`Ship started: T-${ticketNumber} -- branch ${branch}`);

  (async () => {
    try {
      // Find PR number for branch
      const prListOutput = execSync(
        `gh pr list --head "${branch}" --json number --jq '.[0].number'`,
        { cwd: shipProjectDir, encoding: "utf-8", timeout: 30000 }
      ).trim();

      if (!prListOutput) {
        log(`Ship failed: T-${ticketNumber} -- no PR found for branch ${branch}`);
        await patchTicket(ticketNumber, {
          summary: `Ship failed: No PR found for branch ${branch}`,
        });
        return;
      }

      const prNumber = prListOutput;

      // Merge PR
      execSync(
        `gh pr merge ${prNumber} --squash --delete-branch`,
        { cwd: shipProjectDir, encoding: "utf-8", timeout: 60000 }
      );

      log(`Ship completed: T-${ticketNumber} -- PR #${prNumber} merged`);
      await patchTicket(ticketNumber, {
        status: "done",
        pipeline_status: "done",
      });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      log(`Ship failed: T-${ticketNumber} -- ${reason}`);
      await patchTicket(ticketNumber, {
        summary: `Ship error: ${reason}`,
      });
    }
  })();
}

// --- Request handler ---
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  // GET /health — no auth
  if (method === "GET" && url === "/health") {
    if (isMultiProjectMode) {
      sendJson(res, 200, {
        status: "ok",
        mode: "multi-project",
        running: pipelineState.running ? {
          ticket_number: pipelineState.running.ticketNumber,
          project: pipelineState.running.projectSlug,
          started_at: pipelineState.running.startedAt.toISOString(),
        } : null,
        drain: drainManager.getStatus(),
      });
    } else {
      sendJson(res, 200, {
        status: "ok",
        mode: "single-project",
        running_count: runningTickets.size,
        active_slots: worktreeManager?.getActiveSlots() ?? [],
        max_workers: config.maxWorkers,
        drain: drainManager.getStatus(),
      });
    }
    return;
  }

  // GET /api/status/:ticket
  const statusMatch = method === "GET" && url.match(/^\/api\/status\/(\d+)$/);
  if (statusMatch) {
    const ticketNum = Number(statusMatch[1]);
    if (isMultiProjectMode && pipelineState.running?.ticketNumber === ticketNum) {
      sendJson(res, 200, {
        ticket_number: ticketNum,
        status: "running",
        project: pipelineState.running.projectSlug,
        started_at: pipelineState.running.startedAt.toISOString(),
      });
    } else if (runningTickets.has(ticketNum)) {
      sendJson(res, 200, { ticket_number: ticketNum, status: "running" });
    } else {
      sendJson(res, 200, { ticket_number: ticketNum, status: "idle" });
    }
    return;
  }

  // POST /api/launch
  if (method === "POST" && url === "/api/launch") {
    // Auth check
    const apiKey = req.headers["x-pipeline-key"] as string | undefined;
    if (!apiKey || apiKey !== PIPELINE_SERVER_KEY) {
      sendJson(res, 401, { status: "unauthorized", message: "Invalid or missing X-Pipeline-Key" });
      return;
    }

    // Parse body
    let body: Record<string, unknown>;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { status: "bad_request", message: "Invalid JSON body" });
      return;
    }

    const ticketNumber = body.ticket_number;
    if (typeof ticketNumber !== "number" || !Number.isInteger(ticketNumber) || ticketNumber <= 0) {
      sendJson(res, 400, {
        status: "bad_request",
        message: "Missing or invalid field: ticket_number (must be a positive integer)",
      });
      return;
    }

    const projectId = body.project_id as string | undefined;
    await handleLaunch(ticketNumber, res, projectId);
    return;
  }

  // POST /api/events (Board event format)
  if (method === "POST" && url === "/api/events") {
    // Auth check
    const apiKey = req.headers["x-pipeline-key"] as string | undefined;
    if (!apiKey || apiKey !== PIPELINE_SERVER_KEY) {
      sendJson(res, 401, { status: "unauthorized", message: "Invalid or missing X-Pipeline-Key" });
      return;
    }

    // Parse body
    let body: Record<string, unknown>;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { status: "bad_request", message: "Invalid JSON body" });
      return;
    }

    const eventType = body.event_type as string | undefined;

    // Only handle "launch" events
    if (eventType !== "launch") {
      sendJson(res, 200, { status: "ignored", event_type: eventType ?? "unknown" });
      return;
    }

    const ticketNumber = body.ticket_number;
    if (typeof ticketNumber !== "number" || !Number.isInteger(ticketNumber) || ticketNumber <= 0) {
      sendJson(res, 400, {
        status: "bad_request",
        message: "Missing or invalid field: ticket_number (must be a positive integer)",
      });
      return;
    }

    const projectId = body.project_id as string | undefined;
    await handleLaunch(ticketNumber, res, projectId);
    return;
  }

  // POST /api/answer — Resume paused pipeline with human answer
  if (method === "POST" && url === "/api/answer") {
    const apiKey = req.headers["x-pipeline-key"] as string | undefined;
    if (!apiKey || apiKey !== PIPELINE_SERVER_KEY) {
      sendJson(res, 401, { status: "unauthorized", message: "Invalid or missing X-Pipeline-Key" });
      return;
    }

    let body: Record<string, unknown>;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { status: "bad_request", message: "Invalid JSON body" });
      return;
    }

    const ticketNumber = body.ticket_number;
    const answer = body.answer;
    if (typeof ticketNumber !== "number" || !Number.isInteger(ticketNumber) || ticketNumber <= 0) {
      sendJson(res, 400, { status: "bad_request", message: "Missing or invalid field: ticket_number" });
      return;
    }
    if (typeof answer !== "string" || !answer.trim()) {
      sendJson(res, 400, { status: "bad_request", message: "Missing or invalid field: answer" });
      return;
    }

    // Idempotency guard
    if (runningTickets.has(ticketNumber)) {
      sendJson(res, 409, { status: "conflict", message: "Ticket is already being processed" });
      return;
    }

    // Fetch ticket to get session_id
    const ticket = await fetchTicket(ticketNumber);
    if (!ticket) {
      sendJson(res, 404, { status: "not_found", message: "Ticket not found" });
      return;
    }

    const sessionId = ticket.session_id as string | null;
    if (!sessionId) {
      sendJson(res, 400, { status: "bad_request", message: "Ticket has no session_id — cannot resume" });
      return;
    }

    if (ticket.pipeline_status !== "paused") {
      sendJson(res, 409, { status: "conflict", message: `Ticket pipeline_status is "${ticket.pipeline_status}", expected "paused"` });
      return;
    }

    // Resolve project in multi-project mode
    const answerProjectId = body.project_id as string | undefined;
    let answerProjectDir = PROJECT_DIR;
    let answerProjectConfig = config;
    let answerProjectEnv: Record<string, string> = {};

    if (isMultiProjectMode && answerProjectId) {
      const match = findProjectByProjectId(serverConfig!, answerProjectId);
      if (match) {
        answerProjectDir = match.project.project_dir;
        answerProjectEnv = loadProjectEnv(match.project.env_file);
        answerProjectConfig = loadProjectConfig(answerProjectDir);
      }
    }

    // Reserve and respond
    runningTickets.add(ticketNumber);

    await patchTicket(ticketNumber, {
      pipeline_status: "running",
    });

    sendJson(res, 202, {
      status: "resuming",
      ticket_number: ticketNumber,
      message: "Pipeline resuming with answer",
    });

    // Resume pipeline in background
    const title = (ticket.title as string) ?? "Untitled";
    const ticketBody = (ticket.body as string) ?? "No description provided";
    const tags = Array.isArray(ticket.tags) ? (ticket.tags as string[]).join(",") : "";

    log(`Pipeline resuming: T-${ticketNumber} -- answer received`);

    const branchSlug = title.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40);
    const branchName = `${answerProjectConfig.conventions.branch_prefix}${ticketNumber}-${branchSlug}`;

    (async () => {
      let slotId: number | undefined;
      try {
        let workDir: string | undefined;

        if (isMultiProjectMode) {
          // Multi-project mode: no worktree, work directly in project dir
          workDir = undefined;
        } else {
          const slot = await worktreeManager!.reattach(branchName);
          slotId = slot.slotId;
          workDir = slot.workDir;
        }

        const result = await resumePipeline({
          projectDir: answerProjectDir,
          workDir,
          branchName,
          ticket: { ticketId: String(ticketNumber), title, description: ticketBody, labels: tags },
          sessionId,
          answer: answer.trim(),
          env: Object.keys(answerProjectEnv).length > 0 ? answerProjectEnv : undefined,
        });

        if (result.status === "paused") {
          await patchTicket(ticketNumber, { pipeline_status: "paused", session_id: result.sessionId });
          if (!isMultiProjectMode && slotId !== undefined) {
            await worktreeManager!.park(slotId);
            slotId = undefined;
          }
        } else if (result.status === "completed") {
          await patchTicket(ticketNumber, { pipeline_status: "done", status: "in_review", branch: result.branch, session_id: null });
        } else {
          const reason = result.failureReason ?? `exited with code ${result.exitCode}`;
          await patchTicket(ticketNumber, { pipeline_status: "failed", status: "ready_to_develop", summary: `Pipeline error: ${reason}`, session_id: null });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        log(`Pipeline resume crashed: T-${ticketNumber} -- ${reason}`);
        await patchTicket(ticketNumber, { pipeline_status: "failed", status: "ready_to_develop", summary: `Resume error: ${reason}`, session_id: null });
      } finally {
        if (!isMultiProjectMode && slotId !== undefined) await worktreeManager!.release(slotId);
        runningTickets.delete(ticketNumber);
      }
    })();

    return;
  }

  // POST /api/ship
  if (method === "POST" && url === "/api/ship") {
    const apiKey = req.headers["x-pipeline-key"] as string | undefined;
    if (!apiKey || apiKey !== PIPELINE_SERVER_KEY) {
      sendJson(res, 401, { status: "unauthorized", message: "Invalid or missing X-Pipeline-Key" });
      return;
    }

    let body: Record<string, unknown>;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { status: "bad_request", message: "Invalid JSON body" });
      return;
    }

    const ticketNumber = body.ticket_number;
    if (typeof ticketNumber !== "number" || !Number.isInteger(ticketNumber) || ticketNumber <= 0) {
      sendJson(res, 400, { status: "bad_request", message: "Missing or invalid field: ticket_number" });
      return;
    }

    const projectId = body.project_id as string | undefined;
    await handleShip(ticketNumber, res, projectId);
    return;
  }

  // POST /api/update — Receive update trigger from Board, write trigger file for Update-Agent
  if (method === "POST" && url === "/api/update") {
    const updateSecret = serverConfig?.server.update_secret;
    const headerSecret = req.headers["x-update-secret"] as string | undefined;
    if (!updateSecret || !headerSecret || headerSecret !== updateSecret) {
      sendJson(res, 401, { status: "unauthorized", message: "Invalid or missing X-Update-Secret" });
      return;
    }

    let body: Record<string, unknown>;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { status: "bad_request", message: "Invalid JSON body" });
      return;
    }

    const version = body.version as string | undefined;
    const rolloutId = body.rollout_id as string | undefined;
    if (!version || !rolloutId) {
      sendJson(res, 400, { status: "bad_request", message: "Missing required fields: version, rollout_id" });
      return;
    }

    // Write trigger file for the host-level Update-Agent
    try {
      mkdirSync(TRIGGER_DIR, { recursive: true });
      const triggerPayload = {
        schema_version: 1,
        version,
        rollout_id: rolloutId,
        triggered_at: new Date().toISOString(),
      };
      writeFileSync(`${TRIGGER_DIR}/update-trigger.json`, JSON.stringify(triggerPayload, null, 2));
      log(`Update trigger written: version=${version} rollout=${rolloutId}`);
      sendJson(res, 202, { status: "accepted", message: "Update trigger written for Update-Agent" });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      log(`Failed to write update trigger: ${reason}`);
      sendJson(res, 500, { status: "error", message: `Failed to write trigger file: ${reason}` });
    }
    return;
  }

  // POST /api/drain — Start graceful drain (authenticated with X-Pipeline-Key)
  if (method === "POST" && url === "/api/drain") {
    const apiKey = req.headers["x-pipeline-key"] as string | undefined;
    if (!apiKey || apiKey !== PIPELINE_SERVER_KEY) {
      sendJson(res, 401, { status: "unauthorized", message: "Invalid or missing X-Pipeline-Key" });
      return;
    }

    const started = drainManager.startDrain({
      onForceStop: async () => {
        // Mark all running tickets as interrupted
        for (const ticketNumber of runningTickets) {
          log(`Force-drain: marking T-${ticketNumber} as interrupted_by_update`);
          await patchTicket(ticketNumber, {
            pipeline_status: "failed",
            status: "ready_to_develop",
            summary: "Pipeline interrupted by VPS update — will be re-queued",
          });
        }
      },
    });

    if (started) {
      log("Drain started — new runs will be rejected");
      sendJson(res, 202, { status: "accepted", message: "Drain started", drain: drainManager.getStatus() });
    } else {
      sendJson(res, 409, {
        status: "conflict",
        message: `Server is already in state: ${drainManager.getState()}`,
        drain: drainManager.getStatus(),
      });
    }
    return;
  }

  // POST /api/force-drain — Force immediate drain (authenticated with X-Pipeline-Key)
  if (method === "POST" && url === "/api/force-drain") {
    const apiKey = req.headers["x-pipeline-key"] as string | undefined;
    if (!apiKey || apiKey !== PIPELINE_SERVER_KEY) {
      sendJson(res, 401, { status: "unauthorized", message: "Invalid or missing X-Pipeline-Key" });
      return;
    }

    log("Force-drain requested");
    await drainManager.forceDrain();
    sendJson(res, 200, { status: "ok", message: "Force-drain completed", drain: drainManager.getStatus() });
    return;
  }

  // Fallback: 404
  sendJson(res, 404, { status: "not_found", message: `${method} ${url} not found` });
}

// --- Create server ---
const server = createServer((req, res) => {
  handleRequest(req, res).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : "Unknown error";
    log(`Unhandled error: ${reason}`);
    if (!res.headersSent) {
      sendJson(res, 500, { status: "error", message: "Internal server error" });
    }
  });
});

// --- Graceful shutdown ---
process.on("SIGINT", () => {
  log("SIGINT received, shutting down...");
  server.close(() => process.exit(0));
});
process.on("SIGTERM", () => {
  log("SIGTERM received, shutting down...");
  server.close(() => process.exit(0));
});

// --- Start ---
server.listen(PORT, () => {
  log("==========================================");
  log("  Just Ship Pipeline Server");
  log(`  Port: ${PORT}`);
  if (isMultiProjectMode && serverConfig) {
    log(`  Mode: multi-project`);
    log(`  Projects: ${Object.keys(serverConfig.projects).join(", ")}`);
  } else {
    log(`  Mode: single-project`);
    log(`  Project: ${PROJECT_DIR.split("/").pop()}`);
  }
  log("==========================================");
});
