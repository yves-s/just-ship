import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { executePipeline } from "./run.ts";
import { WorktreeManager } from "./lib/worktree-manager.ts";
import { loadProjectConfig } from "./lib/config.ts";

// --- Environment validation ---
const required = [
  "ANTHROPIC_API_KEY",
  "GH_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_PROJECT_ID",
  "PROJECT_DIR",
] as const;

for (const key of required) {
  if (!process.env[key]) {
    console.error(`ERROR: ${key} must be set`);
    process.exit(1);
  }
}

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

// --- Logging ---
function log(msg: string) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

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
    return null;
  }
}

async function supabasePatch<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
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
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// --- Ticket functions ---
interface Ticket {
  number: number;
  title: string;
  body: string | null;
  priority: string;
  tags: string[] | null;
}

async function checkConnectivity(): Promise<boolean> {
  const result = await supabaseGet("/rest/v1/");
  return result !== null;
}

async function getNextTicket(): Promise<Ticket | null> {
  const tickets = await supabaseGet<Ticket[]>(
    `/rest/v1/tickets?status=eq.ready_to_develop&project_id=eq.${SUPABASE_PROJECT_ID}&pipeline_status=is.null&order=priority.asc,created_at.asc&limit=1&select=number,title,body,priority,tags`
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

async function completeTicket(number: number, branch: string): Promise<void> {
  await supabasePatch(
    `/rest/v1/tickets?number=eq.${number}`,
    { pipeline_status: "done", status: "in_review", branch }
  );
}

async function failTicket(number: number, reason: string): Promise<void> {
  await supabasePatch(
    `/rest/v1/tickets?number=eq.${number}`,
    { pipeline_status: "failed", status: "ready_to_develop", summary: reason }
  );
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
});
process.on("SIGTERM", () => {
  log("SIGTERM received, cancelling pipeline and stopping...");
  running = false;
  abortController.abort();
});

// --- Main loop ---
log("==========================================");
log("  Just Ship Pipeline Worker (SDK)");
log(`  Project: ${PROJECT_DIR.split("/").pop()}`);
log(`  Supabase-Project: ${SUPABASE_PROJECT_ID}`);
log(`  Poll-Interval: ${POLL_INTERVAL / 1000}s`);
log(`  Max Workers: ${MAX_WORKERS}`);
log("==========================================");

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  const branchSlug = ticket.title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
  const branchName = `${config.conventions.branch_prefix}${ticket.number}-${branchSlug}`;

  let slotId: number | undefined;
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

    log(`Starting pipeline: T-${ticket.number} — ${ticket.title} (slot ${slotId})`);

    const result = await executePipeline({
      projectDir: PROJECT_DIR,
      workDir: slot.workDir,
      branchName,
      ticket: {
        ticketId: String(ticket.number),
        title: ticket.title,
        description: ticket.body ?? "No description provided",
        labels: Array.isArray(ticket.tags) ? ticket.tags.join(",") : "",
      },
      abortSignal: abortController.signal,
    });

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

    await completeTicket(ticket.number, result.branch);
    log(`Pipeline completed: T-${ticket.number} → ${result.branch} (slot ${slotId})`);

    if (slotId !== undefined) slotFailures.delete(slotId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    log(`Pipeline failed: T-${ticket.number} (${reason})`);
    await failTicket(ticket.number, `Pipeline error: ${reason}`);

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

  await sleep(POLL_INTERVAL);
}

log("Worker stopped gracefully.");

})();
