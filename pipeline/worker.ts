import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { executePipeline } from "./run.ts";

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

// --- Pipeline execution (uses run.ts directly, no shell-out) ---
// AbortController for graceful cancellation on shutdown
const abortController = new AbortController();

async function runTicketPipeline(ticket: Ticket): Promise<void> {
  log(`Starting pipeline: T--${ticket.number} — ${ticket.title}`);

  const labels = Array.isArray(ticket.tags) ? ticket.tags.join(",") : "";

  const result = await executePipeline({
    projectDir: PROJECT_DIR,
    ticket: {
      ticketId: String(ticket.number),
      title: ticket.title,
      description: ticket.body ?? "No description provided",
      labels,
    },
    abortSignal: abortController.signal,
  });

  if (result.status === "failed") {
    throw new Error(`Pipeline failed (exit code: ${result.exitCode})`);
  }

  // Update ticket status to in_review
  await completeTicket(ticket.number, result.branch);
  log(`Pipeline completed: T--${ticket.number} → ${result.branch} (status: in_review)`);
}

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
log("  Agentic Dev Pipeline Worker (SDK)");
log(`  Project: ${PROJECT_DIR.split("/").pop()}`);
log(`  Supabase-Project: ${SUPABASE_PROJECT_ID}`);
log(`  Poll-Interval: ${POLL_INTERVAL / 1000}s`);
log("==========================================");

let consecutiveFailures = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

while (running) {
  // 1. Connectivity check
  if (!(await checkConnectivity())) {
    log("WARN: Supabase not reachable, waiting...");
    await sleep(POLL_INTERVAL);
    continue;
  }

  // 2. Find next ticket
  const ticket = await getNextTicket();
  if (!ticket) {
    await sleep(POLL_INTERVAL);
    continue;
  }

  log(`Ticket found: T--${ticket.number} — ${ticket.title}`);

  // 3. Atomic claim
  const claimed = await claimTicket(ticket.number);
  if (!claimed) {
    log(`Ticket T--${ticket.number} claimed by another worker. Skip.`);
    await sleep(5000);
    continue;
  }

  log(`Ticket T--${ticket.number} claimed.`);

  // 4. Run pipeline (calls executePipeline from run.ts directly)
  try {
    await runTicketPipeline(ticket);
    consecutiveFailures = 0;
  } catch (error) {
    consecutiveFailures++;
    const reason = error instanceof Error ? error.message : "Unknown error";
    log(`Pipeline failed (${consecutiveFailures}/${MAX_FAILURES} consecutive)`);

    await failTicket(ticket.number, `Pipeline error: ${reason}`);

    if (consecutiveFailures >= MAX_FAILURES) {
      log(`CRITICAL: ${MAX_FAILURES} consecutive failures. Worker stopping.`);
      log(`Check logs: ${LOG_DIR}`);
      process.exit(1);
    }

    // 5-minute cooldown after failure
    log("Waiting 5 minutes after failure...");
    await sleep(300_000);
    continue;
  }

  // Short pause between tickets
  await sleep(5000);
}

log("Worker stopped gracefully.");
