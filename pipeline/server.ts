import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execSync } from "node:child_process";
import { loadProjectConfig, type ProjectConfig } from "./lib/config.ts";
import { executePipeline, resumePipeline } from "./run.ts";

// --- Environment validation ---
const required = [
  "ANTHROPIC_API_KEY",
  "GH_TOKEN",
  "PROJECT_DIR",
  "PIPELINE_SERVER_KEY",
] as const;

for (const key of required) {
  if (!process.env[key]) {
    console.error(`ERROR: ${key} must be set`);
    process.exit(1);
  }
}

const PROJECT_DIR = process.env.PROJECT_DIR!;
const PIPELINE_SERVER_KEY = process.env.PIPELINE_SERVER_KEY!;
const PORT = Number(process.env.PORT ?? "3001");

// --- Config ---
const config: ProjectConfig = loadProjectConfig(PROJECT_DIR);

// --- Logging (same style as worker.ts) ---
function log(msg: string) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

// --- In-memory running set (idempotency guard) ---
const runningTickets = new Set<number>();

// --- Board API helpers ---
async function fetchTicket(ticketNumber: number): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${config.pipeline.apiUrl}/api/tickets/${ticketNumber}`, {
      headers: {
        "X-Pipeline-Key": config.pipeline.apiKey,
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
  try {
    const res = await fetch(`${config.pipeline.apiUrl}/api/tickets/${ticketNumber}`, {
      method: "PATCH",
      headers: {
        "X-Pipeline-Key": config.pipeline.apiKey,
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
async function handleLaunch(ticketNumber: number, res: ServerResponse): Promise<void> {
  // 1. In-memory guard
  if (runningTickets.has(ticketNumber)) {
    sendJson(res, 409, {
      status: "conflict",
      ticket_number: ticketNumber,
      message: "Ticket is already being processed by this server",
    });
    return;
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
  if (pipelineStatus === "running" || pipelineStatus === "done") {
    sendJson(res, 409, {
      status: "conflict",
      ticket_number: ticketNumber,
      pipeline_status: pipelineStatus,
      message: `Ticket already has pipeline_status: ${pipelineStatus}`,
    });
    return;
  }

  // 4. Reserve ticket in-memory before async PATCH to close concurrent-request race window
  // SECURITY: add before awaiting so two simultaneous requests cannot both pass step 1
  runningTickets.add(ticketNumber);

  // 5. Atomic claim via PATCH
  const claimed = await patchTicket(ticketNumber, {
    status: "in_progress",
    pipeline_status: "running",
    project_id: config.pipeline.projectId,
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

  executePipeline({
    projectDir: PROJECT_DIR,
    ticket: {
      ticketId: String(ticketNumber),
      title,
      description: body,
      labels: tags,
    },
  })
    .then(async (result) => {
      if (result.status === "completed") {
        log(`Pipeline completed: T-${ticketNumber} -> ${result.branch} (status: in_review)`);
        await patchTicket(ticketNumber, {
          pipeline_status: "done",
          status: "in_review",
          branch: result.branch,
        });
      } else if (result.status === "paused") {
        log(`Pipeline paused: T-${ticketNumber} -- waiting for human input`);
        await patchTicket(ticketNumber, {
          pipeline_status: "paused",
          session_id: result.sessionId,
        });
      } else {
        const reason = result.failureReason ?? `exited with code ${result.exitCode}`;
        log(`Pipeline failed: T-${ticketNumber} (${reason})`);
        await patchTicket(ticketNumber, {
          pipeline_status: "failed",
          status: "ready_to_develop",
          summary: `Pipeline error: ${reason}`,
        });
      }
    })
    .catch(async (error: unknown) => {
      const reason = error instanceof Error ? error.message : "Unknown error";
      log(`Pipeline crashed: T-${ticketNumber} -- ${reason}`);
      await patchTicket(ticketNumber, {
        pipeline_status: "failed",
        status: "ready_to_develop",
        summary: `Server error: ${reason}`,
      });
    })
    .finally(() => {
      runningTickets.delete(ticketNumber);
    });
}

// --- Ship logic ---
async function handleShip(ticketNumber: number, res: ServerResponse): Promise<void> {
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
        { cwd: PROJECT_DIR, encoding: "utf-8", timeout: 30000 }
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
        { cwd: PROJECT_DIR, encoding: "utf-8", timeout: 60000 }
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
    sendJson(res, 200, {
      status: "ok",
      running_count: runningTickets.size,
    });
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

    await handleLaunch(ticketNumber, res);
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

    await handleLaunch(ticketNumber, res);
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

    resumePipeline({
      projectDir: PROJECT_DIR,
      ticket: {
        ticketId: String(ticketNumber),
        title,
        description: ticketBody,
        labels: tags,
      },
      sessionId,
      answer: answer.trim(),
    })
      .then(async (result) => {
        if (result.status === "paused") {
          log(`Pipeline paused again: T-${ticketNumber} — waiting for next answer`);
          await patchTicket(ticketNumber, {
            pipeline_status: "paused",
            session_id: result.sessionId,
          });
        } else if (result.status === "completed") {
          log(`Pipeline completed: T-${ticketNumber} -> ${result.branch}`);
          await patchTicket(ticketNumber, {
            pipeline_status: "done",
            status: "in_review",
            branch: result.branch,
            session_id: null,
          });
        } else {
          const reason = result.failureReason ?? `exited with code ${result.exitCode}`;
          log(`Pipeline failed: T-${ticketNumber} (${reason})`);
          await patchTicket(ticketNumber, {
            pipeline_status: "failed",
            status: "ready_to_develop",
            summary: `Pipeline error: ${reason}`,
            session_id: null,
          });
        }
      })
      .catch(async (error: unknown) => {
        const reason = error instanceof Error ? error.message : "Unknown error";
        log(`Pipeline resume crashed: T-${ticketNumber} -- ${reason}`);
        await patchTicket(ticketNumber, {
          pipeline_status: "failed",
          status: "ready_to_develop",
          summary: `Resume error: ${reason}`,
          session_id: null,
        });
      })
      .finally(() => {
        runningTickets.delete(ticketNumber);
      });

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

    await handleShip(ticketNumber, res);
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
  log(`  Project: ${PROJECT_DIR.split("/").pop()}`);
  log("==========================================");
});
