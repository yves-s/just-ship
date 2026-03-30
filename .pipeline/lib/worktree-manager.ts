import { execSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface Slot {
  slotId: number;
  branchName: string;
  workDir: string;
  status: "active" | "parked";
}

interface QueueEntry {
  branchName: string;
  isResume: boolean;
  resolve: (result: { slotId: number; workDir: string }) => void;
  reject: (error: Error) => void;
}

/**
 * Manages git worktrees for parallel pipeline workers.
 *
 * Each worker gets its own worktree (isolated copy of the repo with its own
 * branch). The manager handles allocation, release, parking (for paused
 * pipelines), reattachment, and cleanup of stale worktrees.
 *
 * When all slots are full, allocate/reattach return a Promise that resolves
 * once a slot frees up via release or park.
 */
export class WorktreeManager {
  private readonly projectDir: string;
  private readonly maxSlots: number;
  private readonly worktreeBase: string;
  private readonly slots: Map<number, Slot> = new Map();
  private readonly waitQueue: QueueEntry[] = [];
  private nextSlotId = 0;

  constructor(projectDir: string, maxSlots: number) {
    this.projectDir = resolve(projectDir);
    this.maxSlots = maxSlots;
    this.worktreeBase = join(this.projectDir, ".worktrees");
  }

  /**
   * Allocate a new worktree with a branch based on origin/main.
   * If all slots are full, queues the request and resolves when a slot opens.
   */
  async allocate(branchName: string): Promise<{ slotId: number; workDir: string }> {
    if (this.getActiveSlots() >= this.maxSlots) {
      return this._enqueue(branchName, false);
    }
    return this._createWorktree(branchName);
  }

  /**
   * Reattach to an existing worktree for a previously paused pipeline.
   * Checks in-memory parked slots first, then scans disk for orphaned worktrees.
   * If all slots are full, queues the request.
   */
  async reattach(branchName: string): Promise<{ slotId: number; workDir: string }> {
    // Check in-memory parked slots
    for (const [slotId, slot] of this.slots) {
      if (slot.branchName === branchName && slot.status === "parked") {
        slot.status = "active";
        return { slotId, workDir: slot.workDir };
      }
    }

    // Scan disk for orphaned worktrees matching the branch
    const diskMatch = this._findParkedOnDisk(branchName);
    if (diskMatch) {
      if (this.getActiveSlots() >= this.maxSlots) {
        return this._enqueue(branchName, true);
      }
      const slotId = this._nextId();
      const slot: Slot = {
        slotId,
        branchName,
        workDir: diskMatch,
        status: "active",
      };
      this.slots.set(slotId, slot);
      return { slotId, workDir: diskMatch };
    }

    // No parked worktree found -- allocate a new one
    if (this.getActiveSlots() >= this.maxSlots) {
      return this._enqueue(branchName, false);
    }
    return this._createWorktree(branchName);
  }

  /**
   * Release a worktree -- removes it from disk and frees the slot.
   */
  async release(slotId: number): Promise<void> {
    const slot = this.slots.get(slotId);
    if (!slot) return;

    this._removeWorktree(slot.workDir);
    this.slots.delete(slotId);
    this._processQueue();
  }

  /**
   * Park a worktree -- keeps it on disk but frees the slot for another worker.
   * Parked worktrees don't count toward the active slot limit.
   */
  async park(slotId: number): Promise<void> {
    const slot = this.slots.get(slotId);
    if (!slot) return;

    slot.status = "parked";
    this._processQueue();
  }

  /**
   * Prune stale worktrees on startup.
   * Runs `git worktree prune`, then scans .worktrees/ for leftover dirs.
   * Skips worktrees whose branch is paused (via isTicketPaused callback).
   */
  async pruneStale(
    isTicketPaused?: (branchName: string) => Promise<boolean>,
  ): Promise<void> {
    // Let git clean up its own stale references
    this._git("worktree prune");

    if (!existsSync(this.worktreeBase)) return;

    let dirs: string[];
    try {
      dirs = readdirSync(this.worktreeBase, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return;
    }

    for (const dir of dirs) {
      const workDir = join(this.worktreeBase, dir);
      const branchName = this._detectBranch(workDir);

      // Check if this worktree belongs to a paused ticket
      if (branchName && isTicketPaused) {
        try {
          const paused = await isTicketPaused(branchName);
          if (paused) continue; // Skip -- ticket is paused, keep worktree
        } catch {
          // If the check fails, be conservative and keep it
          continue;
        }
      }

      // Check if it's tracked by an in-memory slot
      let isTracked = false;
      for (const slot of this.slots.values()) {
        if (slot.workDir === workDir) {
          isTracked = true;
          break;
        }
      }
      if (isTracked) continue;

      // Stale worktree -- remove it
      this._removeWorktree(workDir);
    }
  }

  /**
   * Returns the number of active (non-parked) slots.
   */
  getActiveSlots(): number {
    let count = 0;
    for (const slot of this.slots.values()) {
      if (slot.status === "active") count++;
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _nextId(): number {
    return this.nextSlotId++;
  }

  private _createWorktree(branchName: string): { slotId: number; workDir: string } {
    const slotId = this._nextId();
    const workDir = join(this.worktreeBase, `worker-${slotId}`);

    // Clean up stale worktree directory if it exists (e.g. from a crashed worker)
    if (existsSync(workDir)) {
      this._removeWorktree(workDir);
    }

    // Delete stale local branch if it exists (e.g. from a previous failed run)
    try {
      this._git(`rev-parse --verify refs/heads/${branchName}`);
      // Branch exists -- delete it so we can recreate from origin/main
      this._git(`branch -D "${branchName}"`);
    } catch {
      // Branch doesn't exist -- good
    }

    // Fetch latest main
    this._git("fetch origin main");

    // Create the worktree with a new branch based on origin/main
    this._git(`worktree add "${workDir}" -b "${branchName}" origin/main`);

    const slot: Slot = { slotId, branchName, workDir, status: "active" };
    this.slots.set(slotId, slot);

    return { slotId, workDir };
  }

  private _removeWorktree(workDir: string): void {
    try {
      this._git(`worktree remove "${workDir}" --force`);
    } catch {
      // Fallback: manual cleanup + prune
      try {
        if (existsSync(workDir)) {
          rmSync(workDir, { recursive: true, force: true });
        }
        this._git("worktree prune");
      } catch {
        // Best-effort cleanup -- log but don't throw
        console.warn(`[WorktreeManager] Failed to clean up worktree: ${workDir}`);
      }
    }
  }

  /**
   * Scan .worktrees/ on disk for a directory whose checked-out branch matches.
   */
  private _findParkedOnDisk(branchName: string): string | null {
    if (!existsSync(this.worktreeBase)) return null;

    let dirs: string[];
    try {
      dirs = readdirSync(this.worktreeBase, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return null;
    }

    for (const dir of dirs) {
      const workDir = join(this.worktreeBase, dir);
      const branch = this._detectBranch(workDir);
      if (branch === branchName) return workDir;
    }

    return null;
  }

  /**
   * Detect the branch name of a worktree by reading its .git/HEAD or HEAD file.
   */
  private _detectBranch(workDir: string): string | null {
    // Worktrees have a .git file (not directory) that points to the main repo
    // The HEAD is in the worktree's own directory
    const headPath = join(workDir, ".git");

    try {
      // In a worktree, .git is a file containing: "gitdir: /path/to/main/.git/worktrees/name"
      const gitContent = readFileSync(headPath, "utf-8").trim();
      const gitdirMatch = gitContent.match(/^gitdir:\s+(.+)$/);
      if (gitdirMatch) {
        const worktreeGitDir = gitdirMatch[1];
        const worktreeHead = join(worktreeGitDir, "HEAD");
        if (existsSync(worktreeHead)) {
          const headContent = readFileSync(worktreeHead, "utf-8").trim();
          const refMatch = headContent.match(/^ref:\s+refs\/heads\/(.+)$/);
          if (refMatch) return refMatch[1];
        }
      }
    } catch {
      // Not a valid worktree directory
    }

    return null;
  }

  private _enqueue(branchName: string, isResume: boolean): Promise<{ slotId: number; workDir: string }> {
    return new Promise((resolve, reject) => {
      this.waitQueue.push({ branchName, isResume, resolve, reject });
    });
  }

  /**
   * Process the wait queue when a slot becomes available.
   * For resume paths (branch already exists), requires finding a parked worktree
   * rather than creating a new one.
   */
  private _processQueue(): void {
    if (this.waitQueue.length === 0) return;
    if (this.getActiveSlots() >= this.maxSlots) return;

    const entry = this.waitQueue.shift()!;

    if (entry.isResume) {
      // Resume path: check for parked in-memory slot first
      for (const [slotId, slot] of this.slots) {
        if (slot.branchName === entry.branchName && slot.status === "parked") {
          slot.status = "active";
          entry.resolve({ slotId, workDir: slot.workDir });
          return;
        }
      }

      // Check disk for orphaned worktree
      const diskMatch = this._findParkedOnDisk(entry.branchName);
      if (diskMatch) {
        const slotId = this._nextId();
        const slot: Slot = {
          slotId,
          branchName: entry.branchName,
          workDir: diskMatch,
          status: "active",
        };
        this.slots.set(slotId, slot);
        entry.resolve({ slotId, workDir: diskMatch });
        return;
      }

      // Safety: resume expects an existing worktree -- don't create a new one
      entry.reject(
        new Error(
          `No parked worktree found for branch "${entry.branchName}". ` +
          `Cannot resume without an existing worktree.`,
        ),
      );
      // Try next entry in queue since we didn't consume a slot
      this._processQueue();
      return;
    }

    // Normal allocate path
    try {
      const result = this._createWorktree(entry.branchName);
      entry.resolve(result);
    } catch (err) {
      entry.reject(err instanceof Error ? err : new Error(String(err)));
      // Slot wasn't consumed, try next
      this._processQueue();
    }
  }

  private _git(command: string): string {
    return execSync(`git ${command}`, {
      cwd: this.projectDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  }
}
