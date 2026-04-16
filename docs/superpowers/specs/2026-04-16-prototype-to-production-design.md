# Prototype to Production — Design Spec

> Turn any GitHub prototype into a production-ready app on Just Ship Cloud with one click.

## Problem

Users build prototypes with Claude, Cursor, v0, or during hackathons. These prototypes work locally but are far from production: no tests, no error handling, hardcoded secrets, no hosting. The gap between "works on my machine" and "running in production" kills most prototypes.

## Target Users

1. **Non-tech Solo-Founders** — built something with AI tools, can't do DevOps, want it live
2. **Internal Teams** — hackathon prototype that needs to become production-grade software

## Value Proposition

Connect a GitHub repo → click Launch → get a live Preview URL with production-grade code. Zero external accounts, zero DevOps knowledge, zero terminal.

---

## User Flow

```
Create Project ("Web App")
        │
        ▼
  Project Dashboard
  ┌─────────────────────────────┐
  │  My Prototype               │
  │  Type: Web App              │
  │  Repo: not connected        │
  │                             │
  │  [Connect GitHub Repo]      │
  └─────────────────────────────┘
        │ GitHub App Installation + Repo selection
        ▼
  ┌─────────────────────────────┐
  │  My Prototype               │
  │  Type: Web App              │
  │  Repo: user/my-prototype    │
  │                             │
  │  [Launch]                   │
  └─────────────────────────────┘
        │ User clicks Launch
        ▼
  Progress-View (replaces Dashboard)
  ┌─────────────────────────────┐
  │  🚀 Launching My Prototype  │
  │                             │
  │  Next.js 15 + Tailwind      │
  │  ─────────────────────────  │
  │  ✅ Stack detected           │
  │  ✅ Project configured       │
  │  ⏳ Writing tests (2/5)     │
  │  ○  Security hardening      │
  │  ○  Configure environment   │
  │  ○  Deploy to Just Ship Cloud│
  └─────────────────────────────┘
        │ ENV input required
        ▼
  ┌─────────────────────────────┐
  │  Configure Environment      │
  │                             │
  │  SUPABASE_URL:  [________]  │
  │  SUPABASE_KEY:  [________]  │
  │  API_SECRET:    [________]  │
  │                             │
  │  [Continue]                 │
  └─────────────────────────────┘
        │ Deploy runs
        ▼
  ┌─────────────────────────────┐
  │  ✅ My Prototype is live!    │
  │                             │
  │  Preview: my-proto.just-    │
  │           ship.app          │
  │                             │
  │  [Open Preview] [View Board]│
  └─────────────────────────────┘
```

**User actions:** Connect repo (1x), click Launch (1x), fill ENV vars (1x). Everything else is passive.

---

## Architecture

Three systems involved: **Board**, **Engine**, **Coolify** (internal, branded as "Just Ship Cloud").

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────┐
│      Board       │     │     Engine        │     │   Coolify     │
│  (Next.js App)   │     │  (VPS Pipeline)   │     │  (internal)   │
│                  │     │                   │     │               │
│ 1. GitHub App    │     │                   │     │               │
│    Install Flow  │     │                   │     │               │
│ 2. Repo Picker   │     │                   │     │               │
│ 3. "Launch" ─────┼─POST /api/launch──▶    │     │               │
│                  │     │ 4. Clone repo     │     │               │
│                  │     │ 5. Detect stack   │     │               │
│ 6. Progress-View │◀─Events──────────┤     │     │               │
│                  │     │ 7. Generate Epic  │     │               │
│                  │     │    + Tickets      │     │               │
│                  │     │ 8. Run Pipeline   │     │               │
│                  │     │    (parallel)     │     │               │
│ 9. ENV Form     │     │                   │     │               │
│    User fills ───┼─POST /api/launch/env──▶│     │               │
│                  │     │10. Deploy ────────┼──API──▶ Create App  │
│                  │     │                   │     │  Set ENVs     │
│                  │     │                   │     │  Build + Run  │
│11. Preview URL   │◀───┼── Done event      │◀────┤  Return URL   │
└──────────────────┘     └──────────────────┘     └──────────────┘
```

### What already exists (reused)

- Board → Engine communication (`/api/launch`, `/api/events`)
- Pipeline worker with ticket execution
- Coolify deployment API (`coolify-preview.ts`)
- Stack detection (partially, in `setup.sh`)

### What needs to be built

- **Board:** GitHub App Install Flow + Repo Picker UI
- **Board:** Progress-View component (Launch screen)
- **Board:** ENV input form (shown when `env_input_required` event arrives)
- **Board:** "Launch" trigger calling `/api/launch` with prototype context
- **Engine:** Prototype Analyze phase — stack detection, gap analysis, launch plan generation
- **Engine:** Launch-Pipeline orchestration — Epic + Ticket generation from analysis results
- **Engine:** ENV-handling step — pause pipeline, wait for user input, resume with values
- **DB:** GitHub fields on `projects` table

---

## Launch Pipeline

### Phase 1 — Analyze (5-15 seconds)

Engine clones the repo and scans it. Result is a **Launch Plan** — a list of steps to execute.

**Stack Detection:**

| Signal | Detects |
|---|---|
| `package.json` → `next`, `react`, `vue`, `svelte`, `astro` | Framework |
| `package.json` → `@supabase/supabase-js`, `prisma`, `drizzle` | Database |
| `tailwind.config.*`, `postcss.config.*` | Styling |
| `Dockerfile`, `docker-compose.*` | Container-ready |
| `.env.example`, `.env.local` | ENV variables needed |
| `tsconfig.json` vs only `.js` files | TypeScript yes/no |

**Gap Analysis:**

| Check | Result |
|---|---|
| Tests exist? (`*.test.*`, `*.spec.*`, `__tests__/`) | Write tests: yes/no |
| Error Boundaries / try-catch on API routes? | Error handling: yes/no |
| Hardcoded secrets in code? `.env` committed? | Security fix: yes/no |
| Lockfile present? (`package-lock.json`, `bun.lockb`) | Generate lockfile: yes/no |
| Does the project build? (`npm run build`) | Build fix: yes/no |

Result is sent immediately to Board → Progress-View shows detected stack and planned steps.

### Phase 2 — Execute (10-15 minutes)

Engine creates an Epic "Launch: {project name}" with tickets per step. All work happens on a `just-ship/launch` branch.

**Execution order:**

```
Build-Fix (must be first — project must build before anything else)
    │
    ├── Error Handling  ─┐
    ├── Write Tests      ├── parallel (independent of each other)
    └── Security         ─┘
            │
    Configure Environment (User input — Board shows ENV form)
            │
    Deploy to Just Ship Cloud
```

1. **Build-Fix** — resolve build errors so the project compiles
2. **Error Handling** (parallel) — add Error Boundaries, API route error handling
3. **Write Tests** (parallel) — test coverage for existing routes/components
4. **Security** (parallel) — extract hardcoded secrets to ENV vars, input validation
5. **Configure Environment** — Board shows form with discovered ENV keys, user fills in values
6. **Deploy** — create Coolify app, set ENV vars, build, deploy, return Preview URL

**Branch strategy:** All changes land on `just-ship/launch`. At the end, a single PR is created against the user's default branch. The Preview URL deploys from the launch branch.

### What the user gets at the end

- A running Preview URL on Just Ship Cloud
- Their repo now has tests, error handling, security basics (on the launch branch)
- A clean PR with everything the pipeline did
- A Board with all tickets as history
- From here: normal Just Ship development via tickets

---

## Data Model

### `projects` table — new fields

```sql
github_installation_id  bigint    -- GitHub App Installation ID
github_repo             text      -- "my-prototype"
github_owner            text      -- "username" or "org-name"
github_default_branch   text      -- "main" or "master"
launch_status           text      -- null | analyzing | running | env_input | deploying | live | failed
launch_branch           text      -- "just-ship/launch"
preview_url             text      -- "my-proto-abc123.just-ship.app"
```

No new tables. A project either has a GitHub connection or it doesn't.

### API Endpoints

**Board → GitHub:**
- `GET /api/github/install` — redirect to GitHub App installation page
- `GET /api/github/callback` — callback after installation, saves `installation_id` on project
- `GET /api/github/repos` — list repos accessible via installation token

**Board → Engine:**
- `POST /api/launch` — extended with `launch_type: "prototype"`, Engine recognizes this as a launch run
- `POST /api/launch/env` — user submits ENV variable values, Engine sets them in Coolify and starts deploy

**Engine → Board (Events, existing system extended):**
- `analyze_complete` — stack + steps detected, Board shows Progress-View
- `step_started` / `step_completed` — progress updates per step
- `env_input_required` — Board shows ENV form with discovered keys
- `launch_complete` — Preview URL ready

### GitHub App

- **Name:** Just Ship
- **Permissions:** `contents: read+write`, `pull_requests: write`, `metadata: read`
- **Events:** none (we push, not poll)
- **Installation scope:** per-repository (user chooses which repos)

---

## Scope

### In scope (v1)

| Area | What |
|---|---|
| Hosting + Preview URL | Coolify deployment with auto-generated subdomain |
| ENV management | Extract from code, user fills values, set in Coolify |
| Error handling basics | Error Boundaries, API route try-catch |
| Tests | Coverage for existing routes/components |
| Security basics | Secret extraction, input validation |
| Build fixes | Resolve compilation errors |
| CI/CD | Auto-deploy from launch branch |

### Out of scope (v1)

| Area | Why |
|---|---|
| Custom domains | Post-launch feature, not needed for preview |
| Monitoring/Alerting | Coolify provides basic health checks |
| Performance optimization | Production-ready ≠ optimized, that's a follow-up |
| Feature extensions | We make it production-grade, not feature-complete |
| Non-Node.js stacks | v1 focuses on the JS/TS ecosystem (Next.js, React, Vue, Svelte, Astro) |
| ZIP/folder upload | v1 is GitHub-only, file upload can come later |

---

## Design Decisions (to resolve during planning)

1. **Failure UX:** When a step fails (e.g., build-fix can't resolve errors), the Progress-View shows the failed step with an error summary and a "Retry" / "Get Help" option. The launch does not auto-abort — completed steps are kept, only the failed step needs resolution.

2. **ENV form pre-population:** Values from `.env.example` are shown as placeholder hints in the form fields. Values from `.env.local` (if committed, which is a security issue) are pre-filled as defaults. Keys without any discoverable values show empty fields with a description of what's expected (e.g., "Supabase project URL").

3. **Parallel step failure isolation:** If one parallel step fails, the others continue. A failed step does not block the remaining parallel work. The pipeline pauses before "Configure Environment" only if a critical step (Build-Fix) failed. Non-critical failures (e.g., test generation partially failed) are flagged but don't block deployment.
