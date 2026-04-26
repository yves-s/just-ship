---
template: epic-created
purpose: Sidekick reply after the reasoning-first orchestrator called `create_epic` — an epic plus its children were persisted to the board in one flow. The header confirms the epic, the table lists the children.
fires_at: End of a Sidekick chat turn when the orchestrator picked the `create_epic` tool. The Engine renders this template as the user-facing reply; terminal and browser widget surface it identically. See `pipeline/lib/sidekick-reasoning-tools.ts` for the tool definition and `.claude/rules/sidekick-terminal-routing.md` for terminal mechanics.
---

# Template — epic-created

## Variables

| Name | Type | Example | Notes |
|---|---|---|---|
| `{epic_number}` | int | `997` | Epic ticket number, rendered as `T-{epic_number}` |
| `{epic_title}` | string | `Reporter-Skill + Pipeline Output Voice` | Epic title |
| `{epic_url}` | string | `https://board.just-ship.app/t/997` | Board URL for the epic |
| `{child_rows}` | string (multi-line) | (see body) | One line per child ticket, pre-formatted by the caller |

## Template body

```
Ist im Board als Epic T-{epic_number} — {epic_title}. {epic_url}

Children
────────
{child_rows}
```

`{child_rows}` format (one line per child, pre-formatted by the caller):

```
T-998   Reporter-Skill + 5 Core-Templates
T-999   /develop an Reporter binden
T-1000  /ship an Reporter binden
T-1001  Sidekick-Reply via Reporter
T-1002  Per-Role Output-Sigs
```

**Formatting rules for `{child_rows}`:**

- Left-aligned ticket id padded to the width of the longest id in the block, then a two-space gap, then the title.
- Title is single-line; truncate at 60 chars with `…` if longer.
- Order matches creation order (which matches dependency order when the caller sets one).
- No URLs in the child rows — the children are addressable by number on the board; adding URLs blows up line width and breaks the table alignment.

## Voice checks

- Rule 1 (Result-first): header is the outcome, not narration.
- Rule 2 (Tables): children render as a two-column aligned block — always a table, never prose, because `create_epic` by definition produces ≥ 2 children and almost always ≥ 3.
- Rule 3 (Icons): none in the header. The children are pending work, not statuses — no icons needed.
- Rule 4 (Short active): header is one sentence, period-terminated.
- Rule 5 (No inner monologue): no "I've split this into…" — the split is evident from the table.
- Anti-pattern guard: the Sidekick routing rule explicitly forbids *"Soll ich das so anlegen?"* before `create_epic`. This template confirms artifacts that **already exist**.

## Example — fully rendered

```
Ist im Board als Epic T-997 — Reporter-Skill + Pipeline Output Voice. https://board.just-ship.app/t/997

Children
────────
T-998   Reporter-Skill + 5 Core-Templates
T-999   /develop an Reporter binden
T-1000  /ship an Reporter binden
T-1001  Sidekick-Reply via Reporter
T-1002  Per-Role Output-Sigs
```

## Example — two children (still uses the table form)

Even two children render as a table: the format is consistent and `Children` as a label would read strange inline.

```
Ist im Board als Epic T-880 — Notifications System MVP. https://board.just-ship.app/t/880

Children
────────
T-881  Bell + unread count
T-882  Inbox view with mark-as-read
```

## Anti-patterns

| Wrong | Right |
|---|---|
| `Okay, I've created the epic and its 5 children. Here's what's inside: …` | Use the template header + table verbatim |
| Inlining the children as prose (`T-998 for the skill, T-999 for develop wiring, T-1000…`) | Table, always |
| Sorting children alphabetically instead of by creation/dependency order | Creation order preserves the plan; alphabetical order loses it |
