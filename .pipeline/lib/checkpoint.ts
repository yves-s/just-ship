import { logger } from "./logger.ts";

export interface PipelineCheckpoint {
  phase: "triage" | "planning" | "agents_dispatched" | "agents_done" | "qa" | "pr_created";
  completed_agents: string[];
  pending_agents: string[];
  branch_name: string;
  worktree_path?: string;
  started_at: string;
  last_updated: string;
  attempt: number;
  error?: string;
}

interface CheckpointConfig {
  apiUrl: string;
  apiKey: string;
  ticketNumber: string;
}

/**
 * Write or update a checkpoint on the ticket via Board API.
 * Best-effort — never fails the pipeline.
 */
export async function updateCheckpoint(
  config: CheckpointConfig,
  current: PipelineCheckpoint | null,
  update: Partial<PipelineCheckpoint>,
): Promise<void> {
  const checkpoint: PipelineCheckpoint = {
    phase: "triage",
    completed_agents: [],
    pending_agents: [],
    branch_name: "",
    started_at: current?.started_at ?? new Date().toISOString(),
    last_updated: new Date().toISOString(),
    attempt: current?.attempt ?? 1,
    ...current,
    ...update,
  };

  try {
    await fetch(`${config.apiUrl}/api/tickets/${config.ticketNumber}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Pipeline-Key": config.apiKey,
      },
      body: JSON.stringify({ pipeline_checkpoint: checkpoint }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    logger.error("Failed to write checkpoint");
  }
}

/**
 * Clear checkpoint after successful pipeline completion.
 */
export async function clearCheckpoint(config: CheckpointConfig): Promise<void> {
  try {
    await fetch(`${config.apiUrl}/api/tickets/${config.ticketNumber}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Pipeline-Key": config.apiKey,
      },
      body: JSON.stringify({ pipeline_checkpoint: null }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    logger.error("Failed to clear checkpoint");
  }
}
