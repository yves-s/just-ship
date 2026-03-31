# Changelog

## [Unreleased]

### Changed
- VPS deploys now use pre-built Docker images from GHCR instead of git-pull + build on server
- `docker-compose.yml` references `ghcr.io/yves-s/just-ship/pipeline` image instead of local build context
- VPS Updater (`just-ship-updater.sh`) uses `docker pull` instead of `git fetch` + `docker build`
- Rollback on failed health-check pulls previous image tag instead of git checkout + rebuild
- Self-update mechanism extracts new updater script from container image via `docker cp`
- Project updates run `setup.sh --update` from inside the container (framework files bundled in image)

### Added
- GitHub Actions workflow (`.github/workflows/build-pipeline.yml`) to build and push pipeline Docker image to GHCR on push to main
- `.dockerignore` to keep Docker image lean
- `PIPELINE_IMAGE_TAG` environment variable for docker-compose image tag override

### Added
- `shopify-storefront-api` skill — GraphQL Storefront API queries, pagination, caching, rate limits
- `shopify-hydrogen` skill — React Router v7, Hydrogen components, SSR/streaming, Oxygen deployment
- `shopify-admin-api` skill — Admin API mutations, webhooks, bulk operations, data migration
- `shopify-checkout` skill — Checkout UI Extensions, Shopify Functions, Cart Transform (Shopify Plus)
- `shopify-apps` skill — App CLI, App Bridge v4, Polaris, session tokens, billing API
- Pipeline checkpoint persistence (`pipeline/lib/checkpoint.ts`) — writes phase-level checkpoints to ticket for crash recovery
- Budget ceiling enforcement (`pipeline/lib/budget.ts`) — blocks pipeline launch when workspace monthly budget exceeded (HTTP 402)
- Cost aggregation views (`ticket_costs`, `project_costs`) in Pipeline-DB for budget tracking
- `workspaces.budget_ceiling_usd` and `budget_alert_threshold` fields
- `tickets.pipeline_checkpoint` JSONB field for crash recovery state
- `pipeline.timeouts` config in project.json for per-model agent timeout configuration
- Checkpoint-based worktree recovery — server reattaches crashed pipeline's worktree via checkpoint branch_name

### Changed
- Pipeline server emits `budget_exceeded` (402) and `budget_threshold` events before launch
- `executePipeline()` writes checkpoints at triage, planning, agents_done, qa phases; clears on success

### Fixed
- Pipeline events, token tracking, and change summaries now work in VPS multi-project mode — `loadProjectConfig()` reads `board_url` and `api_key` from `server-config.json` when `SERVER_CONFIG_PATH` is set

### Added
- Shared watchdog module (`pipeline/lib/watchdog.ts`) — `withWatchdog()` timeout wrapper and `saveWorktreeWIP()` helper, extracted from server.ts for reuse
- Worker watchdog — `executePipeline()` wrapped in `withWatchdog()` with per-run AbortController; on timeout: abort subprocess, save WIP, reset ticket
- Structured diagnostic logging before orchestrator `query()` call (agents, skills, prompt length, timeout, branch)
- Sentry breadcrumbs at `triage_done` and `orchestrator_start` phases
- In-memory ring buffer (last 10 runs) for `/health` endpoint with `last_completed`, `last_error`, `recent_runs`, `uptime_seconds`
- CORS headers on Pipeline Server scoped to Board domain for dashboard polling
- Complexity gate — worker filters tickets by `maxAutonomousComplexity` (default: `medium`); server rejects high/critical complexity via HTTP 422
- Question text capture — buffers last assistant message before pause, stores question via Board API events + denormalized `pending_question` field
- Lifecycle timeout runner in worker main loop: failed tickets > 1h auto-reset (max 3 retries, then backlog); paused tickets > 24h auto-cancel with WIP saved
- `findParkedForTicket()` and `releaseByDir()` methods on WorktreeManager
- `getSlotDir()` method on WorktreeManager
- Complexity heuristics in ticket-writer skill (low/medium for autonomous, high/critical for local)
- Spike tickets get automatic +3 day `due_date` via ticket-writer skill

### Changed
- Bugsink + Dozzle monitoring for VPS deployments — error tracking via `@sentry/node` SDK and live container log viewer, both behind Caddy basicauth at `/errors/` and `/logs/`
- `BUGSINK_DSN` environment variable auto-configured in Docker pipeline-server container
- `/spike-review` command — review completed spike tickets, auto-locate spike documents in `docs/spikes/`, present concise summaries, convert Implementation Steps into follow-up tickets. Supports interactive and autonomous (`--auto`) modes
- Skill Loader (`pipeline/lib/load-skills.ts`) — loads domain and custom skills per project, filters by agent role, auto-resolves Shopify variant defaults
- Token cost tracking (`pipeline/lib/cost.ts`) — estimates API costs per model, parses token usage from SDK responses
- `stack.platform`, `stack.variant`, `skills.domain`, `skills.custom`, `pipeline.skip_agents`, `build.verify` fields in `project.json`
- Verification commands in QA phase — platform-specific checks (e.g. `shopify theme check`) run before QA fix loop
- Token usage reporting in pipeline events — `input_tokens`, `output_tokens`, `model`, `estimated_cost_usd` on agent completion events
- Pipeline summary event (`pipeline_completed`) with aggregated token costs at end of run
- Path traversal guard on skill name validation
- Spike T-472: Monitoring solution research — evaluated 10+ tools, recommends Bugsink + Dozzle for VPS error logging and live log visibility
- `/just-ship-review` command — checkout branch, install deps, build, start dev server for local testing. Supports `/review T-{N}` direct access and interactive branch selection without arguments

### Changed
- `createEventHooks()` now returns `{ hooks, getTotals }` to support token accumulation
- `executePipeline()` and `resumePipeline()` now load skills, filter agents by `skip_agents`, and inject domain skills into agent prompts
- `/ship T-{N}` argument support — ship a specific ticket's branch without checking it out first
- `/ship` dev-server cleanup — kills background dev server (PID-tracked) before merging
- `/ship` stale-branch hints — warns about `[gone]` branches and branches >50 commits behind main after shipping
- `build.dev`, `build.dev_port`, `build.install` fields in `project.json` for dev-server and dependency configuration

### Changed
- `/just-ship-status` command rewritten — now shows all branches, PRs, board status, worktrees, and cleanup recommendations (replaces legacy single-ticket Supabase view)

### Added
- VPS Update-Agent (`just-ship-updater.sh`) — host-level systemd service that orchestrates zero-downtime updates
- Drain mechanism (`pipeline/lib/drain.ts`) — graceful drain state machine (normal → draining → drained) for zero-downtime container replacement
- `/api/update` endpoint — receives update triggers from the Board, writes trigger file for Update-Agent
- `/api/drain` and `/api/force-drain` endpoints — control graceful shutdown of running pipelines
- Health endpoint extended with `drain` status field (backward-compatible)
- `install-updater.sh` — installer for the Update-Agent on VPS hosts
- `update_secret` field in `ServerConfig` — per-VPS authentication for update triggers
- Docker trigger volume mount (`/home/claude-dev/.just-ship/triggers:rw`) for container-to-host communication

### Added
- Shopify as first-class hosting type — `/develop` pushes unpublished theme per ticket, `/ship` cleans up after merge
- `shopify-preview.sh` script for theme push, preview URL extraction, and cleanup
- `no-settings-data-edit.md` rule — hard guard preventing agents from editing merchant customizations
- `write-config.sh` extended with `--shopify-password` flag for Theme Access passwords on VPS
- `/setup-just-ship` auto-detects Shopify themes (`sections/` + `layout/theme.liquid`) and configures project accordingly
- `setup.sh` checks for Shopify CLI as optional prerequisite when theme project detected
- Playwright QA now works with Shopify preview URLs (hosting-agnostic), with storefront password support
- `templates/project.json` includes `hosting` and `shopify.store` fields

### Fixed
- VPS pipeline now runs as non-root user (uid=1001) — Claude Code refused `--dangerously-skip-permissions` as root
- VPS pipeline container now correctly receives `ANTHROPIC_API_KEY` — project env was not forwarded to triage and QA-fix-loop query calls
- Claude Code stderr now visible in pipeline logs via `spawnClaudeCodeProcess` hook — previously only exit code was logged on failure
- Env files moved to `/home/claude-dev/.just-ship/env.<slug>` — previously at `/home/claude-dev/.env.<slug>` which is outside the Docker volume mount
- QA runner now reads `build.web` and `build.test` from `project.json` instead of hardcoded `npm run build`
- `git checkout -f main` discards uncommitted changes before each pipeline run, preventing conflicts on next run
- `git config --global --add safe.directory '*'` added to Docker entrypoint — prevents "dubious ownership" errors in mounted volumes
- `CLAUDE_UID`/`CLAUDE_GID` now passed inline to all `docker compose` commands — Docker Compose variable substitution reads from shell env, not from `env_file:`
- Node.js 20 install step added to `/just-ship-vps` setup — required by `setup.sh` but was not installed

### Added
- Change summary generation after agent runs — pipeline writes a human-readable summary of file changes, commits, and PR link to the ticket's `summary` field via Board API
- Token cost estimation per ticket — Board aggregates `estimated_cost` alongside `total_tokens` using configurable per-model rates (Opus/Sonnet/Haiku)
- Centralized token rate config (`token-rates.ts`) with blended pricing for agent workloads
- Cost display in ticket detail view (e.g. "12.4k tokens · $0.07 est.")
- DB migration `014_add_estimated_cost.sql` with atomic cost accumulation via updated `increment_ticket_tokens` RPC

### Fixed
- Preview URL in `/develop` and `/ship` now always attempts to fetch the Vercel deployment URL instead of requiring `pipeline.hosting: "vercel"` config gate — prevents GitHub links from being set as preview URLs
- Agent completion events now reach the Board — `SubagentStop` hook doesn't include `agent_type`, so `on-agent-start.sh` now writes an `agent_id→agent_type` mapping that `on-agent-stop.sh` reads back
- `/develop` now writes `.active-ticket` after branch creation so shell hooks can send events throughout the session
- Worker restart now sends Board API cleanup events for all known agent types on stuck tickets, clearing stale active pulsing and spinning agent indicators
- Install script (`install.sh`) — add error handling with cleanup trap, fix duplicate PATH entries on re-install, handle diverged local repo gracefully, add Linux-specific git install hint, use `USER_SHELL` instead of overwriting `SHELL` variable

### Improved
- `setup.sh --update` now shows an animated spinner during the `claude -p` template sync step, preventing the terminal from appearing frozen

### Changed
- Extend `/develop` docs-check (step 8) to cover CHANGELOG.md, docs/ARCHITECTURE.md, templates/CLAUDE.md, vps/README.md, and CONTRIBUTING.md in addition to README.md and CLAUDE.md

## 2026-03-22

### feat: Sidekick -- AI-powered in-app assistant
- Embeddable snippet (`sidekick.js`, ~3KB) adds a persistent split-view chat panel to any website
- AI-powered ticket creation, search, and duplicate detection via Claude Sonnet
- Conversation history with per-project scoping and workspace-level auth
- Automatic page context capture (URL, title) included in ticket descriptions
- Activation via `Ctrl+Shift+S` or `?sidekick` URL parameter
- Auth via Supabase session (same-origin iframe) with popup login flow
- Backend API at `/api/sidekick/*` with rate limiting (30 msg/min, 200/day per project)
- DB migration `011_sidekick.sql` (conversations + messages tables with RLS)
- Documentation added to README.md and ARCHITECTURE.md

## 2026-03-03

### fix: Bash permission syntax (`bb072e7`)
- `Bash(**)` is **invalid** — double-star only works for file-based tools (Read, Edit, Glob, Grep)
- `Bash(*)` or `Bash` (no parens) is the correct syntax to allow all commands
- Key gotcha: Claude Code parses shell operators (`&&`, `|`, `;`). A pattern like `Bash(find *)` does NOT match `find /path | sort` because `sort` is a separate piped command
- Specific patterns like `Bash(git *)` also fail for chained commands: `cd /path && git checkout -b branch`
- **Rule: Always use `Bash` (no parens) for blanket allow**

### feat: setup.sh update mode (`590fb09`)
- `--update` flag for non-interactive framework file updates
- `--dry-run` flag to preview changes without applying
- Version tracking via `.claude/.pipeline-version`
- Diff preview shows new, changed, and removed files
- Project files (CLAUDE.md, project.json, skills/) are never overwritten

## 2026-03-02

### feat: initial framework (`7800894`)
- Agent definitions (data-engineer, backend, frontend, devops, qa)
- Slash commands (/ticket, /status, /merge, /review)
- Pipeline runner for VPS/CI automation
- Interactive setup.sh with project.json generation
- settings.json with permission defaults
