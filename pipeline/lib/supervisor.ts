export interface SuperviseOptions<T> {
  agentName: string;
  execute: () => Promise<T>;
  maxRetries: number;
  onTimeout?: (attempt: number) => void;
  onSkip?: () => void;
}

export interface SuperviseResult<T> {
  status: "completed" | "skipped" | "failed";
  result?: T;
  attempts: number;
  reason?: string;
  agentName: string;
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("timeout") || msg.includes("aborted") || msg.includes("timed out");
}

/**
 * Wraps agent execution with timeout/retry/skip logic.
 *
 * - On success: returns { status: "completed", result, attempts }
 * - On timeout: retries up to maxRetries, then skips
 * - On non-timeout error: fails immediately without retry
 */
export async function superviseAgent<T>(opts: SuperviseOptions<T>): Promise<SuperviseResult<T>> {
  const { agentName, execute, maxRetries, onTimeout, onSkip } = opts;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await execute();
      return { status: "completed", result, attempts: attempt, agentName };
    } catch (error) {
      if (!isTimeoutError(error)) {
        return {
          status: "failed",
          attempts: attempt,
          reason: error instanceof Error ? error.message : String(error),
          agentName,
        };
      }

      onTimeout?.(attempt);

      if (attempt === maxRetries) {
        onSkip?.();
        return {
          status: "skipped",
          attempts: attempt,
          reason: `Agent timed out after ${maxRetries} attempt(s)`,
          agentName,
        };
      }
    }
  }

  // Safety fallback — should never reach here since maxRetries >= 1
  return { status: "failed", attempts: 0, reason: "No attempts made", agentName };
}
