// Watchdog Module v1.0
import { execSync } from "node:child_process";
import { logger } from "./logger.ts";

const WATCHDOG_GRACE_MS = 5 * 60_000;
const DEFAULT_PIPELINE_TIMEOUT_MS = 1_800_000;
const WATCHDOG_SENTINEL = Symbol("watchdog");

export function getWatchdogTimeoutMs(): number {
  const pipelineTimeout = Number(process.env.PIPELINE_TIMEOUT_MS) || DEFAULT_PIPELINE_TIMEOUT_MS;
  return pipelineTimeout + WATCHDOG_GRACE_MS;
}

export async function withWatchdog<T>(promise: Promise<T>, label: string): Promise<T> {
  const timeoutMs = getWatchdogTimeoutMs();
  let timer: ReturnType<typeof setTimeout>;
  const watchdog = new Promise<typeof WATCHDOG_SENTINEL>((resolve) => {
    timer = setTimeout(() => resolve(WATCHDOG_SENTINEL), timeoutMs);
  });

  const result = await Promise.race([promise, watchdog]);
  clearTimeout(timer!);

  if (result === WATCHDOG_SENTINEL) {
    throw new Error(`Watchdog timeout: ${label} did not complete within ${Math.round(timeoutMs / 60_000)} minutes`);
  }

  return result as T;
}

/**
 * Save any uncommitted work in a worktree before cleanup.
 * Returns true if WIP was pushed, false if worktree was clean.
 */
export function saveWorktreeWIP(workDir: string, ticketNumber: number | string): boolean {
  try {
    const status = execSync("git status --porcelain", { cwd: workDir, encoding: "utf-8", timeout: 10_000 }).trim();
    if (!status) return false;

    execSync("git add -A", { cwd: workDir, stdio: "pipe", timeout: 10_000 });
    execSync(`git commit -m "WIP: watchdog timeout T-${ticketNumber}"`, { cwd: workDir, stdio: "pipe", timeout: 10_000 });
    try {
      execSync("git push -u origin HEAD", { cwd: workDir, stdio: "pipe", timeout: 30_000 });
    } catch {
      // Push may fail if branch doesn't have remote tracking — that's ok
    }
    return true;
  } catch {
    logger.warn({ ticketNumber }, "Failed to save WIP — worktree may have been in a broken git state");
    return false;
  }
}

/**
 * Send an agent_failed event to the Board API.
 * Best-effort — never blocks or throws.
 */
export async function sendAgentFailedEvent(
  apiUrl: string,
  apiKey: string,
  ticketNumber: number | string,
  reason: "timeout" | "crashed" | "manual_stop",
  worktreeHadChanges: boolean,
): Promise<void> {
  try {
    await fetch(`${apiUrl}/api/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pipeline-Key": apiKey,
      },
      body: JSON.stringify({
        ticket_number: Number(ticketNumber),
        agent_type: "orchestrator",
        event_type: "agent_failed",
        metadata: {
          reason,
          recovery_mode: worktreeHadChanges ? "resume" : "restart",
          worktree_had_changes: worktreeHadChanges,
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Best-effort — don't fail the pipeline on event delivery failure
  }
}
