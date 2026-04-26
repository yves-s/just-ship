# Architecture -- Just Ship

**From ticket to ship. Autonomously.**

Comprehensive technical reference for the Just Ship system: the portable multi-agent framework, the Pipeline SDK, the Just Ship Board, and the VPS deployment infrastructure.

---

## Table of Contents

1. [Overview](#overview)
2. [Design Philosophy](#design-philosophy)
3. [System Architecture](#system-architecture)
4. [Directory Structure](#directory-structure)
5. [Agent System](#agent-system)
6. [Slash Commands](#slash-commands)
7. [Skills System](#skills-system)
8. [Pipeline SDK](#pipeline-sdk)
9. [Just Ship Board](#just-ship-board)
10. [Event Streaming](#event-streaming)
11. [Hooks System](#hooks-system)
12. [Configuration](#configuration)
13. [Setup and Installation](#setup-and-installation)
14. [VPS Deployment](#vps-deployment)
15. [Sidekick](#sidekick)
16. [Security Model](#security-model)
17. [Cost Model](#cost-model)

---

## Overview

Just Ship is a portable multi-agent framework that turns Claude Code into an autonomous software development system. It provides a structured set of agents, commands, skills, and a pipeline runner that can be installed into any project -- regardless of tech stack. Tickets go in, pull requests come out.

The framework operates in two modes:

1. **Interactive** -- A developer works in Claude Code, using slash commands (`/ticket`, `/develop`, `/ship`) to drive the workflow.
2. **Autonomous** -- A VPS HTTP server accepts Board-initiated triggers (`POST /api/launch`) and executes the full pipeline without further human intervention. The Engine does nothing unbidden — every autonomous run is the result of an explicit Play-button click on the Board.

Both modes use the same agents, the same orchestrator logic, and the same shipping flow. The only difference is the entry point. The Just Ship Board provides real-time visibility into both modes through a Kanban dashboard and event streaming.

---

## Design Philosophy

### Token-Efficient by Design

Every component is optimized to minimize API token consumption:

- **No Planner Agent** -- The Orchestrator plans itself by reading only the 5-10 affected files.
- **No Spec Files** -- Instructions go directly into agent prompts, avoiding the write-read-interpret round-trip.
- **Model Tiering** -- Expensive models (Opus) only for orchestration; Sonnet for creative work; Haiku for routine tasks.
- **Bash over Agents** -- Build checks run as shell commands; agents are only spawned on failure.
- **Combined Reviews** -- One QA agent (Testing Engineer) handles test strategy, test writing, acceptance criteria, and security checks.

### Portable and Non-Invasive

- Installs into any project via `setup.sh` -- no modifications to existing code.
- All framework files live under `.claude/` and `.pipeline/` -- cleanly separated from project code.
- `CLAUDE.md` and `project.json` are project-specific and never overwritten on update.
- Custom skills in `.claude/skills/` are preserved across updates.

### Autonomous-First

The entire workflow -- from ticket analysis through code implementation to PR creation -- runs without human intervention. The human only reviews the PR and says "merge".

---

## System Architecture

```
                            +-----------------------+
                            |    Just Ship Board    |
                            |  (Next.js, Supabase)  |
                            |  board.just-ship.io   |
                            +----------+------------+
                                       |
                            Events (POST /api/events)
                                       |
+---------------------+    +-----------+-----------+    +----------------+
|  Claude Code CLI    |    |   Pipeline Worker     |    |   Supabase     |
|  (Interactive)      |    |   (VPS, polling)      |    |   (Tickets,    |
+--------+------------+    +-----------+-----------+    |    Events,     |
         |                             |                |    Auth)       |
         |    +------------------------+                +-------+--------+
         |    |                                                 |
         v    v                                                 |
   +---------------+          +----------------+                |
   |  Orchestrator  | ------> |   run.ts        |<--------------+
   |  (Opus)        |         |  (SDK query)    |
   +-------+-------+         +----------------+
           |
     +-----+------+----------+
     |     |      |          |
     v     v      v          v
   +---+ +---+ +---+     +---+
   |BE | |FE | |DB |     |QA |
   |   | |   | |   |     |   |
   +---+ +---+ +---+     +---+
  Sonnet Sonnet Haiku    Haiku
```

The system has three entry points that converge on the same orchestrator:

- **Claude Code CLI** -- Developer triggers `/develop` interactively. The orchestrator runs inside the CLI session.
- **Pipeline Worker** -- A systemd service on a VPS polls Supabase for tickets with `status=ready_to_develop`, claims them atomically, and calls `executePipeline()` from `run.ts`.
- **Just Ship Board** -- A Next.js dashboard at `board.just-ship.io` that provides the ticket management UI and receives real-time events from both entry points.

All three share the same Supabase database for tickets, events, and authentication.

---

## Directory Structure

### Framework Repository

```
just-ship/                         # Framework repository
+-- setup.sh                       # Install + update script
+-- settings.json                  # Template for .claude/settings.json
+-- agents/                        # Agent definitions (markdown + frontmatter)
|   +-- orchestrator.md            # Main orchestrator (Opus)
|   +-- backend.md                 # API, hooks, business logic (Sonnet)
|   +-- frontend.md                # UI components, design-aware (Sonnet)
|   +-- data-engineer.md           # Migrations, RLS, types (Haiku)
|   +-- devops.md                  # Build checks, fixes (Haiku)
|   +-- qa.md                      # Testing Engineer: test strategy, tests, AC verification (Haiku)
|   +-- security.md                # Security review (Haiku)
+-- commands/                      # Slash commands
|   +-- ticket.md                  # Write a ticket (/ticket)
|   +-- develop.md                 # Implement next ticket (/develop)
|   +-- ship.md                    # Commit, push, PR, merge, done (/ship, /ship T-{N})
|   +-- just-ship-review.md         # Checkout, build, dev-server, test (/just-ship-review, /just-ship-review T-{N})
|   +-- just-ship-status.md         # Show branches, PRs, board, worktrees (/just-ship-status)
|   +-- setup-just-ship.md          # Auto-detect stack, configure project
|   +-- just-ship-update.md          # Sync templates after framework update
+-- skills/                        # Framework skills (copied to projects)
|   +-- ticket-writer.md           # PM-quality ticket writing
|   +-- design.md                  # Design system awareness
|   +-- frontend-design.md         # Frontend design patterns
|   +-- creative-design.md         # Greenfield design
|   +-- ux-planning.md             # UX planning
|   +-- backend.md                 # Backend patterns
|   +-- data-engineer.md           # Database patterns
|   +-- webapp-testing.md          # Testing strategy (pyramid, frameworks, mocking) + Playwright
|   +-- plugin-security-gate/      # Plugin security scanning (prompt injection, supply chain)
+-- pipeline/                      # SDK pipeline runner (TypeScript)
|   +-- run.ts                     # Single execution (CLI or imported by server.ts)
|   +-- run.sh                     # Bash wrapper for run.ts
|   +-- server.ts                  # HTTP server (Board-triggered /api/launch, /api/answer, /api/ship)
|   +-- package.json               # Dependencies (claude-agent-sdk, tsx)
|   +-- lib/
|       +-- config.ts              # Project config loader
|       +-- load-agents.ts         # Agent definition parser
|       +-- event-hooks.ts         # Just Ship Board event streaming
|       +-- change-summary.ts      # Git-based change summary generator
+-- templates/                     # Templates for project files
|   +-- CLAUDE.md                  # Project instructions template
|   +-- project.json               # Project config template
+-- apps/
|   +-- board/                     # Just Ship Board (Next.js)
+-- vps/                           # VPS infrastructure (Docker, Caddy, systemd, setup scripts, monitoring)
|   +-- Dockerfile                  # Pipeline container image
|   +-- entrypoint.sh               # Container startup script
|   +-- docker-compose.yml          # Caddy + pipeline-server + Bugsink + Dozzle
|   +-- Caddyfile                   # Reverse proxy with auto-TLS, security headers
|   +-- setup-vps.sh                # Initial VPS provisioning
|   +-- connect-project.sh          # Connect a project to VPS via SSH
|   +-- just-ship-updater.sh        # Host-level update agent (zero-downtime)
|   +-- pipeline-container-monitor.sh # Health monitoring with Telegram alerts
|   +-- logs.sh                     # Remote Docker log viewer via SSH
+-- .claude/
|   +-- hooks/                     # Event streaming hooks
|   |   +-- detect-ticket.sh       # SessionStart: extract ticket from branch
|   |   +-- detect-ticket-post.sh  # PostToolUse: re-detect ticket after branch changes
|   |   +-- quality-gate.sh        # PostToolUse: lint + format check on Edit/Write
|   |   +-- on-agent-start.sh      # SubagentStart: send event to Board
|   |   +-- on-agent-stop.sh       # SubagentStop: send event to Board
|   |   +-- on-session-end.sh      # SessionEnd: send completion event
|   +-- scripts/
|       +-- send-event.sh          # Event posting utility
+-- docs/
    +-- ARCHITECTURE.md            # This file
```

### Target Project (after setup)

```
your-project/
+-- CLAUDE.md                      # Project-specific instructions (customize!)
+-- project.json                   # Central config (stack, build, pipeline IDs)
+-- .claude/
|   +-- agents/                    # From framework (auto-updated)
|   +-- commands/                  # From framework (auto-updated)
|   +-- skills/                    # Framework + your custom skills
|   +-- hooks/                     # Event streaming hooks
|   +-- scripts/                   # Utility scripts
|   +-- settings.json              # Permissions + hook config
|   +-- .pipeline-version          # Installed framework version
|   +-- .template-hash             # Template change detection
+-- .pipeline/
    +-- run.sh                     # Pipeline runner wrapper
    +-- run.ts                     # SDK pipeline execution (invoked by /develop or the VPS HTTP server)
    +-- package.json               # Pipeline dependencies
    +-- lib/                       # Config, agent loader, model router, event hooks
```

---

## Agent System

### Agent Definition Format

Each agent is a markdown file with YAML frontmatter:

```markdown
---
name: backend
description: Backend-Entwickler fuer API-Endpoints, Shared Hooks und Business Logic.
tools: Read, Write, Edit, Bash, Grep, Glob
model: inherit
permissionMode: bypassPermissions
---

# Agent instructions in markdown...
```

The `load-agents.ts` module parses these definitions at runtime, extracting tools, model preferences, and the prompt body for the Claude Agent SDK.

### Agent Roster

| Agent | Role | Model | When Used |
|-------|------|-------|-----------|
| **Orchestrator** | Plans, delegates, ships | Opus | Always -- drives the entire flow |
| **Backend** | API endpoints, shared hooks, business logic | Sonnet | API/hook changes |
| **Frontend** | UI components, pages (design-aware) | Sonnet | UI changes |
| **Data Engineer** | DB migrations, RLS policies, TypeScript types | Haiku | Schema changes |
| **DevOps** | Build checks, lint fixes, TypeScript compilation | Haiku | Only on build failure |
| **Code Review** | Reviews diff against main, fixes code quality / patterns / edge cases / performance | Sonnet | Always (after build check) |
| **QA (Testing Engineer)** | Test strategy, test writing, AC verification, security check | Haiku | Always (review phase) |
| **Security** | Deep security review (Auth, RLS, input validation) | Haiku | Security-critical changes |

### Orchestrator Workflow

Every `/develop` run executes a strict 10-step pipeline. No step is optional, no step requires human intervention:

```
 1  Ticket finden        Pick next ready_to_develop ticket from Board API
 2  Ticket übernehmen    Display ticket, continue immediately (no confirmation)
 3  Branch + Status      Status → in_progress, create feature branch in worktree, send event
 3½ Triage               Haiku analyzes ticket quality, enriches description, sets QA tier
 4  Planning             Orchestrator reads 5-10 affected files, formulates agent instructions
 5  Implementation       Sub-agents in parallel (data-engineer first if schema changes)
 6  Build Check          Run build commands -- DevOps agent only on failure
 6½ Code Review          Review diff against main -- fix quality/pattern/security issues directly
 7  Review               QA agent checks acceptance criteria + security
 8  Docs Check           Auto-update CHANGELOG, README, ARCHITECTURE, VPS docs, CONTRIBUTING
 9  Ship (no merge)      Commit → Push → PR → status "in_review" → Preview URL (Vercel/Coolify/Shopify)
10  Automated QA         Build + tests + optional Playwright screenshots, QA report on PR
```

The human only reviews the PR and says "merge".

#### Step 8: Docs Check

Documentation is not a separate task -- it is an automated step in every development run. The agent analyzes `git diff` to determine which docs are affected:

| Changed files | Updated docs |
|---|---|
| Any change (always) | `CHANGELOG.md` -- entry under `[Unreleased]` (Keep-a-Changelog) |
| `commands/*.md` | `README.md` -- commands table + architecture |
| `agents/*.md` | `README.md` -- agents table |
| `skills/*.md` | `README.md` -- skills table |
| Pipeline, agents, commands | `README.md` -- workflow diagram |
| Pipeline, agents, config | `docs/ARCHITECTURE.md` -- affected sections |
| Architecture structures | `CLAUDE.md` -- architecture section |
| Commands, agents, skills | `templates/CLAUDE.md` -- template for new projects |
| Worker, server | `docs/ARCHITECTURE.md` -- pipeline server section |
| Workflow, conventions | `CONTRIBUTING.md` -- contributing guidelines |

Only existing files are updated -- no new docs are created. Docs changes are part of the same commit as the code.

### Parallelization Strategy

Sub-agents are spawned via the Claude Agent SDK's `Agent` tool. Multiple `Agent` tool calls in a single response execute in parallel -- this typically saves 50%+ time:

- **Sequential**: data-engineer first (if schema changes exist).
- **Parallel**: backend + frontend + other agents together.
- **Rule of thumb**: If agents work on different files, parallelize.

### Model Selection Strategy

The pipeline uses **Smart Model Routing** (`pipeline/lib/model-router.ts`) to assign the optimal model per agent phase:

| Phase | Model | Agents | Rationale |
|-------|-------|--------|-----------|
| Orchestration | Opus | orchestrator (hardcoded in `run.ts`) | Complex planning, multi-agent coordination |
| Planning | Opus | code-review, qa, security | Quality-critical analysis and review |
| Implementation | Sonnet | backend, frontend, data-engineer, devops | Code generation after clear plan — comparable quality at ~5x lower cost |
| Triage | Haiku | triage (hardcoded in `run.ts`) | Fast, mechanical ticket analysis |

**Configuration:** Override defaults via `pipeline.model_routing` in `project.json`:

```json
{
  "pipeline": {
    "model_routing": {
      "planning_model": "opus",
      "implementation_model": "sonnet",
      "planning_phases": ["code-review", "qa", "security"],
      "implementation_phases": ["backend", "frontend", "data-engineer", "devops"],
      "override": { "backend": "opus" }
    }
  }
}
```

**Fallback:** When `model_routing` is absent, all agents inherit the parent model (Opus) — preserving the pre-routing single-model behavior.

---

## Slash Commands

Commands are markdown files in `commands/` with frontmatter metadata. They provide the developer-facing workflow interface.

### Workflow Commands

| Command | Purpose | Autonomous |
|---------|---------|------------|
| `/ticket` | Write a structured ticket (bug, feature, improvement, spike). Supports splitting (auto-Epic + children) and manual grouping | No -- may ask user for input |
| `/develop` | Pick next ticket, implement end-to-end, create PR | Yes -- fully autonomous |
| `/ship` | Commit, push, PR, squash merge, delete branch, update board status. Supports `/ship T-{N}` | Yes -- zero questions |
| `/just-ship-review` | Checkout branch, install deps, build, start dev server for local testing | No -- interactive |
| `/spike-review` | Review completed spike, summarize findings, create follow-up tickets. Supports `--auto` | Both |

### Utility Commands

| Command | Purpose |
|---------|---------|
| `/just-ship-status` | Show all branches, PRs, board status, worktrees, and cleanup recommendations |
| `/setup-just-ship` | Auto-detect stack, fill `project.json`, connect Just Ship Board |
| `/just-ship-update` | Sync `CLAUDE.md` and `project.json` after framework update (auto-run by `just-ship update`) |

### Conversational Triggers

The following phrases automatically trigger `/ship`:

> "passt", "done", "fertig", "klappt", "sieht gut aus", "ship it", "mach zu"

### Command Flow

```
/ticket ---- writes ticket to Board -----------------------+
                                                            |
/develop -- picks ticket -- implements -- PR ------+        |
                                                   |        |
           /review -- checkout -- dev-server       |        |
           "passt" or /ship -----------------------+        |
                                                   v        |
                                          squash merge      |
                                          delete branch     |
                                          status: done      |
                                                            |
/spike-review T-{N} -- locate doc -- summarize -- create follow-up tickets
                                                            |
                              +-----------------------------+
                              v
                    Board Ticket Queue
                    (ready_to_develop -> in_progress -> in_review -> done)
```

---

## Skills System

Skills are specialized instruction sets that guide agents for specific types of work. The framework ships two categories:

### Framework Skills (auto-deployed)

Shipped with the framework and updated via `setup.sh --update`:

| Skill | Purpose |
|-------|---------|
| **ticket-writer** | Writes PM-quality tickets with acceptance criteria. Handles splits (auto-Epic + children) and manual grouping |
| **design** | Design system awareness for consistent UI |
| **frontend-design** | Frontend component patterns |
| **creative-design** | Greenfield design for new pages/features |
| **ux-planning** | UX planning and user flow design |
| **backend** | Backend patterns and API design |
| **data-engineer** | Database migration and RLS patterns |
| **webapp-testing** | Testing strategy (test pyramid, framework selection, mocking) + Playwright visual testing |
| **plugin-security-gate** | Scans third-party plugins for prompt injection, credential harvesting, and supply chain risks |

### Superpowers Plugin

Process skills (TDD, debugging, code review, planning) are provided by the [superpowers](https://github.com/obra/superpowers-marketplace) plugin, installed automatically during setup:

| Skill | Purpose |
|-------|---------|
| **brainstorming** | Explores requirements before implementation |
| **writing-plans** | Structured implementation planning |
| **executing-plans** | Plan execution with review checkpoints |
| **test-driven-development** | Red-green-refactor workflow |
| **systematic-debugging** | Root cause analysis |
| **requesting-code-review** | Initiating code review |
| **receiving-code-review** | Processing code review feedback |
| **verification-before-completion** | Evidence before assertions |
| **dispatching-parallel-agents** | Parallel task execution |
| **using-git-worktrees** | Isolated development branches |
| **finishing-a-development-branch** | Branch completion workflow |
| **subagent-driven-development** | Multi-agent coordination |

### Progressive Skill Disclosure

Skills use a two-stage loading model to reduce token overhead on the VPS:

- **Stage 1 (frontmatter-only):** `loadSkillFrontmatters()` reads only the YAML frontmatter (`name`, `description`, `triggers`) for each skill — roughly 100 tokens per skill instead of 200-500 lines of full content.
- **Stage 2 (on-demand):** `loadSkillFull()` / `loadSkillByName()` loads complete skill content when a skill is activated for a specific agent role.

The pipeline (`run.ts`) still loads full content for role-mapped skills via `loadSkills()`, but now also produces a `frontmatterIndex` — a compact text listing of all available skills — and tracks `totalFrontmatterTokens` vs `totalFullTokens` for cost visibility.

All skills must have valid frontmatter with `name`, `description`, and `triggers` fields. The `scripts/validate-skill-frontmatter.sh` script validates this before merge.

### Custom Skills

Projects can add their own skills in `.claude/skills/`. These are never touched by framework updates.

---

## Pipeline SDK

The pipeline runner is a TypeScript application built on the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk). It provides two entry points:

### `run.ts` -- Single Execution

Used for CLI invocation or called by the HTTP server after a Board-initiated trigger:

```bash
npx tsx run.ts <TICKET_ID> <TITLE> [DESCRIPTION] [LABELS]
```

Internally:

1. Loads `project.json` config.
2. Creates a feature branch from main.
3. Loads all agent definitions from `.claude/agents/`.
4. Applies **Smart Model Routing** — assigns optimal model per agent phase (see [Model Selection Strategy](#model-selection-strategy)).
5. Builds the orchestrator prompt with ticket details.
6. Calls `query()` from the Agent SDK with the orchestrator prompt.
7. Ships: pushes branch, creates PR, verifies remote branch exists.
8. Outputs JSON result on stdout (for automation/n8n integration).

Note: The orchestrator only commits locally. Push, PR creation, and ticket status updates are handled by the pipeline infrastructure (`run.ts`) after the orchestrator exits, ensuring these steps always execute reliably.

```typescript
for await (const message of query({
  prompt,
  options: {
    model: "opus",
    permissionMode: "bypassPermissions",
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent"],
    agents,           // Loaded from .claude/agents/*.md
    hooks,            // Just Ship Board event streaming
    maxTurns: 200,
  },
})) { ... }
```

### `server.ts` -- Board-Triggered HTTP Server

Runs as the `pipeline-server` container on a VPS (or the `just-ship-server@` systemd unit for bare-metal installs). It is **not** a polling loop — every autonomous run starts with an explicit HTTP call from the Board when a user clicks the Play button on a ticket.

```
Request lifecycle:
  1. Board sends POST /api/launch { ticket_number, project_id }
     Auth: X-Pipeline-Key header (per-server secret)
  2. Server validates the key, rate-limits, and fetches the ticket via the Board API
  3. Atomic claim: PATCH tickets/:num { pipeline_status: "running", status: "in_progress" }
  4. Spawns executePipeline() from run.ts for this ticket (runs async, returns 202 immediately)
  5. On success: PATCH tickets/:num { pipeline_status: "done", status: "in_review", review_url }
  6. On failure: PATCH tickets/:num { pipeline_status: "failed" } + agent_failed event
```

**Guarantees:**

- **No polling.** The Engine does nothing unbidden. A ticket with `status='ready_to_develop'` stays untouched until the Play button fires `/api/launch`. This is the explicit contract from the Operating Model (see `docs/just-ship-operating-model.md`).
- Atomic claim via `pipeline_status` prevents double-processing when two trigger requests arrive for the same ticket.
- Graceful drain on SIGTERM: refuses new launches, lets active runs complete, then exits.
- Lifecycle recovery (stuck-running / paused / failed ticket reset) runs on server startup — not on a timer.

Other routes the server exposes: `POST /api/events` (Board event handler that forwards to launch), `POST /api/answer` (resume a paused pipeline), `POST /api/ship` (merge a PR for a ticket), `GET /api/status/:ticket` (current pipeline status).

### JSON Output

The pipeline emits structured JSON on stdout for automation:

```json
{
  "status": "completed",
  "ticket_id": "T-162",
  "branch": "feature/T-162-short-description",
  "project": "my-project"
}
```

---

## Just Ship Board

### Overview

The Just Ship Board is a multi-tenant SaaS dashboard that provides real-time visibility into the autonomous development pipeline. It serves as the central ticket and project management tool, purpose-built for collaboration between human developers and AI agents.

Tickets are created either manually in the Board UI or via the Claude Code `/ticket` command. AI agents work through tickets autonomously while status updates appear in real-time on the Kanban board.

**Production:** `board.just-ship.io` (Vercel)

### Tech Stack

| Category | Technology | Version |
|----------|-----------|---------|
| Framework | Next.js (App Router) | 16 |
| UI Library | React | 19 |
| Language | TypeScript | 5 |
| Styling | Tailwind CSS | 4 |
| Components | shadcn/ui (base-nova theme) | -- |
| Backend/Auth/DB | Supabase (Auth, PostgreSQL, Realtime, RLS) | -- |
| State Management | TanStack Query | 5 |
| Forms | React Hook Form + Zod v4 | -- |
| Drag and Drop | @dnd-kit | -- |
| Icons | Lucide React | -- |
| Markdown | react-markdown + remark-gfm | -- |
| Package Manager | npm | -- |

**Notable library details:**

- shadcn/ui base-nova uses `@radix-ui/react-*` primitives.
- Zod v4 with `@hookform/resolvers` -- use `resolver: zodResolver(schema) as any` for `.default()` fields.
- Server Components for initial data fetching, Client Components with TanStack Query for mutations and interactivity.

### Board Architecture

```
                            +--------------------------------+
                            |        Just Ship Board          |
                            |      (Next.js 16 App Router)    |
                            |       board.just-ship.io        |
                            +-----------+--------------------+
                                        |
                   +--------------------+--------------------+
                   |                    |                     |
                   v                    v                     v
           +--------------+    +--------------+    +--------------+
           |   Web UI     |    | Pipeline API |    | Events API   |
           |  (SSR + CSR) |    | (REST)       |    | (REST)       |
           +------+-------+    +------+-------+    +------+-------+
                  |                    |                    |
                  +--------------------+--------------------+
                                       |
                                       v
                            +--------------------------------+
                            |           Supabase              |
                            |  +----------+ +---------------+ |
                            |  | Auth     | | PostgreSQL    | |
                            |  | (JWT)    | | (RLS)         | |
                            |  +----------+ +---------------+ |
                            |  +--------------------------+   |
                            |  | Realtime (Subscriptions) |   |
                            |  +--------------------------+   |
                            +--------------------------------+
                                       ^
                                       |
                   +-------------------+-------------------+
                   |                   |                    |
          +----------------+  +-------------------+  +----------+
          | Claude Code    |  | Pipeline Worker   |  | Other    |
          | (in repos)     |  | (Hooks/Events)    |  | Clients  |
          +----------------+  +-------------------+  +----------+
```

**Data flows:**

1. **Web UI to Supabase** -- Server Components fetch via Server Client; Client Components use TanStack Query + Browser Client for mutations.
2. **Pipeline API to Supabase** -- Bearer Token Auth (`adp_...`), validated via SHA-256 hash lookup in `api_keys`.
3. **Claude Code to Supabase** -- Status updates via MCP SQL tool (`mcp__claude_ai_Supabase__execute_sql`) or Board REST API.
4. **Realtime** -- Supabase Realtime subscriptions on `task_events` INSERT trigger agent indicators on ticket cards.

### Board Directory Structure

```
src/
+-- app/
|   +-- (auth)/                           # Auth Route Group (no URL prefix)
|   |   +-- login/page.tsx                # Sign-in
|   |   +-- register/page.tsx             # Sign-up
|   |   +-- forgot-password/page.tsx      # Password reset
|   +-- auth/callback/                    # Supabase OAuth Callback
|   +-- invite/[token]/page.tsx           # Accept workspace invitation
|   +-- new-workspace/page.tsx            # Create workspace
|   +-- reset-password/page.tsx           # Set new password
|   +-- [slug]/                           # Workspace scope (dynamic)
|   |   +-- page.tsx                      # Redirect to /[slug]/board
|   |   +-- board/page.tsx                # Kanban Board (main view)
|   |   +-- tickets/page.tsx              # Ticket list (table view)
|   |   +-- settings/
|   |       +-- page.tsx                  # General Settings
|   |       +-- members/page.tsx          # Team and invitations
|   |       +-- api-keys/page.tsx         # Manage API keys
|   +-- api/
|   |   +-- v1/pipeline/[slug]/tickets/   # Pipeline REST API
|   |   |   +-- route.ts                  # GET (list) / POST (create)
|   |   |   +-- [id]/route.ts             # GET / PATCH / DELETE
|   |   +-- tickets/                      # Internal Ticket API
|   |   |   +-- route.ts                  # GET (list)
|   |   |   +-- [number]/route.ts         # GET / PATCH
|   |   +-- events/route.ts               # POST (log agent events)
|   |   +-- check-slug/route.ts           # GET (slug availability)
|   |   +-- workspace/[workspaceId]/
|   |       +-- api-keys/route.ts         # POST (create key)
|   +-- page.tsx                          # Root redirect
|   +-- layout.tsx                        # Root layout
+-- components/
|   +-- board/
|   |   +-- board.tsx                     # Board container (Server to Client bridge)
|   |   +-- board-client.tsx              # Client-side board with DnD
|   |   +-- board-column.tsx              # Single Kanban column
|   |   +-- board-group-row.tsx           # Grouped row (by project)
|   |   +-- board-header.tsx              # Board header
|   |   +-- board-toolbar.tsx             # Filters and actions
|   |   +-- ticket-card.tsx               # Ticket card in board
|   |   +-- agent-panel.tsx               # Agent activity panel
|   +-- tickets/
|   |   +-- create-ticket-dialog.tsx      # Create new ticket
|   |   +-- ticket-detail-sheet.tsx       # Ticket detail side sheet
|   |   +-- ticket-list-view.tsx          # Table view
|   +-- settings/
|   |   +-- settings-general.tsx          # Workspace name/slug editing
|   |   +-- members-view.tsx              # Member list
|   |   +-- invite-member-dialog.tsx      # Invitation dialog
|   |   +-- api-keys-view.tsx             # API key management
|   |   +-- create-api-key-dialog.tsx     # Create new key
|   +-- layout/
|   |   +-- sidebar.tsx                   # Main navigation
|   +-- shared/
|   |   +-- status-badge.tsx              # Status badge component
|   |   +-- empty-state.tsx               # Empty state display
|   |   +-- command-palette.tsx           # Cmd+K command palette
|   |   +-- markdown-renderer.tsx         # Markdown rendering
|   +-- ui/                               # shadcn/ui primitives
|   +-- providers.tsx                     # TanStack QueryClientProvider
+-- lib/
|   +-- supabase/
|   |   +-- client.ts                     # Browser Supabase Client
|   |   +-- server.ts                     # Server Supabase Client
|   |   +-- service.ts                    # Service Role Client (API routes)
|   |   +-- middleware.ts                 # Auth middleware
|   +-- api/
|   |   +-- pipeline-key-auth.ts          # Bearer token validation
|   |   +-- workspace-auth.ts             # Workspace membership check
|   |   +-- error-response.ts             # Standardized API responses
|   +-- validations/
|   |   +-- ticket.ts                     # Zod schemas for tickets
|   |   +-- workspace.ts                  # Zod schemas for workspaces
|   |   +-- project.ts                    # Zod schemas for projects
|   |   +-- api-key.ts                    # Zod schemas for API keys
|   +-- workspace-context.tsx             # WorkspaceProvider + useWorkspace()
|   +-- types.ts                          # TypeScript interfaces
|   +-- constants.ts                      # Status/Priority/Agent constants
+-- middleware.ts                          # Next.js route middleware
```

### Data Model

The Board uses Supabase PostgreSQL with the following tables:

```
+------------------+     +------------------+
|   workspaces     |     | workspace_members|
+------------------+     +------------------+
| id (uuid, PK)   |<----| workspace_id (FK)|
| name             |     | user_id          |
| slug (unique)    |     | role             |
| created_by       |     | joined_at        |
| created_at       |     +------------------+
| updated_at       |
+--------+---------+     +------------------+
         |               | workspace_invites|
         |               +------------------+
         +-------------->| workspace_id (FK)|
         |               | email            |
         |               | token (unique)   |
         |               | invited_by       |
         |               | accepted_at      |
         |               | expires_at       |
         |               +------------------+
         |
         |               +------------------+
         +-------------->|   api_keys       |
         |               +------------------+
         |               | id (uuid, PK)    |
         |               | workspace_id (FK)|
         |               | name             |
         |               | key_hash (SHA256)|
         |               | key_prefix       |
         |               | last_used_at     |
         |               | revoked_at       |
         |               | created_by       |
         |               +------------------+
         |
         |               +------------------+
         +-------------->|   projects       |
         |               +------------------+
         |               | id (uuid, PK)    |
         |               | workspace_id (FK)|
         |               | name             |
         |               | description      |
         |               +------------------+
         |
         |               +------------------------------+
         +-------------->|          tickets              |
                         +------------------------------+
                         | id (uuid, PK)                |
                         | workspace_id (FK)            |
                         | number (auto-increment)      |
                         | title                        |
                         | body (markdown)              |
                         | status (enum)                |
                         | priority (enum)              |
                         | tags (text[])                |
                         | project_id (FK -> projects)  |
                         | parent_ticket_id (FK -> self)|
                         | assignee_id                  |
                         | branch                       |
                         | pipeline_status              |
                         | assigned_agents (text[])     |
                         | summary                      |
                         | test_results                 |
                         | preview_url                  |
                         | due_date                     |
                         | created_by                   |
                         | created_at / updated_at      |
                         +--------------+---------------+
                                        |
                                        v
                         +------------------------------+
                         |       task_events            |
                         +------------------------------+
                         | id (uuid, PK)                |
                         | ticket_id (FK -> tickets)    |
                         | project_id (FK -> projects)  |
                         | agent_type (enum)            |
                         | event_type (enum)            |
                         | metadata (jsonb)             |
                         | created_at                   |
                         +------------------------------+
```

### Enums

**Ticket Status:** `backlog` | `ready_to_develop` | `in_progress` | `in_review` | `done` | `cancelled`

**Ticket Priority:** `low` | `medium` | `high`

**Pipeline Status:** `NULL` | `queued` | `running` | `done` | `failed`

**Agent Types:** `orchestrator` | `frontend` | `backend` | `data-engineer` | `qa` | `devops` | `security`

**Event Types:** `agent_started` | `agent_completed` | `agent_spawned` | `tool_use` | `log`

### Row Level Security

All tables are protected by RLS at the database level. Access is enforced through `workspace_members` membership -- no client-side workspace filtering is required. Every query automatically scopes to workspaces the authenticated user belongs to.

### Routing and Middleware

**Public routes (no authentication required):**

| Route | Purpose |
|-------|---------|
| `/` | Root redirect |
| `/login` | Sign in |
| `/register` | Sign up |
| `/forgot-password` | Password reset |
| `/invite/[token]` | Accept invitation |
| `/auth/callback` | OAuth callback |
| `/api/v1/pipeline/*` | Pipeline REST API (Bearer auth) |
| `/api/tickets/*` | Ticket API (Bearer auth) |
| `/api/events` | Events API (Bearer auth) |

**Protected routes (session authentication required):**

| Route | Purpose |
|-------|---------|
| `/new-workspace` | Create workspace |
| `/[slug]/board` | Kanban board |
| `/[slug]/tickets` | Ticket list |
| `/[slug]/settings` | Workspace settings |
| `/[slug]/settings/members` | Team members |
| `/[slug]/settings/api-keys` | API keys |

**Middleware behavior:**

1. Authenticated user on auth page -- redirect to `/`.
2. Unauthenticated user on protected page -- redirect to `/login?redirect=...`.
3. Root `/` -- authenticated: first workspace `/[slug]/board`; unauthenticated: `/login`.

### Authentication

**User Auth (Web UI):**

- Supabase Auth with email/password.
- Session management via `@supabase/ssr` (cookie-based).
- OAuth callback via `/auth/callback`.

**API Auth (Pipeline):**

- Bearer token in format `adp_<64 hex characters>`.
- Token validation flow:
  1. Extract `Authorization: Bearer adp_...` header.
  2. Compute SHA-256 hash of the token.
  3. Look up hash in `api_keys.key_hash`.
  4. On match: extract `workspace_id`, update `last_used_at`.
  5. No match: return `401 Unauthorized`.
- The plaintext key is shown only once at creation time.
- The UI displays only the `key_prefix` (first 8 hex characters).

**Workspace membership:**

- `workspace_members` table with roles (`owner`, `member`).
- RLS policies enforce membership at the database level.
- No manual filtering required in application code.

### Pipeline API

**Base URL:** `https://board.just-ship.io/api`

**Authentication:** `Authorization: Bearer adp_<key>`

**Ticket endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/pipeline/[slug]/tickets` | List tickets (query: `status`, `project`, `limit`) |
| `POST` | `/v1/pipeline/[slug]/tickets` | Create ticket |
| `GET` | `/v1/pipeline/[slug]/tickets/[id]` | Get single ticket |
| `PATCH` | `/v1/pipeline/[slug]/tickets/[id]` | Update ticket (status, branch, agents) |
| `DELETE` | `/v1/pipeline/[slug]/tickets/[id]` | Delete ticket |

**Internal APIs:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tickets` | List tickets (Bearer auth) |
| `GET` | `/tickets/[number]` | Get ticket by number |
| `PATCH` | `/tickets/[number]` | Update ticket |
| `POST` | `/events` | Log agent event |
| `GET` | `/check-slug` | Check slug availability |
| `POST` | `/workspace/[id]/api-keys` | Create API key |

### Kanban Board

**Columns:**

| Column | Status | Color |
|--------|--------|-------|
| Backlog | `backlog` | Grey |
| Ready | `ready_to_develop` | Blue |
| In Progress | `in_progress` | Yellow |
| In Review | `in_review` | Purple |
| Done | `done` | Green |

**Features:**

- **Drag and Drop** -- @dnd-kit with optimistic updates. Ticket status updates immediately in the UI; the PATCH request follows asynchronously.
- **Agent Indicator** -- A pulsing dot appears on ticket cards when `task_events` are younger than 60 seconds, showing that an agent is actively working.
- **Realtime** -- Supabase Realtime subscription on `task_events` INSERT events.
- **Colored Columns** -- Notion-inspired column backgrounds with colored header pills.
- **Activity Timeline** -- The ticket detail sheet shows a chronological list of agent events.
- **Command Palette** -- `Cmd+K` for quick navigation and actions.
- **Grouping** -- Tickets can be grouped by project.

**Kanban data flow:**

```
Server Component loads tickets (Supabase Server Client)
        |
        v
Client Component hydrates with TanStack Query (initialData)
        |
        +-- Drag & Drop --> optimistic update --> PATCH mutation
        |
        +-- New Ticket --> CreateTicketDialog --> INSERT mutation
        |
        +-- Ticket Detail --> TicketDetailSheet --> PATCH mutation
        |
        +-- Realtime Subscription --> task_events INSERT
                |
                v
          Agent indicator pulses on affected card
```

---

## Event Streaming

### Event API

```
POST {board_url}/api/events
Header: X-Pipeline-Key: adp_<hex>

{
  "ticket_number": 42,
  "agent_type": "backend",
  "event_type": "agent_started",
  "metadata": { ... }
}
```

### Event Types

| Event | When |
|-------|------|
| `agent_started` | Sub-agent begins work |
| `completed` | Sub-agent finishes |
| `tool_use` | File Write/Edit operation |
| `pipeline_failed` | Pipeline encountered an error |

### Two Streaming Modes

1. **SDK Hooks** (Pipeline/VPS mode) -- `event-hooks.ts` registers callbacks for `SubagentStart`, `SubagentStop`, and `PostToolUse` events via the Agent SDK. These fire automatically during pipeline execution.
2. **Shell Hooks** (Interactive mode) -- `settings.json` configures hooks for `SessionStart`, `SubagentStart`, `SubagentStop`, and `SessionEnd` that call shell scripts in `.claude/hooks/`.

Both modes post to the same Event API, providing a unified view in the Just Ship Board regardless of execution mode.

### Realtime Updates

Events are stored in the `task_events` table in Supabase. The Board subscribes to INSERT events on this table via Supabase Realtime (PostgreSQL change notifications). When a new event arrives, the corresponding ticket card updates its agent indicator in real-time -- no polling required.

---

## Hooks System

Claude Code hooks are shell scripts triggered by lifecycle events. The framework uses them for ticket detection and event streaming in interactive mode.

### Configured Hooks (settings.json)

| Hook | Script | Purpose |
|------|--------|---------|
| `SessionStart` | `detect-ticket.sh` | Extract ticket number from branch name, set `TICKET_NUMBER` env var |
| `PreToolUse` (Edit/Write/NotebookEdit) | `main-context-edit-block.sh` | Block state-mutating tool calls from the main Claude Code context while a ticket is active. Forces edits through a subagent so the skill loader (`pipeline/lib/load-skills.ts`) injects the matching domain skill. Allow-list covers `.claude/{rules,scripts,hooks}/`, `.worktrees/T-*/`, and ephemeral session-state files. Read-only-defensive default: exits 0 on missing context |
| `PostToolUse` (Bash) | `detect-ticket-post.sh` | Re-detect ticket number after Bash commands (catches mid-session branch changes) |
| `PostToolUse` (Edit/Write) | `quality-gate.sh` | Run lint + format checks on the changed file. Format auto-fixes, lint errors block the agent |
| `SubagentStart` | `on-agent-start.sh` | Send `agent_started` event to Just Ship Board; also writes `.claude/.agent-map/<id>` marker consumed by `main-context-edit-block.sh` to detect live subagents |
| `SubagentStop` | `on-agent-stop.sh` | Send `completed` event to Just Ship Board; removes the `.claude/.agent-map/<id>` marker |
| `SessionEnd` | `on-session-end.sh` | Send session completion event |

### Ticket Detection Flow

Ticket detection is fully hook-driven. Claude Code never writes `.active-ticket` directly.

**On session start**, `detect-ticket.sh`:
1. Reads the current git branch name.
2. Extracts the ticket number (e.g., `feature/T-551-foo` yields `551`).
3. Writes it to `.claude/.active-ticket` and `$CLAUDE_ENV_FILE`.
4. Sends an `agent_started` event for the orchestrator.

**After every Bash command**, `detect-ticket-post.sh`:
1. Reads the current git branch name.
2. Extracts the ticket number (supports both `T-551-foo` and legacy `551-foo` formats).
3. Writes to `.active-ticket` only if the value changed.
4. Catches branch changes that happen mid-session (e.g., `/develop` creating a new branch).

---

## Configuration

### project.json

Central configuration read by all agents, commands, and the pipeline runner:

```json
{
  "name": "my-project",
  "description": "Project description",
  "stack": {
    "language": "typescript",
    "framework": "Next.js 15 (App Router)",
    "styling": "Tailwind CSS",
    "database": "Supabase (PostgreSQL)",
    "testing": "Vitest",
    "package_manager": "pnpm"
  },
  "build": {
    "web": "pnpm run build",
    "dev": "pnpm run dev",
    "test": "npx vitest run"
  },
  "paths": {
    "components": "src/components",
    "pages": "src/app",
    "lib": "src/lib",
    "api": "src/app/api"
  },
  "supabase": {
    "project_id": "abc123"
  },
  "pipeline": {
    "project_id": "uuid",
    "project_name": "My Project",
    "workspace_id": "uuid",
    "api_url": "https://board.just-ship.io",
    "api_key": "adp_<key>"
  },
  "conventions": {
    "branch_prefix": "feature/",
    "commit_format": "conventional",
    "language": "de"
  }
}
```

This file is gitignored because it contains the pipeline API key.

### CLAUDE.md

Project-specific instructions that provide context to all agents:

- Project description and architecture.
- Code conventions (imports, styling, patterns).
- Git conventions (branches, commits).
- Security requirements.
- Domain-specific knowledge.
- Ticket workflow steps and status update commands.

Generated from `templates/CLAUDE.md` during setup, then customized by the developer. Never overwritten on update.

### settings.json

Permissions and hook configuration:

```json
{
  "permissions": {
    "allow": [
      "Read(**)", "Edit(**)", "Write(**)",
      "Glob(**)", "Grep(**)", "Bash(*)",
      "mcp__claude_ai_Supabase__*",
      "mcp__claude_ai_Vercel__*",
      "mcp__claude_ai_n8n__*"
    ]
  },
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/detect-ticket.sh\"",
            "timeout": 5
          }
        ]
      }
    ],
    "SubagentStart": [ ... ],
    "SubagentStop": [ ... ],
    "SessionEnd": [ ... ]
  }
}
```

---

## Setup and Installation

### Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
- Git
- GitHub CLI (`gh`)
- Node.js (>= 18)

### First Installation

```bash
curl -fsSL https://just-ship.io/install | bash
```

Then open a new terminal and run in your project:

```bash
cd /path/to/your-project
just-ship setup

# Open a new Claude Code session and configure
claude
> /setup-just-ship
```

### What setup.sh Does

1. Checks prerequisites (`claude`, `git`, `gh`, `node`).
2. Copies agents, commands, skills, scripts, hooks to `.claude/`.
3. Copies pipeline runner to `.pipeline/`.
4. Installs pipeline dependencies (`npm install`).
5. Installs plugins from `project.json` (registries + dependencies).
6. Runs plugin security gate (`scripts/scan-plugin-security.sh`) — blocks installation on critical findings (prompt injection, credential harvesting, persistence).
7. Generates `project.json` (interactive prompts for project name and description).
8. Generates `CLAUDE.md` from template.
9. Generates `settings.json` with permissions and hook configuration.
10. Writes version marker to `.claude/.pipeline-version`.

### Updating

```bash
cd /path/to/your-project
~/just-ship/setup.sh --update
```

Updates only framework files -- never overwrites `CLAUDE.md`, `project.json`, or custom skills.

| Updated on --update | Never overwritten |
|---------------------|-------------------|
| `.claude/agents/*` | `CLAUDE.md` |
| `.claude/commands/*` | `project.json` |
| `.claude/skills/<framework>.md` | `.claude/skills/<custom>.md` |
| `.claude/hooks/*` | |
| `.claude/scripts/*` | |
| `.claude/settings.json` | |
| `.pipeline/*` | |

### Dry Run

```bash
~/just-ship/setup.sh --update --dry-run
```

Previews what would change without applying any modifications.

### Self-Install Guard

The framework repository itself uses symlinks (`.claude/commands` symlinked to `../commands`, etc.). Running `setup.sh` on the framework directory is detected and blocked to prevent self-corruption.

---

## VPS Deployment

The framework can run fully autonomously on a VPS. A systemd service polls for tickets and executes the pipeline without any human involvement.

### Architecture

```
VPS (Ubuntu 22.04)
+-- claude-dev user
+-- Docker: pipeline-server container (runs pipeline/server.ts)
+-- ~/projects/my-project/           # Project clone (mounted into container)
+-- ~/.just-ship/server-config.json  # Per-project config (project_id, api_key, repo_url)
+-- ~/.env                           # Global keys (ANTHROPIC_API_KEY, GH_*)
```

For bare-metal installs (without Docker), the `just-ship-server@{slug}` systemd template unit runs the same `pipeline/server.ts` process. Either way, the Engine only executes when the Board sends `POST /api/launch`.

### Server Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API authentication |
| `GH_TOKEN` | GitHub operations (PR, push) — optional if GitHub App configured |
| `GITHUB_APP_ID` | GitHub App ID (alternative to `GH_TOKEN`) |
| `GITHUB_APP_PRIVATE_KEY_PATH` | Path to GitHub App private key PEM file |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private key PEM content (alternative to path) |
| `GITHUB_APP_INSTALLATION_ID` | Default GitHub App installation ID for token generation |
| `SUPABASE_URL` | Supabase REST endpoint (for ticket status updates) |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `SUPABASE_PROJECT_ID` | Filter tickets by project |
| `PROJECT_DIR` | Absolute path to project clone |
| `PIPELINE_SERVER_KEY` | HMAC secret for Board `/api/launch` auth (`X-Pipeline-Key` header) |
| `PORT` | HTTP server port (default: 3001) |
| `MAX_FAILURES` | Consecutive failures before the server refuses new launches (default: 5) |
| `LOG_DIR` | Log directory (default: `~/pipeline-logs`) |
| `LOG_LEVEL` | Pino log level: `debug`, `info`, `warn`, `error` (default: `debug` in dev, `info` in production) |
| `BUGSINK_DSN` | Bugsink error tracking DSN (auto-configured in Docker) |

### Structured Logging

The pipeline uses **Pino** for structured JSON logging (`pipeline/lib/logger.ts`). Every log line includes `level`, `timestamp` (ISO 8601), and `service: "engine"`. Child loggers add correlation fields like `ticketNumber`, `workspaceId`, `branch`, and `requestId`.

Sensitive data (API keys, tokens, secrets) is automatically redacted via Pino's `redact` option — values are partially masked (first 4 + last 4 chars visible) before serialization, so secrets never reach the log stream.

Log level is controlled via `LOG_LEVEL` env var (defaults to `debug` in development, `info` in production).

### Monitoring

VPS deployments include built-in monitoring via two lightweight containers (~286 MB total):

- **Bugsink** (`/errors/`) — Error tracking with stack traces. The pipeline-server uses `@sentry/node` SDK pointed at the Bugsink DSN. Sentry-compatible, so switching to GlitchTip or Sentry Cloud later only requires changing the DSN.
- **Dozzle** (`/logs/`) — Live Docker container log viewer. Reads the Docker socket (read-only), zero code changes required. With structured JSON logging, Dozzle can parse and filter log fields directly.

Both UIs are protected by Caddy basicauth and only accessible through the reverse proxy.

### Multi-Project Support

One VPS can host multiple projects side by side. In the Docker setup, a single `pipeline-server` container multiplexes projects via `server-config.json` (keyed by project slug). On bare-metal installs, one `just-ship-server@{slug}` systemd unit runs per project. Either way, launches are routed by the `project_id` in the incoming `/api/launch` request — there is no polling.

### systemd Configuration

For bare-metal installs, the template unit (`just-ship-server@.service`) provides:

- Automatic restart on failure with 10-second delay.
- Rate limiting (5 restarts per 300 seconds).
- Security hardening (`NoNewPrivileges`, `PrivateTmp`).
- Resource limits (4 GB memory, 200% CPU quota, 65536 file descriptors).
- Fast graceful shutdown (30 seconds) — the HTTP server drains quickly; in-flight pipeline runs are tracked independently.
- Dual environment files: global keys (`.env`) + project-specific overrides (`.env.{slug}`).

The legacy polling worker unit (`just-ship-pipeline@.service`) has been removed. Older VPS installs are cleaned up automatically by `vps/setup-vps.sh` on next run.

---

## Sidekick

The Sidekick is an AI-powered in-app assistant that lets project admins create, search, and manage tickets directly from any website -- without leaving the page they're working on.

### How It Works

A lightweight JavaScript snippet (~3KB) is embedded in the target website. When activated, it opens a persistent split-view panel on the right side, loading the Sidekick UI from `board.just-ship.io` in an iframe. The chat interface communicates with the Just Ship Board backend, using Claude Sonnet for AI-powered conversations.

```
┌──────────────────────────────────┬────────────────────┐
│  Host site (narrowed)            │  iframe             │
│                                  │  board.just-ship.io │
│  ┌────────────────────────────┐  │  /sidekick/[slug]   │
│  │  Snippet (~3KB)            │  │                     │
│  │  - Activation (Ctrl+Shift+S)│ │  ┌───────────────┐  │
│  │  - Split-view layout       │  │  │ Sidebar       │  │
│  │  - postMessage bridge      │  │  │ (History)     │  │
│  │  - Context updates         │  │  ├───────────────┤  │
│  └────────────────────────────┘  │  │ Chat          │  │
│                                  │  │               │  │
│  Normal page, navigable          │  │ [Input]       │  │
│                                  │  └───────────────┘  │
└──────────────────────────────────┴────────────────────┘
```

### Embedding

```html
<script
  src="https://board.just-ship.io/sidekick.js"
  data-project="my-project-slug"
></script>
```

One line. No sensitive data in the HTML -- only the public project slug (not the internal UUID). The server resolves the slug to the internal project ID.

### Activation

- `Ctrl+Shift+S` -- keyboard shortcut
- `?sidekick` -- URL parameter
- State persists in `localStorage` -- survives page reloads

### Target Audience

Project admins and workspace members working on their own applications. Not for end users or anonymous visitors. The snippet renders nothing visible -- there's no hint of its existence for regular visitors. Authentication is required before any access.

### AI Capabilities

The Sidekick uses Claude Sonnet with tool use for three actions:

| Tool | Description |
|------|-------------|
| `create_ticket` | Creates a ticket in the Board with title, description, tags, priority |
| `search_tickets` | Searches existing tickets by title and body (`ILIKE`) |
| `list_my_tickets` | Lists the user's tickets, optionally filtered by status |

The AI automatically captures page context (URL, title) and includes it in ticket descriptions. Before creating a ticket, it searches for duplicates and asks the user if a match is found.

### Architecture

**Snippet (host site):**
- Vanilla JS, no dependencies, ~3KB minified
- Wraps `document.body` in a flex container, creates iframe alongside
- Patches `history.pushState`/`replaceState` for SPA navigation detection
- Sends context updates to iframe via `postMessage` with origin checks

**Sidekick App (iframe):**
- Next.js route at `/sidekick/[projectSlug]` -- standalone layout, no Board chrome
- React + shadcn/ui + TanStack Query (same stack as the Board)
- Conversation sidebar with history, chat area with streaming responses
- Inline ticket cards and search result cards

**Auth:**
- iframe is same-origin with Board -- Supabase session cookie works directly
- No session: "Sign in with Just Ship" button opens a popup at `board.just-ship.io/auth/sidekick`
- After login, popup sends `postMessage` to iframe, session refreshes without reload

**Backend API:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/sidekick/conversations` | Create conversation |
| `GET` | `/api/sidekick/conversations` | List conversations for project |
| `POST` | `/api/sidekick/conversations/[id]/messages` | Send message, receive SSE stream |
| `GET` | `/api/sidekick/conversations/[id]/messages` | Load message history |

All endpoints require Supabase session + workspace membership. Rate limited to 30 messages/min per user, 200/day per project.

### Data Model

```
+---------------------------+        +---------------------------+
|  sidekick_conversations   |        |    sidekick_messages      |
+---------------------------+        +---------------------------+
| id (uuid, PK)            |<-------| conversation_id (FK)      |
| workspace_id (FK)         |        | id (uuid, PK)            |
| project_id (FK)           |        | role (user/assistant)     |
| user_id (FK)              |        | content (text)            |
| title                     |        | context (jsonb)           |
| page_url                  |        | ticket_id (FK, optional)  |
| page_title                |        | search_results (jsonb)    |
| created_at / updated_at   |        | created_at                |
+---------------------------+        +---------------------------+
```

Both tables are protected by RLS -- users can only access their own conversations and messages.

### Board Directory Structure (Sidekick files)

```
src/
├── app/
│   ├── (sidekick)/
│   │   ├── layout.tsx                      # Standalone layout (no Board chrome)
│   │   └── sidekick/[projectSlug]/page.tsx # Sidekick main page
│   ├── (main)/auth/sidekick/page.tsx       # Auth popup for iframe login
│   └── api/sidekick/
│       ├── conversations/route.ts          # List/create conversations
│       └── conversations/[id]/messages/route.ts  # Send/load messages
├── components/sidekick/
│   ├── sidekick-client.tsx                 # Main client component
│   ├── sidekick-auth.tsx                   # Auth gate component
│   ├── chat-view.tsx                       # Chat interface
│   ├── message-bubble.tsx                  # Message rendering
│   └── conversation-sidebar.tsx            # Conversation list
├── lib/sidekick/
│   ├── ai.ts                              # Claude Sonnet integration + tools
│   └── auth.ts                            # Auth helpers
└── lib/validations/sidekick.ts             # Zod schemas

public/sidekick.js                          # Embeddable snippet
supabase/migrations/011_sidekick.sql        # DB migration
```

---

## Security Model

### Permission Model

- All file operations are allowed via `settings.json` permission config in interactive mode.
- Pipeline mode uses `bypassPermissions` with `allowDangerouslySkipPermissions` for fully autonomous execution.
- Interactive mode prompts the user for any non-allowed operations.

### Secrets Management

- No API keys, tokens, or secrets in code.
- `project.json` is gitignored because it contains the pipeline API key.
- VPS: secrets stored in `.env` files with `chmod 600`.
- Pipeline API keys stored as SHA-256 hashed values in Supabase -- plaintext is never persisted.
- `setup.sh` never generates or stores secrets.

### Agent Sandboxing

- Each agent has a defined set of allowed tools (specified in frontmatter).
- The orchestrator controls which agents are spawned and with what instructions.
- Agents cannot modify their own definitions or the framework.
- Sub-agents inherit the permission mode of their parent session.

---

## Cost Model

### Per-Ticket Costs (Anthropic API)

| Ticket Type | Agents | Estimated Cost |
|-------------|--------|----------------|
| Simple bug fix | Orchestrator + 1 agent | ~$1-2 |
| Feature with DB + UI | Orchestrator + 3 agents | ~$3-5 |
| Complex feature | Orchestrator + 5 agents | ~$5-10 |

### Model Cost Breakdown

- **Opus** (Orchestrator only) -- Most expensive, but used sparingly for planning and delegation.
- **Sonnet** (Backend, Frontend) -- Mid-range, used for creative implementation.
- **Haiku** (DB, DevOps, QA, Security) -- Cheapest, used for routine tasks.

### VPS Costs

- Hostinger VPS 1 or 2: ~$4-8/month.
- At 5 tickets/day: ~$15-25/day in API costs.
