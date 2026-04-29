---
name: develop
description: Nächstes ready_to_develop Ticket holen und autonom implementieren
---

# /develop — Ticket implementieren

Trigger gegen `pipeline/run.ts`. Der gesamte Workflow (Triage-Subagent, Orchestrator-Subagent, Implementation, Build-Check, Code-Review, QA, Commit, Push, PR) lebt in TypeScript — single source of truth zwischen VPS und Lokal. Subagent-Spawns (`⚡ Triage joined`, `⚡ Orchestrator joined`, `⚡ Backend Dev joined`, …) erscheinen automatisch sobald die Skills injiziert sind.

## Ausführung

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
TICKET_NUMBER=$(echo "$ARGUMENTS" | grep -oE '[0-9]+' | head -1)
if [ -z "$TICKET_NUMBER" ]; then
  echo "ERROR: /develop requires a ticket number, e.g. /develop T-42" >&2
  exit 1
fi

WORKTREE_DIR="$REPO_ROOT/.worktrees/T-$TICKET_NUMBER"
if [ ! -d "$WORKTREE_DIR" ]; then
  git -C "$REPO_ROOT" fetch origin main 2>/dev/null || true
  git -C "$REPO_ROOT" worktree add "$WORKTREE_DIR" -b "feature/T-$TICKET_NUMBER" origin/main \
    || git -C "$REPO_ROOT" worktree add "$WORKTREE_DIR" "feature/T-$TICKET_NUMBER"
  ln -sf "$REPO_ROOT/.env.local" "$WORKTREE_DIR/.env.local" 2>/dev/null || true
fi

# Use install-path .pipeline/run.sh — works in engine + consumer repos, no bun required.
cd "$WORKTREE_DIR" && bash "$REPO_ROOT/.pipeline/run.sh" develop \
  --ticket="$TICKET_NUMBER" --mode=local --worktree="$WORKTREE_DIR"
```
