# Parallel Workers & Automated QA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable parallel ticket processing via git worktrees and automated QA with Playwright against Vercel Preview Deployments.

**Architecture:** WorktreeManager handles worktree lifecycle. worker.ts spawns N parallel flows (each in its own worktree). run.ts receives a workDir instead of doing git checkout. After the orchestrator creates a PR, a new QA phase runs Playwright tests (or lighter checks) and posts a report as PR comment. Fix loops auto-correct failures up to 3 times.

**Tech Stack:** TypeScript (Node.js), Claude Agent SDK, Playwright, Vercel API, GitHub CLI (`gh`)

**Spec:** `docs/superpowers/specs/2026-03-23-parallel-workers-automated-qa-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `pipeline/lib/worktree-manager.ts` | WorktreeManager class: allocate, release, park, reattach, pruneStale |
| Create | `pipeline/lib/qa-runner.ts` | QA phase: tier-based QA execution, Playwright scripts, report generation, screenshot upload |
| Create | `pipeline/lib/qa-fix-loop.ts` | Fix loop orchestration: re-run QA up to 3 times, commit fixes, post final report |
| Create | `pipeline/lib/vercel-preview.ts` | Poll Vercel API for preview deployment readiness |
| Modify | `pipeline/lib/config.ts` | Extend ProjectConfig with `max_workers` and `qa` config fields |
| Modify | `pipeline/run.ts` | Accept `workDir`, remove git checkout, add QA phase (Phase 3), extend TriageResult |
| Modify | `pipeline/worker.ts` | Worker pool with concurrency, worktree lifecycle, per-slot failure tracking, crash recovery |
| Modify | `pipeline/server.ts` | Use shared WorktreeManager for launch and resume paths |
| Modify | `agents/triage.md` | Add QA-tiering to triage prompt and output format |
| Modify | `templates/project.json` | Add `pipeline.max_workers` and `pipeline.qa` fields |
| Modify | `vps/just-ship-pipeline@.service` | Increase MemoryMax to 12G |

---

## Task 1: WorktreeManager

**Files:**
- Create: `pipeline/lib/worktree-manager.ts`

- [ ] **Step 1: Write WorktreeManager class**

```typescript
// pipeline/lib/worktree-manager.ts
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

interface SlotInfo {
  slotId: number;
  workDir: string;
  branchName: string;
  status: "active" | "parked";
}

interface AllocateResult {
  slotId: number;
  workDir: string;
}

export class WorktreeManager {
  private projectDir: string;
  private maxSlots: number;
  private worktreeBase: string;
  private slots: Map<number, SlotInfo> = new Map();
  private waitQueue: Array<{
    resolve: (result: AllocateResult) => void;
    branchName: string;
  }> = [];

  constructor(projectDir: string, maxSlots: number) {
    this.projectDir = projectDir;
    this.maxSlots = maxSlots;
    this.worktreeBase = resolve(projectDir, ".worktrees");
    mkdirSync(this.worktreeBase, { recursive: true });
  }

  getActiveSlots(): number {
    let active = 0;
    for (const slot of this.slots.values()) {
      if (slot.status === "active") active++;
    }
    return active;
  }

  async allocate(branchName: string): Promise<AllocateResult> {
    // Find a free slot ID
    if (this.getActiveSlots() >= this.maxSlots) {
      // Queue and wait
      return new Promise((resolve) => {
        this.waitQueue.push({ resolve, branchName });
      });
    }

    return this._createWorktree(branchName);
  }

  private _createWorktree(branchName: string): AllocateResult {
    const slotId = this._nextSlotId();
    const workDir = join(this.worktreeBase, `worker-${slotId}`);

    // Ensure main is up-to-date before branching
    try {
      execSync("git fetch origin main", {
        cwd: this.projectDir,
        stdio: "pipe",
      });
    } catch {
      /* offline or no remote — continue */
    }

    // Create worktree with new branch based on origin/main
    execSync(
      `git worktree add "${workDir}" -b "${branchName}" origin/main`,
      { cwd: this.projectDir, stdio: "pipe" }
    );

    this.slots.set(slotId, {
      slotId,
      workDir,
      branchName,
      status: "active",
    });

    return { slotId, workDir };
  }

  private _nextSlotId(): number {
    for (let i = 1; i <= this.maxSlots + 10; i++) {
      if (!this.slots.has(i)) return i;
    }
    return this.slots.size + 1;
  }

  async release(slotId: number): Promise<void> {
    const slot = this.slots.get(slotId);
    if (!slot) return;

    // Remove worktree
    try {
      execSync(`git worktree remove "${slot.workDir}" --force`, {
        cwd: this.projectDir,
        stdio: "pipe",
      });
    } catch {
      // Force cleanup if worktree remove fails
      if (existsSync(slot.workDir)) {
        rmSync(slot.workDir, { recursive: true, force: true });
      }
      try {
        execSync("git worktree prune", {
          cwd: this.projectDir,
          stdio: "pipe",
        });
      } catch {
        /* best effort */
      }
    }

    this.slots.delete(slotId);

    // Process wait queue
    this._processQueue();
  }

  async park(slotId: number): Promise<void> {
    const slot = this.slots.get(slotId);
    if (!slot) return;
    slot.status = "parked";

    // Process wait queue — parked slots don't count as active
    this._processQueue();
  }

  async reattach(branchName: string): Promise<AllocateResult> {
    // Find parked worktree for this branch
    for (const [slotId, slot] of this.slots.entries()) {
      if (slot.branchName === branchName && slot.status === "parked") {
        if (this.getActiveSlots() >= this.maxSlots) {
          // Queue and wait
          return new Promise((resolve) => {
            this.waitQueue.push({ resolve, branchName });
          });
        }
        slot.status = "active";
        return { slotId, workDir: slot.workDir };
      }
    }

    // No parked worktree found — scan disk for orphaned worktrees
    const dirs = existsSync(this.worktreeBase)
      ? readdirSync(this.worktreeBase, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
      : [];

    for (const dir of dirs) {
      const dirPath = join(this.worktreeBase, dir);
      try {
        const branch = execSync("git rev-parse --abbrev-ref HEAD", {
          cwd: dirPath,
          encoding: "utf-8",
        }).trim();
        if (branch === branchName) {
          // Found it on disk — register and reattach
          if (this.getActiveSlots() >= this.maxSlots) {
            return new Promise((resolve) => {
              this.waitQueue.push({ resolve, branchName });
            });
          }
          const slotId = this._nextSlotId();
          this.slots.set(slotId, {
            slotId,
            workDir: dirPath,
            branchName,
            status: "active",
          });
          return { slotId, workDir: dirPath };
        }
      } catch {
        /* not a valid worktree */
      }
    }

    throw new Error(
      `No parked worktree found for branch "${branchName}". Cannot resume.`
    );
  }

  async pruneStale(
    isTicketPaused?: (branchName: string) => Promise<boolean>
  ): Promise<void> {
    // 1. Run git worktree prune to clean broken refs
    try {
      execSync("git worktree prune", {
        cwd: this.projectDir,
        stdio: "pipe",
      });
    } catch {
      /* best effort */
    }

    // 2. Scan .worktrees/ for leftover directories
    if (!existsSync(this.worktreeBase)) return;

    const dirs = readdirSync(this.worktreeBase, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const dir of dirs) {
      const dirPath = join(this.worktreeBase, dir);

      // Check branch name
      let branch = "";
      try {
        branch = execSync("git rev-parse --abbrev-ref HEAD", {
          cwd: dirPath,
          encoding: "utf-8",
        }).trim();
      } catch {
        // Not a valid git dir — remove
        rmSync(dirPath, { recursive: true, force: true });
        continue;
      }

      // Check if ticket is paused (keep parked worktrees)
      if (isTicketPaused) {
        const paused = await isTicketPaused(branch);
        if (paused) {
          // Register as parked slot
          const slotId = this._nextSlotId();
          this.slots.set(slotId, {
            slotId,
            workDir: dirPath,
            branchName: branch,
            status: "parked",
          });
          continue;
        }
      }

      // Not paused — remove stale worktree
      try {
        execSync(`git worktree remove "${dirPath}" --force`, {
          cwd: this.projectDir,
          stdio: "pipe",
        });
      } catch {
        rmSync(dirPath, { recursive: true, force: true });
      }
    }

    // Final prune
    try {
      execSync("git worktree prune", {
        cwd: this.projectDir,
        stdio: "pipe",
      });
    } catch {
      /* best effort */
    }
  }

  private _processQueue(): void {
    while (this.waitQueue.length > 0 && this.getActiveSlots() < this.maxSlots) {
      const next = this.waitQueue.shift()!;

      // Check if there's a parked worktree for this branch
      let found = false;
      for (const slot of this.slots.values()) {
        if (slot.branchName === next.branchName && slot.status === "parked") {
          slot.status = "active";
          next.resolve({ slotId: slot.slotId, workDir: slot.workDir });
          found = true;
          break;
        }
      }

      if (!found) {
        // For resume paths: if no parked worktree exists, the worktree was cleaned up.
        // Throw rather than create a new one — the branch already exists and resume needs the old session.
        try {
          const result = this._createWorktree(next.branchName);
          next.resolve(result);
        } catch (error) {
          // Branch already exists (resume case) — cannot create new worktree
          // Re-queue and let the caller handle the error
          throw new Error(`Cannot create worktree for "${next.branchName}": ${error instanceof Error ? error.message : "unknown"}`);
        }
      }
    }
  }
}
```

- [ ] **Step 2: Verify file compiles**

Run: `npx tsx --eval "import './pipeline/lib/worktree-manager.ts'"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add pipeline/lib/worktree-manager.ts
git commit -m "feat: add WorktreeManager for parallel worker isolation"
```

---

## Task 2: Extend config with max_workers and QA settings

**Files:**
- Modify: `pipeline/lib/config.ts:5-18`
- Modify: `templates/project.json`

- [ ] **Step 1: Extend ProjectConfig interface and parsing**

In `pipeline/lib/config.ts`, add QA config to `PipelineConfig` and `ProjectConfig`:

```typescript
// Add after PipelineConfig interface (line 11)
export interface QaConfig {
  maxFixIterations: number;
  playwrightTimeoutMs: number;
  previewProvider: "vercel" | "none";
  vercelProjectId: string;
  vercelTeamId: string;
  vercelPreviewPollIntervalMs: number;
  vercelPreviewMaxWaitMs: number;
}

// Extend ProjectConfig (add after pipeline field)
export interface ProjectConfig {
  name: string;
  description: string;
  conventions: { branch_prefix: string };
  pipeline: PipelineConfig;
  maxWorkers: number;
  qa: QaConfig;
  stack: { packageManager: string };
}
```

In the `loadProjectConfig` function, parse these new fields from `project.json`:

```typescript
// After the existing return statement (line 126), add maxWorkers, qa, stack parsing:
const rawQa = rawPipeline.qa ?? {};
const qa: QaConfig = {
  maxFixIterations: Number(rawQa.max_fix_iterations ?? 3),
  playwrightTimeoutMs: Number(rawQa.playwright_timeout_ms ?? 60000),
  previewProvider: (rawQa.preview_provider as "vercel" | "none") ?? "none",
  vercelProjectId: (rawQa.vercel_project_id as string) ?? "",
  vercelTeamId: (rawQa.vercel_team_id as string) ?? "",
  vercelPreviewPollIntervalMs: Number(rawQa.vercel_preview_poll_interval_ms ?? 10000),
  vercelPreviewMaxWaitMs: Number(rawQa.vercel_preview_max_wait_ms ?? 300000),
};

return {
  name: raw.name ?? "project",
  description: raw.description ?? "",
  conventions: { branch_prefix: raw.conventions?.branch_prefix ?? "feature/" },
  pipeline,
  maxWorkers: Number(rawPipeline.max_workers ?? 1),
  qa,
  stack: { packageManager: raw.stack?.package_manager ?? "npm" },
};
```

- [ ] **Step 2: Update templates/project.json**

Add `max_workers` and `qa` to the pipeline section:

```json
{
  "pipeline": {
    "workspace": "",
    "project_id": "",
    "project_name": null,
    "max_workers": 1,
    "qa": {
      "max_fix_iterations": 3,
      "playwright_timeout_ms": 60000,
      "preview_provider": "none",
      "vercel_project_id": "",
      "vercel_team_id": "",
      "vercel_preview_poll_interval_ms": 10000,
      "vercel_preview_max_wait_ms": 300000
    }
  }
}
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsx --eval "import { loadProjectConfig } from './pipeline/lib/config.ts'; console.log(JSON.stringify(loadProjectConfig('.'), null, 2))"`
Expected: Output includes `maxWorkers`, `qa`, and `stack` fields with defaults

- [ ] **Step 4: Commit**

```bash
git add pipeline/lib/config.ts templates/project.json
git commit -m "feat: extend config with max_workers, QA settings, and stack info"
```

---

## Task 3: Extend triage agent with QA-tiering

**Files:**
- Modify: `agents/triage.md`
- Modify: `pipeline/run.ts:26-30` (TriageResult interface)
- Modify: `pipeline/run.ts:79-91` (triage JSON parsing)

- [ ] **Step 1: Extend TriageResult interface**

In `pipeline/run.ts`, update the `TriageResult` interface (line 26):

```typescript
interface TriageResult {
  description: string;
  verdict: string;
  analysis: string;
  qaTier: "full" | "light" | "skip";
  qaPages: string[];
  qaFlows: string[];
}
```

- [ ] **Step 2: Update triage result parsing**

In `pipeline/run.ts`, update the JSON parsing block (around line 79-91) to extract QA fields:

```typescript
if (jsonMatch) {
  const parsed = JSON.parse(jsonMatch[0]);
  result.verdict = parsed.verdict ?? "sufficient";
  result.analysis = parsed.analysis ?? "";
  result.qaTier = parsed.qa_tier ?? "light";
  result.qaPages = Array.isArray(parsed.qa_pages) ? parsed.qa_pages : [];
  result.qaFlows = Array.isArray(parsed.qa_flows) ? parsed.qa_flows : [];

  if (parsed.verdict === "enriched" && parsed.enriched_body) {
    result.description = parsed.enriched_body;
    console.error(`[Triage] Enriched — ${result.analysis}`);
  } else {
    console.error(`[Triage] Sufficient — ${result.analysis}`);
  }
  console.error(`[Triage] QA tier: ${result.qaTier}`);
}
```

Also update the initial `result` object (around line 51):

```typescript
const result: TriageResult = {
  description: ticket.description,
  verdict: "sufficient",
  analysis: "",
  qaTier: "light",
  qaPages: [],
  qaFlows: [],
};
```

- [ ] **Step 3: Update triage agent prompt**

In `agents/triage.md`, add QA-tiering section before the `## Regeln` section:

```markdown
## QA-Tiering

Zusätzlich zur Qualitätsprüfung bestimmst du das QA-Level für das Ticket:

| Tier | Wann | Beispiele |
|------|------|-----------|
| **full** | UI-sichtbare Änderungen, neue Features, große Refactors | Neuer Button, Layout-Änderung, neue Seite |
| **light** | Bug-Fixes, kleine Improvements, Backend-only | API-Fix, Typo-Korrektur, Performance-Verbesserung |
| **skip** | Docs, Chore, Config, CI/CD | README-Update, Dependency-Update, .env-Änderung |

Bei **full** musst du zusätzlich angeben:
- `qa_pages`: Welche Seiten/Routes betroffen sind (z.B. `["/dashboard", "/settings"]`)
- `qa_flows`: Klick-Flows aus den Acceptance Criteria (z.B. `["Button 'Speichern' klicken → Toast erscheint"]`)
```

Update the output format JSON examples to include QA fields:

```json
{
  "verdict": "sufficient",
  "analysis": "1-3 Sätze zur Bewertung",
  "qa_tier": "light",
  "qa_pages": [],
  "qa_flows": []
}
```

And for full tier:

```json
{
  "verdict": "enriched",
  "analysis": "1-3 Sätze zur Bewertung",
  "enriched_body": "...",
  "qa_tier": "full",
  "qa_pages": ["/dashboard", "/settings"],
  "qa_flows": ["Settings-Button klicken → Modal öffnet sich"]
}
```

- [ ] **Step 4: Verify compilation**

Run: `npx tsx --eval "import { executePipeline } from './pipeline/run.ts'; console.log('OK')"`
Expected: No compilation errors

- [ ] **Step 5: Commit**

```bash
git add pipeline/run.ts agents/triage.md
git commit -m "feat: extend triage agent with QA-tiering (full/light/skip)"
```

---

## Task 4: Refactor run.ts — accept workDir, remove git checkout

**Files:**
- Modify: `pipeline/run.ts:9-14` (PipelineOptions)
- Modify: `pipeline/run.ts:106-131` (executePipeline — git checkout block)
- Modify: `pipeline/run.ts:214-217` (SDK query cwd)
- Modify: `pipeline/run.ts:293-307` (resumePipeline — git checkout block)
- Modify: `pipeline/run.ts:355-358` (resumePipeline SDK query cwd)

- [ ] **Step 1: Add workDir to PipelineOptions**

In `pipeline/run.ts`, extend the `PipelineOptions` interface (line 9):

```typescript
export interface PipelineOptions {
  projectDir: string;
  workDir?: string;      // Worktree directory — if set, skip git checkout and use this as cwd
  branchName?: string;   // Pre-computed branch name — if set, skip slug generation
  ticket: TicketArgs;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}
```

**Important:** When `workDir` is set, `branchName` MUST also be set. The branch name is computed once in `worker.ts`/`server.ts` and passed through — `run.ts` no longer derives it independently. This eliminates the risk of mismatches between the worktree's branch and the branch name `run.ts` returns.

- [ ] **Step 2: Replace git checkout with workDir in executePipeline**

In `executePipeline` (around line 106), replace the git checkout block (lines 113-130) with:

```typescript
// Branch name: use pre-computed value if provided, otherwise derive (CLI mode)
let branchName: string;
if (opts.branchName) {
  branchName = opts.branchName;
} else {
  const branchSlug = ticket.title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
  branchName = `${config.conventions.branch_prefix}${ticket.ticketId}-${branchSlug}`;
}

// workDir: use provided worktree directory, or fall back to projectDir (CLI mode)
const workDir = opts.workDir ?? projectDir;

if (!opts.workDir) {
  // CLI mode — no worktree manager, do git checkout as before
  try {
    execSync("git checkout main", { cwd: projectDir, stdio: "pipe" });
    execSync("git pull origin main", { cwd: projectDir, stdio: "pipe" });
  } catch { /* continue */ }

  try {
    execSync(`git checkout -b ${branchName}`, { cwd: projectDir, stdio: "pipe" });
  } catch {
    execSync(`git checkout ${branchName}`, { cwd: projectDir, stdio: "pipe" });
  }
}
// When workDir is set (worker/server mode), branch is already checked out by WorktreeManager
```

- [ ] **Step 3: Update all `cwd: projectDir` references to use `workDir`**

There are several places in `executePipeline` that pass `cwd: projectDir` to the SDK. Update all of them:

1. Triage call (line 59): `cwd: projectDir` → `cwd: workDir`
   Note: Also update the `runTriage` function signature to accept `workDir` instead of always using `projectDir`.

2. Orchestrator query (line 217): `cwd: projectDir` → `cwd: workDir`

3. Config loading (line 108): Keep `loadProjectConfig(projectDir)` — config reads `project.json` which is in the worktree too, but `projectDir` is fine since it's the canonical source. For agent loading and orchestrator prompt, use `workDir` since Claude Code needs to find `.claude/agents/` relative to the working directory:

```typescript
// Line 133-134: change to use workDir
const agents = loadAgents(workDir);
const orchestratorPrompt = loadOrchestratorPrompt(workDir);
```

Also update the triage prompt loading:
```typescript
// Line 149: change to use workDir
const triagePrompt = loadTriagePrompt(workDir);
```

Update `runTriage` to accept and use `workDir`:
```typescript
async function runTriage(
  workDir: string,    // changed from projectDir
  ticket: TicketArgs,
  triagePrompt: string,
  eventConfig: EventConfig,
  hasPipeline: boolean,
): Promise<TriageResult> {
  // ... same code but cwd: workDir in the query call (line 59)
}
```

- [ ] **Step 4: Do the same for resumePipeline**

Add `workDir` to `ResumeOptions`:

```typescript
export interface ResumeOptions {
  projectDir: string;
  workDir?: string;
  ticket: TicketArgs;
  sessionId: string;
  answer: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}
```

Replace the git checkout block in `resumePipeline` (lines 305-307):

```typescript
const workDir = opts.workDir ?? projectDir;

if (!opts.workDir) {
  try {
    execSync(`git checkout ${branchName}`, { cwd: projectDir, stdio: "pipe" });
  } catch { /* branch may already be checked out */ }
}
```

Update `cwd: projectDir` → `cwd: workDir` in the resume SDK query call (line 358).

- [ ] **Step 5: Verify compilation and CLI still works**

Run: `npx tsx --eval "import { executePipeline, resumePipeline } from './pipeline/run.ts'; console.log('OK')"`
Expected: No errors. CLI mode (no workDir) falls back to old git checkout behavior.

- [ ] **Step 6: Commit**

```bash
git add pipeline/run.ts
git commit -m "feat: run.ts accepts workDir for worktree-based execution"
```

---

## Task 5: Refactor worker.ts — parallel worker pool

**Files:**
- Modify: `pipeline/worker.ts` (major refactor)

- [ ] **Step 1: Add WorktreeManager import and concurrency setup**

At the top of `worker.ts`, add:

```typescript
import { WorktreeManager } from "./lib/worktree-manager.ts";
import { loadProjectConfig } from "./lib/config.ts";
```

After environment validation, add:

```typescript
const config = loadProjectConfig(PROJECT_DIR);
const MAX_WORKERS = config.maxWorkers;
const worktreeManager = new WorktreeManager(PROJECT_DIR, MAX_WORKERS);
```

- [ ] **Step 2: Add crash recovery on startup**

Before the main loop, add stale worktree cleanup:

```typescript
// --- Crash recovery: clean stale worktrees and reset stuck tickets ---
log("Cleaning stale worktrees...");
await worktreeManager.pruneStale(async (branchName) => {
  // Check if ticket is paused — extract ticket number from branch name
  const match = branchName.match(/(\d+)/);
  if (!match) return false;
  const ticketNumber = match[1];
  const tickets = await supabaseGet<Array<{ pipeline_status: string }>>(
    `/rest/v1/tickets?number=eq.${ticketNumber}&project_id=eq.${SUPABASE_PROJECT_ID}&select=pipeline_status`
  );
  return tickets?.[0]?.pipeline_status === "paused";
});

// Reset stuck running tickets back to ready_to_develop
await supabasePatch(
  `/rest/v1/tickets?pipeline_status=eq.running&project_id=eq.${SUPABASE_PROJECT_ID}`,
  { pipeline_status: null, status: "ready_to_develop" }
);
log("Cleanup done.");
```

- [ ] **Step 3: Replace sequential main loop with parallel worker pool**

Replace the entire `while (running)` loop (lines 183-235) with:

```typescript
// --- Per-slot failure tracking ---
const slotFailures = new Map<number, number>();

async function runWorkerSlot(ticket: Ticket): Promise<void> {
  // Ticket is already claimed — allocate worktree and run pipeline
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

    // 5. Install dependencies in worktree
    const installCmd = config.stack.packageManager === "pnpm" ? "pnpm install --frozen-lockfile"
      : config.stack.packageManager === "yarn" ? "yarn install --frozen-lockfile"
      : config.stack.packageManager === "bun" ? "bun install --frozen-lockfile"
      : "npm ci";
    try {
      execSync(installCmd, { cwd: slot.workDir, stdio: "pipe", timeout: 120_000 });
    } catch (e) {
      log(`WARN: Install failed in worktree (${e instanceof Error ? e.message : "unknown"}), continuing...`);
    }

    // 6. Run pipeline
    log(`Starting pipeline: T-${ticket.number} — ${ticket.title} (slot ${slotId})`);

    const result = await executePipeline({
      projectDir: PROJECT_DIR,
      workDir: slot.workDir,
      branchName,  // Pass pre-computed branch name — run.ts won't re-derive it
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

    // Reset slot failure counter on success
    if (slotId !== undefined) slotFailures.delete(slotId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    log(`Pipeline failed: T-${ticket.number} (${reason})`);
    await failTicket(ticket.number, `Pipeline error: ${reason}`);

    // Per-slot failure tracking
    if (slotId !== undefined) {
      const count = (slotFailures.get(slotId) ?? 0) + 1;
      slotFailures.set(slotId, count);
    }
  } finally {
    // Release worktree (unless parked)
    if (slotId !== undefined) {
      await worktreeManager.release(slotId);
    }
  }
}

// --- Main loop: fetch tickets sequentially, then run pipelines in parallel ---
while (running) {
  const activeSlots = worktreeManager.getActiveSlots();
  const availableSlots = MAX_WORKERS - activeSlots;

  if (availableSlots > 0) {
    // Fetch and claim tickets SEQUENTIALLY to avoid race conditions
    // (multiple workers fetching the same ticket from limit=1 query)
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
```

- [ ] **Step 4: Add execSync import if not already present**

Ensure `import { execSync } from "node:child_process"` is at the top.

- [ ] **Step 5: Update banner to show max_workers**

```typescript
log(`  Max Workers: ${MAX_WORKERS}`);
```

- [ ] **Step 6: Verify compilation**

Run: `npx tsx --eval "import './pipeline/worker.ts'" 2>&1 | head -5`
Expected: Environment validation errors (expected since env vars aren't set), but no TypeScript errors

- [ ] **Step 7: Commit**

```bash
git add pipeline/worker.ts
git commit -m "feat: parallel worker pool with worktree isolation and crash recovery"
```

---

## Task 6: Refactor server.ts — shared WorktreeManager

**Files:**
- Modify: `pipeline/server.ts`

- [ ] **Step 1: Add WorktreeManager to server.ts**

At the top of `server.ts`, import and instantiate:

```typescript
import { WorktreeManager } from "./lib/worktree-manager.ts";

// After config loading:
const MAX_WORKERS = config.maxWorkers;
const worktreeManager = new WorktreeManager(PROJECT_DIR, MAX_WORKERS);
```

- [ ] **Step 2: Update handleLaunch to use worktrees**

In `handleLaunch` (line 88), the current pattern is fire-and-forget: `sendJson(202)` first, then `executePipeline().then().catch().finally()`. **Keep this pattern** — the worktree allocation and release happen inside the fire-and-forget chain, not in the request handler:

```typescript
// After sendJson(res, 202, ...) — replace the existing executePipeline().then() chain:

const branchSlug = title.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40);
const branchName = `${config.conventions.branch_prefix}${ticketNumber}-${branchSlug}`;

// Fire-and-forget: allocate worktree, run pipeline, release on completion
(async () => {
  let slotId: number | undefined;
  try {
    const slot = await worktreeManager.allocate(branchName);
    slotId = slot.slotId;

    const result = await executePipeline({
      projectDir: PROJECT_DIR,
      workDir: slot.workDir,
      branchName,
      ticket: { ticketId: String(ticketNumber), title, description: body, labels: tags },
    });

    if (result.status === "completed") {
      log(`Pipeline completed: T-${ticketNumber} -> ${result.branch}`);
      await patchTicket(ticketNumber, { pipeline_status: "done", status: "in_review", branch: result.branch });
    } else if (result.status === "paused") {
      log(`Pipeline paused: T-${ticketNumber}`);
      await patchTicket(ticketNumber, { pipeline_status: "paused", session_id: result.sessionId });
      await worktreeManager.park(slotId);
      slotId = undefined;  // Don't release — it's parked
    } else {
      const reason = result.failureReason ?? `exited with code ${result.exitCode}`;
      log(`Pipeline failed: T-${ticketNumber} (${reason})`);
      await patchTicket(ticketNumber, { pipeline_status: "failed", status: "ready_to_develop", summary: `Pipeline error: ${reason}` });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    log(`Pipeline crashed: T-${ticketNumber} -- ${reason}`);
    await patchTicket(ticketNumber, { pipeline_status: "failed", status: "ready_to_develop", summary: `Server error: ${reason}` });
  } finally {
    if (slotId !== undefined) await worktreeManager.release(slotId);
    runningTickets.delete(ticketNumber);
  }
})();
```

**Key:** The `async IIFE` preserves the fire-and-forget pattern. The HTTP handler responds 202 immediately, the pipeline runs in background.

- [ ] **Step 3: Update /api/answer to use worktree reattach**

In the `/api/answer` handler, replace the `resumePipeline().then()` chain with a fire-and-forget async IIFE that uses `worktreeManager.reattach`:

```typescript
// After sendJson(res, 202, { status: "resuming", ... }) — replace the existing chain:

const branchSlug = title.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40);
const branchName = `${config.conventions.branch_prefix}${ticketNumber}-${branchSlug}`;

(async () => {
  let slotId: number | undefined;
  try {
    const slot = await worktreeManager.reattach(branchName);
    slotId = slot.slotId;

    const result = await resumePipeline({
      projectDir: PROJECT_DIR,
      workDir: slot.workDir,
      branchName,
      ticket: { ticketId: String(ticketNumber), title, description: ticketBody, labels: tags },
      sessionId,
      answer: answer.trim(),
    });

    if (result.status === "paused") {
      await patchTicket(ticketNumber, { pipeline_status: "paused", session_id: result.sessionId });
      await worktreeManager.park(slotId);
      slotId = undefined;
    } else if (result.status === "completed") {
      await patchTicket(ticketNumber, { pipeline_status: "done", status: "in_review", branch: result.branch, session_id: null });
    } else {
      const reason = result.failureReason ?? `exited with code ${result.exitCode}`;
      await patchTicket(ticketNumber, { pipeline_status: "failed", status: "ready_to_develop", summary: `Pipeline error: ${reason}`, session_id: null });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    log(`Pipeline resume crashed: T-${ticketNumber} -- ${reason}`);
    await patchTicket(ticketNumber, { pipeline_status: "failed", status: "ready_to_develop", summary: `Resume error: ${reason}`, session_id: null });
  } finally {
    if (slotId !== undefined) await worktreeManager.release(slotId);
    runningTickets.delete(ticketNumber);
  }
})();
```

- [ ] **Step 4: Add active slots to health endpoint**

Update the `/health` endpoint to include worktree info:

```typescript
sendJson(res, 200, {
  status: "ok",
  running_count: runningTickets.size,
  active_slots: worktreeManager.getActiveSlots(),
  max_workers: MAX_WORKERS,
});
```

- [ ] **Step 5: Verify compilation**

Run: `npx tsx --eval "import './pipeline/server.ts'" 2>&1 | head -5`
Expected: Environment validation errors (expected), no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add pipeline/server.ts
git commit -m "feat: server.ts uses shared WorktreeManager for launch and resume"
```

---

## Task 7: Vercel Preview URL poller

**Files:**
- Create: `pipeline/lib/vercel-preview.ts`

- [ ] **Step 1: Write Vercel preview poller**

```typescript
// pipeline/lib/vercel-preview.ts
import type { QaConfig } from "./config.ts";

interface VercelDeployment {
  url: string;
  readyState: string;
  meta?: { githubCommitRef?: string };
}

export async function waitForVercelPreview(
  branchName: string,
  qaConfig: QaConfig,
): Promise<string | null> {
  if (qaConfig.previewProvider !== "vercel" || !qaConfig.vercelProjectId) {
    return null;
  }

  const vercelToken = process.env.VERCEL_TOKEN;
  if (!vercelToken) {
    console.error("[QA] VERCEL_TOKEN not set — skipping preview wait");
    return null;
  }

  const startTime = Date.now();
  const maxWait = qaConfig.vercelPreviewMaxWaitMs;
  const pollInterval = qaConfig.vercelPreviewPollIntervalMs;

  const teamParam = qaConfig.vercelTeamId ? `&teamId=${qaConfig.vercelTeamId}` : "";

  while (Date.now() - startTime < maxWait) {
    try {
      const res = await fetch(
        `https://api.vercel.com/v6/deployments?projectId=${qaConfig.vercelProjectId}${teamParam}&limit=5`,
        {
          headers: { Authorization: `Bearer ${vercelToken}` },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!res.ok) {
        console.error(`[QA] Vercel API error: ${res.status}`);
        await sleep(pollInterval);
        continue;
      }

      const data = (await res.json()) as { deployments: VercelDeployment[] };
      const deployment = data.deployments.find(
        (d) => d.meta?.githubCommitRef === branchName
      );

      if (deployment?.readyState === "READY") {
        const previewUrl = `https://${deployment.url}`;
        console.error(`[QA] Preview ready: ${previewUrl}`);
        return previewUrl;
      }

      if (deployment?.readyState === "ERROR") {
        console.error("[QA] Vercel deployment failed");
        return null;
      }
    } catch (error) {
      console.error(`[QA] Vercel poll error: ${error instanceof Error ? error.message : "unknown"}`);
    }

    await sleep(pollInterval);
  }

  console.error(`[QA] Vercel preview timed out after ${maxWait / 1000}s`);
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsx --eval "import './pipeline/lib/vercel-preview.ts'"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add pipeline/lib/vercel-preview.ts
git commit -m "feat: add Vercel preview URL poller for QA pipeline"
```

---

## Task 8: QA Runner — tier-based execution, screenshots, and report

**Files:**
- Create: `pipeline/lib/qa-runner.ts`

- [ ] **Step 1: Write the QA runner**

This file handles: tier-based QA dispatch, Playwright smoke tests, screenshot capture and upload, report generation and posting. Fix loops are in a separate file (Task 8b).

The key design decisions:
- **Functional checks are explicitly marked as stubs** — they always pass in v1. Real functional check generation (Claude writes Playwright scripts from natural-language flows) is deferred to a follow-up. The smoke tests (navigation, console errors) provide the core value.
- **Screenshots are uploaded to the PR** via `gh` CLI (GitHub attaches images in comment body when you use the issue-comment API with markdown image syntax). Screenshots are saved to a temp dir and referenced in the report.
- **`qa:skipped` label** is assigned for skip-tier tickets (separate from `qa:passed`/`qa:needs-review`).

```typescript
// pipeline/lib/qa-runner.ts
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { QaConfig } from "./config.ts";
import { waitForVercelPreview } from "./vercel-preview.ts";

export interface QaContext {
  workDir: string;
  branchName: string;
  ticketId: string;
  qaTier: "full" | "light" | "skip";
  qaPages: string[];
  qaFlows: string[];
  qaConfig: QaConfig;
  packageManager: string;
}

export interface QaCheckResult {
  name: string;
  passed: boolean;
  details: string;
  blocking: boolean;  // false = best-effort (functional checks)
}

export interface QaReport {
  tier: string;
  status: "passed" | "failed";
  previewUrl: string | null;
  checks: QaCheckResult[];
  screenshotMarkdown: string[];  // Markdown image references for PR comment
  fixHistory: string[];
}

// --- Build check ---
export function runBuildCheck(workDir: string, packageManager: string): QaCheckResult {
  const buildCmd = packageManager === "pnpm" ? "pnpm run build"
    : packageManager === "yarn" ? "yarn build"
    : packageManager === "bun" ? "bun run build"
    : "npm run build";

  try {
    execSync(buildCmd, { cwd: workDir, stdio: "pipe", timeout: 120_000 });
    return { name: "Build", passed: true, details: "Build successful", blocking: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return { name: "Build", passed: false, details: `Build failed: ${msg.slice(0, 500)}`, blocking: true };
  }
}

// --- Test check ---
export function runTestCheck(workDir: string, packageManager: string): QaCheckResult | null {
  const testCmd = packageManager === "pnpm" ? "pnpm run test"
    : packageManager === "yarn" ? "yarn test"
    : packageManager === "bun" ? "bun test"
    : "npm test";

  try {
    const pkg = JSON.parse(readFileSync(`${workDir}/package.json`, "utf-8"));
    if (!pkg.scripts?.test || pkg.scripts.test === 'echo "Error: no test specified" && exit 1') {
      return null;
    }
  } catch {
    return null;
  }

  try {
    execSync(testCmd, { cwd: workDir, stdio: "pipe", timeout: 120_000 });
    return { name: "Tests", passed: true, details: "All tests passed", blocking: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return { name: "Tests", passed: false, details: `Tests failed: ${msg.slice(0, 500)}`, blocking: true };
  }
}

// --- Playwright smoke + screenshots ---
export function runPlaywrightSmoke(
  workDir: string,
  previewUrl: string,
  pages: string[],
  timeout: number,
): { checks: QaCheckResult[]; screenshotPaths: Array<{ page: string; path: string }> } {
  const checks: QaCheckResult[] = [];
  const screenshotPaths: Array<{ page: string; path: string }> = [];
  const pagesToTest = pages.length > 0 ? pages : ["/"];

  for (const page of pagesToTest) {
    const fullUrl = `${previewUrl}${page}`;
    const safePageName = page.replace(/\//g, "_").replace(/^_/, "") || "root";
    const screenshotPath = `/tmp/qa-screenshot-${safePageName}-${Date.now()}.png`;

    // Write script to temp file to avoid shell escaping issues
    const scriptPath = `/tmp/qa-smoke-${safePageName}-${Date.now()}.mjs`;
    const script = `
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const p = await context.newPage();
const errors = [];
p.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
p.on('pageerror', err => errors.push(err.message));
try {
  const res = await p.goto(${JSON.stringify(fullUrl)}, { waitUntil: 'networkidle', timeout: ${timeout} });
  await p.screenshot({ path: ${JSON.stringify(screenshotPath)}, fullPage: true });
  console.log(JSON.stringify({ status: res?.status() ?? 0, errors, url: ${JSON.stringify(fullUrl)} }));
} catch (e) {
  console.log(JSON.stringify({ status: 0, errors: [e.message], url: ${JSON.stringify(fullUrl)} }));
} finally {
  await browser.close();
}
`;

    try {
      execSync(`cat > ${scriptPath} << 'PLAYWRIGHT_EOF'\n${script}\nPLAYWRIGHT_EOF`, { stdio: "pipe" });
      const output = execSync(`node ${scriptPath}`, {
        cwd: workDir,
        encoding: "utf-8",
        timeout: timeout + 10_000,
      });
      const result = JSON.parse(output.trim());

      checks.push({
        name: `Navigation ${page}`,
        passed: result.status >= 200 && result.status < 400,
        details: `HTTP ${result.status}`,
        blocking: true,
      });

      checks.push({
        name: `Console errors ${page}`,
        passed: result.errors.length === 0,
        details: result.errors.length > 0
          ? result.errors.join("; ").slice(0, 500)
          : "No console errors",
        blocking: true,
      });

      screenshotPaths.push({ page, path: screenshotPath });
    } catch (error) {
      checks.push({
        name: `Smoke test ${page}`,
        passed: false,
        details: `Playwright error: ${(error instanceof Error ? error.message : "unknown").slice(0, 300)}`,
        blocking: true,
      });
    }
  }

  return { checks, screenshotPaths };
}

// --- Format QA report as markdown ---
export function formatReport(report: QaReport, ticketId: string): string {
  const statusText = report.status === "passed" ? "Passed" : "Failed — needs human review";
  const fixCount = report.fixHistory.length;
  const fixSuffix = fixCount > 0 ? ` (after ${fixCount} fix loop${fixCount > 1 ? "s" : ""})` : "";

  let md = `## QA Report — T-${ticketId}\n\n`;
  md += `**Tier:** ${report.tier} | **Status:** ${statusText}${fixSuffix}\n`;
  if (report.previewUrl) md += `**Preview:** ${report.previewUrl}\n`;
  md += "\n";

  // Screenshots (if any)
  if (report.screenshotMarkdown.length > 0) {
    md += "### Screenshots\n";
    for (const img of report.screenshotMarkdown) {
      md += `${img}\n\n`;
    }
  }

  // Blocking checks
  md += "### Checks\n";
  for (const check of report.checks.filter((c) => c.blocking)) {
    md += `- [${check.passed ? "x" : " "}] ${check.name}: ${check.details}\n`;
  }
  md += "\n";

  // Functional checks (best-effort)
  const functional = report.checks.filter((c) => !c.blocking);
  if (functional.length > 0) {
    md += "### Functional Checks (best-effort)\n";
    for (const check of functional) {
      md += `- [${check.passed ? "x" : " "}] ${check.name}: ${check.details}\n`;
    }
    md += "\n";
  }

  // Fix history
  if (report.fixHistory.length > 0) {
    md += "### Fix History\n";
    for (const fix of report.fixHistory) {
      md += `- ${fix}\n`;
    }
    md += "\n";
  }

  return md;
}

// --- Upload screenshots and return markdown image references ---
function uploadScreenshots(
  workDir: string,
  branchName: string,
  screenshotPaths: Array<{ page: string; path: string }>,
): string[] {
  // Upload screenshots as GitHub issue/PR comment image attachments
  // GitHub allows embedding images by dragging into comments, but via CLI
  // we commit them to the branch and reference via raw URL
  const markdownImages: string[] = [];

  for (const { page, path } of screenshotPaths) {
    try {
      // Copy screenshot into repo and commit
      const repoPath = `.qa-screenshots/${page.replace(/\//g, "_").replace(/^_/, "") || "root"}.png`;
      execSync(`mkdir -p .qa-screenshots && cp "${path}" "${repoPath}"`, { cwd: workDir, stdio: "pipe" });
      execSync(`git add "${repoPath}" && git commit -m "chore(qa): add screenshot for ${page}"`, { cwd: workDir, stdio: "pipe" });
      execSync("git push", { cwd: workDir, stdio: "pipe" });

      // Get raw GitHub URL for the image
      const remoteUrl = execSync("gh repo view --json url --jq '.url'", { cwd: workDir, encoding: "utf-8" }).trim();
      const imageUrl = `${remoteUrl}/blob/${branchName}/${repoPath}?raw=true`;
      markdownImages.push(`**${page}**\n![${page}](${imageUrl})`);
    } catch (error) {
      console.error(`[QA] Failed to upload screenshot for ${page}: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  return markdownImages;
}

// --- Post QA report as PR comment + label ---
export function postQaReport(workDir: string, branchName: string, report: QaReport, ticketId: string): void {
  const markdown = formatReport(report, ticketId);

  // Determine label based on tier and status
  let label: string;
  if (report.tier === "skip") {
    label = "qa:skipped";
  } else if (report.status === "passed") {
    label = "qa:passed";
  } else {
    label = "qa:needs-review";
  }

  try {
    const prNumber = execSync(
      `gh pr list --head "${branchName}" --json number --jq '.[0].number'`,
      { cwd: workDir, encoding: "utf-8", timeout: 15000 }
    ).trim();

    if (!prNumber) {
      console.error("[QA] No PR found — cannot post report");
      return;
    }

    // Write report to temp file to avoid shell escaping issues with large markdown
    const tmpFile = `/tmp/qa-report-${ticketId}-${Date.now()}.md`;
    execSync(`cat > ${tmpFile} << 'QA_REPORT_EOF'\n${markdown}\nQA_REPORT_EOF`, { stdio: "pipe" });
    execSync(`gh pr comment ${prNumber} --body-file "${tmpFile}"`, { cwd: workDir, stdio: "pipe", timeout: 15000 });
    execSync(`gh pr edit ${prNumber} --add-label "${label}"`, { cwd: workDir, stdio: "pipe", timeout: 15000 });

    console.error(`[QA] Report posted on PR #${prNumber} (${label})`);
  } catch (error) {
    console.error(`[QA] Failed to post report: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

// --- Main QA runner (single pass — fix loops are in qa-fix-loop.ts) ---
export async function runQa(ctx: QaContext): Promise<QaReport> {
  const report: QaReport = {
    tier: ctx.qaTier,
    status: "passed",
    previewUrl: null,
    checks: [],
    screenshotMarkdown: [],
    fixHistory: [],
  };

  // --- Skip tier ---
  if (ctx.qaTier === "skip") {
    const buildResult = runBuildCheck(ctx.workDir, ctx.packageManager);
    report.checks.push(buildResult);
    report.status = buildResult.passed ? "passed" : "failed";
    return report;
  }

  // --- Light tier ---
  if (ctx.qaTier === "light") {
    const buildResult = runBuildCheck(ctx.workDir, ctx.packageManager);
    report.checks.push(buildResult);
    const testResult = runTestCheck(ctx.workDir, ctx.packageManager);
    if (testResult) report.checks.push(testResult);
    const blockingFailed = report.checks.some((c) => c.blocking && !c.passed);
    report.status = blockingFailed ? "failed" : "passed";
    return report;
  }

  // --- Full tier ---
  const buildResult = runBuildCheck(ctx.workDir, ctx.packageManager);
  report.checks.push(buildResult);

  const testResult = runTestCheck(ctx.workDir, ctx.packageManager);
  if (testResult) report.checks.push(testResult);

  // Wait for Vercel preview
  report.previewUrl = await waitForVercelPreview(ctx.branchName, ctx.qaConfig);

  if (report.previewUrl) {
    // Playwright smoke + screenshots
    const smoke = runPlaywrightSmoke(ctx.workDir, report.previewUrl, ctx.qaPages, ctx.qaConfig.playwrightTimeoutMs);
    report.checks.push(...smoke.checks);

    // Upload screenshots and get markdown references
    if (smoke.screenshotPaths.length > 0) {
      report.screenshotMarkdown = uploadScreenshots(ctx.workDir, ctx.branchName, smoke.screenshotPaths);
    }

    // Functional checks — STUB in v1, always pass
    // TODO: In v2, use Claude to generate Playwright scripts from qa_flows
    for (const flow of ctx.qaFlows) {
      report.checks.push({
        name: `Flow: ${flow}`,
        passed: true,
        details: "Stub — not yet implemented (v2)",
        blocking: false,
      });
    }
  } else {
    console.error("[QA] No preview URL available — skipping Playwright checks");
  }

  const blockingFailed = report.checks.some((c) => c.blocking && !c.passed);
  report.status = blockingFailed ? "failed" : "passed";

  return report;
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsx --eval "import './pipeline/lib/qa-runner.ts'"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add pipeline/lib/qa-runner.ts
git commit -m "feat: add QA runner with tier-based execution, screenshots, and report"
```

---

## Task 8b: Fix Loop Orchestration

**Files:**
- Create: `pipeline/lib/qa-fix-loop.ts`

- [ ] **Step 1: Write the fix loop orchestrator**

This is the core of the autonomous QA system. After initial QA finds failures, it uses a Claude Code session to analyze and fix the issues, then re-runs QA. Max 3 iterations.

```typescript
// pipeline/lib/qa-fix-loop.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "node:child_process";
import {
  runQa,
  postQaReport,
  type QaContext,
  type QaReport,
} from "./qa-runner.ts";

export interface FixLoopResult {
  finalReport: QaReport;
  iterations: number;
}

export async function runQaWithFixLoop(ctx: QaContext): Promise<FixLoopResult> {
  const maxIterations = ctx.qaConfig.maxFixIterations;
  let report = await runQa(ctx);
  let iteration = 0;

  while (report.status === "failed" && iteration < maxIterations) {
    iteration++;
    console.error(`[QA Fix Loop] Iteration ${iteration}/${maxIterations} — attempting fix`);

    // Build a prompt describing the QA failures for Claude to fix
    const failedChecks = report.checks
      .filter((c) => c.blocking && !c.passed)
      .map((c) => `- ${c.name}: ${c.details}`)
      .join("\n");

    const fixPrompt = `The QA checks for ticket T-${ctx.ticketId} have failed. Fix the issues and push.

## Failed Checks
${failedChecks}

## Instructions
1. Read the relevant source files
2. Fix the issues causing the failures
3. Run the build to verify your fix: \`npm run build\` (or the project's build command)
4. Commit your fix with message: "fix(qa): address QA failures (attempt ${iteration})"
5. Push with: \`git push\`

Do NOT create a new branch. You are already on the correct branch.
Do NOT modify test expectations to make them pass — fix the actual code.`;

    try {
      // Run Claude to fix the issues
      for await (const message of query({
        prompt: fixPrompt,
        options: {
          cwd: ctx.workDir,
          model: "sonnet",  // Sonnet for speed — fixes should be targeted
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
          maxTurns: 30,
        },
      })) {
        // Consume messages — we just need it to finish
        if (message.type === "result") {
          const resultMsg = message as { type: "result"; subtype: string };
          if (resultMsg.subtype !== "success") {
            console.error(`[QA Fix Loop] Claude fix attempt ${iteration} ended with: ${resultMsg.subtype}`);
          }
        }
      }

      // Record the fix attempt
      const lastCommit = execSync("git log -1 --oneline", {
        cwd: ctx.workDir,
        encoding: "utf-8",
      }).trim();
      report.fixHistory.push(`**Attempt ${iteration}:** ${lastCommit}`);

      // Re-run QA
      console.error(`[QA Fix Loop] Re-running QA after fix attempt ${iteration}`);

      // For full tier with preview, wait for new Vercel deployment
      if (ctx.qaTier === "full" && ctx.qaConfig.previewProvider === "vercel") {
        // Small delay to let Vercel pick up the new push
        await new Promise((r) => setTimeout(r, 5000));
      }

      const newReport = await runQa(ctx);
      // Preserve fix history across iterations
      newReport.fixHistory = report.fixHistory;
      report = newReport;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown";
      console.error(`[QA Fix Loop] Fix attempt ${iteration} failed: ${msg}`);
      report.fixHistory.push(`**Attempt ${iteration}:** Failed — ${msg}`);
    }
  }

  if (report.status === "passed") {
    console.error(`[QA Fix Loop] QA passed after ${iteration} fix loop(s)`);
  } else if (iteration >= maxIterations) {
    console.error(`[QA Fix Loop] QA still failing after ${maxIterations} attempts — needs human review`);
  }

  // Post final report (with full fix history)
  postQaReport(ctx.workDir, ctx.branchName, report, ctx.ticketId);

  return { finalReport: report, iterations: iteration };
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsx --eval "import './pipeline/lib/qa-fix-loop.ts'"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add pipeline/lib/qa-fix-loop.ts
git commit -m "feat: add QA fix loop orchestration (max 3 auto-fix iterations)"
```

---

## Task 9: Add QA Phase to executePipeline

**Files:**
- Modify: `pipeline/run.ts` (add Phase 3 after orchestrator, before return)

- [ ] **Step 1: Import QA fix loop**

At the top of `run.ts`:

```typescript
import { runQaWithFixLoop } from "./lib/qa-fix-loop.ts";
import type { QaContext } from "./lib/qa-runner.ts";
```

- [ ] **Step 2: Pass triage result to QA phase**

After the orchestrator completes and before the return statement in `executePipeline`, store the triage result so it's accessible for QA:

The triage result is currently consumed only for `ticketDescription`. Store the full result:

```typescript
// Around line 148-153, change to:
let triageResult: TriageResult | undefined;
const triagePrompt = loadTriagePrompt(projectDir);
if (triagePrompt) {
  triageResult = await runTriage(workDir, ticket, triagePrompt, eventConfig, hasPipeline);
  ticketDescription = triageResult.description;
}
```

- [ ] **Step 3: Add QA phase after orchestrator**

After the orchestrator try/catch block (around line 259), before the final `return`, add:

```typescript
// --- Phase 3: QA with Fix Loops ---
if (exitCode === 0 && !timedOut) {
  if (hasPipeline) await postPipelineEvent(eventConfig, "agent_started", "qa");

  const qaContext: QaContext = {
    workDir,
    branchName,
    ticketId: ticket.ticketId,
    qaTier: triageResult?.qaTier ?? "light",
    qaPages: triageResult?.qaPages ?? [],
    qaFlows: triageResult?.qaFlows ?? [],
    qaConfig: config.qa,
    packageManager: config.stack.packageManager,
  };

  // runQaWithFixLoop runs QA, and if it fails, uses Claude to fix
  // and re-run QA up to maxFixIterations times (default 3)
  const { finalReport, iterations } = await runQaWithFixLoop(qaContext);
  console.error(`[QA] ${finalReport.tier} tier — ${finalReport.status} (${iterations} fix loops)`);

  if (hasPipeline) {
    await postPipelineEvent(eventConfig, "completed", "qa", {
      tier: finalReport.tier,
      status: finalReport.status,
      fix_iterations: iterations,
      checks_passed: finalReport.checks.filter((c) => c.passed).length,
      checks_total: finalReport.checks.length,
    });
  }
}
```

**Note on QA tier fallback:** If no triage prompt exists (`triageResult` is undefined), the QA tier defaults to `"light"`. This means projects without a triage agent still get build checks and tests. To override the QA tier without triage, a future enhancement could add a `pipeline.qa.default_tier` field to `project.json`.

- [ ] **Step 4: Verify compilation**

Run: `npx tsx --eval "import { executePipeline } from './pipeline/run.ts'; console.log('OK')"`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add pipeline/run.ts
git commit -m "feat: add QA phase (Phase 3) to executePipeline"
```

---

## Task 10: Update systemd service and templates

**Files:**
- Modify: `vps/just-ship-pipeline@.service:57`
- Modify: `templates/project.json`

- [ ] **Step 1: Increase MemoryMax in systemd service**

In `vps/just-ship-pipeline@.service`, change line 57:

```
MemoryMax=12G
```

- [ ] **Step 2: Add VERCEL_TOKEN to env file documentation**

Update the comment block at the top of the service file to mention `VERCEL_TOKEN`:

```
#   /home/claude-dev/.env              # Globale Keys (ANTHROPIC_API_KEY, GH_TOKEN, VERCEL_TOKEN)
```

- [ ] **Step 3: Commit**

```bash
git add vps/just-ship-pipeline@.service templates/project.json
git commit -m "chore: increase systemd MemoryMax to 12G, add VERCEL_TOKEN docs"
```

---

## Task 11: Integration test — verify end-to-end compilation

**Files:** (no new files — verification only)

- [ ] **Step 1: Verify all pipeline files compile together**

Run:
```bash
npx tsx --eval "
import './pipeline/lib/worktree-manager.ts';
import './pipeline/lib/config.ts';
import './pipeline/lib/vercel-preview.ts';
import './pipeline/lib/qa-runner.ts';
import './pipeline/run.ts';
console.log('All modules compile successfully');
"
```
Expected: "All modules compile successfully"

- [ ] **Step 2: Verify worker.ts and server.ts compile**

Run:
```bash
npx tsx --eval "console.log('worker.ts:'); import './pipeline/worker.ts';" 2>&1 | head -3
npx tsx --eval "console.log('server.ts:'); import './pipeline/server.ts';" 2>&1 | head -3
```
Expected: Environment validation errors (no env vars set), but no TypeScript/import errors

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve integration issues across pipeline modules"
```

---

## Summary

| Task | What | Key Files |
|------|------|-----------|
| 1 | WorktreeManager class | `pipeline/lib/worktree-manager.ts` (create) |
| 2 | Config extension | `pipeline/lib/config.ts`, `templates/project.json` |
| 3 | Triage QA-tiering | `agents/triage.md`, `pipeline/run.ts` |
| 4 | run.ts workDir + branchName refactor | `pipeline/run.ts` |
| 5 | Parallel worker pool | `pipeline/worker.ts` |
| 6 | Server WorktreeManager | `pipeline/server.ts` |
| 7 | Vercel preview poller | `pipeline/lib/vercel-preview.ts` (create) |
| 8 | QA runner (single pass) | `pipeline/lib/qa-runner.ts` (create) |
| 8b | Fix loop orchestration | `pipeline/lib/qa-fix-loop.ts` (create) |
| 9 | QA phase in pipeline | `pipeline/run.ts` |
| 10 | systemd + templates | `vps/`, `templates/` |
| 11 | Integration verification | (all files) |

Tasks 1-4 are foundational and must be done in order. Tasks 5-6 depend on 1-4 but are independent of each other. Tasks 7-8 are independent. Task 8b depends on 8. Task 9 depends on 3+8b. Tasks 10-11 can run last.

```
  1 → 2 → 3 → 4 → 5 (parallel with 6)
                  ↘ 6
  7 (parallel with everything)
  8 → 8b (parallel with 1-6)
  9 (depends on 3 + 8b)
  10 (parallel)
  11 (last)
```
