# Just Ship

A portable multi-agent framework for autonomous software development with [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

Install it into any project. Write tickets. Watch them turn into pull requests — autonomously.

---

## How It Works

```
You write a ticket
    │
    ▼
Orchestrator (Opus) reads affected files, plans the work
    │
    ├── data-engineer (Haiku)  → migrations, RLS, types
    ├── backend (Sonnet)       → API, hooks, business logic     } parallel
    ├── frontend (Sonnet)      → UI components, pages           }
    │
    ▼
Build check → QA review → Commit → Push → PR
    │
    ▼
You review the PR → "passt" → squash merge → done
```

The framework provides **7 specialized agents**, **7 slash commands**, a **TypeScript pipeline runner** (built on the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)), and **real-time event streaming** to a visual Dev Board.

It works in two modes:
- **Interactive** — You drive the workflow with slash commands in Claude Code
- **Autonomous** — A VPS worker polls a Supabase ticket queue and runs the pipeline 24/7

---

## Quick Start

```bash
# 1. Clone the framework
git clone https://github.com/yves-s/just-ship.git ~/.just-ship

# 2. Go to your project and run setup
cd /path/to/your-project
~/.just-ship/setup.sh

# 3. Connect to the Just Ship Board
#    Create a workspace + project at https://board.just-ship.io
#    Copy the connect command from the project setup dialog, then run it in Claude Code:
claude
> /setup-pipeline --board https://board.just-ship.io --key adp_... --project <uuid>

# 4. Write your first ticket
> /ticket Add dark mode toggle to the settings page

# 5. Implement it
> /develop
```

---

## Commands

| Command | What it does | Autonomous |
|---------|-------------|------------|
| `/ticket` | Write a structured ticket (bug, feature, improvement, spike) | No — may ask for input |
| `/develop` | Pick next ticket, implement end-to-end, create PR | Yes |
| `/ship` | Commit + push + PR + board status "in_review" | Yes |
| `/merge` | Squash merge + delete branch + board status "done" | Yes |
| `/status` | Show current ticket, branch, and changes | — |
| `/setup-pipeline` | Auto-detect stack, configure project, connect Dev Board | Interactive |
| `/update-pipeline` | Sync project files after framework update | Interactive |

**Conversational triggers:** Saying "passt", "done", "fertig", or "sieht gut aus" automatically executes `/merge`.

---

## Agents

| Agent | Model | Role |
|-------|-------|------|
| **Orchestrator** | Opus | Plans, delegates, ships — drives the entire flow |
| **Backend** | Sonnet | API endpoints, shared hooks, business logic |
| **Frontend** | Sonnet | UI components and pages (design-aware) |
| **Data Engineer** | Haiku | DB migrations, RLS policies, TypeScript types |
| **DevOps** | Haiku | Build checks and fixes (only on failure) |
| **QA** | Haiku | Acceptance criteria + security review |
| **Security** | Haiku | Deep security review for critical changes |

Sub-agents run in parallel where possible (e.g., backend + frontend simultaneously), saving 50%+ execution time. Model selection is cost-optimized: Opus only for orchestration, Haiku for routine tasks.

---

## Skills

Skills are specialized instruction sets that guide agents for specific types of work.

### Framework Skills (shipped with the pipeline)

| Skill | Purpose |
|-------|---------|
| **ticket-writer** | Writes PM-quality tickets with acceptance criteria |
| **design** | Design system awareness for consistent UI |
| **frontend-design** | Frontend component patterns and best practices |
| **creative-design** | Greenfield design for new pages and features |
| **ux-planning** | UX planning and user flow design |
| **backend** | Backend patterns and API design |
| **data-engineer** | Database migration and RLS patterns |
| **webapp-testing** | Testing patterns including Playwright |

### Superpowers Plugin (installed automatically)

Process skills for TDD, debugging, code review, and planning — provided by the [superpowers](https://github.com/obra/superpowers-marketplace) plugin:

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

### Custom Skills

Add your own project-specific skills in `.claude/skills/`. They are never touched by framework updates.

---

## Workflow

```
/ticket ──── writes ticket to Board API ─────────────┐
                                                      │
/develop ── picks ticket ── implements ── /ship ──┐   │
                                                  │   │
              "passt" or /merge ──────────────────┤   │
                                                  ▼   │
                                         squash merge  │
                                         delete branch │
                                         status: done ◄┘

Ticket lifecycle:
  ready_to_develop → in_progress → in_review → done
```

### Orchestrator Phases

```
Phase 1: Planning        Orchestrator reads 5-10 affected files, formulates agent instructions
Phase 2: Implementation  Sub-agents execute in parallel (data-engineer first if schema changes)
Phase 3: Build Check     Bash command — DevOps agent only on failure
Phase 4: Review          Single QA agent — acceptance criteria + security quick-check
Phase 5: Ship            Commit → Push → PR → Board status "in_review" → STOP
```

---

## Architecture

```
just-ship/
├── setup.sh                    # Install + update script
├── agents/                     # Agent definitions (markdown + YAML frontmatter)
│   ├── orchestrator.md         # Plans, delegates, ships
│   ├── backend.md              # API, hooks, business logic
│   ├── frontend.md             # UI components (design-aware)
│   ├── data-engineer.md        # DB migrations, RLS, types
│   ├── devops.md               # Build checks, fixes
│   ├── qa.md                   # AC verification, security review
│   └── security.md             # Security review
├── commands/                   # Slash commands
│   ├── ticket.md               # Write a ticket
│   ├── develop.md              # Implement next ticket
│   ├── ship.md                 # Commit + push + PR
│   ├── merge.md                # Squash merge + cleanup
│   ├── status.md               # Show current status
│   ├── setup-pipeline.md       # Auto-detect stack, configure project
│   └── update-pipeline.md      # Sync templates after update
├── skills/                     # Framework skills
│   ├── ticket-writer.md        # PM-quality ticket writing
│   ├── design.md               # Design system awareness
│   ├── frontend-design.md      # Frontend component patterns
│   ├── creative-design.md      # Greenfield design
│   ├── ux-planning.md          # UX planning
│   ├── backend.md              # Backend patterns
│   ├── data-engineer.md        # Database patterns
│   └── webapp-testing.md       # Playwright testing
├── pipeline/                   # SDK pipeline runner (TypeScript)
│   ├── run.ts                  # Single execution (CLI or worker import)
│   ├── worker.ts               # Supabase polling worker (VPS)
│   ├── run.sh                  # Bash wrapper
│   └── lib/
│       ├── config.ts           # Project config loader
│       ├── load-agents.ts      # Agent definition parser (frontmatter → SDK)
│       └── event-hooks.ts      # Dev Board event streaming
├── templates/
│   ├── CLAUDE.md               # Project instructions template
│   └── project.json            # Project config template
├── vps/                        # VPS deployment
│   ├── setup-vps.sh            # Ubuntu 22.04 setup (Node, gh, claude)
│   ├── just-ship-pipeline@.service     # systemd template unit
│   └── README.md               # Step-by-step VPS guide
└── .claude/
    ├── hooks/                  # Event streaming hooks
    │   ├── detect-ticket.sh    # SessionStart: ticket detection from branch
    │   ├── on-agent-start.sh   # SubagentStart: event to Dev Board
    │   ├── on-agent-stop.sh    # SubagentStop: event to Dev Board
    │   └── on-session-end.sh   # SessionEnd: completion event
    ├── scripts/
    │   └── send-event.sh       # Event posting utility
    └── settings.json           # Permissions + hook config template
```

### After Installation

```
your-project/
├── CLAUDE.md                   # Project instructions (edit to match your project)
├── project.json                # Config: stack, build commands, pipeline IDs
├── .claude/
│   ├── agents/                 # 7 agents (from framework, auto-updated)
│   ├── commands/               # 7 commands (from framework, auto-updated)
│   ├── skills/                 # 8 framework skills + your custom skills
│   ├── hooks/                  # Event streaming (4 lifecycle hooks)
│   ├── scripts/                # Utility scripts
│   ├── settings.json           # Permissions + hook config
│   └── .pipeline-version       # Installed framework version
└── .pipeline/                  # Pipeline runner (auto-updated)
    ├── run.ts, worker.ts       # SDK pipeline
    └── lib/                    # Config, agent loader, events
```

For comprehensive technical documentation, see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Configuration

### project.json

Central config read by all agents and commands. Auto-populated by `/setup-pipeline`:

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

Project-specific instructions — architecture, conventions, domain knowledge. Generated from a template during setup, then you customize it for your project. Your content is never overwritten on update.

---

## Setup & Update

### Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
- Git + [GitHub CLI](https://cli.github.com/) (`gh`)
- Node.js >= 18

### First Installation

```bash
cd /path/to/your-project                    # go to your project
/path/to/just-ship/setup.sh                 # run the installer
```

> **Note:** Replace `/path/to/just-ship` with the actual path where you cloned the framework.

Interactive: asks for project name, generates config files, installs dependencies, sets up the [superpowers](https://github.com/obra/superpowers-marketplace) plugin for TDD, debugging, and code review skills.

### Update

```bash
cd /path/to/your-project                                      # go to your project
/path/to/just-ship/setup.sh --update                          # apply updates
/path/to/just-ship/setup.sh --update --dry-run                # preview changes only
```

Updates framework files — your project-specific content is never overwritten:

| Updated | Never overwritten |
|---------|-------------------|
| `.claude/agents/*`, `commands/*`, `hooks/*` | `CLAUDE.md` |
| `.claude/skills/<framework>.md` | `project.json` |
| `.claude/settings.json`, `.pipeline/*` | `.claude/skills/<custom>.md` |

> **Tip:** Create an alias so you don't have to remember the path:
> ```bash
> # Add to ~/.zshrc or ~/.bashrc — adjust the path to where YOU cloned the framework
> alias pipeline-update='/path/to/just-ship/setup.sh --update'
> ```
> Then just `cd /path/to/your-project && pipeline-update`.

### Version Tracking

```
Installed: abc1234 (2026-02-28)
Available: def5678 (2026-03-02)
```

Tracked in `.claude/.pipeline-version`. If templates changed, you'll be prompted to run `/update-pipeline`.

---

## Pipeline Runner (SDK)

The pipeline is built on the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk):

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: orchestratorPrompt,
  options: {
    model: "opus",
    permissionMode: "bypassPermissions",
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent"],
    agents,  // Loaded from .claude/agents/*.md
    hooks,   // Dev Board event streaming
    maxTurns: 200,
  },
})) { ... }
```

### CLI Execution

```bash
.pipeline/run.sh <TICKET_ID> <TITLE> [DESCRIPTION] [LABELS]
```

Outputs JSON for automation (n8n, CI/CD):

```json
{
  "status": "completed",
  "ticket_id": "T-162",
  "branch": "feature/T-162-add-dark-mode",
  "project": "my-project"
}
```

### VPS Worker

Polls Supabase every 60s for tickets with `status = 'ready_to_develop'`:

```
Supabase ticket queue → Worker claims → Orchestrator executes → PR created
```

Features: atomic ticket claiming, graceful shutdown (SIGTERM), failure cooldown, max consecutive failure limit.

See **[vps/README.md](vps/README.md)** for the complete deployment guide.

---

## Dev Board Integration

The **[Just Ship Board](https://board.just-ship.io)** is the visual companion for the pipeline. It provides a Kanban board, activity timelines, and project setup.

### Connecting a Project

1. Create a workspace and project on the Board
2. The Board generates an API key and shows a connect command
3. Run the command in Claude Code: `/setup-pipeline --board https://board.just-ship.io --key <key> --project <uuid>`
4. This writes `api_url`, `api_key`, and `project_id` to `project.json`

Commands (`/ticket`, `/develop`, `/ship`, `/merge`) auto-detect the Board API config and use it for ticket operations and status updates. If no Board API is configured, they fall back to legacy Supabase MCP.

### Event Streaming

Real-time agent activity streaming via two modes:

1. **SDK Hooks** (Pipeline/VPS) — `SubagentStart`, `SubagentStop`, `PostToolUse` events via Agent SDK callbacks
2. **Shell Hooks** (Interactive) — `SessionStart`, `SubagentStart/Stop`, `SessionEnd` via `settings.json` hook config

Both post to `POST /api/events` with `X-Pipeline-Key` authentication. Events stored in `task_events` (Supabase) and delivered via Supabase Realtime.

---

## Cost

Rough estimates (Anthropic API) — actual costs vary by ticket complexity:

| Ticket Type | Agents | Estimated Cost |
|-------------|--------|----------------|
| Simple bug fix | Orchestrator + 1 agent | ~$1-2 |
| Feature with DB + UI | Orchestrator + 3 agents | ~$3-5 |
| Complex feature | Orchestrator + 5 agents | ~$5-10 |

**Model tiering:** Opus for orchestration only. Sonnet for creative work (UI, business logic). Haiku for routine tasks (SQL, builds, reviews).

VPS hosting: ~$4-8/month (Hostinger).

> Per-ticket token tracking is planned — see roadmap.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

MIT — see [LICENSE](LICENSE)
