import { initSentry, Sentry } from "./lib/sentry.ts";
initSentry();
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { executePipeline } from "./run.ts";
import { toBranchName, sleep, log } from "./lib/utils.ts";
import { logger } from "./lib/logger.ts";
import { classifyError } from "./lib/error-handler.ts";
import { withWatchdog, saveWorktreeWIP, sendAgentFailedEvent } from "./lib/watchdog.ts";
import { WorktreeManager } from "./lib/worktree-manager.ts";
import { loadProjectConfig } from "./lib/config.ts";
import { generateChangeSummary } from "./lib/change-summary.ts";
import { loadGitHubAppConfig, getInstallationToken, type GitHubAppConfig } from "./lib/github-app.ts";

// --- Environment validation ---
const required = [
  "ANTHROPIC_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_PROJECT_ID",
  "PROJECT_DIR",
] as const;

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

// Load GitHub App config (optional — falls back to GH_TOKEN)
const githubAppConfig: GitHubAppConfig | null = loadGitHubAppConfig();
const defaultInstallationId = process.env.GITHUB_APP_INSTALLATION_ID
  ? Number(process.env.GITHUB_APP_INSTALLATION_ID)
  : undefined;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SUPABASE_PROJECT_ID = process.env.SUPABASE_PROJECT_ID!;
const PROJECT_DIR = process.env.PROJECT_DIR!;
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL ?? "60") * 1000;
const LOG_DIR = process.env.LOG_DIR ?? resolve(process.env.HOME ?? "/tmp", "pipeline-logs");
const MAX_FAILURES = Number(process.env.MAX_FAILURES ?? "5");

mkdirSync(LOG_DIR, { recursive: true });

const config = loadProjectConfig(PROJECT_DIR);
const MAX_WORKERS = config.maxWorkers;
const worktreeManager = new WorktreeManager(PROJECT_DIR, MAX_WORKERS);

// log() imported from ./lib/utils.ts

// --- Supabase helpers ---
async function supabaseGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Best-effort: Supabase GET failure handled by caller via null return
    return null;
  }
}

async function supabasePatch<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}${path}`, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return (await res.json()) as T;
      // 4xx client errors — don't retry
      if (res.status >= 400 && res.status < 500) {
        log(`supabasePatch 4xx (${res.status}) on ${path}, not retrying`);
        return null;
      }
      // 5xx server error — retry
      if (attempt < maxAttempts) {
        log(`supabasePatch ${res.status} on ${path}, retry ${attempt}/${maxAttempts}...`);
        await sleep(1000 * attempt);
      }
    } catch (err) {
      // Network/timeout error — retry
      if (attempt < maxAttempts) {
        log(`supabasePatch error on ${path} (${err instanceof Error ? err.message : "unknown"}), retry ${attempt}/${maxAttempts}...`);
        await sleep(1000 * attempt);
      }
    }
  }
  log(`supabasePatch FAILED after ${maxAttempts} attempts on ${path}`);
  return null;
}

// --- Complexity gate ---
function getAllowedComplexities(maxLevel: string): string[] {
  const levels = ["low", "medium", "high", "critical"];
  const idx = levels.indexOf(maxLevel);
  return idx >= 0 ? levels.slice(0, idx + 1) : ["low", "medium"];
}

// --- Ticket functions ---
interface Ticket {
  number: number;
  title: string;
  body: string | null;
  priority: string;
  tags: string[] | null;
  complexity: string | null;
}

async function checkConnectivity(): Promise<boolean> {
  const result = await supabaseGet("/rest/v1/");
  return result !== null;
}

async function getNextTicket(): Promise<Ticket | null> {
  const maxComplexity = config.pipeline.maxAutonomousComplexity ?? "medium";
  const allowedComplexities = getAllowedComplexities(maxComplexity);
  const tickets = await supabaseGet<Ticket[]>(
    `/rest/v1/tickets?status=eq.ready_to_develop&project_id=eq.${SUPABASE_PROJECT_ID}&pipeline_status=is.null&complexity=in.(${allowedComplexities.join(",")})&order=priority.asc,created_at.asc&limit=1&select=number,title,body,priority,tags,complexity`
  );
  return tickets?.[0] ?? null;
}

async function claimTicket(number: number): Promise<boolean> {
  const result = await supabasePatch<Ticket[]>(
    `/rest/v1/tickets?number=eq.${number}&pipeline_status=is.null`,
    { pipeline_status: "running", status: "in_progress" }
  );
  return (result?.length ?? 0) > 0;
}

async function completeTicket(number: number, branch: string, summary?: string): Promise<void> {
  const result = await supabasePatch(
    `/rest/v1/tickets?number=eq.${number}`,
    { pipeline_status: "done", status: "in_review", branch, ...(summary ? { summary } : {}) }
  );
  if (!result) {
    throw new Error(`Failed to update ticket T-${number} to in_review after 3 retries`);
  }
}

async function failTicket(number: number, reason: string): Promise<void> {
  const result = await supabasePatch(
    `/rest/v1/tickets?number=eq.${number}`,
    { pipeline_status: "failed", status: "ready_to_develop", summary: reason }
  );
  if (!result) {
    log(`CRITICAL: Failed to update ticket T-${number} to failed status after 3 retries — ticket may be stuck`);
  }
}

// Board API: known agent types that may have open events
const KNOWN_AGENT_TYPES = [
  "orchestrator", "triage", "qa", "qa-auto",
  "frontend", "backend", "data-engineer", "devops",
] as const;

async function clearBoardAgentEvents(ticketNumber: number): Promise<void> {
  if (!config.pipeline.apiUrl || !config.pipeline.apiKey) return;
  // Send 'completed' for all known agent types so the Board clears stale running indicators
  for (const agentType of KNOWN_AGENT_TYPES) {
    try {
      await fetch(`${config.pipeline.apiUrl}/api/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Pipeline-Key": config.pipeline.apiKey,
        },
        body: JSON.stringify({
          ticket_number: ticketNumber,
          agent_type: agentType,
          event_type: "completed",
          metadata: { cleanup: true, reason: "worker_restart_cleanup" },
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Silent fail — cleanup events are best-effort
    }
  }
}

// --- Pipeline execution (uses run.ts directly, no shell-out) ---
// AbortController for graceful cancellation on shutdown
const abortController = new AbortController();

// --- Graceful shutdown ---
let running = true;
process.on("SIGINT", () => {
  log("SIGINT received, cancelling pipeline and stopping...");
  running = false;
  abortController.abort();
  Sentry.close(2000);
});
process.on("SIGTERM", () => {
  log("SIGTERM received, cancelling pipeline and stopping...");
  running = false;
  abortController.abort();
  Sentry.close(2000);
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

// --- Main loop ---
log("==========================================");
log("  Just Ship Pipeline Worker (SDK)");
log(`  Project: ${PROJECT_DIR.split("/").pop()}`);
log(`  Supabase-Project: ${SUPABASE_PROJECT_ID}`);
log(`  Poll-Interval: ${POLL_INTERVAL / 1000}s`);
log(`  Max Workers: ${MAX_WORKERS}`);
log("==========================================");

// sleep() imported from ./lib/utils.ts

// Wrap in async IIFE — top-level await not supported in CJS
(async () => {

// --- Crash recovery: clean stale worktrees and reset stuck tickets ---
log("Cleaning stale worktrees...");
await worktreeManager.pruneStale(async (branchName) => {
  const match = branchName.match(/(\d+)/);
  if (!match) return false;
  const ticketNumber = match[1];
  const tickets = await supabaseGet<Array<{ pipeline_status: string }>>(
    `/rest/v1/tickets?number=eq.${ticketNumber}&project_id=eq.${SUPABASE_PROJECT_ID}&select=pipeline_status`
  );
  return tickets?.[0]?.pipeline_status === "paused";
});

// Reset stuck running tickets back to ready_to_develop + clear Board agent indicators
const stuckTickets = await supabaseGet<Array<{ number: number }>>(
  `/rest/v1/tickets?pipeline_status=eq.running&project_id=eq.${SUPABASE_PROJECT_ID}&select=number`
);
if (stuckTickets && stuckTickets.length > 0) {
  log(`Found ${stuckTickets.length} stuck ticket(s), resetting and clearing Board events...`);
  await supabasePatch(
    `/rest/v1/tickets?pipeline_status=eq.running&project_id=eq.${SUPABASE_PROJECT_ID}`,
    { pipeline_status: null, status: "ready_to_develop" }
  );
  for (const ticket of stuckTickets) {
    await clearBoardAgentEvents(ticket.number);
    log(`Board cleanup events sent for T-${ticket.number}`);
  }
} else {
  await supabasePatch(
    `/rest/v1/tickets?pipeline_status=eq.running&project_id=eq.${SUPABASE_PROJECT_ID}`,
    { pipeline_status: null, status: "ready_to_develop" }
  );
}
log("Cleanup done.");

// --- Per-slot failure tracking ---
const slotFailures = new Map<number, number>();

async function runWorkerSlot(ticket: Ticket): Promise<void> {
  const branchName = toBranchName(config.conventions.branch_prefix, ticket.number, ticket.title);

  let slotId: number | undefined;
  const runAbortController = new AbortController();
  // Forward module-level abort to per-run controller
  if (abortController.signal.aborted) {
    runAbortController.abort();
  } else {
    abortController.signal.addEventListener("abort", () => runAbortController.abort(), { once: true });
  }

  try {
    const slot = await worktreeManager.allocate(branchName);
    slotId = slot.slotId;

    // Install dependencies in worktree
    const installCmd = config.stack.packageManager === "pnpm" ? "pnpm install --frozen-lockfile"
      : config.stack.packageManager === "yarn" ? "yarn install --frozen-lockfile"
      : config.stack.packageManager === "bun" ? "bun install --frozen-lockfile"
      : "npm ci";
    try {
      execSync(installCmd, { cwd: slot.workDir, stdio: "pipe", timeout: 120_000 });
    } catch (e) {
      log(`WARN: Install failed in worktree (${e instanceof Error ? e.message : "unknown"}), continuing...`);
    }

    // Resolve GitHub token (installation token > GH_TOKEN env var)
    let pipelineEnv: Record<string, string> | undefined;
    if (githubAppConfig && defaultInstallationId) {
      try {
        const token = await getInstallationToken(githubAppConfig, defaultInstallationId);
        pipelineEnv = { GH_TOKEN: token };
        // Also authenticate gh CLI for this run (best-effort — git operations use x-access-token)
        try {
          execSync("gh auth login --with-token", {
            input: token,
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 10_000,
          });
        } catch { /* gh auth is best-effort */ }
      } catch (err) {
        log(`GitHub App token generation failed: ${err instanceof Error ? err.message : String(err)}`);
        if (!process.env.GH_TOKEN) {
          throw new Error("No GitHub token available: GitHub App token generation failed and GH_TOKEN not set");
        }
      }
    }

    // Inject Shopify env vars from project metadata
    if (config.stack.platform === "shopify") {
      // Fetch shopify_store_url from project data (stored in Board database via Supabase REST)
      try {
        const projectData = await supabaseGet<Array<{ shopify_store_url: string | null }>>(
          `/rest/v1/projects?id=eq.${SUPABASE_PROJECT_ID}&select=shopify_store_url`
        );
        const shopifyStoreUrl = projectData?.[0]?.shopify_store_url;
        if (shopifyStoreUrl) {
          pipelineEnv = {
            ...(pipelineEnv ?? {}),
            SHOPIFY_STORE_URL: shopifyStoreUrl,
          };
          log(`Injected SHOPIFY_STORE_URL: ${shopifyStoreUrl}`);
        } else {
          log(`WARN: Project is Shopify type but shopify_store_url is not set in database`);
        }
      } catch (err) {
        log(`WARN: Failed to fetch shopify_store_url from project: ${err instanceof Error ? err.message : "unknown"}`);
      }
      // SHOPIFY_CLI_THEME_TOKEN comes from local .env on VPS — passed through automatically via process.env.
    }

    log(`Starting pipeline: T-${ticket.number} — ${ticket.title} (slot ${slotId})`);

    const result = await withWatchdog(
      executePipeline({
        projectDir: PROJECT_DIR,
        workDir: slot.workDir,
        branchName,
        ticket: {
          ticketId: String(ticket.number),
          title: ticket.title,
          description: ticket.body ?? "No description provided",
          labels: Array.isArray(ticket.tags) ? ticket.tags.join(",") : "",
        },
        abortSignal: runAbortController.signal,
        env: pipelineEnv,
      }),
      `T-${ticket.number}`
    );

    if (result.status === "paused") {
      await supabasePatch(
        `/rest/v1/tickets?number=eq.${ticket.number}`,
        { pipeline_status: "paused", session_id: result.sessionId }
      );
      log(`Pipeline paused: T-${ticket.number} (slot ${slotId})`);
      await worktreeManager.park(slotId);
      slotId = undefined; // Don't release — it's parked
      return;
    }

    if (result.status === "failed") {
      throw new Error(result.failureReason ?? `Pipeline failed (exit code: ${result.exitCode})`);
    }

    // Generate change summary before completing
    let summary: string | undefined;
    try {
      let prUrl: string | undefined;
      try {
        prUrl = execSync(`gh pr view --json url -q .url`, { cwd: slot.workDir, encoding: "utf-8", timeout: 10000 }).trim();
      } catch { /* no PR yet */ }

      summary = generateChangeSummary({ workDir: slot.workDir, baseBranch: "main", prUrl });
    } catch {
      // Summary generation is best-effort
    }

    await completeTicket(ticket.number, result.branch, summary);
    log(`Pipeline completed: T-${ticket.number} → ${result.branch} (slot ${slotId})`);

    if (slotId !== undefined) slotFailures.delete(slotId);
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const isStatusUpdateFailure = errorObj.message.includes("Failed to update ticket") && errorObj.message.includes("after 3 retries");
    const isWatchdog = errorObj.message.startsWith("Watchdog timeout:");

    // --- Status update failure: pipeline succeeded but Supabase is unreachable ---
    // Do NOT call failTicket (that would also fail). Log critically and let
    // the startup recovery (line ~230) reset it on next worker restart.
    if (isStatusUpdateFailure) {
      log(`CRITICAL: T-${ticket.number} pipeline succeeded but status update to in_review failed after retries. Ticket stuck at in_progress — will be auto-recovered on next worker restart.`);
      Sentry.captureException(error);
    } else {
      // --- Watchdog timeout: abort subprocess, save WIP, send agent_failed ---
      let watchdogHadWip = false;
      if (isWatchdog) {
        runAbortController.abort();
        await sleep(5000);
        if (slotId !== undefined) {
          const worktreeDir = worktreeManager.getSlotDir(slotId);
          if (worktreeDir) {
            watchdogHadWip = saveWorktreeWIP(worktreeDir, ticket.number);
          }
        }
        // Send agent_failed event via Board API
        if (config.pipeline.apiUrl && config.pipeline.apiKey) {
          await sendAgentFailedEvent(config.pipeline.apiUrl, config.pipeline.apiKey, ticket.number, "timeout", watchdogHadWip);
        }
      }

      // --- Error classification and ticket status update ---
      const classification = classifyError({
        error: errorObj,
        ticketId: String(ticket.number),
        exitCode: 1,
        timedOut: false,
        branch: branchName,
        projectDir: PROJECT_DIR,
      });

      log(`Pipeline failed: T-${ticket.number} (${errorObj.message}) [${classification.action}]`);
      Sentry.captureException(error);

      if (watchdogHadWip) {
        // Partial work saved — set crashed so recovery can resume instead of restart
        await supabasePatch(`/rest/v1/tickets?number=eq.${ticket.number}`, {
          pipeline_status: "crashed",
          summary: `Watchdog timeout with partial work saved. Use /recover T-${ticket.number} to resume.`,
        });
        log(`T-${ticket.number}: watchdog timeout, WIP saved, set pipeline_status=crashed`);
      } else {
        await failTicket(ticket.number, `Pipeline error: ${errorObj.message}`);
      }
    }

    // Auto-heal: worker only logs the classification for now.
    // Full auto-heal (ticket creation + fix) runs via server.ts which has Board REST API access.
    // The worker talks to Supabase directly and lacks a POST helper for ticket creation.
    // Future: add supabasePost to worker.ts or route auto-heal through the server.

    if (slotId !== undefined) {
      const count = (slotFailures.get(slotId) ?? 0) + 1;
      slotFailures.set(slotId, count);
    }
  } finally {
    if (slotId !== undefined) {
      await worktreeManager.release(slotId);
    }
  }
}

// --- Lifecycle timeout runner (runs every poll cycle) ---
async function runLifecycleChecks(): Promise<void> {
  const now = new Date();

  // 1. Failed tickets > 1h → auto-reset (max 3 retries)
  const failedTickets = await supabaseGet<Array<{ number: number; pipeline_retry_count: number; updated_at: string }>>(
    `/rest/v1/tickets?pipeline_status=eq.failed&project_id=eq.${SUPABASE_PROJECT_ID}&select=number,pipeline_retry_count,updated_at`
  );
  if (failedTickets) {
    for (const t of failedTickets) {
      const age = now.getTime() - new Date(t.updated_at).getTime();
      if (age < 60 * 60_000) continue; // < 1h, skip
      const retries = t.pipeline_retry_count ?? 0;
      if (retries >= 3) {
        // Max retries reached → move to backlog
        await supabasePatch(`/rest/v1/tickets?number=eq.${t.number}`, {
          pipeline_status: null,
          status: "backlog",
          summary: `Blocked after ${retries} failed autonomous attempts. Requires manual intervention.`,
        });
        log(`T-${t.number}: moved to backlog after ${retries} failed retries`);
      } else {
        // Auto-reset for retry
        await supabasePatch(`/rest/v1/tickets?number=eq.${t.number}`, {
          pipeline_status: null,
          status: "ready_to_develop",
          pipeline_retry_count: retries + 1,
        });
        log(`T-${t.number}: auto-reset for retry (attempt ${retries + 1}/3)`);
      }
      await clearBoardAgentEvents(t.number);
    }
  }

  // 2. Paused tickets > 24h → auto-cancel
  const pausedTickets = await supabaseGet<Array<{ number: number; updated_at: string }>>(
    `/rest/v1/tickets?pipeline_status=eq.paused&project_id=eq.${SUPABASE_PROJECT_ID}&select=number,updated_at`
  );
  if (pausedTickets) {
    for (const t of pausedTickets) {
      const age = now.getTime() - new Date(t.updated_at).getTime();
      if (age < 24 * 60 * 60_000) continue; // < 24h, skip
      // Try to save WIP from parked worktree
      const worktreeDir = worktreeManager.findParkedForTicket(t.number);
      if (worktreeDir) {
        saveWorktreeWIP(worktreeDir, t.number);
        await worktreeManager.releaseByDir(worktreeDir);
      }
      await supabasePatch(`/rest/v1/tickets?number=eq.${t.number}`, {
        pipeline_status: null,
        status: "ready_to_develop",
        summary: "Auto-cancelled after 24h without answer. Branch may contain partial work.",
      });
      await clearBoardAgentEvents(t.number);
      log(`T-${t.number}: auto-cancelled after 24h pause`);
    }
  }

  // 3. Stale running tickets > 90min → auto-reset
  // Handles hung workers: the watchdog fires after 35min, but if the worker process
  // itself hangs (not crashes), systemd restart never triggers and no cleanup runs.
  // This check ensures stuck tickets are recovered on the next poll cycle.
  const staleRunningTickets = await supabaseGet<Array<{ number: number; updated_at: string }>>(
    `/rest/v1/tickets?pipeline_status=eq.running&project_id=eq.${SUPABASE_PROJECT_ID}&select=number,updated_at`
  );
  if (staleRunningTickets) {
    for (const t of staleRunningTickets) {
      const age = now.getTime() - new Date(t.updated_at).getTime();
      if (age < 90 * 60_000) continue; // < 90min — watchdog may still be active, skip
      await supabasePatch(`/rest/v1/tickets?number=eq.${t.number}`, {
        pipeline_status: null,
        status: "ready_to_develop",
        summary: `Auto-reset: pipeline_status was stuck at running for ${Math.round(age / 60_000)}min. Worker may have hung without crashing.`,
      });
      await clearBoardAgentEvents(t.number);
      log(`T-${t.number}: auto-reset from stale running (age: ${Math.round(age / 60_000)}min)`);
    }
  }
}

// --- Main loop: fetch tickets sequentially, run pipelines in parallel ---
while (running) {
  const activeSlots = worktreeManager.getActiveSlots();
  const availableSlots = MAX_WORKERS - activeSlots;

  if (availableSlots > 0) {
    // Fetch and claim tickets SEQUENTIALLY to avoid race conditions
    const claimedTickets: Ticket[] = [];
    for (let i = 0; i < availableSlots; i++) {
      if (!(await checkConnectivity())) break;
      const ticket = await getNextTicket();
      if (!ticket) break;

      const claimed = await claimTicket(ticket.number);
      if (claimed) {
        claimedTickets.push(ticket);
        log(`Ticket T-${ticket.number} claimed.`);
      }
    }

    // Run claimed tickets IN PARALLEL
    if (claimedTickets.length > 0) {
      const promises = claimedTickets.map((ticket) => runWorkerSlot(ticket));
      await Promise.allSettled(promises);
    }
  }

  // Check for infrastructure-level failures
  let totalFailures = 0;
  for (const count of slotFailures.values()) totalFailures += count;
  if (totalFailures >= MAX_FAILURES) {
    log(`CRITICAL: ${totalFailures} total failures across slots. Worker stopping.`);
    process.exit(1);
  }

  // Run lifecycle checks each poll cycle
  try {
    await runLifecycleChecks();
  } catch (e) {
    log(`Lifecycle check error: ${e instanceof Error ? e.message : String(e)}`);
  }

  await sleep(POLL_INTERVAL);
}

log("Worker stopped gracefully.");

})();
