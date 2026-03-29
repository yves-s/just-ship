# Just Ship — Product Overview

> This file describes the entire Just Ship product across all repositories.
> It exists so that Claude Code — working in any repo — understands the full system.

---

## What is Just Ship?

A multi-agent framework for autonomous software development with Claude Code. A single ticket triggers a full pipeline: triage, planning, implementation, testing, PR, merge. Runs locally via CLI or 24/7 on a VPS.

---

## Repositories

Just Ship consists of 4 repositories. They share the same Supabase database (Pipeline-DB: `wsmnutkobalfrceavpxs`) and belong to the same workspace.

### 1. Engine (`just-ship`)

The core framework. Gets installed into target projects via `setup.sh`. Contains everything that makes autonomous development work.

**Agents:** Orchestrator, Backend, Frontend, Data Engineer, DevOps, QA, Security, Triage

**Pipeline:**
- **Runner** — Single ticket-to-PR execution with human-in-the-loop resume
- **Worker** — Supabase polling for queued tasks, multi-worker concurrency
- **Server** — HTTP endpoints for Board integration (`/api/launch`, `/api/events`, `/api/answer`, `/api/ship`)

**Slash Commands:** `/develop`, `/ship`, `/ticket`, `/connect-board`, `/disconnect-board`, `/setup-just-ship`, `/just-ship-update`, `/just-ship-vps`, `/add-project`, `/status`

**Skills (23):** brainstorming, writing-plans, executing-plans, TDD, systematic-debugging, code-review, frontend-design, creative-design, ux-planning, backend, data-engineer, Shopify (theme, liquid, metafields), webapp-testing, and more

**VPS:** Docker-based deployment with Caddy reverse proxy, automatic HTTPS, multi-project support

**Repo:** `just-ship` | **Local path:** `../just-ship`

---

### 2. Board (`just-ship-board`)

The web dashboard. Multi-tenant SaaS for ticket and project management. This is what users interact with in the browser.

**Core Features:**
- **Dashboard** — KPIs, activity stream, recent tasks
- **Kanban Board** — Visual ticket management with drag-and-drop
- **Ticket Management** — Create, view, edit, search, filter tickets
- **Workspace & Project Settings** — Members, API keys, notifications, pipeline config

**Sidekick (AI Ticket Assistant):**
- Embeddable iframe for external projects (`<script src="board.just-ship.io/sidekick.js">`)
- Claude Sonnet chat with tool-calling (create/search/list tickets)
- SSE-streaming responses, conversation persistence
- Third-party iframe auth via localStorage + popup SSO

**Pipeline API:**
- REST API at `/api/v1/pipeline/[slug]/tickets`
- Bearer token auth (`adp_...` keys, SHA-256 hashed)
- Webhook endpoints for pipeline events

**Telegram Integration:**
- Connect/disconnect Telegram bot per workspace
- Verify and manage bot connections from settings

**Tech:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Supabase, TanStack Query 5

**Repo:** `just-ship-board` | **Local path:** `../just-ship-board` | **Deployed at:** board.just-ship.io (Vercel)

---

### 3. Bot (`just-ship-bot`)

Telegram bot for creating tickets via chat. Supports text, voice messages, and screenshots.

**Features:**
- **Text tickets** — Send a message, get a structured ticket
- **Voice tickets** — Transcription via OpenAI Whisper (German)
- **Screenshot tickets** — Image analysis via Claude API, supports multiple images
- **AI structuring** — Automatic title, description (Problem/Desired Behavior/Acceptance Criteria), priority, tags
- **Multi-workspace** — Workspace and project selection per user
- **User auth** — Telegram account linking to Board workspaces

**Tech:** Telegraf, TypeScript, Anthropic SDK, OpenAI SDK (Whisper), Supabase

**Repo:** `just-ship-bot` | **Local path:** `../just-ship-bot` | **Deployed on:** VPS (systemd service)

---

### 4. Website (`just-ship-web`)

Marketing and documentation website at just-ship.io.

**Pages/Sections:**
- **Hero** — "Your 24/7 tech team. Always shipping" + early access signup
- **How It Works** — 4-step workflow (Ticket > Agents > PR > Ship)
- **Differentiation** — Problem vs. solution comparison, competitor positioning
- **Agents** — Overview of all 7 specialized agents with model routing
- **Commands** — `/ticket`, `/develop`, `/ship` showcase
- **Features** — Live Board, Smart Cost Routing, 24/7, Parallel Agents, Zero-Config, Open Source
- **Skills** — 17 battle-tested workflows (8 framework + 9 superpowers)
- **Showcase** — Real products (Aime, 19ELF, just-ship itself)
- **Quick Start** — `curl` install + onboarding flow
- **Newsletter** — Email subscription with confirmation flow

**Tech:** Next.js 16, TypeScript, Tailwind CSS 4, Supabase (newsletter)

**Repo:** `just-ship-web` | **Local path:** `../just-ship-web` | **Deployed at:** just-ship.io (Vercel)

---

## How the Repos Connect

```
                    +-----------------+
                    |     Board       |
                    | board.just-ship |
                    | .io             |
                    +--------+--------+
                             |
              HTTP API       |  Sidekick iframe
          (/api/launch,      |  (embeddable in
           /api/events)      |   any project)
                             |
+------------+      +--------+--------+      +------------+
|    Bot     |----->|     Engine      |      |    Web     |
| Telegram   |      | (Framework +   |      | just-ship  |
|            |      |  Pipeline)     |      | .io        |
+------------+      +----------------+      +------------+
      |                     |
      |   Supabase          |   setup.sh
      |   (shared DB)       |   (installs into
      +---------------------+    target projects)
```

- **Board triggers Engine** — "Develop" button sends POST to Engine's `/api/launch`
- **Engine reports to Board** — Pipeline events stream back via `/api/events`
- **Bot writes to DB** — Tickets created via Telegram land in the same Supabase DB the Board reads
- **Engine installs into projects** — `setup.sh` copies agents, commands, skills into any repo
- **Web is standalone** — Marketing site, links to Board for signup, install script for CLI
- **Sidekick embeds from Board** — Any external project can embed the AI ticket assistant

## Shared Database

All repos share the Pipeline-DB (`wsmnutkobalfrceavpxs` on Supabase):
- **workspaces** — Multi-tenant containers
- **projects** — Within workspaces
- **tickets** — The core unit of work
- **task_events** — Pipeline execution logs
- **api_keys** — Hashed Bearer tokens for pipeline auth
- **workspace_members** — User access control
- **telegram_users** — Bot authorization
