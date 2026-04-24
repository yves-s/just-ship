---
template: ship-complete
purpose: Final user-facing block after `/ship` has merged the PR and cleaned up. The last thing the CEO sees before the flow closes.
fires_at: End of `/ship` flow, after the PR merged, the branch deleted, the worktree cleaned up, and the board set to `done`. Rendered by step 7 of `skills/ship/SKILL.md` (the block labeled "EINZIGE Ausgabe an den User").
---

# Template — ship-complete

## Variables

| Name | Type | Example | Notes |
|---|---|---|---|
| `{ticket_number}` | int | `351` | Always rendered as `T-{ticket_number}` |
| `{commit_subject}` | string | `feat(T-351): add saved searches` | The first line of the merge commit — the "what shipped" |
| `{pr_url}` | string | `https://github.com/…/pull/257` | The PR that was merged |
| `{branch}` | string | `feature/351-saved-searches` | The branch that was deleted |
| `{worktree_status}` | string | `cleaned up` or `none` | `cleaned up` if a worktree existed, `none` if not |
| `{board_status}` | string | `done` or `—` | `done` when the board was updated, `—` when pipeline is not configured |
| `{stale_branches_block}` | string (multi-line) | (see body) | Optional — cleanup hint for other branches. The full block (header line + indented branch lines), pre-formatted by the caller. Empty string elides the block entirely. |

## Template body

```
✓ Shipped: {commit_subject}

PR        {pr_url}
Branch    {branch} → deleted
Worktree  .worktrees/T-{ticket_number} → {worktree_status}
Board     {board_status}
{stale_branches_block}
```

## Optional-row rules

- `Worktree` — always render the line; value is either `cleaned up` or `none`.
- `Board` — always render the line; value is either `done` or `—` (pipeline not configured).
- `{stale_branches_block}` — elide entirely if no stale branches. Otherwise, render the block below.

`{stale_branches_block}` format (rendered only if non-empty):

```

Hinweis — folgende Branches könnten aufgeräumt werden:
  feature/old-foo — Remote gelöscht
  feature/old-bar — 73 Commits hinter main
```

Each line inside the block: two-space indent, `{branch-name} — {reason}`.

## Voice checks

- Rule 1 (Result-first): the first line is the shipped commit subject, leading with `✓ Shipped:`. No narration of the merge process.
- Rule 2 (Tables): the four rows (PR / Branch / Worktree / Board) render as an aligned two-column block.
- Rule 3 (Icons): only `✓`. No celebratory emoji.
- Rule 4 (Short active): every row is a single fragment — subject, verb-or-arrow, result.
- Rule 5 (No inner monologue): no "I have now merged" / "Great, shipping this" — just the facts.

## Example — fully rendered (with stale-branch hint)

```
✓ Shipped: feat(T-351): add saved searches

PR        https://github.com/yves-s/just-ship/pull/257
Branch    feature/351-saved-searches → deleted
Worktree  .worktrees/T-351 → cleaned up
Board     done

Hinweis — folgende Branches könnten aufgeräumt werden:
  feature/283-old-intake — Remote gelöscht
  feature/244-nav-refactor — 73 Commits hinter main
```

## Example — minimal (no stale branches, no pipeline)

```
✓ Shipped: chore(T-401): bump dependencies

PR        https://github.com/yves-s/just-ship/pull/258
Branch    chore/401-bump-deps → deleted
Worktree  .worktrees/T-401 → none
Board     —
```
