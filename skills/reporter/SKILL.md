---
applies_to: all-agents
name: reporter
description: Single source of truth for how the just-ship pipeline talks to the CEO. Defines the voice (Result-First, tables for lists of 3+, status icons, short active sentences, no inner monologue) and the five Core Templates (develop-complete, ship-complete, ticket-created, epic-created, phase-progress). Every user-facing output string produced by an agent, a skill, or a pipeline phase runs through this skill — never freeform prose. Triggers at the end of /develop, at the end of /ship, in Sidekick replies for ticket/epic creation, in /just-ship-status, and during phase-progress updates. Load whenever you are about to render a terminal block the CEO will read.
triggers:
  - report
  - output
  - summary
  - session-summary
  - phase-update
  - develop-complete
  - ship-complete
  - sidekick-reply
---

# Reporter

The Reporter is the pipeline's voice. Every string the CEO reads on their terminal passes through this skill — the voice rules define **how** we say it, the templates define **which shape** we say it in.

If the pipeline renders a one-off prose paragraph instead of using a template, it is off-voice. Off-voice output wastes the CEO's reading time and erodes trust: two different flows saying the same thing differently forces the CEO to re-learn the output on every run.

## When to use

Load the Reporter and render the matching template at exactly these five trigger points. Never at others — this is not a general "output helper".

| Trigger | Template | Rendered by |
|---|---|---|
| End of `/develop` — after QA, docs-check, PR creation, summary | `templates/develop-complete.md` | `commands/develop.md` step 11 via `.claude/scripts/develop-summary.sh` |
| End of `/ship` — after merge, branch delete, worktree cleanup | `templates/ship-complete.md` | `commands/ship.md` step 7 via `.claude/scripts/ship-summary.sh` |
| Sidekick `create_ticket` tool result (single ticket) | `templates/ticket-created.md` | Engine chat-stream surface (`pipeline/lib/sidekick-reasoning-tools.ts → create_ticket`) |
| Sidekick `create_epic` tool result (epic + children) | `templates/epic-created.md` | Engine chat-stream surface (`pipeline/lib/sidekick-reasoning-tools.ts → create_epic`) |
| Any phase transition during a long-running operation | `templates/phase-progress.md` | `/develop`, `/ship`, `/just-ship-audit`, any multi-phase flow |

`/just-ship-status` also uses this skill: it composes a status view out of `phase-progress.md` (for any active operation), plus the relevant completion template (`develop-complete.md` / `ship-complete.md`) if a PR is pending.

## Voice rules

The six rules below are non-negotiable. Every template respects them; every ad-hoc output is measured against them. The **Yes** column is the correct shape, the **No** column is the forbidden shape.

| Rule | Yes | No |
|---|---|---|
| **1. Result-first.** Lead with the outcome, never the narration. The CEO knows you did work — they don't need you to announce it. | `✓ Shipped: feat(T-351): add saved searches` | `I have now successfully merged the pull request for T-351, and the branch has been deleted.` |
| **2. Tables for lists of 3 or more.** Three items in prose reads as noise. A table reads as a structure. | <pre>Agent        Tokens<br/>─────────────<br/>planner      12.3k<br/>backend      41.2k<br/>qa           8.7k</pre> | `The planner used 12.3k tokens, the backend used 41.2k tokens, and QA used 8.7k tokens.` |
| **3. Status icons, not adjectives.** A leading glyph is scannable; an adjective is not. Allowed: `✓` (done), `▸` (running), `✗` (failed), `⚠` (warning), `▶` (phase start), `↻` (retrying). Nothing else. | `✓ qa — 12/12 passed` | `All 12 tests have passed successfully.` |
| **4. Short active sentences.** One clause, one verb, no subordinate framing. Target ≤ 12 words per sentence in narrative blocks. | `PR ready. Branch pushed. Waiting on review.` | `Once I had finished, I proceeded to push the branch and open the PR for review.` |
| **5. No inner monologue.** The CEO reads outcomes, not deliberation. Words like *"Let me…"*, *"I'll now…"*, *"I'm going to…"*, *"Next, I need to…"* are off-voice. If you must narrate a transition, use a phase line from `phase-progress.md`. | `▸ qa · running Playwright smoke tests` | `Let me now run the Playwright smoke tests to verify the pages load correctly.` |
| **6. Numbers are specific, not vague.** If you measured it, say the number. If you didn't measure it, don't hedge with an adjective. | `8 files changed · +412 / −87` | `Several files were changed with substantial additions.` |

### Reading the rules as a checklist

Before rendering, scan your output for:

- A leading sentence that states **what happened**, not what you did.
- Any list of 3+ items — convert to a table.
- Any adjective that could be a number.
- Any sentence starting with *I / Let me / I'll / I'm going to* — delete or rewrite as a phase line.
- Any status word ("done", "complete", "failed") without a leading icon — add the icon or drop the word.

If a template already applies, these checks are redundant — the template was designed against the same rules.

## Templates

The five files under `templates/` are renderable forms. Each defines:

- **Purpose** — the single situation it covers.
- **When it fires** — the exact pipeline event.
- **Variables** — the placeholder names used in the body.
- **Template body** — the fenced block that gets filled and printed verbatim.
- **Voice checks** — what to verify before rendering (usually a subset of the six rules that matter most for this shape).

Each template is a **contract**: the rendering code (in `pipeline/run.ts`, `.claude/scripts/session-summary.sh`, `skills/develop/SKILL.md`, etc.) passes exactly the named variables, and the template produces exactly the named block. If a variable is missing at render time, the template says so (`— n/a` or the whole row is elided); it never silently drops structure.

| Template | File |
|---|---|
| `develop-complete` | `templates/develop-complete.md` |
| `ship-complete` | `templates/ship-complete.md` |
| `ticket-created` | `templates/ticket-created.md` |
| `epic-created` | `templates/epic-created.md` |
| `phase-progress` | `templates/phase-progress.md` |

## Rendering contract

A template is rendered by substituting `{variable}` placeholders with string values. The substitution rules are narrow on purpose:

1. **Exact match.** `{ticket_number}` becomes the literal number, nothing else. `{title}` becomes the title, not `"title"` with quotes.
2. **Pass the type the template declares.** Each template's Variables table lists a type per placeholder. If the type is `int` or `float`, pass the raw number — the template owns units and pluralization (`{tests_passed}` is `12`, not `"12 tests"`). If the type is `string`, the caller pre-formats according to the notes column (e.g. `{total_tokens}` = `"243k"`, not `243819`). Mixing the two is the error mode this rule prevents.
3. **Null → elide the row.** If the caller passes `null` or an empty string for `{preview_url}`, the whole `Preview:` line is dropped from the output. Templates mark such optional rows with `(optional — elide if empty)`.
4. **No conditional prose inside the template.** If a branch is needed (e.g. QA passed vs. failed), the caller selects the correct template variant; the template itself is a single static shape.

## Anti-patterns

| Wrong | Right |
|---|---|
| Inline-rendering a completion block inside `pipeline/run.ts` so it "matches the look" | Call the template; any drift is a bug in the template, fixed in one place |
| Skipping the Reporter because "this one is just a quick status line" | That quick status line is exactly what `phase-progress.md` is for |
| Adding a new status icon (`✅`, `❌`, `🎉`) | Use the six allowed icons; if none fits, the output probably doesn't belong in a template |
| Rendering a table for two rows | Two rows is a list, three rows is a table. Below three, use bullets or a prose sentence |
| Letting an agent write a "summary paragraph" at the end of its turn | The agent emits structured data; the Reporter renders the user-facing block |

## Relationship to other skills

- **`commands/develop.md`** calls `develop-complete` at step 11 via `.claude/scripts/develop-summary.sh`. The script and the template evolve together; `pipeline/run.ts` writes `.claude/.reporter-team-roster.json` in its Pre-Develop step so the renderer can fill the Team block without inventing rows.
- **`commands/ship.md`** calls `ship-complete` at step 7 via `.claude/scripts/ship-summary.sh` (the "EINZIGE Ausgabe an den User" block). Pre-Merge (build / tests / conflict-check), Merge (commit / push / merge), and Post-Merge phases also render `phase-progress` lines.
- **`pipeline/lib/sidekick-reasoning-tools.ts`** is the canonical caller of `ticket-created` (after `create_ticket`) and `epic-created` (after `create_epic`); the terminal mechanics that surface those template renders live in `.claude/rules/sidekick-terminal-routing.md`.
- **`skills/just-ship-status/SKILL.md`** composes status screens out of `phase-progress` and the relevant completion template.

When any of the above are edited, also check that the variables they pass match the template's declared set.
