# Changelog

## [T-625] VPS Integration Test — Pipeline Merge Gate — 2026-04-07

**Bereiche:** Pipeline, Quality

Neues Script `scripts/pipeline-vps-test.sh` das ein echtes Ticket auf dem VPS durch die Pipeline schickt und end-to-end verifiziert: Agent-Ausführung, PR-Erstellung, Ticket-Status `in_review`. Ersetzt die bisherige manuelle VPS-Verifikation als primäres Merge-Gate für Pipeline-Tickets. Definition of Done in CLAUDE.md aktualisiert um den automatisierten VPS-Test zu referenzieren.

## [Unreleased]

### Added
- **Prototype to Production Pipeline**: New launch pipeline that analyzes a GitHub repo, detects stack/gaps, and deploys to Just Ship Cloud. Includes prototype analyzer (`prototype-analyzer.ts`), launch orchestration (`launch-pipeline.ts`), Coolify app provisioning (create, env vars, build, deploy), and launch event types for Board Progress View integration.
- **`/api/launch/env` endpoint**: Accepts environment variable values from the Board UI during a launch pipeline run. Uses in-memory Promise resolution with 30-minute timeout.
- **`launch_type: "prototype"` in `/api/launch`**: New launch mode that triggers the full prototype-to-production flow instead of the standard ticket-based pipeline.

### Fixed
- **README banner image**: Replaced broken `public/logos/png/social/banner-1280x420.png` reference with existing `public/logos/just-ship-logos-preview.png`
- **README installation path**: Removed non-functional Claude Code marketplace plugin commands (`claude plugin marketplace add`, `claude plugin install`). CLI (`setup.sh`) is now the recommended installation path. Plugin section marked as "Coming soon" with local `--plugin-dir` fallback for development.

### Added
- **Shopify Board Integration**: Pipeline worker injects `SHOPIFY_STORE_URL` env var from Board project metadata for Shopify-typed projects. Pipeline generates Shopify theme preview URLs via `shopify-preview.sh` and patches them to ticket `preview_url` after completion.
- **Shopify AI Toolkit auto-install**: `setup.sh` now automatically adds `shopify-plugin@shopify-plugin` (registry: `Shopify/shopify-ai-toolkit`) to `plugins.dependencies` for Shopify projects (`stack.platform === "shopify"`). Works in both fresh setup and `--update` paths. The existing `install_plugins_from_project()` handles installation.
- **Audit completeness rule** (T-841): New `.claude/rules/audit-completeness.md` forces all audit agents to include a Pre-Conclusion Audit section listing reviewed files, checked items, and unverified areas. Prevents false negatives from agent hallucination.

### Fixed
- **Coolify preview URL end-to-end** — `implement.md` and `ship.md` (all 6 copies across `commands/`, `skills/`, `.claude/skills/`) now support Coolify and Shopify as hosting providers instead of hardcoding Vercel-only. Removed 15s deploy-poll cap in `coolify-preview.ts` that prevented the VPS pipeline from waiting long enough for Coolify deployments to finish (now uses the full `coolifyMaxWaitMs` config value, default 5 minutes).

### Changed
- **Connect-flow: project-local credentials** — `just-ship connect` now writes API key to `.env.local` (gitignored, `chmod 600`) instead of global `~/.just-ship/config.json`. `board-api.sh` reads `.env.local` as Tier 2 in its 4-tier credential fallback chain. `/connect-board` in Claude Code becomes a status-check only — tokens are redirected to `just-ship connect` in the terminal. `setup.sh` ensures `.env.local` is in `.gitignore`.
- **Server-side token redemption** — Encrypted `jsp_` tokens are now redeemed via Board API (`/api/connect/redeem`) when no local decryption key is available. Eliminates the need for `JSP_ENCRYPTION_KEY` on developer machines. Fallback chain: plain base64 → local AES-256-GCM → Board API redemption.

### Removed
- **Project-specific Supabase IDs from framework** (T-831): Removed `.claude/rules/supabase-db-routing.md` which contained hardcoded Aime database IDs and was copied to every installed project via `setup.sh`. Cleared `supabase.project_id` in `project.json`. Deleted obsolete `tmp/ticket-workflow-supabase.md` migration doc.

### Added
- **False-positive filter in `/just-ship-audit`**: New Step 4a filters findings against 13 exclusion precedents (ENV_TRUSTED, UUID_UNGUESSABLE, FRAMEWORK_ESCAPING, ORM_PARAMETERIZED, SHELL_TRUSTED, TEST_FIXTURE, EXAMPLE_FILE, DOCS_ONLY, CONFIG_BUILDTIME, INTERNAL_API, CLIENT_ONLY, SKILL_MARKDOWN, GENERATED_CODE) plus a confidence gate that drops medium-confidence + low-severity noise. Supports `--no-filter` flag to bypass. Based on Anthropic Security Review exclusion patterns.
- **Plugin Security Gate skill**: New `plugin-security-gate` skill that scans third-party plugins for prompt injection, credential harvesting, exfiltration, persistence, and supply chain risks. Five threat categories (T1-T5) with pattern-based detection. Runs automatically during `setup.sh` plugin installation — blocks install on critical findings.
- **`scripts/scan-plugin-security.sh`**: Lightweight bash scanner for plugin skills, used by `setup.sh` during plugin installation. Checks markdown files for prompt injection patterns and script files for dangerous code execution, persistence, and credential harvesting patterns.
- **COOLIFY_API_TOKEN onboarding in VPS scripts** (T-833): `setup-vps.sh` now optionally prompts for `COOLIFY_API_TOKEN` during initial setup and writes it to `.env` when provided. `connect-project.sh` detects `hosting.provider: "coolify"` in project config and warns (non-blocking) if the token is missing on the VPS.
- **`/just-ship-audit` command**: Parallel audit command that discovers `category: audit` skills via frontmatter, dispatches one agent per skill in parallel, and produces a consolidated severity-sorted report. Supports `--diff` (branch diff only) and `--skills` (filter by name) flags. Output: terminal summary + full report in `docs/audit/`.
- **Audit frontmatter fields for skills**: Skills can now declare `category: audit` and `audit_scope: full|diff|both` in their YAML frontmatter to be discoverable by the audit command. Six plugin skills tagged: security-review, find-bugs, code-review, gha-security-review, differential-review, insecure-defaults.
- **`parseSkillFrontmatter` function**: New exported function in `load-skills.ts` that parses YAML frontmatter from skill files including `category` and `audit_scope` fields. Used by the audit command for skill discovery.
- **Plugin registration via marketplace** (T-817): Created `.claude-plugin/marketplace.json` so `claude plugin marketplace add yves-s/just-ship` discovers the plugin. Added `setup.sh --register-plugin` flag that validates the plugin structure, registers the marketplace, and installs the plugin in one step. Includes error handling, idempotency checks, and verification tests.

### Fixed
- **Plugin skills copied to project after installation** (T-826): `setup.sh` now copies SKILL.md files from the plugin cache (`~/.claude/plugins/cache/`) into `.claude/skills/` after `claude plugin install`. Skills are prefixed as `plugin--{name}--{skill}.md` to distinguish from framework skills. Stale plugin skills are cleaned up on each update. Previously, plugins were installed but skills were only in the global cache — invisible to users and agents.
- **project.json deep-merge on update** (T-825): `setup.sh --update` now automatically adds missing fields from `templates/project.json` into existing project configurations. Previously, new framework fields (e.g. `plugins`) were silently absent after updates, breaking features that depend on them. Deep-merge adds missing top-level and nested keys without overwriting existing values.

### Added
- **Framework abstraction check rule** (T-824): New `.claude/rules/framework-abstraction-check.md` requires agents to identify the abstraction level (Framework/Project/Runtime) before writing code. Prevents the pattern of solving framework-level problems with project-level approaches (e.g. vendoring files instead of declaring dependencies).
- **Plugin dependency management** (T-821): `project.json` gets a new `plugins` field with `registries` (GitHub repos as plugin marketplaces) and `dependencies` (plugins to install). `setup.sh` reads these fields and runs `claude plugin marketplace add` + `claude plugin install --scope project` idempotently — both in setup and update mode. Framework ships with getsentry/skills (security-review) and trailofbits/skills (differential-review, insecure-defaults) as default registries.
- **Mode detection: plugin vs standalone** (T-816): `project.json` gets a new `mode` field (`"plugin"` or `"standalone"`). `setup.sh` auto-sets `"standalone"` on install and update. `/init` detects mode via `CLAUDE_PLUGIN_ROOT` env var. Existing projects without mode field are migrated on next setup.sh run. Standalone mode skips framework file installation in `/init` (already done by setup.sh).

### Changed
- **/init delegates CLAUDE.md generation to setup.sh** (T-815): `/init` no longer generates CLAUDE.md, migrates templates, or installs framework files (agents, commands, skills, scripts, hooks, rules). It now focuses solely on stack detection and `project.json` creation/migration. All CLAUDE.md and framework file management is handled by `setup.sh`, eliminating the fragile duplicated logic.

### Fixed
- **Standalone settings.json with local hook paths** (T-814): `setup.sh` was copying the plugin `settings.json` (with `CLAUDE_PLUGIN_ROOT` paths) into target projects — hooks never ran because the env var was never set. Now copies `templates/settings.standalone.json` with `$CLAUDE_PROJECT_DIR` paths. Existing projects with plugin paths are automatically migrated on next `setup.sh` run.

### Added
- **Framework versioning and drift detection** (T-807): `setup.sh` now writes `framework.version` and `framework.updated_at` to `project.json` on install and update. New `--check` flag shows a drift report without changing files. Session-start rule warns when framework is older than 14 days. Prevents silent drift where installed projects miss new scripts, rules, or commands.
- **Single Source of Truth for CLAUDE.md template** (T-806): `scripts/sync-template.sh` auto-generates `templates/CLAUDE.md` from the repo's `CLAUDE.md` by replacing project-specific sections with placeholders. Integrated into quality-gate hook — editing CLAUDE.md automatically regenerates the template. Template drift is now structurally impossible.

### Fixed
- **Template CLAUDE.md synced to current state** (T-805): `templates/CLAUDE.md` was 104 lines behind the production CLAUDE.md — missing Skill Role Mapping table, Sparring flow, test-driven-development routing, and extended triggers. New projects now get the complete framework instructions on init.

### Changed
- **CLAUDE.md + project.json migration** (T-802): `/init` and `setup.sh` now detect incomplete or outdated CLAUDE.md files (<50 lines or missing framework sections) and regenerate from template while preserving project-specific content (description, conventions, architecture). `project.json` gets missing fields deep-merged from template without overwriting existing values. Fixes the "once broken, always broken" problem where a bad first install could never be repaired.
- **Init installs complete framework** (T-799): `/init` now copies all framework files (agents, commands, skills, scripts, hooks, rules, settings.json) from the plugin directory into the target project. Projects are immediately usable after init — no separate `setup.sh` step needed. All operations are idempotent. Also fixes the skills copy bug in `setup.sh` where `skills/*.md` glob matched nothing (now correctly iterates `skills/*/SKILL.md`)
- **Init onboarding UX** (T-794): `/init` now shows branded ASCII banner, box-layout project summary with detected stack, component counts (10 Agents, 37 Skills, 18 Commands), Board connect prompt with one-line explanation, and friendly message when stack is not detected
- **README installation and configuration docs** (T-790): Updated outdated sections — `project.json` example now shows current schema (workspace_id/project_id, no api_key/api_url), "Connecting a Project" documents `just-ship connect "jsp_..."` flow, "After Installation" shows both plugin and CLI directory structures, `--plugin-dir` development flow documented

### Added
- **Quality Gate Hooks** (T-742): PostToolUse hooks for Edit/Write that run lint and format checks on every changed file. ESLint/Biome/Ruff lint errors block the agent (exit 1), format violations are auto-fixed via Prettier/Biome/Ruff. Tool detection is cached per project.json mtime. Configurable via `quality_gates` in project.json (enabled, lint, format, ignore_patterns). Projects without linting tools skip silently
- **Auto-Epic on ticket split** (T-782): Every ticket split now automatically creates an Epic as a container before creating child tickets with `parent_ticket_id`. Trigger is the split action itself, not the ticket size. Also supports manual grouping of existing tickets under a new Epic. `/ticket` command updated to delegate split and group flows to the ticket-writer skill

### Fixed
- **Coolify preview URL never set on tickets** (T-801): `get-preview-url.sh` polled Coolify's `/api/v1/deployments` endpoint which returns empty arrays on v4 beta (`4.0.0-beta.470`). Added fallback: after brief deployment poll (10s), constructs preview URL directly from `preview_url_template` + PR number via `gh pr view`. Same fix applied to `pipeline/lib/coolify-preview.ts`. Both implementations remain graceful — never block the pipeline
- **Encrypted jsp_ token support** (T-796): `write-config.sh` now decrypts AES-256-GCM encrypted tokens generated by the Board. Falls back to plain Base64 for legacy unencrypted tokens. Key derivation uses SHA-256 of `JSP_ENCRYPTION_KEY` or `SUPABASE_SERVICE_ROLE_KEY`. Clear error messages for missing key, wrong key, and malformed tokens
- **Plugin structure corrected** (T-792): Restructured plugin to match actual Claude Code Plugin API. Skills converted from flat files (`skills/backend.md`) to subdirectory format (`skills/backend/SKILL.md`). `.claude-plugin/` cleaned to contain only `plugin.json` — all other components (agents, hooks, scripts) moved to plugin root. `setup.sh` updated to read from new subdirectory format. Added `hooks/hooks.json` for plugin-native hook registration

### Fixed
- **Preview URL broken locally** (T-784): `get-preview-url.sh` never produced a preview URL on local machines — two bugs: (1) Token resolution only checked env var and VPS path (`/root/.coolify-api/token`), missing `~/.just-ship/config.json` where the token actually lives locally. (2) Script returned raw FQDN (production URL) instead of PR-specific preview URL using Coolify's `preview_url_template`. Now reads token from `config.json` as third fallback, parses `preview_url_template` from Coolify API, and constructs PR-specific URLs (e.g. `https://board-204.preview.just-ship.io`). Code review hardened: `process.env.HOME` instead of shell `$HOME` in Node, newline-delimited field parsing, env var passing for app name (injection prevention), portable sed for macOS

### Changed
- **Connect command for plugin model** (T-781): `write-config.sh connect` now supports jsp_ v3 tokens with embedded `project_id` (`p` field), eliminating interactive project selection. New `--plugin-mode` flag writes board_url, workspace_id, and project_id to `project.json` without touching `~/.just-ship/config.json`, outputting structured JSON for credential storage via Plugin userConfig. Standard mode auto-links v3 projects directly. v2 tokens remain fully supported with existing fallback. `connect-board.md` rewritten to detect plugin environment and guide userConfig setup
- **Plugin-native credential resolution** (T-780): `board-api.sh`, `send-event.sh`, and `post-comment.sh` now resolve credentials via a 3-tier fallback: (1) `PIPELINE_KEY` + `BOARD_API_URL` from environment (plugin `userConfig`), (2) key from env + `board_url` from `project.json`, (3) legacy `write-config.sh` fallback. Plugin installations no longer require `~/.just-ship/config.json`. Added `board_api_url` to `plugin.json` userConfig and `pipeline.board_url` to `project.json` template. `write-config.sh connect` now writes `board_url` to `project.json` automatically
- **Ticket sizing rewritten for agentic dev** (T-783): Replaced time-based sizing (hours/days/weeks) with complexity signals (domain count, file spread, AC count, requirement clarity). Added "Autonomy profile" column showing what level of human review each size needs. XL remains a mandatory split signal
- **VPS infrastructure consolidated into engine repo** (T-774): All VPS deployment files (docker-compose.yml, Caddyfile, systemd units, setup-vps.sh, connect-project.sh, updater, monitoring scripts, logs.sh, tests) moved from the ops-repo back into `vps/`. Single `git clone && bash vps/setup-vps.sh` now provisions a complete VPS without needing a second repo. OPS-CONTEXT.md updated to reference engine-repo paths. Architecture description in CLAUDE.md updated

### Fixed
- **Hardcoded container name in updater** (T-774): 4 instances of hardcoded `vps-pipeline-server-1` in `just-ship-updater.sh` replaced with `$CONTAINER_NAME` constant
- **Token tracking deterministic** (T-772): Extracted token delta calculation from Markdown instructions into `ship-token-tracking.sh` script. Previously 97% of done tickets had 0 tokens because the agent skipped the inline bash in `/ship` step 5c. The script resolves the main repo root via `git-common-dir` (fixing worktree path mismatch), computes per-ticket deltas using start snapshots from `/develop`, and patches the Board with granular token fields. `on-session-end.sh` now delegates to the same script (fixing winner-takes-all). Synced `calculate-session-cost.sh` plugin copy with space/dot path handling

### Added
- **Marketplace distribution** (T-751): Plugin is now installable via `claude plugin marketplace add yves-s/just-ship && claude plugin install just-ship@just-ship`. Added `marketplace.json` with plugin metadata, description, 10 keywords, and GitHub source reference. Updated `plugin.json` with homepage, repository, license, and expanded keywords. New `scripts/sync-plugin-version.sh` keeps version in sync across `plugin.json`, `marketplace.json`, and `package.json`. `setup.sh` update flow now syncs plugin version from framework source. README documents both installation paths (Plugin and CLI)
- **Hooks & scripts migrated to plugin structure** (`.claude-plugin/scripts/`): All 5 event hooks and 16 utility scripts now live in the plugin directory alongside agents, skills, and rules from T-748. Hook scripts use `${CLAUDE_PLUGIN_ROOT}` for plugin-internal references while keeping project-relative paths (`$CWD`, `$PROJECT_ROOT`) for project files. `plugin.json` hooks updated to use plugin paths. PostToolUse hook for `detect-ticket-post.sh` added to plugin manifest. Code review fixed stale paths in `backfill-ticket-costs.sh` and `shopify-preview.sh`

### Fixed
- **Coolify Preview URL polling** (T-752): Updated `coolify-preview.ts` and `get-preview-url.sh` to use correct Coolify v4 API endpoints — `GET /api/v1/deployments` instead of the non-existent `GET /api/v1/applications/{uuid}/deployments`. Added PR preview URL construction using `preview_url_template` pattern (`https://{pr_id}.{domain}`)
- **Token tracking for projects with spaces/dots in path** (`calculate-session-cost.sh`, `session-summary.sh`, `develop.md`, `ship.md`): SAFE_CWD normalization now replaces spaces and dots with dashes, matching Claude Code's internal session directory naming convention. Previously, projects like `Psychotherapie Schleich/adhs-diagnostic` or `19elf.cc` would silently fail token tracking (exit 0, no data)

### Added
- **Init Command** (`commands/init.md`): Non-interactive `/init` command for project setup — auto-detects stack (Shopify Theme/App/Hydrogen, Next.js, React, Vue, Python, Go, Rust, etc.), creates `project.json` with detected stack info, generates `CLAUDE.md` from template. Idempotent — never overwrites existing files. Board connection remains separate via `/connect-board`. `setup.sh` now references `/init` as the post-install next step
- **Smart Model Routing** (`pipeline/lib/model-router.ts`): Pipeline agents are now routed to optimal models per phase — planning agents (code-review, qa, security) use Opus, implementation agents (backend, frontend, data-engineer, devops) use Sonnet. Configurable via `pipeline.model_routing` in `project.json` with per-agent overrides, custom phase assignments, and model validation. Falls back to single-model behavior when not configured. Board events include model info for cost tracking

### Changed
- **VPS infrastructure migrated to just-ship-ops**: Moved Docker-Compose, Caddyfile, systemd units, setup scripts (`setup-vps.sh`, `connect-project.sh`, `logs.sh`, `install-updater.sh`, `install-monitor.sh`), monitoring (`pipeline-container-monitor*`), and updater scripts from `vps/` to the `just-ship-ops` repository. Engine repo retains only `vps/Dockerfile` and `vps/entrypoint.sh` (CI build context). All markdown references updated across CLAUDE.md, README.md, docs/ARCHITECTURE.md, commands/, and scripts/. `/just-ship-vps` command now discovers the ops repo dynamically and validates its presence with pre-flight checks
- **Shopify skills replaced by official Shopify AI Toolkit**: Removed 9 custom Shopify skill files (`skills/shopify-*.md`) — Shopify domain knowledge now comes from the official `@shopify/dev-mcp` MCP server which provides live docs search, code validation, and auto-updates. `setup.sh` automatically configures the MCP server for detected Shopify projects (both fresh install and update). `detect-shopify.sh` no longer outputs skill names. Pipeline scripts (shopify-dev, shopify-preview, shopify-qa, shopify-env-check, shopify-app-deploy) remain unchanged

### Added
- **Framework files migrated to plugin structure** (`.claude-plugin/`): All 10 agents, 22 skills, 10 rules, and 17 commands now live in the plugin directory. Commands are migrated as skills with `just-ship:` namespace prefix (e.g., `/just-ship:develop`). Domain skills keep their original names. Internal references updated to plugin-relative paths. Original root-level files remain for backward compatibility
- **Plugin scaffold** (`.claude-plugin/plugin.json`): Claude Code plugin manifest with name, version, description, author, keywords, entry points (skills/, agents/, commands/), hooks (SessionStart, SubagentStart/Stop, SessionEnd), and userConfig for sensitive credentials (board_api_key, anthropic_api_key, github_token) and non-sensitive config (workspace_id, project_id). README updated with plugin installation section
- **Backfill script for historical ticket costs** (`.claude/scripts/backfill-ticket-costs.sh`): One-time script to correct historical ticket costs — resets 6 local tickets that had cumulative session costs with wrong pricing to $0, recalculates 8 VPS tickets with current Opus rates ($5/MTok). Supports `--dry-run`. Total correction: $680 → $0.95
- **Progressive Skill Disclosure**: Two-stage skill loading for VPS token optimization — `loadSkillFrontmatters()` loads only YAML frontmatter (name, description, triggers) for initial skill indexing, `loadSkillFull()` and `loadSkillByName()` load full content on demand. All 31 skills now have `triggers` keyword arrays in frontmatter. `loadSkills()` returns `frontmatterIndex` (compact text index), `totalFrontmatterTokens`, and `totalFullTokens` for measurable token savings. New `scripts/validate-skill-frontmatter.sh` validates all skill files before merge
- **Session Summary after /develop**: New Step 11 in `/develop` flow outputs a formatted terminal summary after QA — shows ticket title, description, git changes (files/lines/commits/branch), token usage breakdown (input/output/cache read/cache write), estimated cost with model name, and links (PR URL, preview URL, QA result). New `session-summary.sh` script collects all data and renders a box-drawing formatted output. Token/cost blocks are omitted gracefully when session data is unavailable
- **GitHub App Integration**: Pipeline now supports GitHub App Installation Tokens as an alternative to static PATs. New `pipeline/lib/github-app.ts` module generates short-lived tokens via JWT → GitHub API, with in-memory caching and 5-minute refresh margin. Both `server.ts` and `worker.ts` accept `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY_PATH` env vars. SaaS launch payload accepts `installation_id` for per-run token generation. PAT flow remains fully functional as fallback
- **Automated Code Review Agent**: New step 6.5 in `/develop` flow between Build-Check and QA — a `code-review` agent reviews the diff against main for code quality, patterns, edge cases, error handling, performance and security smells, then fixes issues directly as commits instead of leaving comments
- **Pipeline Container Monitoring** (`vps/pipeline-container-monitor.sh`): Health monitoring for pipeline containers on the Pipeline-VPS — cron-based (every 60s), Telegram alerts after 3 consecutive failures, auto-restart with backoff (immediate/30s/60s, max 3 attempts), recovery notifications, atomic state persistence, error-resilient per-container checks
- **Monitor installer** (`vps/install-monitor.sh`): One-command remote installation via SSH — copies script, installs cron entry, creates logrotate config (7-day retention), verifies execution. Idempotent and follows the same pattern as `provision-pipeline.sh`

### Fixed
- **Preview/Review URL never written to tickets (local /ship flow)**: All `board-api.sh` calls in `commands/ship.md` and `commands/develop.md` used literal `{N}` template placeholders instead of actual ticket numbers — causing silent 404 failures on every Board API patch. Replaced with explicit `$TICKET_NUMBER` shell variable extraction (from branch name in `/ship`, from API response in `/develop`). Added error-checking with warnings on failed patches. Root cause behind 5 prior failed fix attempts (T-460, T-622, T-662, T-663, T-688)
- **SonarQube BLOCKER S3516 in triageWithAI()**: Simplified `pipeline/lib/error-handler.ts:triageWithAI()` from a 3-branch function that always returned the same value to an explicit pass-through to `classifyError()`. Removes dead code paths and the stale TODO comment — AI-based reclassification will be added when the auto-heal pipeline is ready
- **Token-usage not reaching Board**: `postPipelineSummary` now includes `metadata.tokens_used` in the `pipeline_completed` event — fixes `increment_ticket_tokens` RPC never firing because it reads `metadata.tokens_used` while the engine only sent top-level `input_tokens`/`output_tokens`
- **Local /develop token tracking**: Added step 5c to `/ship` command that calculates session tokens and patches them to the ticket before setting status to `done` — fixes tokens always showing 0 for locally developed tickets because `on-session-end.sh` fires too late (session outlives the ticket)
- **Token cost calculation 8x too high**: `calculate-session-cost.sh` and `pipeline/lib/cost.ts` now apply correct cache pricing — cache reads at 90% discount ($1.50/MTok for Opus instead of $15/MTok), cache creation at 25% surcharge ($18.75/MTok). A session that actually costs ~$55 was previously shown as ~$450
- **Per-ticket token isolation**: `/develop` writes a token snapshot at ticket start (step 3e), `/ship` computes the delta between snapshot and current session state (step 5c) — each ticket now shows only its own costs instead of cumulative session totals
- **Cache-read pricing still 5x too high + no granular storage**: Corrected cache-read price from $1.50/MTok (1hr TTL) to $0.30/MTok (5min TTL auto-caching) in both `calculate-session-cost.sh` and `pipeline/lib/cost.ts`. `/ship` step 5c now sends granular token fields (`input_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `output_tokens`) to Board API for future analysis
- **Local cost tracking in worktree scenarios**: `detect-ticket-post.sh` and `on-session-end.sh` now resolve the main project root via `git rev-parse --git-common-dir` instead of using the Bash event CWD directly — fixes `.active-ticket` being written to worktree dir while `on-session-end` reads from project root
- **Model ID recognition for cost calculation**: Added `claude-opus-4-6` and `claude-sonnet-4-6` to pricing tables in `calculate-session-cost.sh` and `pipeline/lib/cost.ts` — sessions using current model IDs are now correctly matched instead of falling through to the fallback
- **VPS provisioning script** (`scripts/provision-pipeline.sh`): One-command setup of isolated pipeline instances on Hostinger VPS — creates Docker Compose stack (pipeline-server + Bugsink + Dozzle), auto-allocates ports, extends shared Caddy config with HTTPS, generates pipeline key, and includes full rollback on failure
- **Preview URL as ticket comment**: After a successful preview deploy, the pipeline now posts a comment (`type: "preview"`) to the ticket via the Board Comments API. The Board's upsert dedup ensures re-deploys overwrite the existing preview comment instead of creating duplicates. Implemented in both `pipeline/run.ts` (VPS mode) and `commands/develop.md` (local mode via `post-comment.sh`)
- **Sparring skill for strategic discussions**: New `skills/sparring.md` with automatic domain triage — recognizes which experts (CTO, Design Lead, UX Lead, etc.) to bring to the table based on topic signals. CLAUDE.md "Durchdenken" intent now references the sparring skill instead of ad-hoc behavior
- **Shopify App deploy in /ship**: After merge, `/ship` runs `shopify app deploy --force` for `variant: "remix"` projects — deploys extensions (Theme App Extensions, Checkout UI, Functions) and app config to Shopify. Retry on transient errors, non-blocking on failure with manual fallback hint
- **shopify-app-deploy.sh**: New script handling Shopify App deployment with variant detection, retry logic (exit 1 → retry, exit >1 → abort), and `.env`-based auth (`SHOPIFY_CLI_PARTNERS_TOKEN`)
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
