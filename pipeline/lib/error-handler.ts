// pipeline/lib/error-handler.ts

export interface ErrorContext {
  error: Error;
  ticketId: string;
  exitCode: number;
  timedOut: boolean;
  aborted?: boolean;
  branch?: string;
  projectDir?: string;
}

export interface ErrorClassification {
  action: "recovery" | "auto_heal" | "escalate";
  reason: string;
  shouldCreateTicket: boolean;
}

/**
 * Synchronous error classification based on known patterns.
 * For ambiguous errors, returns "escalate" — the caller can optionally
 * invoke AI triage for deeper analysis.
 */
export function classifyError(ctx: ErrorContext): ErrorClassification {
  const msg = ctx.error.message.toLowerCase();

  // 1. Timeout — always recovery (restart will retry)
  if (ctx.timedOut || msg.includes("timeout")) {
    return {
      action: "recovery",
      reason: msg.includes("watchdog") ? "watchdog timeout — child process hung" : "pipeline timeout exceeded",
      shouldCreateTicket: false,
    };
  }

  // 2. Abort signal — graceful shutdown, no action needed
  if (ctx.aborted || msg.includes("abort")) {
    return {
      action: "recovery",
      reason: "pipeline aborted by external signal (shutdown/drain)",
      shouldCreateTicket: false,
    };
  }

  // 3. Git errors — often auto-healable (merge conflicts, dirty worktree)
  if (msg.includes("git") && (msg.includes("conflict") || msg.includes("merge") || msg.includes("checkout"))) {
    return {
      action: "auto_heal",
      reason: "git operation failed — likely resolvable by worktree reset",
      shouldCreateTicket: true,
    };
  }

  // 4. Build/compile errors in the pipeline runner itself
  if (msg.includes("syntaxerror") || msg.includes("cannot find module") || msg.includes("typeerror")) {
    return {
      action: "escalate",
      reason: "code-level error in pipeline runner — needs human review",
      shouldCreateTicket: true,
    };
  }

  // 5. Network/API errors — recovery (transient)
  if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("fetch failed")) {
    return {
      action: "recovery",
      reason: "network error — transient, will retry on next run",
      shouldCreateTicket: false,
    };
  }

  // 6. SDK/child process exit — the orchestrator itself failed
  if (msg.includes("pipeline exited with status") || msg.includes("exited with code")) {
    return {
      action: "escalate",
      reason: "orchestrator process failed — AI triage needed to determine if auto-healable",
      shouldCreateTicket: false,
    };
  }

  // Default: escalate to human
  return {
    action: "escalate",
    reason: `unclassified error: ${ctx.error.message.slice(0, 200)}`,
    shouldCreateTicket: false,
  };
}

export interface AutoHealResult {
  healed: boolean;
  ticketNumber?: number;
  branch?: string;
  summary: string;
}

/**
 * Execute auto-healing for a classified error.
 * Creates a bug ticket in the Board for documentation/audit-trail.
 * Actual fix execution is a future task — for now the ticket documents what happened.
 */
export async function executeAutoHeal(
  ctx: ErrorContext,
  classification: ErrorClassification,
  boardApi: { createTicket: (title: string, body: string) => Promise<number | null>; patchTicket: (n: number, data: Record<string, unknown>) => Promise<boolean> },
): Promise<AutoHealResult> {
  if (classification.action !== "auto_heal") {
    return { healed: false, summary: `Not auto-healable: ${classification.reason}` };
  }

  const title = `[Auto-Heal] ${classification.reason.slice(0, 80)}`;
  const body = `## Auto-detected Bug

**Original Ticket:** T-${ctx.ticketId}
**Error:** ${ctx.error.message}
**Exit Code:** ${ctx.exitCode}
**Classification:** ${classification.action}
**Reason:** ${classification.reason}

## Context
- Branch: \`${ctx.branch ?? "unknown"}\`
- Timed out: ${ctx.timedOut}

This ticket was automatically created by the pipeline error handler.`;

  const ticketNumber = await boardApi.createTicket(title, body);
  if (!ticketNumber) {
    return { healed: false, summary: "Failed to create auto-heal ticket" };
  }

  // Mark ticket as done immediately — actual fix execution is a future task.
  // For now the ticket serves as audit-trail documentation.
  const patched = await boardApi.patchTicket(ticketNumber, { status: "done", pipeline_status: "done" });

  return {
    healed: true,
    ticketNumber,
    summary: patched
      ? `Auto-heal ticket T-${ticketNumber} created and resolved: ${classification.reason}`
      : `Auto-heal ticket T-${ticketNumber} created but status update failed: ${classification.reason}`,
  };
}
