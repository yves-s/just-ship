---
template: ticket-created
purpose: Sidekick reply after the reasoning-first orchestrator called `create_ticket` and the artifact was persisted to the board. One compact confirmation line, no prose before or after.
fires_at: End of a Sidekick chat turn when the orchestrator picked the `create_ticket` tool. The Engine renders this template as the user-facing reply; terminal and browser widget surface it identically. See `pipeline/lib/sidekick-reasoning-tools.ts` for the tool definition and `.claude/rules/sidekick-terminal-routing.md` for terminal mechanics.
---

# Template — ticket-created

## Variables

| Name | Type | Example | Notes |
|---|---|---|---|
| `{ticket_number}` | int | `862` | Always rendered as `T-{ticket_number}` |
| `{title}` | string | `Detail-Panel Button-Sizing` | The ticket title, single line |
| `{url}` | string | `https://board.just-ship.app/t/862` | Board URL for the ticket |
| `{priority}` | string | `high`, `medium`, `low`, or empty | Optional — only rendered if not `medium` |
| `{priority_icon}` | string | `↑` (high), `↓` (low), empty | Selected by the caller based on `{priority}` |

## Template body

```
Ist im Board: T-{ticket_number} — {title}. {url}{priority_suffix}
```

`{priority_suffix}` is constructed by the caller:

| `{priority}` | Suffix |
|---|---|
| `high` | ` ↑` |
| `low` | ` ↓` |
| `medium` or empty | empty string |

## Voice checks

- Rule 1 (Result-first): starts with the outcome (`Ist im Board:`), not with narration.
- Rule 3 (Icons): `↑` / `↓` only, and only when priority is non-default. No `🔥`, no `📌`.
- Rule 4 (Short active): one sentence, period-terminated. No leading filler like "Okay," or "Great —".
- Rule 5 (No inner monologue): no "I classified this as…" — the classification is implicit in the output format.
- Anti-pattern guard: the Sidekick routing rule explicitly forbids *"Soll ich das anlegen?"* before `create_ticket`. This template is the confirmation of a ticket that **already exists** — never a pre-creation prompt.

## Example — default priority

```
Ist im Board: T-862 — Detail-Panel Button-Sizing. https://board.just-ship.app/t/862
```

## Example — high priority

```
Ist im Board: T-891 — Critical: classifier drops attachments on retry. https://board.just-ship.app/t/891 ↑
```

## Example — low priority

```
Ist im Board: T-870 — Typo in empty-state copy. https://board.just-ship.app/t/870 ↓
```

## Anti-patterns

| Wrong | Right |
|---|---|
| `Okay, I've created ticket T-862 for you. You can find it here: …` | `Ist im Board: T-862 — Detail-Panel Button-Sizing. https://…` |
| `Ticket T-862 is now in the board. Let me know if you'd like anything else!` | (one line, no trailing offer) |
| Appending a next-action suggestion (`Run /develop T-862 next?`) | The Sidekick reply is terminal — the CEO steers what happens next |
