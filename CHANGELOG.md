# Changelog

## [Unreleased]

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
