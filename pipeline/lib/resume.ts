import type { PipelineCheckpoint } from "./checkpoint.ts";

export interface ResumeDecision {
  action: "resume" | "restart";
  resumeFrom?: PipelineCheckpoint["phase"];
  skipAgents?: string[];
  pendingAgents?: string[];
  attempt: number;
  reason?: string;
  branchName?: string;
  worktreePath?: string;
}

interface ResumeOptions {
  maxAttempts?: number; // default 3
}

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Decide whether to resume from a checkpoint or restart the pipeline.
 *
 * Rules:
 * 1. No checkpoint → restart (fresh run)
 * 2. Phase = pr_created → restart (already completed)
 * 3. Attempt >= maxAttempts → restart (exceeded retries)
 * 4. Phase = agents_dispatched → resume, skip completed agents
 * 5. All other phases → resume from that phase
 */
export function decideResume(
  checkpoint: PipelineCheckpoint | null,
  options?: ResumeOptions,
): ResumeDecision {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  // 1. No checkpoint — fresh start
  if (!checkpoint) {
    return { action: "restart", attempt: 1 };
  }

  // 2. Already completed — start over
  if (checkpoint.phase === "pr_created") {
    return { action: "restart", attempt: 1, reason: "already completed" };
  }

  // 3. Max attempts exceeded — start over
  if (checkpoint.attempt >= maxAttempts) {
    return {
      action: "restart",
      attempt: 1,
      reason: `max attempts reached (${checkpoint.attempt}/${maxAttempts})`,
    };
  }

  // 4. Agents dispatched — resume with skip list
  if (checkpoint.phase === "agents_dispatched") {
    return {
      action: "resume",
      resumeFrom: "agents_dispatched",
      skipAgents: checkpoint.completed_agents,
      pendingAgents: checkpoint.pending_agents,
      attempt: checkpoint.attempt + 1,
      branchName: checkpoint.branch_name,
      worktreePath: checkpoint.worktree_path,
    };
  }

  // 5. All other phases — resume from current phase
  return {
    action: "resume",
    resumeFrom: checkpoint.phase,
    attempt: checkpoint.attempt + 1,
    branchName: checkpoint.branch_name,
    worktreePath: checkpoint.worktree_path,
  };
}
