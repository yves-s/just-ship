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

### 2. Parallel Workers with Worktree Isolation

**Architecture on the VPS:**

```
project-dir/ (main worktree)
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

**Worktree lifecycle:**

```
Ticket claimed
  → git worktree add .worktrees/worker-{N}
  → Claude Code session in worktree
  → Implementation → Push → PR
  → QA step (incl. fix loops)
  → git worktree remove .worktrees/worker-{N}
  → Worker slot becomes free for next ticket
```

### 3. Automated QA Pipeline

**Flow after PR creation:**

```
PR created (push + gh pr create)
       ↓
  Read QA tier (from triage metadata)
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

1. **Wait for preview URL:** After push, poll Vercel API until preview deployment is ready.
2. **Playwright tests** (headless Chromium on VPS):
   - **Screenshots:** Automatically capture relevant pages (derived from ticket context via `qa_pages`)
   - **Functional checks:** Click-flows based on acceptance criteria from `qa_flows` (e.g., "Button X opens Modal Y")
   - **Smoke tests:** Basic navigation, no console errors, no broken links
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

### 4. Autonomous Fix Loops

When QA finds errors, the agent fixes them autonomously:

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
      "vercel_preview_max_wait_ms": 300000
    }
  }
}
```

---

## Implementation Scope

### Must Have (MVP)
1. Worktree-based parallel workers in `worker.ts`
2. QA-tiering in triage agent
3. Playwright QA for full-tier (screenshots + smoke tests + functional checks)
4. Fix loops (max 3)
5. QA report as PR comment with labels
6. `pipeline.max_workers` + `pipeline.qa` config in `project.json`

### Nice to Have (Later)
- Visual regression comparison (before/after screenshots)
- Dynamic worker scaling based on queue depth
- QA dashboard in the Board UI
- Slack/notification when QA fails after 3 attempts

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| VPS RAM for 3 Claude sessions | Start with `max_workers: 2`, monitor, scale up |
| Vercel Preview takes too long | Configurable timeout, fallback to light-tier QA |
| Playwright flaky tests | Smoke tests only (no pixel-perfect comparison), retry on flake |
| Worktree conflicts on shared deps | Each worktree runs its own `npm install` |
| API cost with parallel sessions | Budget alert in pipeline config (future) |
