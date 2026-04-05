import { initSentry, Sentry } from "./lib/sentry.ts";
initSentry();
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { loadProjectConfig, type ProjectConfig } from "./lib/config.ts";
import { classifyError, executeAutoHeal } from "./lib/error-handler.ts";
import { executePipeline, resumePipeline } from "./run.ts";
import { WorktreeManager } from "./lib/worktree-manager.ts";
import { DrainManager } from "./lib/drain.ts";
import { withWatchdog, getWatchdogTimeoutMs, sendAgentFailedEvent } from "./lib/watchdog.ts";
import {
  loadServerConfig,
  findProjectByProjectId,
  loadProjectEnv,
  type ServerConfig,
} from "./lib/server-config.ts";
import { checkBudget } from "./lib/budget.ts";
import type { PipelineCheckpoint } from "./lib/checkpoint.ts";
import { toBranchName, log } from "./lib/utils.ts";

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

// log() imported from ./lib/utils.ts

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

// --- In-memory run history (ring buffer, last 10 runs) ---
interface RunRecord {
  ticketNumber: number;
  status: "completed" | "failed";
  error?: string;
  at: string;
  durationMs?: number;
}
const runHistory: RunRecord[] = [];
const MAX_RUN_HISTORY = 10;
const serverStartedAt = Date.now();

function recordRun(record: RunRecord) {
  runHistory.push(record);
  if (runHistory.length > MAX_RUN_HISTORY) runHistory.shift();
}

// --- Drain manager (for zero-downtime updates) ---
const drainManager = new DrainManager(() => runningTickets.size);

// --- Server-level watchdog timeout ---
// Shared watchdog module: withWatchdog() and getWatchdogTimeoutMs() imported from ./lib/watchdog.ts

// --- Trigger file path (for Update-Agent communication) ---
const TRIGGER_DIR = "/home/claude-dev/.just-ship/triggers";

// --- Board API helpers ---
function getApiCredentials(): { apiUrl: string; apiKey: string } {
  if (serverConfig) {
    return { apiUrl: serverConfig.workspace.board_url, apiKey: serverConfig.workspace.api_key };
  }
  return { apiUrl: config.pipeline.apiUrl, apiKey: config.pipeline.apiKey };
}

function boardApiAdapter(projectCfg: ProjectConfig) {
  return {
    createTicket: async (title: string, body: string): Promise<number | null> => {
      const { apiUrl, apiKey } = getApiCredentials();
      try {
        const res = await fetch(`${apiUrl}/api/tickets`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Pipeline-Key": apiKey },
          body: JSON.stringify({ title, body, tags: ["auto-heal", "bug"], project_id: projectCfg.pipeline.projectId }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { data?: { number?: number } };
        return json.data?.number ?? null;
      } catch {
        // Best-effort: auto-heal ticket creation is non-critical
        return null;
      }
    },
    patchTicket: (n: number, data: Record<string, unknown>) => patchTicket(n, data),
  };
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
    // Best-effort: ticket fetch failure handled by caller via null return
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
    if (!res.ok) {
      log(`patchTicket T-${ticketNumber} failed: HTTP ${res.status} ${res.statusText}`);
    }
    return res.ok;
  } catch (err) {
    log(`patchTicket T-${ticketNumber} error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// --- HTTP helpers ---
function sendJson(res: ServerResponse, status: number, data: Record<string, unknown>) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage, maxBytes = 1_048_576): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > maxBytes) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// --- Launch logic (shared between /api/launch and /api/events) ---
async function handleLaunch(ticketNumber: number, res: ServerResponse, projectId?: string, launchBody?: Record<string, unknown>): Promise<void> {
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

  // --- SaaS ephemeral run mode ---
  // If the launch payload includes repo_url, this is a SaaS run:
  // clone the repo to a temp dir, run the pipeline, send a callback, and clean up.
  const repoUrl = launchBody?.repo_url as string | undefined;
  if (repoUrl) {
    const githubToken = launchBody!.github_token as string | undefined;
    const runId = launchBody!.run_id as string;
    const runToken = launchBody!.run_token as string;
    const callbackUrl = launchBody!.callback_url as string;
    const projectConfig2 = launchBody!.project_config as Record<string, unknown> | undefined;

    if (!runId || !runToken || !callbackUrl) {
      sendJson(res, 400, {
        status: "bad_request",
        ticket_number: ticketNumber,
        message: "SaaS launch requires: run_id, run_token, callback_url",
      });
      return;
    }

    // Reserve ticket in-memory
    runningTickets.add(ticketNumber);

    // Respond immediately
    sendJson(res, 202, {
      status: "queued",
      ticket_number: ticketNumber,
      run_id: runId,
      message: "SaaS pipeline started",
    });

    // Run SaaS pipeline in background
    (async () => {
      const startTime = Date.now();
      const tempDir = `/tmp/run-${runId}`;
      try {
        // 1. Clone repo
        const repoUrlWithoutProtocol = repoUrl.replace(/^https?:\/\//, "");
        const cloneUrl = githubToken
          ? `https://x-access-token:${githubToken}@${repoUrlWithoutProtocol}`
          : repoUrl;
        log(`[SaaS] Cloning ${repoUrlWithoutProtocol} to ${tempDir}`);
        execSync(`git clone --depth 1 "${cloneUrl}" "${tempDir}"`, {
          stdio: "pipe",
          timeout: 120_000,
        });

        // 2. Write temporary project.json from project_config
        if (projectConfig2) {
          const pipelineCfg = (projectConfig2.pipeline ?? {}) as Record<string, unknown>;
          const stackCfg = (projectConfig2.stack ?? {}) as Record<string, unknown>;
          const tempProjectJson = {
            name: projectConfig2.project_name ?? "saas-project",
            pipeline: { ...pipelineCfg },
            stack: { ...stackCfg },
          };
          writeFileSync(`${tempDir}/project.json`, JSON.stringify(tempProjectJson, null, 2));
        }

        // 3. Install framework files via setup.sh --update
        const setupScript = `${tempDir}/setup.sh`;
        try {
          execSync(`bash "${setupScript}" --update`, {
            cwd: tempDir,
            stdio: "pipe",
            timeout: 60_000,
          });
        } catch (setupErr) {
          // setup.sh may not exist in the repo yet — non-fatal for SaaS
          log(`[SaaS] setup.sh --update failed (non-fatal): ${setupErr instanceof Error ? setupErr.message : String(setupErr)}`);
        }

        // 4. Fetch ticket from Board API
        const ticket = await fetchTicket(ticketNumber);
        const title = (ticket?.title as string) ?? "Untitled";
        const ticketBody = (ticket?.body as string) ?? "No description provided";
        const tags = Array.isArray(ticket?.tags) ? (ticket.tags as string[]).join(",") : "";

        log(`[SaaS] Pipeline started: T-${ticketNumber} -- ${title}`);

        // 5. Run pipeline
        const result = await withWatchdog(
          executePipeline({
            projectDir: tempDir,
            ticket: { ticketId: String(ticketNumber), title, description: ticketBody, labels: tags },
          }),
          `T-${ticketNumber} SaaS executePipeline`,
        );

        log(`[SaaS] Pipeline finished: T-${ticketNumber} -> ${result.status}`);

        // 6. Send callback
        try {
          await fetch(callbackUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Run-Token": runToken,
            },
            body: JSON.stringify({
              run_id: runId,
              status: result.status === "completed" ? "completed" : "failed",
              pr_url: result.branch ? `check PR from branch ${result.branch}` : undefined,
              tokens_used: {
                input: result.tokens?.input ?? 0,
                output: result.tokens?.output ?? 0,
              },
              duration_seconds: Math.floor((Date.now() - startTime) / 1000),
              error_message: result.failureReason,
            }),
            signal: AbortSignal.timeout(15_000),
          });
        } catch (cbErr) {
          log(`[SaaS] Callback failed: ${cbErr instanceof Error ? cbErr.message : String(cbErr)}`);
        }

        recordRun({
          ticketNumber,
          status: result.status === "completed" ? "completed" : "failed",
          error: result.failureReason,
          at: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        log(`[SaaS] Pipeline crashed: T-${ticketNumber} -- ${reason}`);
        Sentry.captureException(error);

        // Best-effort callback on crash
        try {
          await fetch(callbackUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Run-Token": runToken,
            },
            body: JSON.stringify({
              run_id: runId,
              status: "failed",
              duration_seconds: Math.floor((Date.now() - startTime) / 1000),
              error_message: reason,
            }),
            signal: AbortSignal.timeout(15_000),
          });
        } catch { /* Best-effort: callback delivery on crash is non-critical */ }

        recordRun({
          ticketNumber,
          status: "failed",
          error: reason,
          at: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        });
      } finally {
        // Cleanup temp dir
        try {
          await rm(tempDir, { recursive: true, force: true });
          log(`[SaaS] Cleaned up ${tempDir}`);
        } catch { /* Best-effort: temp dir cleanup failure is non-critical */ }
        runningTickets.delete(ticketNumber);
      }
    })();

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

  const checkpoint = ticket?.pipeline_checkpoint as PipelineCheckpoint | null;

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

  if (pipelineStatus === "crashed") {
    // Crashed = watchdog timeout with partial work saved. Allow re-launch.
    // The pipeline will create a new worktree (or reattach via checkpoint in P1).
    log(`Crashed ticket: T-${ticketNumber} has pipeline_status=crashed — allowing re-launch`);
  }

  if (pipelineStatus === "paused") {
    // Paused tickets can be retried (resume or restart)
    // If server has the session in memory, it's truly paused
    // If not in memory (server restart), allow re-launch to continue
    log(`Retrying paused ticket: T-${ticketNumber}`);
  }

  // Complexity gate
  const ticketComplexity = (ticket.complexity as string) ?? "medium";
  const maxComplexity = projectConfig.pipeline.maxAutonomousComplexity ?? "medium";
  const allowedLevels = ["low", "medium", "high", "critical"];
  const maxIdx = allowedLevels.indexOf(maxComplexity);
  const ticketIdx = allowedLevels.indexOf(ticketComplexity);
  if (ticketIdx > maxIdx) {
    sendJson(res, 422, {
      status: "rejected",
      ticket_number: ticketNumber,
      message: `Ticket complexity '${ticketComplexity}' exceeds max autonomous level '${maxComplexity}'`,
    });
    return;
  }

  // Budget gate — block launch if workspace budget exceeded
  const { apiUrl: budgetApiUrl, apiKey: budgetApiKey } = getApiCredentials();
  const workspaceId = serverConfig?.workspace?.workspace_id ?? config.pipeline.workspaceId;
  if (workspaceId) {
    const budgetResult = await checkBudget({ apiUrl: budgetApiUrl, apiKey: budgetApiKey }, workspaceId);

    if (!budgetResult.allowed) {
      log(`Budget exceeded for workspace: ${budgetResult.reason}`);
      try {
        await fetch(`${budgetApiUrl}/api/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Pipeline-Key": budgetApiKey },
          body: JSON.stringify({
            ticket_number: ticketNumber,
            agent_type: "orchestrator",
            event_type: "budget_exceeded",
            metadata: { cost: budgetResult.currentCost, ceiling: budgetResult.ceiling },
          }),
          signal: AbortSignal.timeout(8000),
        });
      } catch { /* Best-effort: budget_exceeded event delivery is non-critical */ }
      sendJson(res, 402, { status: "budget_exceeded", ticket_number: ticketNumber, message: budgetResult.reason });
      return;
    }

    if (budgetResult.thresholdReached) {
      log(`Budget threshold reached: $${budgetResult.currentCost?.toFixed(2)} / $${budgetResult.ceiling?.toFixed(2)}`);
      try {
        await fetch(`${budgetApiUrl}/api/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Pipeline-Key": budgetApiKey },
          body: JSON.stringify({
            ticket_number: ticketNumber,
            agent_type: "orchestrator",
            event_type: "budget_threshold",
            metadata: { cost: budgetResult.currentCost, ceiling: budgetResult.ceiling },
          }),
          signal: AbortSignal.timeout(8000),
        });
      } catch { /* Best-effort: budget_threshold event delivery is non-critical */ }
    }
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

  const branchName = toBranchName(projectConfig.conventions.branch_prefix, ticketNumber, title);

  if (isMultiProjectMode) {
    pipelineState.running = {
      ticketNumber,
      projectSlug,
      startedAt: new Date(),
    };
  }

  (async () => {
    const startTime = Date.now();
    let slotId: number | undefined;
    try {
      let workDir: string | undefined;

      if (isMultiProjectMode) {
        // Multi-project mode: no worktree, work directly in project dir (CLI-mode git checkout)
        workDir = undefined;
      } else {
        // Checkpoint-based worktree recovery
        let worktreeResult;
        if (checkpoint?.branch_name && worktreeManager) {
          try {
            worktreeResult = await worktreeManager.reattach(checkpoint.branch_name);
            log(`Reattached worktree for checkpoint branch ${checkpoint.branch_name}`);
          } catch {
            // Worktree reattach failed — fall through to allocate a fresh one
            log(`Could not reattach checkpoint worktree, allocating new`);
            worktreeResult = await worktreeManager.allocate(branchName);
          }
        } else if (worktreeManager) {
          worktreeResult = await worktreeManager.allocate(branchName);
        }
        if (worktreeResult) {
          slotId = worktreeResult.slotId;
          workDir = worktreeResult.workDir;
        }
      }

      const result = await withWatchdog(
        executePipeline({
          projectDir: projectDir,
          workDir,
          branchName,
          ticket: { ticketId: String(ticketNumber), title, description: body, labels: tags },
          env: Object.keys(projectEnv).length > 0 ? projectEnv : undefined,
        }),
        `T-${ticketNumber} executePipeline`,
      );

      if (result.status === "completed") {
        log(`Pipeline completed: T-${ticketNumber} -> ${result.branch}`);
        await patchTicket(ticketNumber, { pipeline_status: "done", status: "in_review", branch: result.branch });
        recordRun({ ticketNumber, status: "completed", at: new Date().toISOString(), durationMs: Date.now() - startTime });
      } else if (result.status === "paused") {
        log(`Pipeline paused: T-${ticketNumber}`);
        await patchTicket(ticketNumber, { pipeline_status: "paused", session_id: result.sessionId });
        if (!isMultiProjectMode && slotId !== undefined) {
          await worktreeManager!.park(slotId);
          slotId = undefined;
        }
      } else {
        const reason = result.failureReason ?? `exited with code ${result.exitCode}`;
        const classification = classifyError({
          error: new Error(reason),
          ticketId: String(ticketNumber),
          exitCode: result.exitCode,
          timedOut: false,
          branch: branchName,
          projectDir,
        });
        log(`Pipeline failed: T-${ticketNumber} (${reason}) [${classification.action}]`);
        await patchTicket(ticketNumber, { pipeline_status: "failed", status: "ready_to_develop", summary: `Pipeline error: ${reason}` });
        recordRun({ ticketNumber, status: "failed", error: reason, at: new Date().toISOString(), durationMs: Date.now() - startTime });

        if (classification.action === "auto_heal") {
          log(`Auto-healing: T-${ticketNumber} -- ${classification.reason}`);
          const healResult = await executeAutoHeal(
            { error: new Error(reason), ticketId: String(ticketNumber), exitCode: result.exitCode, timedOut: false, branch: branchName, projectDir },
            classification,
            boardApiAdapter(projectConfig),
          );
          if (healResult.healed) log(`Auto-heal complete: ${healResult.summary}`);
        }
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      const classification = classifyError({
        error: errorObj,
        ticketId: String(ticketNumber),
        exitCode: 1,
        timedOut: false,
        branch: branchName,
        projectDir,
      });

      const reason = errorObj.message;
      log(`Pipeline crashed: T-${ticketNumber} -- ${reason} [${classification.action}]`);
      Sentry.captureException(error);
      // Send agent_failed event for Board visibility
      const creds = getApiCredentials();
      await sendAgentFailedEvent(creds.apiUrl, creds.apiKey, ticketNumber, "crashed", false);
      await patchTicket(ticketNumber, { pipeline_status: "failed", status: "ready_to_develop", summary: `Server error: ${reason}` });
      recordRun({ ticketNumber, status: "failed", error: reason, at: new Date().toISOString(), durationMs: Date.now() - startTime });

      if (classification.action === "auto_heal") {
        log(`Auto-healing: T-${ticketNumber} -- ${classification.reason}`);
        const healResult = await executeAutoHeal(
          { error: errorObj, ticketId: String(ticketNumber), exitCode: 1, timedOut: false, branch: branchName, projectDir },
          classification,
          boardApiAdapter(projectConfig),
        );
        if (healResult.healed) log(`Auto-heal complete: ${healResult.summary}`);
      }
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
      Sentry.captureException(err);
      await patchTicket(ticketNumber, {
        summary: `Ship error: ${reason}`,
      });
    }
  })();
}

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

/** Authenticate request via X-Pipeline-Key header. Returns true if valid. */
function requirePipelineKey(req: IncomingMessage, res: ServerResponse): boolean {
  const apiKey = req.headers["x-pipeline-key"] as string | undefined;
  if (!apiKey || apiKey !== PIPELINE_SERVER_KEY) {
    sendJson(res, 401, { status: "unauthorized", message: "Invalid or missing X-Pipeline-Key" });
    return false;
  }
  return true;
}

/** Parse JSON body with size limit. Returns null and sends error response on failure. */
async function parseJsonBody(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readBody(req);
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof Error && err.message === "Request body too large") {
      sendJson(res, 413, { status: "payload_too_large", message: "Request body too large" });
    } else {
      sendJson(res, 400, { status: "bad_request", message: "Invalid JSON body" });
    }
    return null;
  }
}

/** Extract and validate ticket_number from parsed body. Returns null and sends error on failure. */
function requireTicketNumber(body: Record<string, unknown>, res: ServerResponse, errorDetail?: string): number | null {
  const ticketNumber = body.ticket_number;
  if (typeof ticketNumber !== "number" || !Number.isInteger(ticketNumber) || ticketNumber <= 0) {
    sendJson(res, 400, {
      status: "bad_request",
      message: errorDetail ?? "Missing or invalid field: ticket_number (must be a positive integer)",
    });
    return null;
  }
  return ticketNumber;
}

// ---------------------------------------------------------------------------
// Route handlers — each receives (req, res) and handles one endpoint
// ---------------------------------------------------------------------------

async function handleHealthRoute(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const lastCompleted = runHistory.filter(r => r.status === "completed").at(-1) ?? null;
  const lastError = runHistory.filter(r => r.status === "failed").at(-1) ?? null;

  sendJson(res, 200, {
    status: drainManager.getState() === "drained" ? "draining" : "ok",
    mode: isMultiProjectMode ? "multi-project" : "single",
    running: pipelineState.running
      ? {
          ticket_number: pipelineState.running.ticketNumber,
          project: pipelineState.running.projectSlug,
          started_at: pipelineState.running.startedAt.toISOString(),
          elapsed_seconds: Math.round((Date.now() - pipelineState.running.startedAt.getTime()) / 1000),
        }
      : null,
    last_completed: lastCompleted,
    last_error: lastError,
    recent_runs: runHistory.slice(-5),
    uptime_seconds: Math.round((Date.now() - serverStartedAt) / 1000),
    drain: drainManager.getStatus(),
  });
}

async function handleStatusRoute(_req: IncomingMessage, res: ServerResponse, ticketNum: number): Promise<void> {
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
}

async function handleLaunchRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  const body = await parseJsonBody(req, res);
  if (!body) return;

  const ticketNumber = requireTicketNumber(body, res);
  if (ticketNumber === null) return;

  const projectId = body.project_id as string | undefined;
  await handleLaunch(ticketNumber, res, projectId, body);
}

async function handleEventsRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  const body = await parseJsonBody(req, res);
  if (!body) return;

  const eventType = body.event_type as string | undefined;

  // Only handle "launch" events
  if (eventType !== "launch") {
    sendJson(res, 200, { status: "ignored", event_type: eventType ?? "unknown" });
    return;
  }

  const ticketNumber = requireTicketNumber(body, res);
  if (ticketNumber === null) return;

  const projectId = body.project_id as string | undefined;
  await handleLaunch(ticketNumber, res, projectId, body);
}

async function handleAnswerRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  const body = await parseJsonBody(req, res);
  if (!body) return;

  const ticketNumber = requireTicketNumber(body, res, "Missing or invalid field: ticket_number");
  if (ticketNumber === null) return;

  const answer = body.answer;
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

  const branchName = toBranchName(answerProjectConfig.conventions.branch_prefix, ticketNumber, title);

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

      const result = await withWatchdog(
        resumePipeline({
          projectDir: answerProjectDir,
          workDir,
          branchName,
          ticket: { ticketId: String(ticketNumber), title, description: ticketBody, labels: tags },
          sessionId,
          answer: answer.trim(),
          env: Object.keys(answerProjectEnv).length > 0 ? answerProjectEnv : undefined,
        }),
        `T-${ticketNumber} resumePipeline`,
      );

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
        const classification = classifyError({
          error: new Error(reason),
          ticketId: String(ticketNumber),
          exitCode: result.exitCode,
          timedOut: false,
          branch: branchName,
          projectDir: answerProjectDir,
        });
        log(`Pipeline failed: T-${ticketNumber} (${reason}) [${classification.action}]`);
        await patchTicket(ticketNumber, { pipeline_status: "failed", status: "ready_to_develop", summary: `Pipeline error: ${reason}`, session_id: null });

        if (classification.action === "auto_heal") {
          log(`Auto-healing: T-${ticketNumber} -- ${classification.reason}`);
          const healResult = await executeAutoHeal(
            { error: new Error(reason), ticketId: String(ticketNumber), exitCode: result.exitCode, timedOut: false, branch: branchName, projectDir: answerProjectDir },
            classification,
            boardApiAdapter(answerProjectConfig),
          );
          if (healResult.healed) log(`Auto-heal complete: ${healResult.summary}`);
        }
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      const classification = classifyError({
        error: errorObj,
        ticketId: String(ticketNumber),
        exitCode: 1,
        timedOut: false,
        branch: branchName,
        projectDir: answerProjectDir,
      });

      const reason = errorObj.message;
      log(`Pipeline resume crashed: T-${ticketNumber} -- ${reason} [${classification.action}]`);
      await patchTicket(ticketNumber, { pipeline_status: "failed", status: "ready_to_develop", summary: `Resume error: ${reason}`, session_id: null });

      if (classification.action === "auto_heal") {
        log(`Auto-healing: T-${ticketNumber} -- ${classification.reason}`);
        const healResult = await executeAutoHeal(
          { error: errorObj, ticketId: String(ticketNumber), exitCode: 1, timedOut: false, branch: branchName, projectDir: answerProjectDir },
          classification,
          boardApiAdapter(answerProjectConfig),
        );
        if (healResult.healed) log(`Auto-heal complete: ${healResult.summary}`);
      }
    } finally {
      if (!isMultiProjectMode && slotId !== undefined) await worktreeManager!.release(slotId);
      runningTickets.delete(ticketNumber);
    }
  })();
}

async function handleShipRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  const body = await parseJsonBody(req, res);
  if (!body) return;

  const ticketNumber = requireTicketNumber(body, res, "Missing or invalid field: ticket_number");
  if (ticketNumber === null) return;

  const projectId = body.project_id as string | undefined;
  await handleShip(ticketNumber, res, projectId);
}

async function handleUpdateRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const updateSecret = serverConfig?.server.update_secret;
  const headerSecret = req.headers["x-update-secret"] as string | undefined;
  if (!updateSecret || !headerSecret || headerSecret !== updateSecret) {
    sendJson(res, 401, { status: "unauthorized", message: "Invalid or missing X-Update-Secret" });
    return;
  }

  const body = await parseJsonBody(req, res);
  if (!body) return;

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
}

async function handleDrainRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

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
}

async function handleForceDrainRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  log("Force-drain requested");
  await drainManager.forceDrain();
  sendJson(res, 200, { status: "ok", message: "Force-drain completed", drain: drainManager.getStatus() });
}

async function handleUndrainRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  drainManager.reset();
  runningTickets.clear();
  pipelineState.running = null;
  log("Undrain: server reset to normal, all in-memory state cleared");
  sendJson(res, 200, { status: "ok", message: "Server reset to normal", drain: drainManager.getStatus() });
}

// ---------------------------------------------------------------------------
// Request router — CORS + method/path dispatch to route handlers
// ---------------------------------------------------------------------------

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  // CORS for Board dashboard access — scoped to Board domain
  const boardOrigin = serverConfig?.workspace?.board_url ?? process.env.BOARD_URL ?? "https://board.just-ship.io";
  const requestOrigin = req.headers.origin;
  const allowedOrigin = requestOrigin === boardOrigin ? boardOrigin : "";

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Pipeline-Key",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }
  if (allowedOrigin) res.setHeader("Access-Control-Allow-Origin", allowedOrigin);

  // --- GET routes ---
  if (method === "GET") {
    if (url === "/health") return handleHealthRoute(req, res);

    const statusMatch = url.match(/^\/api\/status\/(\d+)$/);
    if (statusMatch) return handleStatusRoute(req, res, Number(statusMatch[1]));
  }

  // --- POST routes ---
  if (method === "POST") {
    switch (url) {
      case "/api/launch":      return handleLaunchRoute(req, res);
      case "/api/events":      return handleEventsRoute(req, res);
      case "/api/answer":      return handleAnswerRoute(req, res);
      case "/api/ship":        return handleShipRoute(req, res);
      case "/api/update":      return handleUpdateRoute(req, res);
      case "/api/drain":       return handleDrainRoute(req, res);
      case "/api/force-drain": return handleForceDrainRoute(req, res);
      case "/api/undrain":     return handleUndrainRoute(req, res);
    }
  }

  // Fallback: 404
  sendJson(res, 404, { status: "not_found", message: `${method} ${url} not found` });
}

// --- Create server ---
const server = createServer((req, res) => {
  handleRequest(req, res).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : "Unknown error";
    log(`Unhandled error: ${reason}`);
    Sentry.captureException(error);
    if (!res.headersSent) {
      sendJson(res, 500, { status: "error", message: "Internal server error" });
    }
  });
});

// --- Graceful shutdown ---
process.on("SIGINT", () => {
  log("SIGINT received, shutting down...");
  Sentry.close(2000).finally(() => server.close(() => process.exit(0)));
});
process.on("SIGTERM", () => {
  log("SIGTERM received, shutting down...");
  Sentry.close(2000).finally(() => server.close(() => process.exit(0)));
});

process.on("unhandledRejection", (reason) => {
  log(`Unhandled rejection: ${reason}`);
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
});

process.on("uncaughtException", (err) => {
  log(`Uncaught exception: ${err.message}`);
  Sentry.captureException(err);
  // Give Sentry time to flush, then exit
  setTimeout(() => process.exit(1), 2000);
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
