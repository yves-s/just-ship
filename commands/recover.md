---
name: recover
description: Stuck-Ticket recovern — Resume bei vorhandenem Code, Restart bei leerem Worktree
---

# /recover — Stuck-Ticket recovern

Trigger gegen `pipeline/run.ts recover`. Erkennt automatisch Resume vs. Restart, räumt Worktree und Board auf, setzt das Ticket bei Restart auf `ready_to_develop` zurück. Keine Rückfragen.

## Ausführung

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
TICKET_NUMBER=$(echo "$ARGUMENTS" | grep -oE '[0-9]+' | head -1)
if [ -z "$TICKET_NUMBER" ]; then
  TICKET_NUMBER=$(cat "$REPO_ROOT/.claude/.active-ticket" 2>/dev/null || true)
fi
if [ -z "$TICKET_NUMBER" ]; then
  echo "ERROR: /recover needs a ticket number — /recover T-N or set .claude/.active-ticket." >&2
  exit 1
fi

WORKTREE_DIR="$REPO_ROOT/.worktrees/T-$TICKET_NUMBER"
cd "$REPO_ROOT" && bun run "$REPO_ROOT/pipeline/run.ts" recover \
  --ticket="$TICKET_NUMBER" --mode=local --worktree="$WORKTREE_DIR"
```

Resume → re-runs `/develop` im existierenden Worktree. Restart → räumt Worktree+Branch auf, setzt das Ticket auf `ready_to_develop`, der User triggert dann `/develop T-{N}` neu.
