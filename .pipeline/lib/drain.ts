// pipeline/lib/drain.ts — Drain state machine for zero-downtime updates

export type DrainState = "normal" | "draining" | "drained";

export interface DrainStatus {
  state: DrainState;
  running_count: number;
}

/**
 * Manages the drain lifecycle for zero-downtime VPS updates.
 *
 * State machine: normal → draining → drained
 *
 * In "draining" mode:
 * - New pipeline runs are rejected (503 Service Unavailable)
 * - Running pipelines continue to completion
 * - Health endpoint reports drain status
 *
 * In "drained" mode:
 * - All running pipelines have completed (or were force-drained)
 * - Container is safe to stop/replace
 */
export class DrainManager {
  private state: DrainState = "normal";
  private runningCountFn: () => number;
  private forceStopFn: (() => Promise<void>) | null = null;
  private drainTimeout: ReturnType<typeof setTimeout> | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(runningCountFn: () => number) {
    this.runningCountFn = runningCountFn;
  }

  getState(): DrainState {
    return this.state;
  }

  getStatus(): DrainStatus {
    return {
      state: this.state,
      running_count: this.runningCountFn(),
    };
  }

  /**
   * Check if new pipeline runs should be accepted.
   * Returns true if the server is in normal mode and can accept work.
   */
  canAcceptWork(): boolean {
    return this.state === "normal";
  }

  /**
   * Start draining. Blocks new runs and waits for running ones to finish.
   * Returns false if already draining/drained.
   */
  startDrain(options?: {
    timeoutMs?: number;
    onForceStop?: () => Promise<void>;
  }): boolean {
    if (this.state !== "normal") return false;

    this.state = "draining";
    this.forceStopFn = options?.onForceStop ?? null;

    // Check immediately — if nothing is running, go straight to drained
    if (this.runningCountFn() === 0) {
      this.state = "drained";
      return true;
    }

    // Poll every 5 seconds to check if all runs completed
    this.pollInterval = setInterval(() => {
      if (this.runningCountFn() === 0) {
        this.state = "drained";
        this.cleanup();
      }
    }, 5000);

    // Set timeout for force-drain (default: 30 minutes)
    const timeoutMs = options?.timeoutMs ?? 30 * 60 * 1000;
    this.drainTimeout = setTimeout(() => {
      this.forceDrain();
    }, timeoutMs);

    return true;
  }

  /**
   * Force-drain: immediately mark as drained regardless of running pipelines.
   * Called by the Update-Agent via POST /api/force-drain when drain timeout expires.
   * The onForceStop callback should mark running runs as interrupted.
   */
  async forceDrain(): Promise<void> {
    if (this.state === "drained") return;

    this.cleanup();

    if (this.forceStopFn) {
      await this.forceStopFn();
    }

    this.state = "drained";
  }

  /**
   * Reset drain state back to normal. Called when a new container starts fresh,
   * but also useful for testing or if an update is cancelled.
   */
  reset(): void {
    this.cleanup();
    this.state = "normal";
  }

  private cleanup(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.drainTimeout) {
      clearTimeout(this.drainTimeout);
      this.drainTimeout = null;
    }
  }
}
