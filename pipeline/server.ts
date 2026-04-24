import { initSentry, Sentry } from "./lib/sentry.ts";
initSentry();
import { logger } from "./lib/logger.ts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { loadProjectConfig, type ProjectConfig } from "./lib/config.ts";
import { sanitizeBranchName } from "./lib/sanitize.ts";
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
import { loadGitHubAppConfig, resolveGitHubToken, type GitHubAppConfig } from "./lib/github-app.ts";
import type { PipelineCheckpoint } from "./lib/checkpoint.ts";
import { decideResume } from "./lib/resume.ts";
import { toBranchName, log } from "./lib/utils.ts";
import { RateLimiter } from "./lib/rate-limiter.ts";
import {
  validateCreateRequest,
  validateUpdateRequest,
  validateCreateProjectRequest,
  createFromClassification,
  updateFromCorrection,
  createProjectFromIdea,
  ValidationError as SidekickValidationError,
  BoardApiError as SidekickBoardApiError,
} from "./lib/sidekick-create.ts";
import {
  validateConverseRequest,
  processTurn as processConverseTurn,
  SessionBusyError as SidekickSessionBusyError,
} from "./lib/sidekick-converse.ts";
import {
  validateChatRequest,
  processChat,
  ChatValidationError,
  ChatThreadBusyError,
  type ChatEvent,
  type ChatSink,
} from "./lib/sidekick-chat.ts";
import {
  validateCreateConversationRequest,
  createConversation,
  listConversationMessages,
  ConversationValidationError,
  ConversationNotFoundError,
} from "./lib/sidekick-conversations-store.ts";
import {
  validateCreateThreadRequest,
  validateUpdateThreadRequest,
  createThread,
  getThread,
  updateThread,
  listThreadMessages,
  listThreads,
  THREAD_STATUSES,
  ThreadValidationError,
  ThreadNotFoundError,
  ThreadTransitionError,
  type ThreadStatus,
} from "./lib/threads-store.ts";
import {
  handleAttach,
  AttachValidationError,
  AttachUploadError,
} from "./lib/sidekick-attach.ts";

// --- Mode detection ---
const SERVER_CONFIG_PATH = process.env.SERVER_CONFIG_PATH;
const isMultiProjectMode = !!SERVER_CONFIG_PATH;

let serverConfig: ServerConfig | null = null;
let PROJECT_DIR: string;
let PIPELINE_SERVER_KEY: string;
let config: ProjectConfig;
let worktreeManager: WorktreeManager | null = null;

// Per-project WorktreeManagers for multi-project mode (keyed by project slug)
const projectWorktreeManagers = new Map<string, WorktreeManager>();

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

  // Initialize WorktreeManagers and validate project configs at startup
  for (const [slug, project] of Object.entries(serverConfig.projects)) {
    const projectCfg = loadProjectConfig(project.project_dir);
    projectWorktreeManagers.set(slug, new WorktreeManager(project.project_dir, projectCfg.maxWorkers));

    // Validate config completeness
    const issues: string[] = [];
    if (!projectCfg.pipeline.projectId) issues.push("missing pipeline.project_id");
    if (!projectCfg.pipeline.workspaceId) issues.push("missing pipeline.workspace_id");
    if (projectCfg.qa.previewProvider === "none") issues.push("no hosting provider configured");

    if (issues.length > 0) {
      logger.warn({ slug, issues }, `Project '${slug}' has config issues: ${issues.join(", ")}`);
    } else {
      logger.info({ slug, hosting: projectCfg.qa.previewProvider, maxWorkers: projectCfg.maxWorkers }, `Project '${slug}' config OK`);
    }
  }
} else {
  const required = ["ANTHROPIC_API_KEY", "PROJECT_DIR", "PIPELINE_SERVER_KEY"] as const;
  for (const key of required) {
    if (!process.env[key]) {
      logger.error(`ERROR: ${key} must be set`);
      process.exit(1);
    }
  }
  if (!process.env.GH_TOKEN && !process.env.GITHUB_APP_ID) {
    logger.error("ERROR: Either GH_TOKEN or GITHUB_APP_ID must be set");
    process.exit(1);
  }
  PROJECT_DIR = process.env.PROJECT_DIR!;
  PIPELINE_SERVER_KEY = process.env.PIPELINE_SERVER_KEY!;
  config = loadProjectConfig(PROJECT_DIR);
  worktreeManager = new WorktreeManager(PROJECT_DIR, config.maxWorkers);
}

// --- GitHub App config (optional — falls back to GH_TOKEN PAT) ---
let githubAppConfig: GitHubAppConfig | null = null;
if (isMultiProjectMode && serverConfig?.workspace.github_app) {
  const ga = serverConfig.workspace.github_app;
  try {
    const privateKey = readFileSync(ga.private_key_path, "utf-8");
    githubAppConfig = { appId: ga.app_id, privateKey };
    logger.info({ appId: ga.app_id }, "GitHub App config loaded");
  } catch (err) {
    logger.error(
      { path: ga.private_key_path, err: err instanceof Error ? err.message : String(err) },
      "Failed to load GitHub App private key",
    );
  }
} else {
  githubAppConfig = loadGitHubAppConfig();
}

const PORT = Number(process.env.PORT ?? serverConfig?.server.port ?? "3001");

// log() imported from ./lib/utils.ts

// --- In-memory running set (idempotency guard) ---
const runningTickets = new Set<number>();

// Per-ticket metadata for observability (replaces single pipelineState lock)
interface RunningTicketInfo {
  ticketNumber: number;
  projectSlug: string;
  startedAt: Date;
}
const runningTicketInfo = new Map<number, RunningTicketInfo>();

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

// --- Rate limiting ---
const rateLimiters = {
  launch: new RateLimiter({ windowMs: 60_000, maxRequests: 10 }),
  events: new RateLimiter({ windowMs: 60_000, maxRequests: 100 }),
  ship: new RateLimiter({ windowMs: 60_000, maxRequests: 10 }),
  answer: new RateLimiter({ windowMs: 60_000, maxRequests: 30 }),
  sidekickCreate: new RateLimiter({ windowMs: 60_000, maxRequests: 30 }),
  sidekickUpdate: new RateLimiter({ windowMs: 60_000, maxRequests: 30 }),
  // Lower cap for project creation — larger structural impact than a ticket,
  // and the Sidekick only legitimately calls this once per idea.
  sidekickCreateProject: new RateLimiter({ windowMs: 60_000, maxRequests: 5 }),
  // Converse is per-project. Each session uses 1-3 calls; 30/min/project keeps
  // per-user throughput healthy while blocking abusive callers.
  sidekickConverse: new RateLimiter({ windowMs: 60_000, maxRequests: 30 }),
  // Chat is per-(project, user) (full conversation mode — T-922). 60/min
  // covers bursty usage (multiple quick follow-ups) while still blocking
  // abuse. Key shape: `chat:<project_id>:<user_id|anon>` — scoping always
  // includes project_id so user_id rotation or omission cannot bypass it.
  sidekickChat: new RateLimiter({ windowMs: 60_000, maxRequests: 60 }),
  // Conversation + thread store routes (T-924). Keyed by project_id or resource id.
  sidekickConversationCreate: new RateLimiter({ windowMs: 60_000, maxRequests: 10 }),
  sidekickConversationList: new RateLimiter({ windowMs: 60_000, maxRequests: 60 }),
  sidekickThreadCreate: new RateLimiter({ windowMs: 60_000, maxRequests: 10 }),
  sidekickThreadGet: new RateLimiter({ windowMs: 60_000, maxRequests: 60 }),
  sidekickThreadUpdate: new RateLimiter({ windowMs: 60_000, maxRequests: 30 }),
  sidekickThreadList: new RateLimiter({ windowMs: 60_000, maxRequests: 60 }),
  // Image upload proxy (T-925). Lower than chat because each request is
  // up to 25 MB and the bucket is shared across the workspace.
  sidekickAttach: new RateLimiter({ windowMs: 60_000, maxRequests: 20 }),
};

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

async function patchTicket(ticketNumber: number, body: Record<string, unknown>, maxRetries = 3): Promise<boolean> {
  const { apiUrl, apiKey } = getApiCredentials();
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
      if (res.ok) return true;
      log(`patchTicket T-${ticketNumber} attempt ${attempt}/${maxRetries} failed: HTTP ${res.status} ${res.statusText}`);
      if (res.status >= 400 && res.status < 500) return false; // Client error — don't retry
    } catch (err) {
      log(`patchTicket T-${ticketNumber} attempt ${attempt}/${maxRetries} error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 1000 * attempt)); // Backoff: 1s, 2s
    }
  }
  log(`patchTicket T-${ticketNumber} failed after ${maxRetries} attempts`);
  return false;
}

/**
 * Send a SaaS callback with retry logic (3 attempts, exponential backoff).
 * The callback is the most critical network call — without it, the board
 * never learns the pipeline finished, causing permanent stuck state.
 */
async function sendCallbackWithRetry(
  callbackUrl: string,
  runToken: string,
  payload: Record<string, unknown>,
  maxRetries = 3,
): Promise<boolean> {
  const body = JSON.stringify(payload);
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Run-Token": runToken,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return true;
      log(`[SaaS] Callback attempt ${attempt}/${maxRetries} failed: HTTP ${res.status}`);
      if (res.status >= 400 && res.status < 500) return false; // Client error — don't retry
    } catch (err) {
      log(`[SaaS] Callback attempt ${attempt}/${maxRetries} error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 1000 * attempt)); // Backoff: 1s, 2s
    }
  }
  log(`[SaaS] Callback failed after ${maxRetries} attempts`);
  Sentry.captureMessage(`SaaS callback failed after ${maxRetries} attempts`, { level: "error", extra: { callbackUrl, payload } });
  return false;
}

// --- HTTP helpers ---
function sendJson(res: ServerResponse, status: number, data: Record<string, unknown>) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Apply a rate limiter for the given key. Returns true if the request is
 * allowed, false if blocked (response already sent with 429).
 */
function applyRateLimit(
  limiter: RateLimiter,
  key: string,
  route: string,
  res: ServerResponse,
): boolean {
  const result = limiter.check(key);
  if (!result.allowed) {
    log(`Rate limit exceeded: ${key} on ${route}`);
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": String(result.retryAfterSec),
    });
    res.end(JSON.stringify({
      error: "rate_limit_exceeded",
      retry_after: result.retryAfterSec,
      remaining: 0,
    }));
    return false;
  }
  return true;
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
    const installationId = launchBody!.installation_id as number | undefined;
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
        // 1. Clone repo — resolve token via GitHub App chain (installation > explicit > env)
        const repoUrlWithoutProtocol = repoUrl.replace(/^https?:\/\//, "");
        let effectiveToken = githubToken;
        if (!effectiveToken && installationId && githubAppConfig) {
          try {
            effectiveToken = await resolveGitHubToken({ installationId, appConfig: githubAppConfig }) ?? undefined;
          } catch (err) {
            log(`[SaaS] Failed to generate installation token: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        const cloneUrl = effectiveToken
          ? `https://x-access-token:${effectiveToken}@${repoUrlWithoutProtocol}`
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
            env: effectiveToken ? { GH_TOKEN: effectiveToken } : undefined,
          }),
          `T-${ticketNumber} SaaS executePipeline`,
        );

        log(`[SaaS] Pipeline finished: T-${ticketNumber} -> ${result.status}`);

        // 6. Send callback (with retry — most critical network call)
        await sendCallbackWithRetry(callbackUrl, runToken, {
          run_id: runId,
          status: result.status === "completed" ? "completed" : "failed",
          pr_url: result.prUrl ?? (result.branch ? `check PR from branch ${result.branch}` : undefined),
          tokens_used: {
            input: result.tokens?.input ?? 0,
            output: result.tokens?.output ?? 0,
          },
          duration_seconds: Math.floor((Date.now() - startTime) / 1000),
          error_message: result.failureReason,
        });

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

        // Crash callback (with retry — critical to avoid stuck runs)
        await sendCallbackWithRetry(callbackUrl, runToken, {
          run_id: runId,
          status: "failed",
          tokens_used: { input: 0, output: 0 },
          duration_seconds: Math.floor((Date.now() - startTime) / 1000),
          error_message: reason,
        });

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

  // 1b. Resolve project in multi-project mode
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

    // Resolve GitHub token (installation token > project env > server env)
    const projectInstallationId = match.project.installation_id ?? serverConfig?.workspace.github_app?.installation_id;
    if (projectInstallationId && githubAppConfig) {
      try {
        const token = await resolveGitHubToken({ installationId: projectInstallationId, appConfig: githubAppConfig });
        if (token) projectEnv.GH_TOKEN = token;
      } catch (err) {
        log(`GitHub App token generation failed for project ${projectSlug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
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

  // --- Resume decision ---
  const resumeDecision = decideResume(checkpoint);
  if (resumeDecision.action === "resume") {
    log(`T-${ticketNumber}: resuming from phase '${resumeDecision.resumeFrom}' (attempt ${resumeDecision.attempt})`);
    if (resumeDecision.skipAgents?.length) {
      log(`T-${ticketNumber}: skipping completed agents: ${resumeDecision.skipAgents.join(", ")}`);
    }
  } else if (checkpoint) {
    log(`T-${ticketNumber}: checkpoint exists but restarting — ${resumeDecision.reason}`);
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

  let branchName: string;
  try {
    branchName = toBranchName(projectConfig.conventions.branch_prefix, ticketNumber, title);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ reason, ticketNumber }, "Invalid branch name in launch handler");
    runningTickets.delete(ticketNumber);
    if (isMultiProjectMode) runningTicketInfo.delete(ticketNumber);
    void patchTicket(ticketNumber, { pipeline_status: "failed", status: "ready_to_develop", summary: `Pipeline error: ${reason}` });
    return;
  }

  // Track running ticket metadata for observability
  if (isMultiProjectMode) {
    runningTicketInfo.set(ticketNumber, {
      ticketNumber,
      projectSlug,
      startedAt: new Date(),
    });
  }

  (async () => {
    const startTime = Date.now();
    let slotId: number | undefined;
    // Resolve the correct WorktreeManager (per-project in multi-project mode, global otherwise)
    const activeWtManager = isMultiProjectMode
      ? projectWorktreeManagers.get(projectSlug) ?? null
      : worktreeManager;
    try {
      let workDir: string | undefined;

      // Checkpoint-based worktree recovery (works in both modes now)
      let worktreeResult;
      if (checkpoint?.branch_name && activeWtManager) {
        try {
          worktreeResult = await activeWtManager.reattach(checkpoint.branch_name);
          log(`Reattached worktree for checkpoint branch ${checkpoint.branch_name}`);
        } catch {
          log(`Could not reattach checkpoint worktree, allocating new`);
          worktreeResult = await activeWtManager.allocate(branchName);
        }
      } else if (activeWtManager) {
        worktreeResult = await activeWtManager.allocate(branchName);
      }
      if (worktreeResult) {
        slotId = worktreeResult.slotId;
        workDir = worktreeResult.workDir;
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
        log(`Pipeline completed: T-${ticketNumber} -> ${result.branch}${result.prUrl ? ` (PR: ${result.prUrl})` : ""}`);
        await patchTicket(ticketNumber, {
          pipeline_status: "done",
          status: "in_review",
          branch: result.branch,
          ...(result.prUrl ? { review_url: result.prUrl } : {}),
          ...(result.tokens ? {
            total_tokens: result.tokens.input + result.tokens.output,
            estimated_cost: result.tokens.estimatedCostUsd,
          } : {}),
        });
        recordRun({ ticketNumber, status: "completed", at: new Date().toISOString(), durationMs: Date.now() - startTime });
      } else if (result.status === "paused") {
        log(`Pipeline paused: T-${ticketNumber}`);
        await patchTicket(ticketNumber, { pipeline_status: "paused", session_id: result.sessionId });
        if (slotId !== undefined && activeWtManager) {
          await activeWtManager.park(slotId);
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
      if (slotId !== undefined && activeWtManager) await activeWtManager.release(slotId);
      if (isMultiProjectMode) runningTicketInfo.delete(ticketNumber);
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

  // 3. Get branch and validate
  const branch = ticket.branch as string | null;
  if (!branch) {
    sendJson(res, 400, {
      status: "bad_request",
      ticket_number: ticketNumber,
      message: "Ticket has no branch set",
    });
    return;
  }

  // SECURITY: Validate branch name to prevent command injection via execSync
  try {
    sanitizeBranchName(branch);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : "Invalid branch name";
    sendJson(res, 400, {
      status: "bad_request",
      ticket_number: ticketNumber,
      message: `Invalid branch name: ${reason}`,
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
          pipeline_status: "failed",
          status: "ready_to_develop",
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
        pipeline_status: "failed",
        status: "ready_to_develop",
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

/** Check if request has a valid Pipeline-Key without sending an error response. */
function hasPipelineKey(req: IncomingMessage): boolean {
  const apiKey = req.headers["x-pipeline-key"] as string | undefined;
  return !!apiKey && apiKey === PIPELINE_SERVER_KEY;
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

async function handleHealthRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Unauthenticated: minimal response for monitoring (UptimeRobot keyword: "ok")
  if (!hasPipelineKey(req)) {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  // Authenticated: full details
  const lastCompleted = runHistory.filter(r => r.status === "completed").at(-1) ?? null;
  const lastError = runHistory.filter(r => r.status === "failed").at(-1) ?? null;

  // Build running tickets list from metadata map (multi-project) or runningTickets set (single)
  const runningList: Array<{
    ticket_number: number;
    project?: string;
    started_at?: string;
    elapsed_seconds?: number;
  }> = [];
  if (isMultiProjectMode) {
    for (const info of runningTicketInfo.values()) {
      runningList.push({
        ticket_number: info.ticketNumber,
        project: info.projectSlug,
        started_at: info.startedAt.toISOString(),
        elapsed_seconds: Math.round((Date.now() - info.startedAt.getTime()) / 1000),
      });
    }
  } else {
    for (const ticketNum of runningTickets) {
      runningList.push({ ticket_number: ticketNum });
    }
  }

  sendJson(res, 200, {
    status: drainManager.getState() === "drained" ? "draining" : "ok",
    mode: isMultiProjectMode ? "multi-project" : "single",
    running: runningList.length > 0 ? runningList : null,
    running_count: runningList.length,
    last_completed: lastCompleted,
    last_error: lastError,
    recent_runs: runHistory.slice(-5),
    uptime_seconds: Math.round((Date.now() - serverStartedAt) / 1000),
    drain: drainManager.getStatus(),
  });
}

async function handleStatusRoute(_req: IncomingMessage, res: ServerResponse, ticketNum: number): Promise<void> {
  const info = runningTicketInfo.get(ticketNum);
  if (info) {
    sendJson(res, 200, {
      ticket_number: ticketNum,
      status: "running",
      project: info.projectSlug,
      started_at: info.startedAt.toISOString(),
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

  const projectId = body.project_id as string | undefined;
  if (!applyRateLimit(rateLimiters.launch, projectId ?? "unknown", "/api/launch", res)) return;

  const ticketNumber = requireTicketNumber(body, res);
  if (ticketNumber === null) return;

  await handleLaunch(ticketNumber, res, projectId, body);
}

async function handleEventsRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  const body = await parseJsonBody(req, res);
  if (!body) return;

  const projectIdForRL = body.project_id as string | undefined;
  if (!applyRateLimit(rateLimiters.events, projectIdForRL ?? "unknown", "/api/events", res)) return;

  const eventType = body.event_type as string | undefined;

  // Only handle "launch" events
  if (eventType !== "launch") {
    sendJson(res, 200, { status: "ignored", event_type: eventType ?? "unknown" });
    return;
  }

  const ticketNumber = requireTicketNumber(body, res);
  if (ticketNumber === null) return;

  await handleLaunch(ticketNumber, res, projectIdForRL, body);
}

async function handleAnswerRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  const body = await parseJsonBody(req, res);
  if (!body) return;

  const ticketNum = body.ticket_number;
  if (!applyRateLimit(rateLimiters.answer, String(ticketNum ?? "unknown"), "/api/answer", res)) return;

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
  let answerProjectSlug = "";

  if (isMultiProjectMode && answerProjectId) {
    const match = findProjectByProjectId(serverConfig!, answerProjectId);
    if (match) {
      answerProjectSlug = match.slug;
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

  let branchName: string;
  try {
    branchName = toBranchName(answerProjectConfig.conventions.branch_prefix, ticketNumber, title);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ reason, ticketNumber }, "Invalid branch name in answer handler");
    runningTickets.delete(ticketNumber);
    void patchTicket(ticketNumber, { pipeline_status: "failed", status: "ready_to_develop", summary: `Pipeline error: ${reason}`, session_id: null });
    return;
  }

  (async () => {
    let slotId: number | undefined;
    const resumeWtManager = isMultiProjectMode
      ? projectWorktreeManagers.get(answerProjectSlug) ?? null
      : worktreeManager;
    try {
      let workDir: string | undefined;

      if (resumeWtManager) {
        const slot = await resumeWtManager.reattach(branchName);
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
        if (slotId !== undefined && resumeWtManager) {
          await resumeWtManager.park(slotId);
          slotId = undefined;
        }
      } else if (result.status === "completed") {
        await patchTicket(ticketNumber, {
          pipeline_status: "done",
          status: "in_review",
          branch: result.branch,
          session_id: null,
          ...(result.prUrl ? { review_url: result.prUrl } : {}),
          ...(result.tokens ? {
            total_tokens: result.tokens.input + result.tokens.output,
            estimated_cost: result.tokens.estimatedCostUsd,
          } : {}),
        });
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
      if (slotId !== undefined && resumeWtManager) await resumeWtManager.release(slotId);
      runningTickets.delete(ticketNumber);
    }
  })();
}

// ---------------------------------------------------------------------------
// Sidekick conversation + thread store routes (T-924)
// ---------------------------------------------------------------------------

// UUID regex used for path validation — matches the same pattern as the stores.
const ROUTE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleConversationCreateRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  const body = await parseJsonBody(req, res);
  if (!body) return;

  const projectIdForRL = (body.project_id as string | undefined) ?? "unknown";
  if (!applyRateLimit(rateLimiters.sidekickConversationCreate, projectIdForRL, "/api/sidekick/conversations", res)) return;

  let validated;
  try {
    validated = validateCreateConversationRequest(body);
  } catch (err) {
    if (err instanceof ConversationValidationError) {
      sendJson(res, 400, { status: "bad_request", message: err.message });
      return;
    }
    throw err;
  }

  try {
    const conversation = await createConversation(validated);
    sendJson(res, 201, { status: "created", conversation });
  } catch (err) {
    log(`Conversation create failed: ${err instanceof Error ? err.message : String(err)}`);
    Sentry.captureException(err);
    sendJson(res, 500, { status: "error", message: "Internal server error" });
  }
}

async function handleConversationMessagesRoute(req: IncomingMessage, res: ServerResponse, conversationId: string, rawUrl: string): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  if (!ROUTE_UUID_RE.test(conversationId)) {
    sendJson(res, 400, { status: "bad_request", message: "conversation id must be a valid UUID" });
    return;
  }

  // Parse query params from the raw URL
  const qIdx = rawUrl.indexOf("?");
  const searchParams = new URLSearchParams(qIdx >= 0 ? rawUrl.slice(qIdx + 1) : "");
  const limitRaw = searchParams.get("limit");
  const offsetRaw = searchParams.get("offset");
  const limit = limitRaw !== null ? Math.min(200, Math.max(1, parseInt(limitRaw, 10) || 50)) : 50;
  const offset = offsetRaw !== null ? Math.max(0, parseInt(offsetRaw, 10) || 0) : 0;

  if (!applyRateLimit(rateLimiters.sidekickConversationList, conversationId, `/api/sidekick/conversations/${conversationId}/messages`, res)) return;

  try {
    const result = await listConversationMessages(conversationId, { limit, offset });
    sendJson(res, 200, { status: "ok", messages: result.messages, has_more: result.has_more, limit, offset });
  } catch (err) {
    if (err instanceof ConversationNotFoundError) {
      sendJson(res, 404, { status: "not_found", message: err.message });
      return;
    }
    log(`Conversation messages list failed: ${err instanceof Error ? err.message : String(err)}`);
    Sentry.captureException(err);
    sendJson(res, 500, { status: "error", message: "Internal server error" });
  }
}

async function handleThreadCreateRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  const body = await parseJsonBody(req, res);
  if (!body) return;

  const projectIdForRL = (body.project_id as string | undefined) ?? "unknown";
  if (!applyRateLimit(rateLimiters.sidekickThreadCreate, projectIdForRL, "/api/sidekick/threads", res)) return;

  let validated;
  try {
    validated = validateCreateThreadRequest(body);
  } catch (err) {
    if (err instanceof ThreadValidationError) {
      sendJson(res, 400, { status: "bad_request", message: err.message });
      return;
    }
    throw err;
  }

  try {
    const thread = await createThread(validated);
    sendJson(res, 201, { status: "created", thread });
  } catch (err) {
    log(`Thread create failed: ${err instanceof Error ? err.message : String(err)}`);
    Sentry.captureException(err);
    sendJson(res, 500, { status: "error", message: "Internal server error" });
  }
}

async function handleThreadListRoute(req: IncomingMessage, res: ServerResponse, rawUrl: string): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  const qIdx = rawUrl.indexOf("?");
  const searchParams = new URLSearchParams(qIdx >= 0 ? rawUrl.slice(qIdx + 1) : "");

  const projectId = searchParams.get("project_id") ?? undefined;
  const userId = searchParams.get("user_id") ?? undefined;
  const workspaceId = searchParams.get("workspace_id") ?? undefined;
  const statusRaw = searchParams.getAll("status");

  if (!projectId && !userId && !workspaceId) {
    sendJson(res, 400, {
      status: "bad_request",
      message: "at least one of project_id, user_id, workspace_id is required",
    });
    return;
  }

  // Validate status values against the known enum before hitting the DB.
  // Accepts repeated query param (`?status=draft&status=in_progress`) or a
  // single comma-separated value (`?status=draft,in_progress`).
  const statusExpanded = statusRaw.flatMap((s) => s.split(",").map((v) => v.trim()).filter(Boolean));
  for (const s of statusExpanded) {
    if (!(THREAD_STATUSES as readonly string[]).includes(s)) {
      sendJson(res, 400, {
        status: "bad_request",
        message: `status: must be one of ${THREAD_STATUSES.join(", ")}`,
      });
      return;
    }
  }

  const limitRaw = searchParams.get("limit");
  const offsetRaw = searchParams.get("offset");
  const limit = limitRaw !== null ? Math.min(200, Math.max(1, parseInt(limitRaw, 10) || 50)) : 50;
  const offset = offsetRaw !== null ? Math.max(0, parseInt(offsetRaw, 10) || 0) : 0;

  // Key rate limiting by the most-specific filter present so a chatty user
  // against one project cannot drown out another project's listing traffic.
  const rlKey = projectId ?? userId ?? workspaceId ?? "unknown";
  if (!applyRateLimit(rateLimiters.sidekickThreadList, rlKey, "/api/sidekick/threads", res)) return;

  try {
    const result = await listThreads({
      ...(projectId ? { project_id: projectId } : {}),
      ...(userId ? { user_id: userId } : {}),
      ...(workspaceId ? { workspace_id: workspaceId } : {}),
      ...(statusExpanded.length > 0 ? { status: statusExpanded as ThreadStatus[] } : {}),
      limit,
      offset,
    });
    sendJson(res, 200, {
      status: "ok",
      threads: result.threads,
      has_more: result.has_more,
      limit,
      offset,
    });
  } catch (err) {
    if (err instanceof ThreadValidationError) {
      sendJson(res, 400, { status: "bad_request", message: err.message });
      return;
    }
    log(`Thread list failed: ${err instanceof Error ? err.message : String(err)}`);
    Sentry.captureException(err);
    sendJson(res, 500, { status: "error", message: "Internal server error" });
  }
}

async function handleThreadGetRoute(req: IncomingMessage, res: ServerResponse, threadId: string): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  if (!ROUTE_UUID_RE.test(threadId)) {
    sendJson(res, 400, { status: "bad_request", message: "thread id must be a valid UUID" });
    return;
  }

  if (!applyRateLimit(rateLimiters.sidekickThreadGet, threadId, `/api/sidekick/threads/${threadId}`, res)) return;

  try {
    const thread = await getThread(threadId);
    sendJson(res, 200, { status: "ok", thread });
  } catch (err) {
    if (err instanceof ThreadNotFoundError) {
      sendJson(res, 404, { status: "not_found", message: err.message });
      return;
    }
    log(`Thread get failed: ${err instanceof Error ? err.message : String(err)}`);
    Sentry.captureException(err);
    sendJson(res, 500, { status: "error", message: "Internal server error" });
  }
}

async function handleThreadUpdateRoute(req: IncomingMessage, res: ServerResponse, threadId: string): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  if (!ROUTE_UUID_RE.test(threadId)) {
    sendJson(res, 400, { status: "bad_request", message: "thread id must be a valid UUID" });
    return;
  }

  if (!applyRateLimit(rateLimiters.sidekickThreadUpdate, threadId, `/api/sidekick/threads/${threadId}`, res)) return;

  const body = await parseJsonBody(req, res);
  if (!body) return;

  let validated;
  try {
    validated = validateUpdateThreadRequest(body);
  } catch (err) {
    if (err instanceof ThreadValidationError) {
      sendJson(res, 400, { status: "bad_request", message: err.message });
      return;
    }
    throw err;
  }

  try {
    const thread = await updateThread(threadId, validated);
    sendJson(res, 200, { status: "ok", thread });
  } catch (err) {
    if (err instanceof ThreadNotFoundError) {
      sendJson(res, 404, { status: "not_found", message: err.message });
      return;
    }
    if (err instanceof ThreadTransitionError) {
      sendJson(res, 409, { status: "conflict", from: err.from, to: err.to, message: err.message });
      return;
    }
    log(`Thread update failed: ${err instanceof Error ? err.message : String(err)}`);
    Sentry.captureException(err);
    sendJson(res, 500, { status: "error", message: "Internal server error" });
  }
}

async function handleThreadMessagesRoute(req: IncomingMessage, res: ServerResponse, threadId: string, rawUrl: string): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  if (!ROUTE_UUID_RE.test(threadId)) {
    sendJson(res, 400, { status: "bad_request", message: "thread id must be a valid UUID" });
    return;
  }

  const qIdx = rawUrl.indexOf("?");
  const searchParams = new URLSearchParams(qIdx >= 0 ? rawUrl.slice(qIdx + 1) : "");
  const limitRaw = searchParams.get("limit");
  const offsetRaw = searchParams.get("offset");
  const limit = limitRaw !== null ? Math.min(200, Math.max(1, parseInt(limitRaw, 10) || 50)) : 50;
  const offset = offsetRaw !== null ? Math.max(0, parseInt(offsetRaw, 10) || 0) : 0;

  if (!applyRateLimit(rateLimiters.sidekickThreadList, threadId, `/api/sidekick/threads/${threadId}/messages`, res)) return;

  try {
    const result = await listThreadMessages(threadId, { limit, offset });
    sendJson(res, 200, { status: "ok", messages: result.messages, has_more: result.has_more, limit, offset });
  } catch (err) {
    if (err instanceof ThreadNotFoundError) {
      sendJson(res, 404, { status: "not_found", message: err.message });
      return;
    }
    log(`Thread messages list failed: ${err instanceof Error ? err.message : String(err)}`);
    Sentry.captureException(err);
    sendJson(res, 500, { status: "error", message: "Internal server error" });
  }
}

async function handleSidekickCreateRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  const body = await parseJsonBody(req, res);
  if (!body) return;

  const projectIdForRL = (body.project_id as string | undefined) ?? "unknown";
  if (!applyRateLimit(rateLimiters.sidekickCreate, projectIdForRL, "/api/sidekick/create", res)) return;

  let validated;
  try {
    validated = validateCreateRequest(body);
  } catch (err) {
    if (err instanceof SidekickValidationError) {
      sendJson(res, 400, { status: "bad_request", message: err.message });
      return;
    }
    throw err;
  }

  const { apiUrl, apiKey } = getApiCredentials();
  try {
    const result = await createFromClassification(validated, { apiUrl, apiKey });
    sendJson(res, 201, { status: "created", ...result });
  } catch (err) {
    if (err instanceof SidekickBoardApiError) {
      const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 502;
      log(`Sidekick create failed: ${err.message}`);
      sendJson(res, status, { status: "upstream_error", message: err.message });
      return;
    }
    log(`Sidekick create crashed: ${err instanceof Error ? err.message : String(err)}`);
    Sentry.captureException(err);
    sendJson(res, 500, { status: "error", message: "Internal server error" });
  }
}

async function handleSidekickUpdateRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  const body = await parseJsonBody(req, res);
  if (!body) return;

  const ticketNumForRL = body.ticket_number;
  if (!applyRateLimit(rateLimiters.sidekickUpdate, String(ticketNumForRL ?? "unknown"), "/api/sidekick/update", res)) return;

  let validated;
  try {
    validated = validateUpdateRequest(body);
  } catch (err) {
    if (err instanceof SidekickValidationError) {
      sendJson(res, 400, { status: "bad_request", message: err.message });
      return;
    }
    throw err;
  }

  const { apiUrl, apiKey } = getApiCredentials();
  try {
    const result = await updateFromCorrection(validated, { apiUrl, apiKey });
    sendJson(res, 200, { status: "updated", ...result });
  } catch (err) {
    if (err instanceof SidekickBoardApiError) {
      const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 502;
      log(`Sidekick update failed: ${err.message}`);
      sendJson(res, status, { status: "upstream_error", message: err.message });
      return;
    }
    log(`Sidekick update crashed: ${err instanceof Error ? err.message : String(err)}`);
    Sentry.captureException(err);
    sendJson(res, 500, { status: "error", message: "Internal server error" });
  }
}

async function handleSidekickCreateProjectRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  const body = await parseJsonBody(req, res);
  if (!body) return;

  // Rate limit per workspace — one Sidekick instance per workspace.
  const workspaceIdForRL = (body.workspace_id as string | undefined) ?? "unknown";
  if (!applyRateLimit(rateLimiters.sidekickCreateProject, workspaceIdForRL, "/api/sidekick/create-project", res)) return;

  let validated;
  try {
    validated = validateCreateProjectRequest(body);
  } catch (err) {
    if (err instanceof SidekickValidationError) {
      sendJson(res, 400, { status: "bad_request", message: err.message });
      return;
    }
    throw err;
  }

  const { apiUrl, apiKey } = getApiCredentials();
  try {
    const result = await createProjectFromIdea(validated, { apiUrl, apiKey });
    sendJson(res, 201, { status: "created", ...result });
  } catch (err) {
    if (err instanceof SidekickBoardApiError) {
      const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 502;
      log(`Sidekick create-project failed: ${err.message}`);
      sendJson(res, status, { status: "upstream_error", message: err.message });
      return;
    }
    log(`Sidekick create-project crashed: ${err instanceof Error ? err.message : String(err)}`);
    Sentry.captureException(err);
    sendJson(res, 500, { status: "error", message: "Internal server error" });
  }
}

// T-925: Image upload proxy. Accepts multipart/form-data with 1–5 files
// (JPG/PNG/WebP/GIF, max 5 MB each), uploads each to the Board's
// `ticket-attachments` Supabase bucket, and returns the public URLs in the
// exact shape Board's own `/api/sidekick/upload` route uses — the Board
// widget can switch endpoints without a client-side refactor.
async function handleSidekickAttachRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  // Rate limit per-IP since multipart bodies don't have a project_id in the
  // headers and we want to gate before parsing. We approximate the caller
  // by remote address; in mixed-NAT setups this is coarse but fine for a
  // 20/min ceiling whose purpose is abuse prevention, not quota.
  const rateKey = (req.socket.remoteAddress ?? "unknown") + ":attach";
  if (!applyRateLimit(rateLimiters.sidekickAttach, rateKey, "/api/sidekick/attach", res)) return;

  try {
    const result = await handleAttach(req);
    // Mirror Board's `success()` helper shape: `{ data, error: null }` at
    // HTTP 201. The Board widget reads `response.data.files` — changing
    // this shape would break the AC "response-identical to today's Board
    // upload route".
    sendJson(res, 201, { data: { files: result.files }, error: null });
  } catch (err) {
    if (err instanceof AttachValidationError) {
      sendJson(res, err.status, {
        data: null,
        error: { code: "VALIDATION_ERROR", message: err.message },
      });
      return;
    }
    if (err instanceof AttachUploadError) {
      log(`Sidekick attach upload failed: ${err.message}`);
      Sentry.captureException(err);
      sendJson(res, err.status, {
        data: null,
        error: { code: "UPLOAD_ERROR", message: err.message },
      });
      return;
    }
    log(`Sidekick attach crashed: ${err instanceof Error ? err.message : String(err)}`);
    Sentry.captureException(err);
    sendJson(res, 500, {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  }
}

async function handleSidekickConverseRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  const body = await parseJsonBody(req, res);
  if (!body) return;

  const projectIdForRL = (body.project_id as string | undefined) ?? "unknown";
  if (!applyRateLimit(rateLimiters.sidekickConverse, projectIdForRL, "/api/sidekick/converse", res)) return;

  let validated;
  try {
    validated = validateConverseRequest(body);
  } catch (err) {
    if (err instanceof SidekickValidationError) {
      sendJson(res, 400, { status: "bad_request", message: err.message });
      return;
    }
    throw err;
  }

  const { apiUrl, apiKey } = getApiCredentials();
  try {
    const result = await processConverseTurn(validated, { apiUrl, apiKey });
    const status = result.status === "final" ? 201 : 200;
    sendJson(res, status, result as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof SidekickSessionBusyError) {
      // A second request raced the first one for the same session_id.
      // Tell the caller to retry after the in-flight turn resolves.
      sendJson(res, 409, { status: "session_busy", message: err.message });
      return;
    }
    if (err instanceof SidekickBoardApiError) {
      const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 502;
      log(`Sidekick converse failed: ${err.message}`);
      sendJson(res, status, { status: "upstream_error", message: err.message });
      return;
    }
    log(`Sidekick converse crashed: ${err instanceof Error ? err.message : String(err)}`);
    Sentry.captureException(err);
    sendJson(res, 500, { status: "error", message: "Internal server error" });
  }
}

async function handleShipRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  const body = await parseJsonBody(req, res);
  if (!body) return;

  const projectIdForRL = body.project_id as string | undefined;
  if (!applyRateLimit(rateLimiters.ship, projectIdForRL ?? "unknown", "/api/ship", res)) return;

  const ticketNumber = requireTicketNumber(body, res, "Missing or invalid field: ticket_number");
  if (ticketNumber === null) return;

  await handleShip(ticketNumber, res, projectIdForRL);
}

// ---------------------------------------------------------------------------
// Sidekick Chat (T-922) — SSE endpoint with tool-call loop.
// ---------------------------------------------------------------------------

/**
 * Build an SSE-shaped `ChatSink` around an `http.ServerResponse`.
 *
 * The sink:
 *  - writes SSE headers on first use (idempotent),
 *  - serialises each `ChatEvent` as `event: <type>\ndata: <json>\n\n`,
 *  - tracks the client-connected state so the processor can bail out early,
 *  - fires an AbortSignal to the model call when the socket closes mid-stream.
 */
function createSseChatSink(
  res: ServerResponse,
  abortCtrl: AbortController,
): ChatSink {
  let open = true;
  let headersWritten = false;

  const writeHeaders = () => {
    if (headersWritten) return;
    headersWritten = true;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tell nginx / proxies not to buffer the stream (common pitfall).
      "X-Accel-Buffering": "no",
    });
  };

  // If the client goes away mid-stream we mark closed AND abort upstream.
  // We register once here rather than in the handler so all four failure
  // modes (close, error, aborted, end-without-final) converge on one flag.
  const onClose = () => {
    if (!open) return;
    open = false;
    abortCtrl.abort();
  };
  res.on("close", onClose);
  res.on("error", onClose);

  return {
    send(event: ChatEvent) {
      if (!open) return;
      writeHeaders();
      // SSE frames: "event: <type>" + "data: <payload>" + blank line.
      // Keep payload on a single line — the SSE spec treats every "\n"
      // inside data: as a line break, which would split our JSON.
      const payload = JSON.stringify(event);
      try {
        res.write(`event: ${event.type}\ndata: ${payload}\n\n`);
      } catch (err) {
        // write() throws when the socket is already destroyed — treat as disconnect.
        log(`chat sse write failed: ${err instanceof Error ? err.message : String(err)}`);
        open = false;
        abortCtrl.abort();
      }
    },
    isOpen() {
      return open;
    },
    close() {
      if (!open) return;
      open = false;
      writeHeaders();
      try {
        res.end();
      } catch {
        // Best-effort — socket already torn down.
      }
    },
  };
}

async function handleSidekickChatRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requirePipelineKey(req, res)) return;

  const body = await parseJsonBody(req, res);
  if (!body) return;

  let validated;
  try {
    validated = validateChatRequest(body);
  } catch (err) {
    if (err instanceof ChatValidationError) {
      sendJson(res, 400, { status: "bad_request", message: err.message });
      return;
    }
    throw err;
  }

  // Rate-limit keyed by (project_id, user_id) so the per-user 60/min quota
  // always composes with a per-project quota. A previous version keyed purely
  // on `user_id` (falling back to `project:<id>`), which let a caller dodge
  // the limit by rotating through fabricated user_id values per request, and
  // a different caller in the same project drop their user_id to share a
  // pooled quota with every other anonymous request in that project. Both
  // paths are now closed: anonymous traffic is scoped to the project, and
  // named users can only amplify their own project's budget, not escape it.
  const userKeyPart = validated.user_id ?? "anon";
  const rateKey = `chat:${validated.project_id}:${userKeyPart}`;
  if (!applyRateLimit(rateLimiters.sidekickChat, rateKey, "/api/sidekick/chat", res)) return;

  const abortCtrl = new AbortController();

  // Detect concurrent-turn collisions BEFORE we open the SSE stream. If the
  // same thread_id is already in-flight, responding with an SSE "error" event
  // works but it trains clients to tolerate a 200 for a rejected request;
  // 409 is the standard shape for "the server has a conflict, try again".
  // processChat throws `ChatThreadBusyError` synchronously before emitting
  // anything, so we catch it via a pre-flight invocation that delegates into
  // the SSE sink only once we know the call is accepted.
  try {
    const sink = createSseChatSink(res, abortCtrl);
    try {
      await processChat(validated, sink, { signal: abortCtrl.signal });
    } catch (err) {
      if (err instanceof ChatThreadBusyError) {
        // The thread was reserved by another concurrent request. We already
        // opened the SSE response (headers may or may not be flushed), so we
        // surface the conflict on the stream AND close cleanly — switching
        // to a mid-stream JSON 409 would confuse the SSE parser on the
        // client side.
        if (sink.isOpen()) {
          sink.send({ type: "error", message: err.message, code: "thread_busy" });
        }
        sink.close();
        return;
      }
      // processChat handles its own errors internally, but a throw here
      // would still be a bug in this layer — log it and make sure the
      // stream closes.
      log(`Sidekick chat crashed: ${err instanceof Error ? err.message : String(err)}`);
      Sentry.captureException(err);
      if (sink.isOpen()) {
        sink.send({ type: "error", message: "internal_error" });
      }
      sink.close();
    }
  } catch (err) {
    // Defensive: sink construction itself failed (e.g. socket already dead).
    log(`Sidekick chat setup failed: ${err instanceof Error ? err.message : String(err)}`);
    Sentry.captureException(err);
  }
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
  runningTicketInfo.clear();
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
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
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

    // Dynamic sidekick conversation + thread message list routes (T-924)
    const convMsgsMatch = url.match(/^\/api\/sidekick\/conversations\/([^/?]+)\/messages(?:\?.*)?$/);
    if (convMsgsMatch) return handleConversationMessagesRoute(req, res, convMsgsMatch[1], url);

    const threadMsgsMatch = url.match(/^\/api\/sidekick\/threads\/([^/?]+)\/messages(?:\?.*)?$/);
    if (threadMsgsMatch) return handleThreadMessagesRoute(req, res, threadMsgsMatch[1], url);

    // GET /api/sidekick/threads (list) — bare path, optional query string.
    // Must come BEFORE the `/:id` match to prevent the id regex from
    // accidentally swallowing a bare list call if the URL shape shifts.
    const threadListMatch = url.match(/^\/api\/sidekick\/threads(?:\?.*)?$/);
    if (threadListMatch) return handleThreadListRoute(req, res, url);

    // GET /api/sidekick/threads/:id — must come after /messages to avoid shadowing
    const threadGetMatch = url.match(/^\/api\/sidekick\/threads\/([^/?]+)(?:\?.*)?$/);
    if (threadGetMatch) return handleThreadGetRoute(req, res, threadGetMatch[1]);
  }

  // --- PATCH routes ---
  if (method === "PATCH") {
    const threadPatchMatch = url.match(/^\/api\/sidekick\/threads\/([^/?]+)$/);
    if (threadPatchMatch) return handleThreadUpdateRoute(req, res, threadPatchMatch[1]);
  }

  // --- POST routes ---
  if (method === "POST") {
    switch (url) {
      case "/api/launch":            return handleLaunchRoute(req, res);
      case "/api/events":            return handleEventsRoute(req, res);
      case "/api/answer":            return handleAnswerRoute(req, res);
      case "/api/sidekick/conversations": return handleConversationCreateRoute(req, res);
      case "/api/sidekick/threads":       return handleThreadCreateRoute(req, res);
      case "/api/sidekick/create":   return handleSidekickCreateRoute(req, res);
      case "/api/sidekick/update":   return handleSidekickUpdateRoute(req, res);
      case "/api/sidekick/create-project": return handleSidekickCreateProjectRoute(req, res);
      case "/api/sidekick/converse":       return handleSidekickConverseRoute(req, res);
      case "/api/sidekick/chat":           return handleSidekickChatRoute(req, res);
      case "/api/sidekick/attach":         return handleSidekickAttachRoute(req, res);
      case "/api/ship":              return handleShipRoute(req, res);
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
