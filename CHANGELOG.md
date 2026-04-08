# Changelog

## [T-625] VPS Integration Test — Pipeline Merge Gate — 2026-04-07

**Bereiche:** Pipeline, Quality

Neues Script `scripts/pipeline-vps-test.sh` das ein echtes Ticket auf dem VPS durch die Pipeline schickt und end-to-end verifiziert: Agent-Ausführung, PR-Erstellung, Ticket-Status `in_review`. Ersetzt die bisherige manuelle VPS-Verifikation als primäres Merge-Gate für Pipeline-Tickets. Definition of Done in CLAUDE.md aktualisiert um den automatisierten VPS-Test zu referenzieren.

## [Unreleased]

### Added
- **Sparring skill for strategic discussions**: New `skills/sparring.md` with automatic domain triage — recognizes which experts (CTO, Design Lead, UX Lead, etc.) to bring to the table based on topic signals. CLAUDE.md "Durchdenken" intent now references the sparring skill instead of ad-hoc behavior
- **Coolify preview URL support in /develop**: Step 9f now includes a `coolify` branch that polls the Coolify Deployments API via `get-preview-url.sh` (60s timeout) and writes the application FQDN as preview URL to the ticket

### Fixed
- **Permission prompts in local pipeline runs**: Broadened `PermissionRequest` hook matcher from `Write(.claude/**)|Edit(.claude/**)` to `Write(**)|Edit(**)`, preventing permission dialogs for Write/Edit operations in worktrees during local runs

### Added
- **Shopify App variant verification**: `verify-commands.ts` now supports `variant: "remix"` — adds `npm run build` (blocking), optional ESLint and TypeScript checks (advisory) based on config file detection
- **Shopify App environment checks**: `shopify-env-check.sh` detects app vs theme variant and runs appropriate checks — apps verify `shopify.app.toml`, `node_modules`, `.env` with `SHOPIFY_API_KEY`; themes keep existing store URL + auth checks
- **Shopify App .env.example generation**: First `/develop` in a Shopify App project auto-generates `.env.example` with standard vars (SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL, SCOPES)
- **Shopify App dev hint**: Remix variant env-check outputs a note to run `shopify app dev` in a separate terminal
- **Local cost tracking**: SessionEnd hook now reads token usage from Claude Code session JSONL files and writes `total_tokens` + `estimated_cost` to the Board ticket — costs accumulate across multiple sessions per ticket
- **Session cost calculator**: New `calculate-session-cost.sh` script parses Claude Code session data, detects model (Opus/Sonnet/Haiku), and calculates estimated USD cost using the same pricing as the VPS pipeline
- **Coolify CLI wrapper**: New `coolify-api.sh` script for autonomous Coolify management — supports CRUD operations, deployment triggers, status checks, app logs, and app listing. Token stored securely in `~/.just-ship/config.json`, URL read from `project.json`
- **Shopify auto-detection in setup.sh**: `setup.sh` now auto-detects Shopify project types (App/Remix, Theme/Liquid, Hydrogen) via filesystem signals and fills `project.json` with platform, variant, build commands, and domain skills — no manual configuration needed
- **detect-shopify.sh**: New standalone detection script in `scripts/` with priority-based detection (App > Hydrogen > Theme), store domain parsing, and JSON output
- **Remix variant in VARIANT_DEFAULTS**: `load-skills.ts` now supports `remix` variant with `shopify-apps` + `shopify-admin-api` skills
- **Variant-specific post-install output**: After setup, Shopify projects see their detected type and variant-specific next steps instead of the generic message
- **VPS config sync on deploy**: `just-ship-updater.sh` now syncs `project.json` from `origin/main` after each project update, preventing config drift between local and VPS
- **Container startup validation**: `entrypoint.sh` validates all project configs at container start — checks for `project.json` presence, required pipeline fields, and logs hosting provider per project
- **Server startup config validation**: `server.ts` logs config completeness per project at startup (missing fields, hosting provider) via structured pino logger

### Fixed
- **Preview-Check leaking internal details**: The else-branch in `/develop` step 9f now has an explicit, neutral output instruction instead of a code comment — prevents executing agents from inventing messages that expose provider names or script paths
- **Branch name truncation trailing dash**: `toBranchName()` in `pipeline/lib/utils.ts` now strips leading and trailing non-alphanumeric characters after `.slice(0, 40)`, preventing branch names that end with `-` from being rejected by `sanitizeBranchName`
- **Unhandled branch name errors in server launch/answer handlers**: `toBranchName()` calls in `server.ts` (`handleLaunch` and the answer/resume handler) are now wrapped in try/catch — on failure, the ticket is immediately rolled back to `pipeline_status: "failed"` / `status: "ready_to_develop"` instead of being left stuck in `running`
- **Unhandled branch name errors in run.ts**: `sanitizeBranchName()` calls in `executePipeline` and `resumePipeline` are now wrapped in try/catch — on failure, the function returns a typed `PipelineResult` with `status: "failed"` and a descriptive `failureReason` instead of throwing an unhandled exception
- **loadAgents reads from worktree instead of project root**: `loadAgents()`, `loadOrchestratorPrompt()`, `loadTriagePrompt()`, and `loadEnrichmentPrompt()` now use `projectDir` instead of `workDir`. Because `.claude/agents/` is gitignored it doesn't exist in worktrees, causing `agents: []` and the orchestrator never delegating.
- **Preview URL always resolved**: `qa-runner.ts` now resolves the Vercel/Coolify preview URL for all QA tiers (light + full), not only `full`.
- **Preview URL patched to ticket**: `run.ts` now patches `preview_url` onto the ticket via the Board API after a successful PR push.
- **Pipeline push recovery**: Push failures due to non-fast-forward (stale remote branch from prior run) now recover via `git pull --rebase` instead of failing permanently. Root cause of T-467.
- **Remote branch cleanup on retry**: `_createWorktree()` now deletes stale remote branches before creating new worktree, preventing branch conflicts on pipeline retries.
- **Ship handler status rollback**: `handleShip()` in server.ts now correctly sets `pipeline_status: "failed"` on merge errors and PR-not-found — previously left tickets stuck in `in_review` with no status indicator.
- **Shell injection in PR creation**: Replaced inline shell-interpolated `--body` with `--body-file` temp file for `gh pr create` calls.
- **Git timeout protection**: `_git()` helper now has a 30s default timeout, preventing hung git operations from blocking worker slots indefinitely.
- **Stale running tickets auto-reset**: `runLifecycleChecks()` in worker now detects tickets stuck at `pipeline_status=running` for >90min and resets them to `ready_to_develop` — handles hung worker processes that don't crash (and thus don't trigger systemd restart cleanup)

### Changed
- **Pipeline Definition of Done**: Extended to require VPS verification in addition to smoke test — includes a per-category table of what must be verified on the VPS before merge
- **Smoke Test**: Added steps 7-8 covering the stuck-recovery Board API round-trip (create ticket at `in_progress` → reset to `ready_to_develop` → verify)

### Added
- **Pipeline E2E Smoke Test**: `scripts/pipeline-smoke-test.sh` verifies Board API round-trip end-to-end (create ticket → cycle through all statuses → verify). Runs automatically during QA when pipeline files are changed. Pipeline tickets cannot be marked done without a passing smoke test.

### Changed
- **QA Agent → Testing Engineer**: Upgraded QA agent from pure AC verifier to full Testing Engineer — test writing is now mandatory (not optional), agent autonomously decides unit/integration/E2E strategy per ticket, TDD skill added alongside webapp-testing
- **webapp-testing Skill**: Expanded from Playwright-only visual testing to full testing strategy covering test pyramid guidance, framework decision tree (Vitest/Jest/Testing Library by stack), and mocking boundaries (what to mock vs test for real)
- **Orchestrator Routing**: Testing tickets now explicitly route to QA Agent (Testing Engineer) with both webapp-testing and TDD skills

### Added
- **Diagnose Intent**: New fourth intent type in Organisation — triggers `product-cto.md` Skill for system-level root-cause analysis instead of jumping into ticket work. Phrases: "der CTO soll sich das anschauen", "warum passiert das immer wieder", "was läuft hier schief"
- **VPS Container Logs CLI**: New `vps/logs.sh` script fetches Docker container logs from the remote VPS via SSH — supports container listing, configurable tail lines (`-n`), follow mode (`-f`), and input validation against shell injection

### Fixed
- **Command Injection via Branch Name**: Created `sanitizeBranchName()` in `pipeline/lib/sanitize.ts` with strict allowlist regex, `..` traversal rejection, and shell metacharacter denylist — validates branch names in `executePipeline`, `resumePipeline`, `WorktreeManager._createWorktree`, and `handleShip`; fixed unquoted `${branchName}` in 4 `execSync` calls in `run.ts`
- **Health Endpoint Security**: Unauthenticated `/health` requests now return only `{"status": "ok"}` — running tickets, error details, uptime, project slugs, and drain status require valid `X-Pipeline-Key` header

### Added
- **Caddy Hardening**: Versioned `vps/Caddyfile` with security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security`), basicauth on Dozzle/Bugsink, auto-TLS via `CADDY_DOMAIN` env var, no wildcard CORS

### Added
- **Org-Routing for Terminal**: CLAUDE.md template now includes "Organisation — Skill Routing" section with routing table (Input-Typ → Skills → Workflow) covering 8 categories (UI/Frontend, Neue Seite/Feature, API/Backend, Datenbank, Großes Feature, Bug/Fix, Testing, Creative/Greenfield) — ensures Claude loads domain skills before implementing, matching Sidekick PM behavior
- **just-ship-update sync**: New section is automatically synced to existing projects via `/just-ship-update` command

### Added
- **Rate Limiting on VPS Pipeline API**: In-memory sliding window rate limiter for `/api/launch` (10/min per project), `/api/events` (100/min per project), `/api/ship` (10/min per project), `/api/answer` (30/min per ticket) — returns HTTP 429 with `Retry-After` header; health and admin endpoints remain unlimited

### Fixed
- **Pipeline Ship Phase**: Move push, PR creation, and status update from orchestrator agent to pipeline infrastructure (`run.ts`/`server.ts`) — fixes silent failures where code was committed locally but never pushed, leaving tickets stuck at `in_progress` with `pipeline_status: done`

### Changed
- **Hook-Based Ticket Detection**: Replace Claude Write-tool `.active-ticket` writes with automatic PostToolUse hook — eliminates Permission-Prompt interruptions during autonomous workflows
- Fix branch name regex in `detect-ticket.sh` to support `T-` prefix format (`feature/T-551-foo` → `551`)

### Removed
- `.claude/rules/active-ticket-write-tool.md` — obsolete workaround, no longer needed

### Changed
- **Multi-Project Concurrency**: Replace global single-ticket lock with per-project WorktreeManagers — multiple tickets can now run in parallel across (and within) projects in multi-project mode
- Health endpoint (`/health`) now returns `running` as an array of all active tickets with `running_count`, instead of a single object

### Fixed
- **Security**: Bugsink admin password is now auto-generated via `openssl rand -base64 32` during VPS setup — no more hardcoded `admin` default
- `install-updater.sh` backfills Bugsink secrets for existing installations if missing from `.env`

### Added
- **Structured Logging with Pino**: Replace all `console.log/error/warn` in pipeline with structured JSON logging
  - New `pipeline/lib/logger.ts` — Pino root logger with ISO timestamps, `service: "engine"` base field, and log level control via `LOG_LEVEL` env var
  - Sensitive data redaction: API keys, tokens, secrets automatically masked in all log output (partial masking: first 4 + last 4 chars)
  - Factory functions `createChildLogger` and `createPipelineLogger` for request/ticket-scoped logging with correlation fields (requestId, ticketNumber, workspaceId, branch)
  - All 50+ `console.log/error/warn` calls across 15 pipeline files replaced with structured logger calls at appropriate levels (debug/info/warn/error)

### Added
- **Coolify Hosting Integration**: `"coolify"` as `hosting.provider` in `project.json` — preview URL polling via Coolify API, QA runner integration, `coolify-deploy.sh` for automated project creation
- **Spike T-551**: Hosting infrastructure analysis for customer projects — Hetzner + Coolify recommended, multi-tenant architecture, cost model, security baseline, managed vs. self-hosted comparison
- **Pipeline Quality Gates**: 5 new modules for automated verification and reliability
  - `artifact-verifier` — 3-level verification (files exist, no stubs, exports wired) runs after each orchestrator completion
  - `verify-commands` — auto-discovers and executes lint/test/typecheck from package.json with retry logic (max 2 retries for blocking commands)
  - `scope-guard` — detects scope reduction in agent output ("placeholder", "v1", "hardcoded", etc.) with false-positive filtering
  - `supervisor` — agent timeout wrapper with retry/skip logic for stuck agents
  - `resume` — checkpoint-based resume decision logic (resume vs restart, skip completed agents)
- Test infrastructure: Vitest config, `npm run test` / `test:ci` scripts, CI gate blocks merge on test failure
- 91 tests across 8 test files (60 new tests for quality gate modules)

### Fixed
- Pipeline token tracking: SDK result usage data is now extracted and posted as `pipeline_completed` event with `input_tokens`, `output_tokens`, `estimated_cost_usd` — previously all values were null because hook-based token collection didn't fire for registered custom agents
- Token totals now also written to ticket's `total_tokens` and `estimated_cost` fields on pipeline completion

### Fixed
- **Security**: API keys no longer visible in Claude Code terminal output during `/develop` and `/ship` workflows
- New `board-api.sh` wrapper script hides credentials by suppressing stderr during credential resolution
- All Board API calls in commands now use `board-api.sh` instead of inline curl with exposed headers

### Added
- P2 Client Reports implementation plan — Board-native with token-based client access (`docs/superpowers/plans/2026-04-03-p2-client-reports.md`)

### Fixed
- Shopify scripts now load `.env` file for `SHOPIFY_CLI_THEME_TOKEN` — previously the token was only read from shell environment, making `.env`-based setup non-functional

### Added
- Shopify token setup step in `/setup-just-ship` — prompts for Theme Access token, writes to `.env`, validates against store, adds `.env` to `.gitignore`
- `shopify theme check` (official Liquid linter) integrated into QA pipeline before custom `shopify-qa.sh` analysis
- Triage Enrichment Phase 2 (`agents/triage-enrichment.md`) — Sonnet with tools enriches tickets with affected files, missing ACs, and Shopify-specific checks
- Board Comment API helper (`post-comment.sh`) — non-blocking comment posting for triage, preview, and QA results
- Shopify Environment Check (`shopify-env-check.sh`) — validates CLI, Node, Git, Auth, and project config with 24h cache
- Hybrid Shopify dev/push script (`shopify-dev.sh`) — `theme dev` locally, `theme push` on VPS, with mode detection and PID management
- Shopify App Scaffold skill (`shopify-app-scaffold.md`) — opinionated cleanup rules after `shopify app create`
- Shopify QA static analysis (`shopify-qa.sh`) — checks hardcoded values, propagation, section schema, breakpoints, OS 2.0 compliance
- Shopify-specific QA instructions in QA agent for consistency, settings, and breakpoint checks
- `scaffold_type` field in Triage output for app scaffolding detection
- `shopifyEnabled` flag in QaConfig for auto-detection of Shopify projects
- Shopify QA step integrated into QA runner pipeline (before agent review)
- Shopify-specific fix guidance in QA fix loop

### Changed
- `/just-ship-vps` skill updated for GHCR image-based deploys (docker pull instead of docker build)
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
- `/recover T-{N}` command for recovering stuck pipeline tickets (resume partial work or restart clean)
- Automatic stuck-ticket detection rule at session start (`.claude/rules/detect-stuck-tickets.md`)
- `agent_failed` pipeline event type for crash visibility on the Board
- `pipeline_status: crashed` state for watchdog timeouts with partial work saved
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
