<p align="center">
  <img src="public/logos/png/social/banner-1280x420.png" alt="Just Ship — From ticket to ship. Autonomously." width="100%" />
</p>

<p align="center">
  A portable multi-agent framework for autonomous software development.<br/>
  Install it into any project, write tickets, and watch them turn into pull requests.<br/>
  Built on <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a> and the <a href="https://github.com/anthropics/claude-agent-sdk">Claude Agent SDK</a>.
</p>

---

## How It Works

```
Ticket (Board or CLI)
    |
    v
Triage (Haiku)
    |-- analyzes ticket quality
    |-- enriches unclear descriptions
    |
    v
Orchestrator (Opus)
    |-- reads affected files
    |-- plans the work
    |-- delegates to sub-agents
    |
    |-- data-engineer (Haiku)  --> migrations, RLS, types
    |-- backend (Sonnet)       --> API, hooks, business logic      } parallel
    |-- frontend (Sonnet)      --> UI components, pages            }
    |
    v
Build check --> QA review --> Commit --> Push --> PR
    |
    v
You review the PR --> "passt" --> squash merge --> done
```

Two modes of operation:

- **Interactive** — Drive the workflow with slash commands in Claude Code
- **Autonomous** — A VPS worker polls a Supabase ticket queue and runs the pipeline 24/7

---

## Quick Start

```bash
curl -fsSL https://just-ship.io/install | bash
```

Then open a new terminal and run in your project:

```bash
cd /path/to/your-project
just-ship setup
```

The setup wizard guides you through project configuration and optionally connects to the [Just Ship Board](https://board.just-ship.io).

**Update just-ship itself:**
```bash
just-ship self-update
```

---

## Plugin Installation

If you already have Claude Code, you can install just-ship as a plugin:

**Load for a session:**
```bash
claude --plugin-dir /path/to/just-ship
```

After installation, configure your credentials:
- **Board API Key** — from your [Just Ship Board](https://board.just-ship.io) workspace settings
- **Workspace ID** — your workspace UUID
- **Project ID** — your project UUID

Sensitive values are stored in your system keychain. Non-sensitive config goes to `settings.json`.

> **Note:** Plugin installation is for using just-ship as a development tool. For the full autonomous pipeline with VPS worker, use the [Quick Start](#quick-start) setup instead.

---

## Commands

| Command | What it does | Autonomous |
|---------|-------------|------------|
| `/ticket` | Write a structured ticket (bug, feature, improvement, spike) | No |
| `/implement` | Implement from chat context or description — no ticket required | Yes |
| `/develop` | Pick next ticket, implement end-to-end, create PR | Yes |
| `/ship` | Commit + push + PR + squash merge + board status "done". Supports `/ship T-{N}` | Yes |
| `/spike-review` | Review completed spike, summarize findings, create follow-up tickets. Supports `--auto` | Both |
| `/just-ship-review` | Checkout branch, install deps, build, start dev server for local testing | No |
| `/recover` | Recover stuck pipeline ticket — resume from partial work or restart clean. Supports `/recover T-{N}` | Yes |
| `/just-ship-status` | Show all branches, PRs, board status, worktrees, and cleanup recommendations | -- |
| `/setup-just-ship` | Auto-detect stack, configure project, connect Dev Board, install Sidekick | Interactive |
| `/just-ship-update` | Sync project files after framework update (auto-run by `just-ship update`) | Interactive |

**Conversational triggers:** Saying "passt", "done", "fertig", or "sieht gut aus" automatically executes `/ship`.

---

## Agents

| Agent | Model | Role |
|-------|-------|------|
| **Orchestrator** | Opus | Plans, delegates, ships -- drives the entire flow |
| **Triage** | Haiku | Analyzes ticket quality, enriches unclear descriptions before execution |
| **Triage Enrichment** | Sonnet | Phase 2: enriches tickets with codebase context, affected files, and Shopify-specific checks |
| **Backend** | Sonnet | API endpoints, shared hooks, business logic |
| **Frontend** | Sonnet | UI components and pages (design-aware) |
| **Data Engineer** | Haiku | DB migrations, RLS policies, TypeScript types |
| **DevOps** | Haiku | Build checks and fixes (only on failure) |
| **Code Review** | Sonnet | Reviews diff against main for code quality, patterns, edge cases, performance -- fixes issues directly |
| **QA (Testing Engineer)** | Haiku | Test strategy, test writing, acceptance criteria + security review |
| **Security** | Haiku | Deep security review for critical changes |

Sub-agents run in parallel where possible (e.g., backend + frontend simultaneously), saving 50%+ execution time. Model selection is cost-optimized: Opus only for orchestration, Haiku for routine tasks.

---

## Workflow

```
/implement - chat context or description -- implements -- creates PR (no ticket needed)
                                                                  |
/ticket --- writes ticket to Board API -----------------.         |
                                                        |         |
/develop -- picks ticket -- implements -- creates PR    |         |
                                                   |   |         |
              "passt" or /ship --------------------|   |         |
                                                   v   v         |
                                          squash merge <---------'
                                          delete branch
                                          status: done (if ticket linked)

Ticket lifecycle (Board):
  ready_to_develop --> in_progress --> in_review --> done
```

### The /develop Pipeline (10 Steps)

Every `/develop` run executes a strict 10-step pipeline. No step is optional, no step requires human intervention.

```
 1  Ticket finden        Pick next ready_to_develop ticket from Board API
 2  Ticket übernehmen    Display ticket, continue immediately (no confirmation)
 3  Branch + Status      Status → in_progress, create feature branch in worktree, send pipeline event
 3½ Triage               Haiku analyzes ticket quality, enriches description if unclear, sets QA tier
 4  Planning             Orchestrator reads 5-10 affected files, formulates agent instructions
 5  Implementation       Sub-agents in parallel (data-engineer first if schema changes)
 6  Build Check          Run build commands -- DevOps agent only on failure
 7  Review               QA agent checks acceptance criteria + security
 8  Docs Check           Auto-update CHANGELOG, README, ARCHITECTURE, VPS docs (see below)
 9  Ship (no merge)      Commit → Push → PR → change summary → status "in_review" → preview URL (Vercel, Shopify, or Coolify)
10  Automated QA         Build + tests + optional Playwright screenshots, QA report as PR comment
```

The human only reviews the PR and says "merge".

### Step 8: Docs Check

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
| VPS, worker, server | `vps/README.md` -- VPS-specific docs |
| Workflow, conventions | `CONTRIBUTING.md` -- contributing guidelines |

Docs changes are part of the same commit as the code. No separate PR, no "we'll do it later".

---

## Skills

Skills are specialized instruction sets that guide agents for specific types of work.

### Framework Skills

Shipped with the pipeline:

| Skill | Purpose |
|-------|---------|
| **ticket-writer** | Writes PM-quality tickets with acceptance criteria |
| **design** | Design system awareness for consistent UI |
| **frontend-design** | Frontend component patterns and best practices |
| **creative-design** | Greenfield design for new pages and features |
| **ux-planning** | UX planning and user flow design |
| **backend** | Backend patterns and API design |
| **data-engineer** | Database migration and RLS patterns |
| **sparring** | Strategic discussion partner with automatic domain expert triage |
| **webapp-testing** | Testing strategy (test pyramid, framework selection, mocking) + Playwright visual testing |

### Shopify Domain Skills

Loaded automatically when `stack.platform: "shopify"` is set in `project.json`. Can also be loaded explicitly via `skills.domain`.

| Skill | Variant | Purpose |
|-------|---------|---------|
| **shopify-liquid** | liquid | Liquid syntax, sections, snippets, schema patterns |
| **shopify-theme** | liquid | Theme architecture, JSON templates, asset pipeline, i18n |
| **shopify-metafields** | both | Metafield types, reference resolution, metaobjects |
| **shopify-storefront-api** | hydrogen | GraphQL Storefront API, pagination, caching, rate limits |
| **shopify-hydrogen** | hydrogen | React Router, Hydrogen components, SSR/streaming, Oxygen |
| **shopify-admin-api** | both | Admin API mutations, webhooks, bulk operations |
| **shopify-checkout** | both | Checkout UI Extensions, Shopify Functions (Plus only) |
| **shopify-apps** | both | App CLI, App Bridge, Polaris, session tokens, billing |
| **shopify-app-scaffold** | both | Opinionated cleanup after `shopify app create`, removes demo code |

### Superpowers Plugin

Process skills for TDD, debugging, code review, and planning -- provided by the [superpowers](https://github.com/obra/superpowers-marketplace) plugin. Installed automatically during setup.

| Skill | Purpose |
|-------|---------|
| **brainstorming** | Explores requirements before implementation |
| **writing-plans** | Structured implementation planning |
| **executing-plans** | Plan execution with review checkpoints |
| **test-driven-development** | Red-green-refactor workflow |
| **systematic-debugging** | Root cause analysis before fixing |
| **requesting-code-review** | Code review workflow (requester side) |
| **receiving-code-review** | Code review workflow (reviewer side) |
| **verification-before-completion** | Evidence before assertions |
| **dispatching-parallel-agents** | Parallel task execution |
| **using-git-worktrees** | Isolated development branches |
| **finishing-a-development-branch** | Branch completion workflow |
| **subagent-driven-development** | Multi-agent task delegation |

Add your own project-specific skills in `.claude/skills/`. They are never touched by framework updates.

---

## Architecture

```
just-ship/
├── setup.sh                    # Install + update script
├── agents/                     # Agent definitions (markdown + YAML frontmatter)
│   ├── orchestrator.md
│   ├── triage.md
│   ├── backend.md
│   ├── frontend.md
│   ├── data-engineer.md
│   ├── devops.md
│   ├── qa.md
│   └── security.md
├── commands/                   # Slash commands
│   ├── ticket.md
│   ├── develop.md
│   ├── ship.md
│   ├── status.md
│   ├── setup-just-ship.md
│   └── just-ship-update.md
├── skills/                     # Framework skills
├── pipeline/                   # SDK pipeline runner (TypeScript)
│   ├── run.ts                  # Single execution + session resume
│   ├── worker.ts               # Supabase polling worker (VPS)
│   ├── server.ts               # HTTP server (webhooks, /api/answer)
│   ├── run.sh                  # Bash wrapper
│   └── lib/                    # Config, agent loader, skill loader, event hooks, cost tracking
├── templates/                  # CLAUDE.md + project.json templates
├── vps/                        # VPS deployment (systemd, setup script)
└── .claude/                    # Claude Code config (hooks, scripts, settings)
```

### After Installation

```
your-project/
├── CLAUDE.md                   # Project instructions (edit to match your project)
├── project.json                # Config: stack, build commands, pipeline IDs
├── .claude/
│   ├── agents/                 # 8 agents (from framework, auto-updated)
│   ├── commands/               # 7 commands (from framework, auto-updated)
│   ├── skills/                 # 8 framework skills + your custom skills
│   ├── hooks/                  # Event streaming (lifecycle hooks)
│   ├── scripts/                # Utility scripts
│   ├── settings.json           # Permissions + hook config
│   └── .pipeline-version       # Installed framework version
└── .pipeline/                  # Pipeline runner (auto-updated)
    ├── run.ts, worker.ts       # SDK pipeline
    └── lib/                    # Config, agent loader, events
```

For a comprehensive technical deep dive, see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Configuration

### project.json

Central config read by all agents and commands. Auto-populated by `/setup-just-ship`:

```json
{
  "name": "my-project",
  "description": "Project description",
  "stack": {
    "framework": "Next.js 15 (App Router)",
    "language": "TypeScript",
    "styling": "Tailwind CSS",
    "database": "Supabase (PostgreSQL)",
    "testing": "Vitest",
    "package_manager": "pnpm"
  },
  "build": {
    "web": "pnpm run build",
    "test": "npx vitest run"
  },
  "paths": {
    "components": "src/components",
    "pages": "src/app"
  },
  "pipeline": {
    "project_id": "uuid",
    "project_name": "My Project",
    "workspace_id": "uuid",
    "api_url": "https://board.just-ship.io",
    "api_key": "adp_..."
  },
  "conventions": {
    "commit_format": "conventional",
    "language": "de"
  }
}
```

### CLAUDE.md

Project-specific instructions -- architecture, conventions, domain knowledge. Generated from a template during setup, then customized for your project. Your content is never overwritten on update.

---

## Setup & Update

### Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
- Git + [GitHub CLI](https://cli.github.com/) (`gh`)
- Node.js >= 18

### First Installation

```bash
curl -fsSL https://just-ship.io/install | bash
```

Then open a new terminal and run in your project:

```bash
cd /path/to/your-project
just-ship setup
```

Interactive setup: asks for project name, generates config files, installs dependencies, sets up the [superpowers](https://github.com/obra/superpowers-marketplace) plugin.

### Update

```bash
cd /path/to/your-project
just-ship update                # git pull + apply updates to current project
just-ship update --dry-run      # preview changes only
just-ship self-update           # pull latest framework only (no project update)
```

Updates framework files. Your project-specific content is never overwritten:

| Updated | Never overwritten |
|---------|-------------------|
| `.claude/agents/*`, `commands/*`, `hooks/*` | `CLAUDE.md` |
| `.claude/skills/<framework>.md` | `project.json` |
| `.claude/settings.json`, `.pipeline/*` | `.claude/skills/<custom>.md` |

### Version Tracking

```
Installed: abc1234 (2026-02-28)
Available: def5678 (2026-03-02)
```

Tracked in `.claude/.pipeline-version`. If templates changed, `just-ship update` automatically runs `/just-ship-update` via Claude to merge them.

---

## Pipeline Runner

The pipeline is built on the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk). It loads agent definitions from `.claude/agents/*.md`, streams events to the Dev Board, and produces structured JSON output for automation.

### CLI Usage

```bash
.pipeline/run.sh <TICKET_ID> <TITLE> [DESCRIPTION] [LABELS]
```

### JSON Output

```json
{
  "status": "completed",
  "ticket_id": "T-162",
  "branch": "feature/T-162-add-dark-mode",
  "project": "my-project"
}
```

### VPS Worker

Runs the pipeline 24/7 on a VPS — polls for tickets, claims them, runs the orchestrator, and creates PRs automatically. See [Autonomous VPS Deployment](#autonomous-vps-deployment) for the full setup overview and **[vps/README.md](vps/README.md)** for the step-by-step guide.

---

## Dev Board Integration

The **[Just Ship Board](https://board.just-ship.io)** is the visual companion for the pipeline -- a Kanban board with activity timelines and project setup.

### Connecting a Project

1. Create a workspace and project at [board.just-ship.io](https://board.just-ship.io)
2. Copy the connect command from the project setup dialog
3. Run it in Claude Code: `/setup-just-ship --board https://board.just-ship.io --key <key> --project <uuid>`
4. This writes `api_url`, `api_key`, and `project_id` to `project.json`

Commands (`/ticket`, `/develop`, `/ship`) auto-detect the Board config and use it for ticket operations and status updates.

### Sidekick

An AI-powered in-app assistant that lets project admins create, search, and manage tickets directly from any website -- without leaving the page.

**Embed it with one line:**

```html
<script src="https://board.just-ship.io/sidekick.js" data-project="my-project-slug"></script>
```

Activate with `Ctrl+Shift+S` or `?sidekick` in the URL. A persistent split-view panel opens on the right side, powered by Claude Sonnet:

- **Create tickets** from context -- the AI captures the current page URL and title automatically
- **Search existing tickets** -- find duplicates before creating new ones
- **Conversation history** -- pick up where you left off across sessions

The Sidekick is for project admins and workspace members only -- it requires Just Ship authentication. Regular visitors never see it.

For the full technical deep dive (architecture, API, data model), see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#sidekick).

### Event Streaming

Real-time agent activity via two modes:

- **SDK Hooks** (Pipeline/VPS) -- `SubagentStart`, `SubagentStop`, `PostToolUse` events via Agent SDK callbacks
- **Shell Hooks** (Interactive) -- `SessionStart`, `SubagentStart/Stop`, `SessionEnd` via `settings.json` hook config

Both post to `POST /api/events` with `X-Pipeline-Key` authentication.

---

## Autonomous VPS Deployment

Run the pipeline 24/7 on a VPS — no local machine required. A worker process polls for tickets, claims them, runs the full orchestrator flow, and creates pull requests autonomously.

```
Ticket queue --> Worker claims ticket --> Orchestrator runs agents --> PR created
                  (polls every 60s)        (plan, implement, review)
```

### Why a VPS?

- **Always on** — tickets are processed around the clock, not just when your laptop is open
- **Hands-free** — write tickets from the Board, phone, or anywhere — the VPS picks them up
- **Low cost** — a $4-8/month Ubuntu VPS handles it; API costs scale with ticket complexity

### Prerequisites

- Any Ubuntu 22.04+ VPS (e.g. Hostinger, Hetzner, DigitalOcean — any provider works)
- SSH access to the VPS
- **Anthropic API key** — for Claude Code
- **GitHub Personal Access Token** — with `repo` and `workflow` scopes

### Setup Overview

| Step | What happens |
|------|-------------|
| **1. Provision VPS** | Create an Ubuntu 22.04 VPS with your provider, SSH in as root |
| **2. Run `/just-ship-vps`** | Claude installs Docker, Node.js, GitHub CLI, creates the `claude-dev` user, and starts the pipeline server as a Docker container |
| **3. Connect a project** | Claude clones the repo, runs `setup.sh`, and registers the project in the server config |
| **4. Configure environment** | API keys and project env vars go in `/home/claude-dev/.just-ship/env.{project-slug}` |
| **5. Done** | Press "Develop" on the Board — the VPS picks up the ticket and starts working |

See **[vps/README.md](vps/README.md)** for the complete step-by-step guide with all commands.

### Multi-Project Support

One VPS handles multiple projects. Each project has its own env file and is registered in the server config. The Docker container runs a single HTTP server that routes tickets to the correct project based on `project_id`.

### Cost

| Component | Cost |
|-----------|------|
| VPS hosting | ~$4-8/month (smallest tier is sufficient) |
| API per simple ticket | ~$1-2 (Orchestrator + 1 agent) |
| API per complex ticket | ~$5-10 (Orchestrator + 5 agents) |

At 5 tickets/day, expect ~$15-25/day in API costs. The VPS itself is negligible.

---

## Cost

Rough estimates (Anthropic API) -- actual costs vary by ticket complexity:

| Ticket Type | Agents | Estimated Cost |
|-------------|--------|----------------|
| Simple bug fix | Orchestrator + 1 agent | ~$1-2 |
| Feature with DB + UI | Orchestrator + 3 agents | ~$3-5 |
| Complex feature | Orchestrator + 5 agents | ~$5-10 |

**Model tiering:** Opus for orchestration only. Sonnet for creative work (UI, business logic). Haiku for routine tasks (SQL, builds, reviews).

VPS hosting: ~$4-8/month (Hostinger).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

MIT -- see [LICENSE](LICENSE)
