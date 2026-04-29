---
name: ship
description: Alles abschliessen — pre-merge checks, push, PR, merge, cleanup. Vollständig autonom, NULL Rückfragen.
---

# /ship — ALLES abschliessen, ein Befehl

Trigger gegen `pipeline/run.ts ship`. Pre-merge build + tests + conflict-check, push, PR (falls fehlt), squash-merge, worktree-cleanup, Board-Update — alles in TypeScript. Trigger: `/ship`, `/ship T-{N}`, "ship it", "merge". Kurze Bestätigungswörter ("passt"/"done") nur unter `.claude/rules/ship-trigger-context.md`. Bei Konflikten oder fehlgeschlagenem Build: Exit 1 mit Grund — kein automatischer Merge.

## Ausführung

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
TICKET_NUMBER=$(echo "$ARGUMENTS" | grep -oE '[0-9]+' | head -1)
if [ -z "$TICKET_NUMBER" ]; then
  TICKET_NUMBER=$(git -C "$REPO_ROOT" branch --show-current | grep -oE 'T-[0-9]+' | head -1 | sed 's/T-//')
fi
if [ -z "$TICKET_NUMBER" ]; then
  echo "ERROR: /ship needs a ticket number — pass /ship T-N or run on a feature/T-N-* branch." >&2
  exit 1
fi

WORKTREE_DIR="$REPO_ROOT/.worktrees/T-$TICKET_NUMBER"
[ -d "$WORKTREE_DIR" ] || WORKTREE_DIR="$REPO_ROOT"

# Use install-path .pipeline/run.sh — works in engine + consumer repos, no bun required.
cd "$WORKTREE_DIR" && bash "$REPO_ROOT/.pipeline/run.sh" ship \
  --ticket="$TICKET_NUMBER" --mode=local --worktree="$WORKTREE_DIR"
```
