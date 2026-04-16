# Prototype to Production — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to connect a GitHub repo to a Web App project in the Board, click "Launch", and get a production-ready app deployed to Just Ship Cloud with a Preview URL — fully autonomous.

**Architecture:** Two independent workstreams — Board (UI + GitHub App + Launch trigger) and Engine (Analyze phase + Launch pipeline + Coolify deploy). Board communicates with Engine via existing `/api/launch` endpoint. Engine reports progress via existing event system. Supabase Realtime pushes updates to the Board UI.

**Tech Stack:** Next.js 16 (Board), TypeScript (Engine pipeline), Supabase (DB + Realtime), Coolify API (deployment), GitHub App API (repo access)

**Spec:** `docs/superpowers/specs/2026-04-16-prototype-to-production-design.md`

---

## Workstream Overview

This feature spans two repos:

| Workstream | Repo | Tasks |
|---|---|---|
| **A — Board** | `just-ship-board` | DB migration, GitHub connect flow, Launch trigger, Progress-View, ENV form |
| **B — Engine** | `just-ship` | Analyze phase, Launch pipeline orchestration, ticket generation, Coolify deploy |

**Dependency:** Workstream A (Tasks 1-4) and B (Tasks 5-7) can run in parallel. Task 8 (integration) requires both to be complete.

---

## Workstream A — Board

### Task 1: DB Migration — Launch Fields on Projects

Add launch-related fields to the existing `projects` table. The GitHub App installation fields (`github_installations` table) already exist.

**Files:**
- Create: `just-ship-board/supabase/migrations/042_project_launch_fields.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add launch fields to projects table
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS github_installation_id bigint REFERENCES github_installations(github_installation_id),
  ADD COLUMN IF NOT EXISTS github_repo text,
  ADD COLUMN IF NOT EXISTS github_owner text,
  ADD COLUMN IF NOT EXISTS github_default_branch text DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS launch_status text CHECK (launch_status IN ('analyzing', 'running', 'env_input', 'deploying', 'live', 'failed')),
  ADD COLUMN IF NOT EXISTS launch_branch text,
  ADD COLUMN IF NOT EXISTS preview_url text;

-- Index for quick lookup of projects in launch state
CREATE INDEX IF NOT EXISTS idx_projects_launch_status ON projects(launch_status) WHERE launch_status IS NOT NULL;

-- RLS: existing project policies already cover these columns (same-workspace check)
```

- [ ] **Step 2: Apply the migration locally**

Run: `cd just-ship-board && npx supabase db push`
Expected: Migration applies cleanly, no errors.

- [ ] **Step 3: Generate updated TypeScript types**

Run: `npx supabase gen types typescript --local > src/lib/database.types.ts`
Expected: New fields appear in `projects` type definition.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/042_project_launch_fields.sql src/lib/database.types.ts
git commit -m "feat: add launch fields to projects table for prototype-to-production flow"
```

---

### Task 2: GitHub Repo Connect Flow in Project Setup

Extend the existing Project Setup Dialog to show a "Connect GitHub Repo" button for Web App projects. The GitHub App installation flow and repo listing API already exist (`lib/github/app.ts`, `api/github/repos/route.ts`).

**Files:**
- Modify: `just-ship-board/src/components/board/project-setup-dialog.tsx` — add GitHub connect section
- Create: `just-ship-board/src/components/board/github-repo-picker.tsx` — repo selection dropdown
- Modify: `just-ship-board/src/lib/validations/project.ts` — add github fields to schema

- [ ] **Step 1: Read existing files to understand current patterns**

Read:
- `src/components/board/project-setup-dialog.tsx` — current setup dialog structure
- `src/lib/github/app.ts` — GitHub App JWT + installation token functions
- `src/app/api/github/repos/route.ts` — existing repo listing endpoint
- `src/lib/github/repos.ts` — repo fetching logic (if exists)

- [ ] **Step 2: Create the GitHub Repo Picker component**

Create `src/components/board/github-repo-picker.tsx`:

```tsx
// Fetches repos via /api/github/repos using the workspace's github_installation_id
// Shows a searchable dropdown of repos
// On select: updates project with github_repo, github_owner, github_default_branch
// Props: workspaceId, projectId, installationId, onRepoConnected
```

Component behavior:
- Fetch repos from `/api/github/repos?installation_id={id}`
- Show repos in a searchable Combobox (shadcn/ui pattern already used in Board)
- On selection: PATCH project with `github_repo`, `github_owner`, `github_default_branch`
- Show connected state: repo name + "Disconnect" option

- [ ] **Step 3: Extend Project Setup Dialog**

Modify `src/components/board/project-setup-dialog.tsx`:

- Add a conditional section for `type === 'webapp'` projects
- If workspace has no GitHub App installed: show "Connect GitHub" button → redirect to GitHub App install URL
- If GitHub App installed but no repo connected: show `GitHubRepoPicker`
- If repo connected: show repo name, "Disconnect" link, and the **Launch button** (Task 3)

- [ ] **Step 4: Test the flow manually**

Run: `cd just-ship-board && npm run dev`
Test: Create a Web App project → open Project Setup → verify GitHub connect section appears → connect a repo → verify repo name shows.

- [ ] **Step 5: Commit**

```bash
git add src/components/board/github-repo-picker.tsx src/components/board/project-setup-dialog.tsx src/lib/validations/project.ts
git commit -m "feat: add GitHub repo connect flow to Web App project setup"
```

---

### Task 3: Launch Button + Progress View

Add the "Launch" button that triggers the prototype-to-production pipeline, and a Progress View that shows real-time step updates.

**Files:**
- Create: `just-ship-board/src/components/board/launch-progress-view.tsx` — the progress UI
- Create: `just-ship-board/src/lib/hooks/use-launch-realtime.ts` — Supabase Realtime subscription for launch updates
- Modify: `just-ship-board/src/components/board/project-setup-dialog.tsx` — add Launch button + conditional Progress View

- [ ] **Step 1: Create the launch realtime hook**

Create `src/lib/hooks/use-launch-realtime.ts`:

```typescript
// Subscribe to Supabase Realtime changes on the project's launch_status field
// Pattern: follow use-ticket-realtime.ts exactly
// Channel: 'launch-realtime-{projectId}'
// Filter: postgres_changes on projects table, filter by id=projectId
// Returns: { launchStatus, previewUrl } — auto-updates on DB changes
```

- [ ] **Step 2: Create the Progress View component**

Create `src/components/board/launch-progress-view.tsx`:

```tsx
// Props: projectId, projectName, onComplete
// Uses use-launch-realtime hook for live status
// Fetches launch steps from a new field or derives from launch_status
//
// Visual structure:
// - Header: "Launching {projectName}"
// - Stack label: "Next.js 15 + Tailwind" (from analyze result)
// - Step list with status icons:
//   ✅ completed | ⏳ in progress | ○ pending | ❌ failed
// - On "live": show Preview URL + "Open Preview" button
//
// Steps derived from launch events stored in task_events table.
// On mount: query historical events for this project (handles page refresh mid-launch).
// Then subscribe to Realtime for live updates.
// 1. Analyze → 2. Build Fix → 3. Error Handling → 4. Tests → 5. Security
// → 6. Configure Environment → 7. Deploy
```

- [ ] **Step 3: Add Launch button to Project Setup Dialog**

Modify `src/components/board/project-setup-dialog.tsx`:

- After repo is connected: show "Launch" button (primary, prominent)
- On click: POST to Engine's `/api/launch` with `{ launch_type: "prototype", project_id, repo_url: "github.com/{owner}/{repo}" }`
- After clicking: replace the setup content with `LaunchProgressView`
- Disable Launch button if `launch_status` is not null (already launched / in progress)

- [ ] **Step 4: Wire up the launch API call**

Create a server action or API route in Board that forwards the launch request to the Engine:

```typescript
// POST /api/projects/{id}/launch
// Body: {} (project already has all needed info)
// Server-side: fetch project from DB, build payload, POST to Engine /api/launch
// Response: { success: true } or error
```

- [ ] **Step 5: Test the full flow manually**

Run: `npm run dev`
Test: Open a Web App project with connected repo → click Launch → verify Progress View appears → verify it updates as events come in (mock events via Supabase insert if Engine not ready).

- [ ] **Step 6: Commit**

```bash
git add src/components/board/launch-progress-view.tsx src/lib/hooks/use-launch-realtime.ts src/components/board/project-setup-dialog.tsx src/app/api/projects/
git commit -m "feat: add Launch button and Progress View for prototype-to-production"
```

---

### Task 4: ENV Input Form

When the Engine reports `env_input_required`, the Progress View shows an ENV form. User fills in values, submits, Engine continues with deploy.

**Files:**
- Create: `just-ship-board/src/components/board/env-input-form.tsx` — ENV variable form
- Modify: `just-ship-board/src/components/board/launch-progress-view.tsx` — show ENV form when status is `env_input`

- [ ] **Step 1: Create the ENV Input Form component**

Create `src/components/board/env-input-form.tsx`:

```tsx
// Props: projectId, envKeys: Array<{ key: string, hint?: string, defaultValue?: string }>
// Renders a form with one input per ENV key
// Key name as label, hint as placeholder, defaultValue pre-filled
// "Continue" button submits all values
// On submit: POST to Engine /api/launch/env with { project_id, env_vars: Record<string, string> }
// Sensitive values (containing KEY, SECRET, TOKEN, PASSWORD) use type="password"
```

- [ ] **Step 2: Integrate into Progress View**

Modify `launch-progress-view.tsx`:
- When `launch_status === 'env_input'`: show ENV form inline, replacing the step list temporarily
- ENV keys come from a task_event with type `env_input_required` and metadata containing the keys
- After submit: form disappears, step list returns with "Configure Environment ✅" and "Deploy ⏳"

- [ ] **Step 3: Test manually**

Insert a mock `env_input_required` event into task_events → verify form appears → fill values → submit → verify status updates.

- [ ] **Step 4: Commit**

```bash
git add src/components/board/env-input-form.tsx src/components/board/launch-progress-view.tsx
git commit -m "feat: add ENV input form for prototype launch pipeline"
```

---

## Workstream B — Engine

### Task 5: Prototype Analyzer

New module that clones a repo, detects the stack, identifies gaps, and returns a Launch Plan.

**Files:**
- Create: `just-ship/.pipeline/lib/prototype-analyzer.ts` — stack detection + gap analysis
- Create: `just-ship/.pipeline/lib/prototype-analyzer.test.ts` — tests

- [ ] **Step 1: Write failing tests for stack detection**

Create `.pipeline/lib/prototype-analyzer.test.ts`:

```typescript
import { analyzePrototype, LaunchPlan } from "./prototype-analyzer";

// Test: detects Next.js + Supabase + Tailwind from package.json
// Test: detects missing tests (no *.test.* files)
// Test: detects hardcoded secrets (SUPABASE_URL in .ts files, not in .env)
// Test: detects build script exists
// Test: returns correct step list based on gaps
// Test: handles empty repo gracefully
```

Test against fixture directories with known package.json / file structures. Create minimal fixtures in a `test-fixtures/` dir.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd .pipeline && npx vitest run lib/prototype-analyzer.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the analyzer**

Create `.pipeline/lib/prototype-analyzer.ts`:

```typescript
export interface LaunchPlan {
  stack: {
    framework: string | null;    // "next", "react", "vue", "svelte", "astro"
    database: string | null;     // "supabase", "prisma", "drizzle"
    styling: string | null;      // "tailwind", "css-modules", "styled-components"
    language: "typescript" | "javascript";
    packageManager: "npm" | "yarn" | "pnpm" | "bun";
  };
  gaps: {
    needsBuildFix: boolean;
    needsErrorHandling: boolean;
    needsTests: boolean;
    needsSecurity: boolean;
    needsLockfile: boolean;
  };
  envKeys: string[];             // discovered ENV variable keys
  steps: LaunchStep[];           // ordered list of steps to execute
}

export interface LaunchStep {
  id: string;                    // "build-fix", "error-handling", "tests", "security", "env-input", "deploy"
  label: string;                 // "Fix build errors"
  status: "pending";
  parallel?: boolean;            // true for steps that can run in parallel
}

export async function analyzePrototype(repoDir: string): Promise<LaunchPlan>
```

Implementation:
- Read `package.json` for framework/database/styling detection
- Glob for `*.test.*`, `*.spec.*`, `__tests__/` to check test coverage
- Glob for `.env.example`, `.env.local` to extract ENV keys
- Grep for hardcoded patterns (`SUPABASE_URL=`, `sk_live_`, `Bearer `) in `.ts`/`.js` files
- Try `npm run build` (or equivalent) to check if it builds
- Return `LaunchPlan` with detected stack, gaps, and ordered steps

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/prototype-analyzer.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add .pipeline/lib/prototype-analyzer.ts .pipeline/lib/prototype-analyzer.test.ts
git commit -m "feat: add prototype analyzer for stack detection and gap analysis"
```

---

### Task 6: Launch Pipeline Orchestration

Extend the Engine's `/api/launch` endpoint to handle `launch_type: "prototype"`. This creates an Epic with tickets and runs them through the existing pipeline.

**Files:**
- Create: `just-ship/.pipeline/lib/launch-pipeline.ts` — orchestrates the full launch flow
- Modify: `just-ship/pipeline/server.ts` — add `launch_type: "prototype"` handling in `handleLaunch()`
- Modify: `just-ship/.pipeline/lib/event-hooks.ts` — add new event types (`analyze_complete`, `env_input_required`, `launch_complete`)

- [ ] **Step 1: Read existing launch handler**

Read:
- `pipeline/server.ts` lines 323-800 — understand `handleLaunch()` flow
- `.pipeline/lib/event-hooks.ts` — understand event posting pattern

- [ ] **Step 2: Create launch-pipeline module**

Create `.pipeline/lib/launch-pipeline.ts`:

```typescript
export interface LaunchOptions {
  projectId: string;
  repoUrl: string;
  githubInstallationId: number;
  githubOwner: string;
  githubRepo: string;
  githubDefaultBranch: string;
  boardApiUrl: string;
  boardApiKey: string;
}

export async function executeLaunchPipeline(opts: LaunchOptions): Promise<{
  previewUrl: string | null;
  prUrl: string | null;
  status: "live" | "failed" | "env_input";
}>
```

Implementation flow:
1. Clone repo using GitHub App installation token (URL format: `https://x-access-token:{token}@github.com/{owner}/{repo}.git`)
2. Run `analyzePrototype()` → get LaunchPlan
3. Post `analyze_complete` event with stack info and step list
4. Update project `launch_status = 'running'`
5. Create `just-ship/launch` branch
6. **Build-Fix step** (if needed): Run claude agent with build-fix prompt → commit to launch branch
7. **Parallel steps**: Dispatch agents for error-handling, tests, security concurrently → commit results
8. Post `env_input_required` event with discovered ENV keys → update `launch_status = 'env_input'`
9. **Wait for ENV values** (poll project record or receive via `/api/launch/env` callback)
10. **Deploy step**: Create Coolify app, set ENV vars, trigger build from launch branch
11. Wait for Coolify deployment → get Preview URL
12. Create PR from `just-ship/launch` → default branch
13. Post `launch_complete` event with Preview URL → update `launch_status = 'live'`, `preview_url`

- [ ] **Step 3: Add new event types to event-hooks**

Modify `.pipeline/lib/event-hooks.ts`:

```typescript
// Add helper functions:
export async function postAnalyzeComplete(config: EventConfig, plan: LaunchPlan): Promise<void>
export async function postEnvInputRequired(config: EventConfig, envKeys: Array<{ key: string, hint?: string }>): Promise<void>
export async function postLaunchComplete(config: EventConfig, previewUrl: string, prUrl: string): Promise<void>
export async function postStepUpdate(config: EventConfig, stepId: string, status: "started" | "completed" | "failed"): Promise<void>
```

- [ ] **Step 4: Extend server.ts to handle prototype launches**

Modify `pipeline/server.ts` in `handleLaunch()`:

```typescript
// After rate limiting and idempotency check:
if (body.launch_type === "prototype") {
  // Fetch project from Board API to get GitHub fields
  // Call executeLaunchPipeline() asynchronously
  // Return 202 immediately
  return;
}
// ... existing ticket-based launch flow
```

- [ ] **Step 5: Add /api/launch/env endpoint**

Add to `pipeline/server.ts`:

```typescript
// POST /api/launch/env
// Body: { project_id: string, env_vars: Record<string, string> }
// Stores env vars and signals the running launch pipeline to continue
// Implementation: in-memory Map<projectId, { resolve: Function }> — single-process server,
// no disk I/O needed. Pipeline awaits a Promise that resolves when this endpoint is called.
// Add a 30-minute timeout so the pipeline doesn't hang forever if user abandons.
```

- [ ] **Step 6: Test with a real prototype repo**

Create a minimal test repo (Next.js starter with intentional gaps) → trigger launch via curl → verify analyze events arrive → verify agents run → verify ENV input pause → submit ENV vars → verify deploy.

- [ ] **Step 7: Commit**

```bash
git add .pipeline/lib/launch-pipeline.ts pipeline/server.ts .pipeline/lib/event-hooks.ts
git commit -m "feat: add launch pipeline orchestration for prototype-to-production"
```

---

### Task 7: Coolify App Provisioning

Extend the existing Coolify integration to create new apps (not just wait for preview deployments).

**Files:**
- Modify: `just-ship/.pipeline/lib/coolify-preview.ts` — add `createCoolifyApp()` and `setCoolifyEnvVars()`
- Create: `just-ship/.pipeline/lib/coolify-preview.test.ts` — tests

- [ ] **Step 1: Read existing Coolify integration**

Read: `.pipeline/lib/coolify-preview.ts` — understand current API patterns and auth.

- [ ] **Step 2: Write failing tests**

```typescript
// Test: createCoolifyApp returns app UUID and preview URL
// Test: setCoolifyEnvVars sets all provided vars on the app
// Test: triggerCoolifyBuild starts a deployment
// Test: waitForCoolifyDeployment returns URL when build finishes
```

- [ ] **Step 3: Implement new Coolify functions**

Add to `.pipeline/lib/coolify-preview.ts`:

```typescript
export async function createCoolifyApp(opts: {
  name: string;
  repoUrl: string;
  branch: string;
  buildCommand: string;
  installCommand: string;
  port: number;
}): Promise<{ uuid: string; previewUrl: string }>

export async function setCoolifyEnvVars(
  appUuid: string,
  envVars: Record<string, string>
): Promise<void>

export async function triggerCoolifyBuild(appUuid: string): Promise<string>  // returns deployment ID

export async function waitForCoolifyDeployment(
  appUuid: string,
  deploymentId: string,
  timeoutMs?: number
): Promise<string>  // returns live URL
```

Uses existing auth pattern (Bearer token from `COOLIFY_API_TOKEN`).

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/coolify-preview.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .pipeline/lib/coolify-preview.ts .pipeline/lib/coolify-preview.test.ts
git commit -m "feat: add Coolify app provisioning for prototype deployments"
```

---

## Integration

### Task 8: End-to-End Integration Test

Wire Board and Engine together, test the full flow.

**Files:**
- No new files — this is a manual integration test across both repos

- [ ] **Step 1: Start both systems locally**

```bash
# Terminal 1: Board
cd just-ship-board && npm run dev

# Terminal 2: Engine (pipeline server)
cd just-ship && npx tsx pipeline/server.ts
```

- [ ] **Step 2: Create a test project and connect a repo**

In Board UI:
1. Create project with type "Web App"
2. Open Project Setup → Connect GitHub → select a test repo
3. Verify repo name appears in setup dialog

- [ ] **Step 3: Click Launch and verify the full flow**

1. Click "Launch" button
2. Verify Progress View appears with detected stack
3. Verify steps update in real-time as agents run
4. When ENV form appears: fill in test values, submit
5. Verify deployment completes and Preview URL appears
6. Click "Open Preview" → verify the app loads

- [ ] **Step 4: Verify the PR was created**

Check the test repo on GitHub → verify a PR from `just-ship/launch` → default branch exists with all changes (tests, error handling, security fixes).

- [ ] **Step 5: Document any issues found**

Create follow-up tickets for anything that needs polish (edge cases, error states, UX improvements).

---

## Task Dependency Graph

```
Task 1 (DB Migration)
    │
    ├── Task 2 (GitHub Connect) ──── Task 3 (Launch + Progress) ──── Task 4 (ENV Form)
    │                                        │
    │                                        │ (needs Engine ready)
Task 5 (Analyzer) ──── Task 6 (Launch Pipeline) ──── Task 7 (Coolify Provisioning)
    │                                                         │
    └─────────────────────── Task 8 (Integration) ────────────┘
```

**Parallel execution:** Tasks 1-4 (Board) and Tasks 5-7 (Engine) can run in parallel as separate workstreams. Task 8 requires both.
