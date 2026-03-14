# Architecture — Just Ship

Comprehensive technical documentation of the framework's architecture, components, and inner workings.

---

## Table of Contents

- [Overview](#overview)
- [Design Philosophy](#design-philosophy)
- [System Architecture](#system-architecture)
- [Agent System](#agent-system)
- [Slash Commands](#slash-commands)
- [Skills System](#skills-system)
- [Pipeline SDK](#pipeline-sdk)
- [Event Streaming & Just Ship Board](#event-streaming--dev-board)
- [Hooks System](#hooks-system)
- [Configuration](#configuration)
- [Setup & Installation](#setup--installation)
- [VPS Deployment](#vps-deployment)
- [Security Model](#security-model)
- [Cost Model](#cost-model)

---

## Overview

Just Ship is a portable multi-agent framework that turns Claude Code into an autonomous software development system. It provides a structured set of agents, commands, skills, and a pipeline runner that can be installed into any project — regardless of tech stack.

The framework operates in two modes:

1. **Interactive** — Developer works in Claude Code, uses slash commands (`/ticket`, `/develop`, `/ship`, `/merge`) to drive the workflow
2. **Autonomous** — A VPS worker polls a Supabase ticket queue, picks up tickets, and executes the full pipeline without human intervention

Both modes use the same agents, the same orchestrator logic, and the same shipping flow. The only difference is the entry point.

---

## Design Philosophy

### Token-Efficient by Design

Every component is optimized to minimize API token consumption:

- **No Planner Agent** — The Orchestrator plans itself by reading only the 5-10 affected files
- **No Spec Files** — Instructions go directly into agent prompts, avoiding the write-read-interpret round-trip
- **Model Tiering** — Expensive models (Opus) only for orchestration; Sonnet for creative work; Haiku for routine tasks
- **Bash over Agents** — Build checks run as shell commands; agents are only spawned on failure
- **Combined Reviews** — One QA agent handles both acceptance criteria and security checks

### Portable & Non-Invasive

- Installs into any project via `setup.sh` — no modifications to existing code
- All framework files live under `.claude/` and `.pipeline/` — cleanly separated from project code
- `CLAUDE.md` and `project.json` are project-specific and never overwritten on update
- Custom skills in `.claude/skills/` are preserved across updates

### Autonomous-First

The entire workflow — from ticket analysis through code implementation to PR creation — runs without human intervention. The human only reviews the PR and says "merge".

---

## System Architecture

```
                          ┌─────────────────────┐
                          │   Just Ship Board    │
                          │   (Next.js + Supa)   │
                          └──────────┬──────────┘
                                     │
                          Events (POST /api/events)
                                     │
┌───────────────────┐    ┌───────────┴───────────┐    ┌──────────────┐
│  Claude Code CLI  │    │    Pipeline Worker     │    │   Supabase   │
│  (Interactive)    │    │    (VPS, polling)       │    │   (Tickets)  │
└────────┬──────────┘    └───────────┬───────────┘    └──────┬───────┘
         │                           │                        │
         │    ┌──────────────────────┘                        │
         │    │                                               │
         ▼    ▼                                               │
   ┌──────────────┐          ┌──────────────┐                │
   │  Orchestrator │ ────────│   run.ts      │◄───────────────┘
   │  (Opus)       │         │  (SDK query)  │
   └──────┬───────┘          └──────────────┘
          │
    ┌─────┼─────┬──────────┐
    │     │     │          │
    ▼     ▼     ▼          ▼
  ┌───┐ ┌───┐ ┌───┐    ┌───┐
  │ BE│ │ FE│ │ DB│    │QA │
  │   │ │   │ │   │    │   │
  └───┘ └───┘ └───┘    └───┘
 Sonnet Sonnet Haiku   Haiku
```

### Directory Structure

```
just-ship/                         # Framework repository
├── setup.sh                       # Install + update script
├── settings.json                  # Template for .claude/settings.json
├── agents/                        # Agent definitions (markdown + frontmatter)
│   ├── orchestrator.md            # Main orchestrator (Opus)
│   ├── backend.md                 # API, hooks, business logic (Sonnet)
│   ├── frontend.md                # UI components, design-aware (Sonnet)
│   ├── data-engineer.md           # Migrations, RLS, types (Haiku)
│   ├── devops.md                  # Build checks, fixes (Haiku)
│   ├── qa.md                      # AC verification, security review (Haiku)
│   └── security.md                # Security review (Haiku)
├── commands/                      # Slash commands
│   ├── ticket.md                  # Write a ticket (/ticket)
│   ├── develop.md                 # Implement next ticket (/develop)
│   ├── ship.md                    # Commit + push + PR (/ship)
│   ├── merge.md                   # Squash merge + cleanup (/merge)
│   ├── status.md                  # Show current status (/status)
│   ├── setup-pipeline.md          # Auto-detect stack, configure project (/setup-pipeline)
│   └── update-pipeline.md         # Sync templates after framework update (/update-pipeline)
├── skills/                        # Framework skills (copied to projects)
│   ├── ticket-writer.md           # PM-quality ticket writing
│   ├── design.md                  # Design system awareness
│   ├── frontend-design.md         # Frontend design patterns
│   ├── creative-design.md         # Greenfield design
│   ├── ux-planning.md             # UX planning
│   ├── backend.md                 # Backend patterns
│   ├── data-engineer.md           # Database patterns
│   └── webapp-testing.md          # Testing patterns (Playwright)
├── pipeline/                      # SDK pipeline runner (TypeScript)
│   ├── run.ts                     # Single execution (CLI or imported by worker)
│   ├── run.sh                     # Bash wrapper for run.ts
│   ├── worker.ts                  # Supabase polling worker (VPS)
│   ├── package.json               # Dependencies (claude-agent-sdk, tsx)
│   └── lib/
│       ├── config.ts              # Project config loader
│       ├── load-agents.ts         # Agent definition parser
│       └── event-hooks.ts         # Just Ship Board event streaming
├── templates/                     # Templates for project files
│   ├── CLAUDE.md                  # Project instructions template
│   └── project.json               # Project config template
├── vps/                           # VPS infrastructure
│   ├── setup-vps.sh               # Root setup script (Ubuntu 22.04)
│   ├── just-ship-pipeline@.service     # systemd template unit
│   └── README.md                  # Step-by-step VPS guide
├── .claude/
│   ├── hooks/                     # Event streaming hooks
│   │   ├── detect-ticket.sh       # SessionStart: extract ticket from branch
│   │   ├── on-agent-start.sh      # SubagentStart: send event to Just Ship Board
│   │   ├── on-agent-stop.sh       # SubagentStop: send event to Just Ship Board
│   │   └── on-session-end.sh      # SessionEnd: send completion event
│   └── scripts/
│       └── send-event.sh          # Event posting utility
└── docs/
    └── ARCHITECTURE.md            # This file
```

### Target Project (after setup)

```
your-project/
├── CLAUDE.md                      # Project-specific instructions (customize!)
├── project.json                   # Central config (stack, build, pipeline IDs)
├── .claude/
│   ├── agents/                    # From framework (auto-updated)
│   ├── commands/                  # From framework (auto-updated)
│   ├── skills/                    # Framework + your custom skills
│   ├── hooks/                     # Event streaming hooks
│   ├── scripts/                   # Utility scripts
│   ├── settings.json              # Permissions + hook config
│   ├── .pipeline-version          # Installed framework version
│   └── .template-hash             # Template change detection
└── .pipeline/
    ├── run.sh                     # Pipeline runner wrapper
    ├── run.ts                     # SDK pipeline execution
    ├── worker.ts                  # Polling worker
    ├── package.json               # Pipeline dependencies
    └── lib/                       # Config, agent loader, event hooks
```

---

## Agent System

### Agent Definition Format

Each agent is a markdown file with YAML frontmatter:

```markdown
---
name: backend
description: Backend-Entwickler für API-Endpoints, Shared Hooks und Business Logic.
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
| **Orchestrator** | Plans, delegates, ships | Opus | Always — drives the entire flow |
| **Backend** | API endpoints, shared hooks, business logic | Sonnet | API/hook changes |
| **Frontend** | UI components, pages (design-aware) | Sonnet | UI changes |
| **Data Engineer** | DB migrations, RLS policies, TypeScript types | Haiku | Schema changes |
| **DevOps** | Build checks, lint fixes, TypeScript compilation | Haiku | Only on build failure |
| **QA** | Acceptance criteria verification, security check | Haiku | Always (review phase) |
| **Security** | Deep security review (Auth, RLS, input validation) | Haiku | Security-critical changes |

### Orchestrator Workflow

The orchestrator follows a strict 5-phase pipeline:

```
Phase 1: Planning (Orchestrator itself)
  └─ Read 5-10 affected files, formulate agent instructions

Phase 2: Implementation (Sub-agents, parallelized)
  ├─ data-engineer (if schema changes needed) → runs FIRST
  ├─ backend + frontend (in parallel after schema is done)
  └─ Other agents as needed

Phase 3: Build Check (Bash command)
  └─ DevOps agent only spawned on failure

Phase 4: Review (Single QA agent)
  └─ AC verification + security quick-check combined

Phase 5: Ship (/ship command)
  └─ Commit → Push → PR → Board status "in_review"
```

### Parallelization

Sub-agents are spawned via the Claude Agent SDK's `Agent` tool. Multiple `Agent` tool calls in a single response execute in parallel — this typically saves 50%+ time:

- **Sequential**: data-engineer first (if schema changes exist)
- **Parallel**: backend + frontend + other agents together
- **Rule of thumb**: If agents work on different files, parallelize

### Model Selection Strategy

| Task Complexity | Model | Cost | Examples |
|----------------|-------|------|----------|
| Orchestration & planning | Opus | $$$ | Only the orchestrator |
| Creative implementation | Sonnet | $$ | UI components, business logic |
| Routine/mechanical tasks | Haiku | $ | SQL migrations, build fixes, checklists, reviews |

---

## Slash Commands

Commands are markdown files in `commands/` with frontmatter metadata. They provide the developer-facing workflow interface.

### Workflow Commands

| Command | Purpose | Autonomous |
|---------|---------|------------|
| `/ticket` | Write a structured ticket (bug, feature, improvement, spike) | No — may ask user for input |
| `/develop` | Pick next ticket, implement end-to-end, create PR | Yes — fully autonomous |
| `/ship` | Commit, push, create PR, update board status | Yes — zero questions |
| `/merge` | Squash merge, delete branch, update board status | Yes — zero questions |

### Utility Commands

| Command | Purpose |
|---------|---------|
| `/status` | Show current ticket, branch, and change summary |
| `/setup-pipeline` | Auto-detect stack, fill `project.json`, connect Just Ship Board |
| `/update-pipeline` | Sync `CLAUDE.md` and `project.json` after framework update |

### Conversational Triggers

The following phrases automatically trigger `/merge`:

> "passt", "done", "fertig", "klappt", "sieht gut aus", "ship it", "mach zu"

### Command Flow

```
/ticket ──── writes ticket to Supabase ──────────────┐
                                                      │
/develop ── picks ticket ── implements ── /ship ──┐   │
                                                  │   │
           "passt" or /merge ─────────────────────┤   │
                                                  ▼   │
                                         squash merge  │
                                         delete branch │
                                         status: done  │
                                                      │
                              ┌────────────────────────┘
                              ▼
                    Supabase Ticket Queue
                    (ready_to_develop → in_progress → in_review → done)
```

---

## Skills System

Skills are specialized instruction sets that guide agents for specific types of work. The framework ships two categories:

### Framework Skills (auto-deployed)

Shipped with the framework and updated via `setup.sh --update`:

- **ticket-writer** — Writes PM-quality tickets with acceptance criteria
- **design** — Design system awareness for consistent UI
- **frontend-design** — Frontend component patterns
- **creative-design** — Greenfield design for new pages/features
- **ux-planning** — UX planning and user flow design
- **backend** — Backend patterns and API design
- **data-engineer** — Database migration and RLS patterns
- **webapp-testing** — Testing patterns including Playwright

### Superpowers Plugin

Process skills (TDD, debugging, code review, planning) are provided by the [superpowers](https://github.com/obra/superpowers-marketplace) plugin, installed automatically during setup:

- **brainstorming** — Explores requirements before implementation
- **writing-plans** — Structured implementation planning
- **executing-plans** — Plan execution with review checkpoints
- **test-driven-development** — Red-green-refactor workflow
- **systematic-debugging** — Root cause analysis
- **requesting-code-review** / **receiving-code-review** — Code review workflows
- **verification-before-completion** — Evidence before assertions
- **dispatching-parallel-agents** — Parallel task execution
- **using-git-worktrees** — Isolated development branches
- **finishing-a-development-branch** — Branch completion workflow

### Custom Skills

Projects can add their own skills in `.claude/skills/`. These are never touched by framework updates.

---

## Pipeline SDK

The pipeline runner is a TypeScript application built on the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk). It provides two entry points:

### `run.ts` — Single Execution

Used for CLI invocation or called by the worker:

```bash
npx tsx run.ts <TICKET_ID> <TITLE> [DESCRIPTION] [LABELS]
```

Internally:
1. Loads `project.json` config
2. Creates a feature branch from main
3. Loads all agent definitions from `.claude/agents/`
4. Builds the orchestrator prompt with ticket details
5. Calls `query()` from the Agent SDK with the orchestrator prompt
6. Outputs JSON result on stdout (for automation/n8n integration)

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

### `worker.ts` — Polling Worker

Runs as a systemd service on a VPS, polling Supabase for tickets:

```
Loop:
  1. Check Supabase connectivity
  2. Query: tickets WHERE status='ready_to_develop' AND pipeline_status IS NULL
  3. Atomic claim: SET pipeline_status='running' WHERE pipeline_status IS NULL
  4. Call executePipeline() from run.ts
  5. On success: SET pipeline_status='done', status='in_review'
  6. On failure: SET pipeline_status='failed', wait 5 min cooldown
  7. Sleep POLL_INTERVAL (default 60s)
```

**Safety features:**
- Atomic claim prevents duplicate processing by multiple workers
- Graceful shutdown on SIGINT/SIGTERM (cancels running pipeline)
- Max consecutive failures limit (default 5) before worker stops
- 5-minute cooldown after failure

### JSON Output

The pipeline emits structured JSON for automation:

```json
{
  "status": "completed",
  "ticket_id": "T-162",
  "branch": "feature/T-162-short-description",
  "project": "my-project"
}
```

---

## Event Streaming & Just Ship Board

The framework integrates with the **Just Ship Board** — a Next.js application that provides a visual Kanban board for tracking tickets and pipeline progress in real-time.

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

1. **SDK Hooks** (Pipeline/VPS mode) — `event-hooks.ts` registers callbacks for `SubagentStart`, `SubagentStop`, and `PostToolUse` events via the Agent SDK
2. **Shell Hooks** (Interactive mode) — `settings.json` configures hooks for `SessionStart`, `SubagentStart`, `SubagentStop`, and `SessionEnd` that call shell scripts

Both modes post to the same Event API, providing a unified view in the Just Ship Board regardless of execution mode.

### Real-time Updates

Events are stored in the `task_events` table in Supabase and delivered to the board via Supabase Realtime (PostgreSQL INSERT triggers).

---

## Hooks System

Claude Code hooks are shell scripts triggered by lifecycle events. The framework uses them for ticket detection and event streaming.

### Configured Hooks (settings.json)

| Hook | Script | Purpose |
|------|--------|---------|
| `SessionStart` | `detect-ticket.sh` | Extract ticket number from branch name, set `TICKET_NUMBER` env var |
| `SubagentStart` | `on-agent-start.sh` | Send `agent_started` event to Just Ship Board |
| `SubagentStop` | `on-agent-stop.sh` | Send `completed` event to Just Ship Board |
| `SessionEnd` | `on-session-end.sh` | Send session completion event |

### Ticket Detection

On session start, `detect-ticket.sh`:
1. Reads the current git branch name
2. Extracts the ticket number (e.g., `feature/287-foo` → `287`)
3. Writes it to `.claude/.active-ticket` and `$CLAUDE_ENV_FILE`
4. Sends an `agent_started` event for the orchestrator

---

## Configuration

### project.json

Central configuration read by all agents and commands:

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
    "workspace_id": "uuid"
  },
  "conventions": {
    "commit_format": "conventional",
    "language": "de"
  }
}
```

### CLAUDE.md

Project-specific instructions that provide context to all agents:
- Project description and architecture
- Code conventions (imports, styling, patterns)
- Git conventions (branches, commits)
- Security requirements
- Domain-specific knowledge

Generated from `templates/CLAUDE.md` during setup, then customized by the developer.

### settings.json

Permissions and hook configuration:

```json
{
  "permissions": {
    "allow": [
      "Read(**)", "Edit(**)", "Write(**)",
      "Glob(**)", "Grep(**)", "Bash(*)",
      "mcp__claude_ai_Supabase__*",
      "mcp__claude_ai_Notion__*",
      "mcp__claude_ai_Vercel__*"
    ]
  },
  "hooks": {
    "SessionStart": [...],
    "SubagentStart": [...],
    "SubagentStop": [...],
    "SessionEnd": [...]
  }
}
```

---

## Setup & Installation

### Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
- Git
- GitHub CLI (`gh`)
- Node.js (>= 18)

### First Installation

```bash
# Clone the framework (once)
git clone https://github.com/yves-s/just-ship.git ~/just-ship

# Switch to your project
cd /path/to/your-project

# Run interactive setup
~/just-ship/setup.sh

# Open Claude Code and configure
claude
> /setup-pipeline
```

### What setup.sh Does

1. Checks prerequisites (claude, git, gh, node)
2. Copies agents, commands, skills, scripts, hooks to `.claude/`
3. Copies pipeline runner to `.pipeline/`
4. Installs pipeline dependencies (`npm install`)
5. Installs the superpowers plugin
6. Generates `project.json` (interactive prompts)
7. Generates `CLAUDE.md` from template
8. Generates `settings.json` with permissions
9. Writes version marker to `.claude/.pipeline-version`

### Updating

```bash
cd /path/to/your-project
~/just-ship/setup.sh --update
```

Updates **only framework files** — never overwrites `CLAUDE.md`, `project.json`, or custom skills.

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

### Self-Install Guard

The framework repository itself uses symlinks (`.claude/commands → ../commands`, etc.). Running `setup.sh` on the framework directory is detected and blocked to prevent self-corruption.

---

## VPS Deployment

The framework can run fully autonomously on a VPS. See [vps/README.md](../vps/README.md) for the complete guide.

### Architecture

```
VPS (Ubuntu 22.04)
├── claude-dev user
├── ~/just-ship/                     # Framework (git cloned)
├── ~/mein-projekt/                  # Project clone
│   ├── .pipeline/worker.ts          # Polling worker
│   └── .env.mein-projekt            # Env vars (API keys)
└── systemd
    └── just-ship-pipeline@mein-projekt.service
```

### Worker Environment

Required environment variables:

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API authentication |
| `GH_TOKEN` | GitHub operations (PR, push) |
| `SUPABASE_URL` | Ticket queue endpoint |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `SUPABASE_PROJECT_ID` | Filter tickets by project |
| `PROJECT_DIR` | Absolute path to project clone |
| `POLL_INTERVAL` | Polling interval in seconds (default: 60) |

### Multi-Project Support

One VPS can run multiple project workers. Each gets its own:
- `.env.{slug}` file
- systemd service instance (`just-ship-pipeline@{slug}`)
- Project clone directory

Workers poll independently and only process tickets for their configured `SUPABASE_PROJECT_ID`.

---

## Security Model

### Permission Model

- All file operations are allowed via `settings.json` permission config
- Pipeline mode uses `bypassPermissions` for autonomous execution
- Interactive mode prompts the user for any non-allowed operations

### Secrets Management

- No API keys, tokens, or secrets in code
- VPS: secrets in `.env` files with `chmod 600`
- Pipeline API keys stored as hashed values in Supabase
- `setup.sh` never generates or stores secrets

### Agent Sandboxing

- Each agent has a defined set of allowed tools (specified in frontmatter)
- The orchestrator controls which agents are spawned and with what instructions
- Agents cannot modify their own definitions or the framework

---

## Cost Model

### Per-Ticket Costs (Anthropic API)

| Ticket Type | Agents | Estimated Cost |
|-------------|--------|----------------|
| Simple bug fix | Orchestrator + 1 agent | ~$1-2 |
| Feature with DB + UI | Orchestrator + 3 agents | ~$3-5 |
| Complex feature | Orchestrator + 5 agents | ~$5-10 |

### Model Cost Breakdown

- **Opus** (Orchestrator only): Most expensive, but used sparingly for planning and delegation
- **Sonnet** (Backend, Frontend): Mid-range, used for creative implementation
- **Haiku** (DB, DevOps, QA, Security): Cheapest, used for routine tasks

### VPS Costs

- Hostinger VPS 1 or 2: ~$4-8/month
- At 5 tickets/day: ~$15-25/day in API costs
