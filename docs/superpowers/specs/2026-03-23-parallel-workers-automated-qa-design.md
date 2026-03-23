# Parallel Workers & Automated QA Pipeline

**Date:** 2026-03-23
**Status:** Draft
**Author:** Claude + Yannik

---

## Problem

Three bottlenecks limit ticket throughput:

1. **Sequential processing:** The pipeline worker handles one ticket at a time — the VPS sits idle while waiting for human review.
2. **Manual QA:** Every ticket requires starting a dev server, opening localhost, and visually checking UI/UX + functionality. This is the biggest time sink.
3. **No parallel branches:** A single VSCode window / single worker can only work on one branch at a time.

## Goal

The pipeline works autonomously throughout the day. Multiple tickets are implemented in parallel. QA runs automatically with Playwright against Vercel Preview Deployments. The user reviews PRs in the evening — each PR has a structured QA report with screenshots, test results, and fix history.

---

## Design

### 1. QA-Tiering

The Triage Agent (already exists) classifies each ticket and assigns a QA tier:

| Tier | Ticket Types | QA Method | Preview Deploy? |
|------|-------------|-----------|-----------------|
| **Full** | Feature, UI-Change, large refactors | Playwright against Vercel Preview: screenshots, click-flows, visual regression | Yes |
| **Light** | Bug-Fix, small improvements | Build-check + unit/integration tests + code-review agent | No |
| **Skip** | Docs, Chore, Config changes | Build-check only (TypeScript compiles, lint passes) | No |

**Triage output is extended with:**
- `qa_tier`: `full` | `light` | `skip`
- `qa_pages`: List of relevant pages/routes to test (for `full`)
- `qa_flows`: Short description of click-flows derived from acceptance criteria (for `full`)

**Data flow:** The `TriageResult` interface in `run.ts` is extended with `qa_tier`, `qa_pages`, and `qa_flows` fields. The triage agent's prompt is updated to include QA classification in its JSON response. These fields are passed into `PipelineOptions` and available to the QA phase inside `executePipeline`.

### 2. Parallel Workers with Worktree Isolation

**Architecture on the VPS:**

```
project-dir/ (main worktree — never used for coding, only as git anchor)
├── .worktrees/
│   ├── worker-1/  ──→  feature/T-351-...
│   ├── worker-2/  ──→  feature/T-352-...
│   └── worker-3/  ──→  feature/T-353-...
```

**How it works:**

1. **Worker pool instead of single worker:** `worker.ts` gets a `concurrency` parameter (default: 1, configurable via `pipeline.max_workers` in `project.json`). Instead of running one flow, it spawns up to N parallel flows.

2. **Ticket claiming stays atomic:** Each flow still does the atomic PATCH with `pipeline_status = "running"`. Two workers can never claim the same ticket — this is already solved.

3. **Worktree per flow:** Before coding, each flow creates its own git worktree:
   ```
   git worktree add .worktrees/worker-{N} -b feature/T-{id}-{slug}
   ```
   Claude Code is started in the worktree directory. After completion (PR created + QA done), the worktree is cleaned up.

4. **Resource limit:** Maximum 3 concurrent Claude sessions. Configurable via `pipeline.max_workers` in `project.json`.

5. **Single process:** One `worker.ts` process manages all flows asynchronously. No systemd templates, no separate worker instances.

**Module ownership for worktrees:**

- **`worker.ts` owns worktree lifecycle:** Creates worktree before calling `executePipeline`, passes the worktree path as a new `workDir` field in `PipelineOptions`, and removes the worktree after the pipeline completes (or crashes).
- **`run.ts` changes:** The existing `git checkout main && git pull && git checkout -b {branch}` logic is replaced. `run.ts` receives `workDir` via `PipelineOptions` and uses it for all file operations. The branch is already checked out by the worktree creation — `run.ts` does not call `git checkout` at all.
- **`server.ts` changes:** `server.ts` also calls `executePipeline` (for webhook-triggered tickets via `/api/launch`) and `resumePipeline` (which does `git checkout {branch}`). Both paths are updated to use the worktree pool. `server.ts` and `worker.ts` share a `WorktreeManager` that tracks slot allocation, ensuring neither exceeds `max_workers`. If all slots are full, new requests queue until a slot frees up.

**WorktreeManager interface:**

```typescript
class WorktreeManager {
  constructor(projectDir: string, maxSlots: number)
  allocate(branchName: string): Promise<{ slotId: number; workDir: string }>
  reattach(branchName: string): Promise<{ slotId: number; workDir: string }>  // for resume
  release(slotId: number): Promise<void>
  park(slotId: number): Promise<void>      // release slot but keep worktree (for pause)
  pruneStale(): Promise<void>              // cleanup on startup — skips parked worktrees
  getActiveSlots(): number
}
```

**Paused worktree handling:**

When `executePipeline` returns with `status: "paused"` (human-in-the-loop), the worktree must survive but should not block other work:

1. **On pause:** Call `worktreeManager.park(slotId)` — releases the slot (freeing it for other tickets) but marks the worktree directory as "parked" so `pruneStale()` skips it.
2. **On resume:** Call `worktreeManager.reattach(branchName)` — finds the existing parked worktree by scanning `.worktrees/` for the matching branch, re-acquires a slot (queuing if all slots are full), and returns the `workDir`. `run.ts` uses this `workDir` for the resumed session instead of creating a new worktree.
3. **Stale parked worktrees:** `pruneStale()` on startup skips worktrees that have a matching ticket with `pipeline_status = "paused"` in Supabase. Parked worktrees whose ticket is no longer paused (e.g., manually cancelled) are cleaned up.

**Worktree lifecycle:**

```
Ticket claimed
  → worktreeManager.allocate(branchName)
  → npm/pnpm install in worktree (reads stack.package_manager from project.json)
  → Claude Code session in worktree (workDir)
  → Implementation → Push → PR
  → QA phase (incl. fix loops) — still inside executePipeline, worktree still alive
  → executePipeline returns:
      status "completed" → worktreeManager.release(slotId) → slot free
      status "paused"    → worktreeManager.park(slotId) → slot free, worktree kept

Resume (triggered via /api/answer):
  → worktreeManager.reattach(branchName) → re-acquires slot, returns existing workDir
  → Claude Code session resumes in same worktree
  → ... continues from where it paused
  → release or park on completion/re-pause
```

**Crash recovery on startup:**

```
Worker boots
  → worktreeManager.pruneStale()
    → Scans .worktrees/ for leftover directories
    → Runs `git worktree prune`
    → Resets tickets stuck in pipeline_status = "running" back to "ready_to_develop"
  → Normal polling begins
```

**Package installation per worktree:**

Git worktrees share `.git` but not working files. Each worktree needs its own `node_modules`. Before Claude Code starts:
1. Read `stack.package_manager` from `project.json` (npm, pnpm, yarn, bun)
2. Run the appropriate install command in the worktree directory
3. If two worktrees install simultaneously: npm/yarn are safe (independent `node_modules`). pnpm uses a content-addressable store — concurrent installs from the same lockfile are safe due to hardlinks.

### 3. Automated QA Pipeline

**QA runs inside `executePipeline`, after the orchestrator creates the PR but before the function returns.** This is critical: the Claude session and worktree must stay alive during QA so that fix loops can modify code and push new commits.

**Pipeline phases (updated):**

```
executePipeline(options: PipelineOptions)
  Phase 1: Triage (existing) → sets qa_tier, qa_pages, qa_flows
  Phase 2: Orchestrator (existing) → implementation → push → PR
  Phase 3: QA (NEW) → runs in same worktree, same session
  Phase 4: Cleanup → report posted, worktree released
```

**QA phase flow:**

```
Read QA tier (from triage result in PipelineOptions)
       ↓
  ┌─────────────────────────────────────────────┐
  │ Skip:  Build-check only                     │
  │ Light: Build + tests + code-review          │
  │ Full:  Build + tests + Playwright + report  │
  └─────────────────────────────────────────────┘
       ↓
  QA report posted as PR comment
```

**Full-tier Playwright QA:**

1. **Wait for preview URL:** After push, poll Vercel API until preview deployment is ready. Requires `pipeline.qa.vercel_project_id` and optionally `pipeline.qa.vercel_team_id` in project config.
2. **Playwright tests** (headless Chromium on VPS):
   - **Screenshots:** Automatically capture relevant pages (derived from ticket context via `qa_pages`)
   - **Smoke tests:** Basic navigation, no console errors, no broken links — these are deterministic and reliable
   - **Functional checks (best-effort):** The QA agent writes ad-hoc Playwright scripts (not persistent test files) based on `qa_flows` and executes them via Bash. These are inherently less reliable than smoke tests — a flaky failure gets one automatic retry before counting as a real failure. Functional check failures are reported but do not block `qa:passed` if smoke tests pass. They are informational for the user.
3. **Report:** Structured PR comment (see format below).

**Light-tier QA:**

1. Build-check: `npm run build` must pass
2. If tests configured in project: `npm run test`
3. Code-review agent (already in orchestrator) checks diff
4. Short report as PR comment

**Skip-tier QA:**

1. Build-check only
2. Auto-label `qa:skipped` on PR

**Playwright on VPS:** Headless Chromium via `npx playwright install chromium`. ~400 MB disk, minimal RAM overhead since headless.

**Preview provider abstraction:**

Not all target projects deploy to Vercel. The config supports a `preview_provider` field:

```json
{
  "pipeline": {
    "qa": {
      "preview_provider": "vercel",
      "vercel_project_id": "prj_xxx",
      "vercel_team_id": "team_xxx"
    }
  }
}
```

When `preview_provider` is not set or `"none"`, full-tier QA falls back to light-tier (build + tests + code review). Only Vercel is supported initially; other providers (Render, Netlify) can be added later.

### 4. Autonomous Fix Loops

When QA finds errors, the agent fixes them autonomously. The fix loop runs inside the same `executePipeline` call — the Claude session and worktree are still active.

```
QA report generated
       ↓
  All green? ──→ Yes ──→ PR comment: "QA passed"
       ↓                   Label: qa:passed
      No
       ↓
  Fix loop (max 3 iterations)
       ↓
  ┌──────────────────────────────────┐
  │ 1. Analyze QA failures           │
  │ 2. Implement fix                 │
  │ 3. Push (new commit)             │
  │ 4. Re-run QA                     │
  │    (full: wait for new preview)  │
  └──────────────────────────────────┘
       ↓
  Green after ≤3 loops?
       ↓              ↓
      Yes            No
       ↓              ↓
  "QA passed"     "QA failed — needs human review"
                   Label: qa:needs-review
                   Report with all 3 attempts + what doesn't work
```

**Rules:**

- **Max 3 fix iterations.** After that it's a fundamental problem, not a quick fix. The user gets a report with all three attempts.
- **Each fix is a separate commit.** No `--amend`, so the user can see what the agent tried in the PR.
- **QA tier stays the same.** A full-tier ticket runs the full Playwright check on every fix attempt.
- **Console errors / build failures → fix immediately.** No Playwright rerun needed, just build-check.
- **Visual/UX issues → new Playwright screenshots.** Agent compares own screenshots with expectations from ticket.

### 5. PR Labels & User Review

What the user sees in the evening:

| PR Label | Meaning | User Action |
|----------|---------|-------------|
| `qa:passed` | QA green, possibly after fix loops | Review screenshots → "ship" |
| `qa:needs-review` | 3x tried, can't fix autonomously | Read report, give direction |
| `qa:skipped` | Build-check only (docs/chore) | Quick glance → "ship" |

### 6. PR Comment Format (Full-Tier Example)

```markdown
## QA Report — T-351

**Tier:** Full | **Status:** Passed (after 1 fix loop)
**Preview:** https://project-abc-git-feature-t-351.vercel.app

### Screenshots
| Page | Screenshot |
|------|-----------|
| /dashboard | ![screenshot](url) |
| /settings | ![screenshot](url) |

### Checks
- [x] Build successful
- [x] No console errors
- [x] Navigation smoke test
- [x] AC: "Settings Modal opens" → click-flow passed

### Functional Checks (best-effort)
- [x] AC: "Settings Modal opens" → click-flow passed
- [ ] AC: "Theme toggle persists" → flaky (1 retry), reported for review

### Fix History
- **Attempt 1:** Console error `TypeError: undefined` in Settings → Fixed in commit `abc123`
- **Attempt 2:** All checks passed
```

---

## Configuration

**project.json extension:**

```json
{
  "pipeline": {
    "max_workers": 3,
    "qa": {
      "max_fix_iterations": 3,
      "playwright_timeout_ms": 60000,
      "vercel_preview_poll_interval_ms": 10000,
      "vercel_preview_max_wait_ms": 300000,
      "preview_provider": "vercel",
      "vercel_project_id": "prj_xxx",
      "vercel_team_id": "team_xxx"
    }
  }
}
```

**VPS requirements:**

- Minimum 16 GB RAM for 3 workers (each Claude session ~2-4 GB + Playwright ~400 MB)
- systemd unit `MemoryMax` must be increased from current 4 GB to at least 12 GB, or removed
- Disk: ~400 MB additional for Playwright Chromium

---

## Implementation Scope

### Must Have (MVP)
1. `WorktreeManager` class (allocate, release, pruneStale)
2. `worker.ts` refactor: worker pool with `max_workers` concurrency
3. `run.ts` refactor: replace `git checkout` with `workDir` from `PipelineOptions`
4. `server.ts` refactor: use shared `WorktreeManager` for webhook and resume paths
5. QA-tiering in triage agent (extend `TriageResult`, update triage prompt)
6. QA phase in `executePipeline` (Phase 3, after orchestrator, before cleanup)
7. Playwright QA for full-tier (screenshots + smoke tests + best-effort functional checks)
8. Fix loops (max 3, inside executePipeline)
9. QA report as PR comment with labels
10. `pipeline.max_workers` + `pipeline.qa` config in `project.json`
11. Crash recovery: stale worktree cleanup + stuck ticket reset on startup
12. systemd unit update: increase `MemoryMax`
13. Failure tracking: per-slot failure counter (not shared across workers)

### Nice to Have (Later)
- Visual regression comparison (before/after screenshots)
- Dynamic worker scaling based on queue depth
- QA dashboard in the Board UI
- Slack/notification when QA fails after 3 attempts
- Additional preview providers (Render, Netlify)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| VPS RAM for 3 Claude sessions | Start with `max_workers: 2`, monitor, scale up. Minimum 16 GB RAM. |
| Vercel Preview takes too long | Configurable timeout (`vercel_preview_max_wait_ms`), fallback to light-tier QA |
| Playwright flaky tests | Smoke tests are deterministic. Functional checks are best-effort with 1 retry — they inform but don't block. |
| Worktree conflicts on shared deps | Each worktree runs its own install via `stack.package_manager`. pnpm store is safe for concurrent access. |
| API cost with parallel sessions | Budget alert in pipeline config (future) |
| No Vercel in target project | `preview_provider` config — falls back to light-tier when not set |
| Worker crash leaves stale worktrees | `pruneStale()` on startup: scans `.worktrees/`, prunes git refs, resets stuck tickets |
| Shared failure counter causes premature shutdown | Per-slot failure tracking. Only infra failures (auth, connectivity) count toward global shutdown threshold. |
| `server.ts` and `worker.ts` compete for slots | Shared `WorktreeManager` instance with slot allocation. Queuing when all slots full. |
