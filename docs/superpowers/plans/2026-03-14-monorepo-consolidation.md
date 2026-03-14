# Monorepo Consolidation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `just-ship-board` and `just-ship-bot` into `just-ship` as a single monorepo with npm workspaces.

**Architecture:** Board and Bot move into `apps/board/` and `apps/bot/` via `git subtree add` (preserving history). Framework files (agents, commands, skills, pipeline) stay at root. npm workspaces connect all three packages. Board deploys on Vercel, Bot + Worker on VPS.

**Tech Stack:** npm workspaces, git subtree, Next.js (board), Telegraf (bot), Claude Agent SDK (pipeline)

**Spec:** `docs/superpowers/specs/2026-03-14-monorepo-consolidation-design.md`

---

## Chunk 1: Git Subtree Migration

### Task 1: Remove legacy telegram-bot/ directory

The root contains a leftover `telegram-bot/` directory with only `node_modules/` inside — no actual source code. Remove it before the subtree operations.

**Files:**
- Delete: `telegram-bot/` (entire directory)

- [ ] **Step 1: Remove the directory**

The directory contains only `node_modules/` which is gitignored — nothing is tracked. This is a local cleanup only, no commit needed.

```bash
rm -rf telegram-bot/
```

---

### Task 2: Add Board repo via git subtree

Bring in `just-ship-board` with full git history under `apps/board/`.

- [ ] **Step 1: Add the board remote**

```bash
git remote add board git@github.com:yves-s/just-ship-board.git
git fetch board
```

- [ ] **Step 2: Run subtree add**

`git subtree add` creates the `apps/board/` directory automatically.

```bash
git subtree add --prefix=apps/board board main
```

This creates a merge commit containing the entire board repo history.

- [ ] **Step 3: Verify the subtree landed correctly**

```bash
ls apps/board/package.json
ls apps/board/src/app/layout.tsx
```

Both files should exist.

---

### Task 3: Add Bot repo via git subtree

Bring in `just-ship-bot` with full git history under `apps/bot/`.

- [ ] **Step 1: Add the bot remote**

```bash
git remote add bot git@github.com:yves-s/just-ship-bot.git
git fetch bot
```

- [ ] **Step 2: Run subtree add**

```bash
git subtree add --prefix=apps/bot bot main
```

- [ ] **Step 3: Verify the subtree landed correctly**

```bash
ls apps/bot/package.json
ls apps/bot/bot.ts
```

Both files should exist.

---

## Chunk 2: Cleanup & Workspace Setup

### Task 4: Clean Board — remove duplicated pipeline/claude files

Board has its own `.pipeline/` and `.claude/` directories that are copies of the framework. These are no longer needed since the monorepo has them at root.

**Files:**
- Delete: `apps/board/.pipeline/` (entire directory)
- Delete: `apps/board/.claude/` (entire directory)
- Delete: `apps/board/pnpm-lock.yaml` (dual lockfile)
- Delete: `apps/board/project.json` (contains API keys, was tracked in git)

- [ ] **Step 1: Remove the directories and files**

```bash
rm -rf apps/board/.pipeline/
rm -rf apps/board/.claude/
rm -f apps/board/pnpm-lock.yaml
rm -f apps/board/project.json
```

- [ ] **Step 2: Commit**

```bash
git add -A apps/board/.pipeline/ apps/board/.claude/ apps/board/pnpm-lock.yaml apps/board/project.json
git commit -m "chore(board): remove duplicated pipeline/claude files and secrets

- .pipeline/ — now at monorepo root
- .claude/ — root config applies to all workspaces
- pnpm-lock.yaml — using npm workspaces, not pnpm
- project.json — contained API keys, should not be in git"
```

---

### Task 5: Clean Bot — remove duplicated files, move systemd service

Bot has the same `.pipeline/` and `.claude/` duplication, plus a systemd service file that belongs in `vps/`.

**Files:**
- Delete: `apps/bot/.pipeline/` (entire directory)
- Delete: `apps/bot/.claude/` (entire directory)
- Delete: `apps/bot/project.json` (contains API keys, was tracked in git)
- Move: `apps/bot/telegram-bot.service` → `vps/just-ship-bot.service`

- [ ] **Step 1: Remove duplicated directories and secrets**

```bash
rm -rf apps/bot/.pipeline/
rm -rf apps/bot/.claude/
rm -f apps/bot/project.json
```

- [ ] **Step 2: Move and update the systemd service file**

Move the service file to `vps/` and update the working directory path:

```bash
mv apps/bot/telegram-bot.service vps/just-ship-bot.service
```

Then edit `vps/just-ship-bot.service` — change the `WorkingDirectory`:

```ini
# Before:
WorkingDirectory=/home/claude-dev/just-ship/telegram-bot

# After:
WorkingDirectory=/home/claude-dev/just-ship/apps/bot
```

**Note:** Verify that `EnvironmentFile` paths (e.g., `/home/claude-dev/.env.telegram-bot`) remain valid on the VPS. These env files must exist on the VPS for the service to start.

- [ ] **Step 3: Commit**

```bash
git add -A apps/bot/.pipeline/ apps/bot/.claude/ apps/bot/project.json apps/bot/telegram-bot.service vps/just-ship-bot.service
git commit -m "chore(bot): remove duplicated files, move systemd service to vps/

- .pipeline/, .claude/ — now at monorepo root
- project.json — contained API keys, should not be in git
- telegram-bot.service → vps/just-ship-bot.service with updated path"
```

---

### Task 6: Create .env.example for Board

Board has no `.env.example` — create one documenting all required environment variables.

**Files:**
- Create: `apps/board/.env.example`

- [ ] **Step 1: Create the file**

```bash
# apps/board/.env.example
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
TELEGRAM_BOT_SECRET=your-telegram-bot-secret
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=your_bot_username
```

- [ ] **Step 2: Commit**

**Note:** The board's `.gitignore` currently has `.env*` which blocks `.env.example`. Task 7 will fix this by replacing the board `.gitignore` with `!.env.example`. Until then, force-add the file:

```bash
git add -f apps/board/.env.example
git commit -m "chore(board): add .env.example with required environment variables"
```

---

### Task 7: Reconcile .gitignore files

Three `.gitignore` files need to be consolidated. The root `.gitignore` already has good patterns. Board and bot `.gitignore` files need board/bot-specific patterns only.

**Files:**
- Modify: `.gitignore` (root)
- Modify: `apps/board/.gitignore`
- Modify: `apps/bot/.gitignore`

- [ ] **Step 1: Update root .gitignore — add monorepo-wide patterns**

Add to root `.gitignore`:

```gitignore
# Vercel
.vercel

# Next.js (for apps/board)
.next/

# TypeScript
*.tsbuildinfo
```

- [ ] **Step 2: Simplify board .gitignore — keep only board-specific patterns**

Replace `apps/board/.gitignore` with only board-specific entries not covered by root. Env patterns are handled by root `.gitignore` (which already has `!.env.example`):

```gitignore
# Next.js
/out/
next-env.d.ts

# Coverage
/coverage

# Build
/build
```

- [ ] **Step 3: Simplify bot .gitignore — keep only bot-specific patterns**

Replace `apps/bot/.gitignore` with only bot-specific entries not covered by root. Env patterns are handled by root `.gitignore`:

```gitignore
# Supabase
supabase/.temp/
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore apps/board/.gitignore apps/bot/.gitignore
git commit -m "chore: reconcile .gitignore files across monorepo

Root .gitignore handles common patterns (node_modules, .DS_Store, etc.).
Board and bot .gitignore files keep only workspace-specific patterns."
```

---

### Task 8: Rename pipeline package and create root package.json

Avoid npm workspace name collision and set up the monorepo.

**Files:**
- Modify: `pipeline/package.json`
- Create: `package.json` (root)

- [ ] **Step 1: Rename pipeline package**

Edit `pipeline/package.json` — change only the `name` field (leave everything else untouched):

```json
// Before:
"name": "just-ship"

// After:
"name": "just-ship-sdk"
```

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "just-ship",
  "private": true,
  "workspaces": [
    "pipeline",
    "apps/*"
  ],
  "scripts": {
    "dev:board": "npm run dev -w apps/board",
    "dev:bot": "npm run dev -w apps/bot",
    "dev": "npm run dev:board & npm run dev:bot",
    "build:board": "npm run build -w apps/board",
    "start:bot": "npm run start -w apps/bot",
    "lint": "npm run lint -w apps/board"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json pipeline/package.json
git commit -m "feat: set up npm workspaces for monorepo

Root package.json connects pipeline, apps/board, and apps/bot as
npm workspaces. Pipeline package renamed to just-ship-sdk
to avoid name collision with root."
```

---

### Task 9: Run npm install and verify workspace resolution

- [ ] **Step 1: Install all dependencies**

```bash
npm install
```

Expected: Creates root `package-lock.json` and `node_modules/` with hoisted dependencies. Each workspace's dependencies are resolved.

- [ ] **Step 2: Verify workspaces are recognized**

```bash
npm ls --workspaces --depth=0
```

Expected output should list three workspaces: `just-ship-sdk`, `just-ship-board`, `just-ship-bot`.

- [ ] **Step 3: Verify board builds**

The board needs environment variables at build time. Copy the example and fill in real values (or placeholder values if just testing the build):

```bash
cp apps/board/.env.example apps/board/.env.local
# Edit apps/board/.env.local with real or placeholder values
npm run build:board
```

Expected: Next.js production build succeeds.

- [ ] **Step 4: Commit lockfile**

```bash
git add package-lock.json
git commit -m "chore: add package-lock.json from npm workspaces install"
```

**Note:** `node_modules/` is already in `.gitignore`.

---

## Chunk 3: Deployment Configuration

### Task 10: Reconfigure Vercel for monorepo

This is a manual step in the Vercel dashboard. No code changes needed.

- [ ] **Step 1: Update Vercel project settings**

Go to Vercel Dashboard → just-ship-board project → Settings → General:

- **Root Directory:** *(leave empty / repo root)*
- **Build Command:** `npm run build -w apps/board`
- **Output Directory:** `apps/board/.next`
- **Install Command:** `npm install`

- [ ] **Step 2: Trigger a deployment and verify**

Push a commit or trigger a manual deployment. Verify:
- Build succeeds
- `board.just-ship.io` loads correctly
- Preview deploys work on branches

---

### Task 11: Update VPS systemd services

This is a manual step on the VPS server.

- [ ] **Step 1: SSH into VPS and pull the monorepo**

```bash
ssh claude-dev@<vps-ip>
cd /home/claude-dev/just-ship
git pull origin main
```

- [ ] **Step 2: Install monorepo dependencies**

```bash
npm install
```

- [ ] **Step 3: Install the new bot service**

```bash
sudo cp vps/just-ship-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
```

- [ ] **Step 4: Stop old bot service (if running from separate repo)**

```bash
sudo systemctl stop telegram-bot.service 2>/dev/null || true
sudo systemctl disable telegram-bot.service 2>/dev/null || true
```

- [ ] **Step 5: Start bot from monorepo**

```bash
sudo systemctl enable --now just-ship-bot.service
```

- [ ] **Step 6: Verify bot responds**

Send a message to the Telegram bot and verify it responds correctly.

- [ ] **Step 7: Clean up old bot repo clone (after verification)**

```bash
rm -rf /home/claude-dev/just-ship-bot
```

---

### Task 12: Clean up git remotes

Remove the temporary remotes added for subtree operations.

- [ ] **Step 1: Remove board and bot remotes**

```bash
git remote remove board
git remote remove bot
```

- [ ] **Step 2: Commit is not needed — remotes are local config**

---

## Chunk 4: Verification & Archive

### Task 13: End-to-end verification

- [ ] **Step 1: Verify local dev experience**

```bash
npm run dev:board
# Open http://localhost:3000 — board should load
```

```bash
npm run dev:bot
# Bot should start without errors (requires .env)
```

- [ ] **Step 2: Verify setup.sh still works for target projects**

```bash
# From a target project directory (e.g., Aime):
/path/to/just-ship/setup.sh --update --dry-run
```

Expected: Dry run shows only framework files (agents, commands, skills, pipeline). No board or bot files.

- [ ] **Step 3: Verify Vercel deployment**

Check `board.just-ship.io` is serving the board correctly.

- [ ] **Step 4: Verify VPS services**

```bash
sudo systemctl status just-ship-bot.service
sudo systemctl status just-ship@*.service
```

Both should be active and running.

---

### Task 14: Archive old repos

**Only after production has been verified stable for at least one week.**

- [ ] **Step 1: Archive just-ship-board on GitHub**

```bash
gh repo edit yves-s/just-ship-board --description "ARCHIVED — Moved to just-ship monorepo (apps/board/)" --visibility public
gh repo archive yves-s/just-ship-board --yes
```

- [ ] **Step 2: Archive just-ship-bot on GitHub**

```bash
gh repo edit yves-s/just-ship-bot --description "ARCHIVED — Moved to just-ship monorepo (apps/bot/)" --visibility public
gh repo archive yves-s/just-ship-bot --yes
```

---

## Task Dependency Overview

```
Task 1 (remove telegram-bot/)
  ↓
Task 2 (subtree add board)  →  Task 3 (subtree add bot)
  ↓                              ↓
Task 4 (clean board)          Task 5 (clean bot)
  ↓                              ↓
Task 6 (board .env.example)      │
  ↓                              │
  └──────────┬───────────────────┘
             ↓
Task 7 (reconcile .gitignore)
  ↓
Task 8 (root package.json + rename pipeline)
  ↓
Task 9 (npm install + verify)
  ↓
Task 10 (Vercel) ←→ Task 11 (VPS)  [parallel, manual]
  ↓
Task 12 (clean remotes)
  ↓
Task 13 (end-to-end verification)
  ↓
Task 14 (archive old repos — 1 week later)
```
