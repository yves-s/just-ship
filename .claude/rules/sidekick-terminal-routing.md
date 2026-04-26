---
applies_to: top-level-only
---

When the user types into the Claude Code terminal and the input looks like a Sidekick intent (idea, feature wish, bug report, audit/review request, expert question, project pitch), Claude Code IS the Sidekick. There is no `/sidekick` command, no classification call, no four-category branch. The terminal opens a single chat stream against the Engine's reasoning-first Sidekick — the same endpoint the browser widget uses — and lets the orchestrator LLM reason about which of its eight tools (`create_ticket`, `create_epic`, `create_project`, `start_conversation_thread`, `update_thread_status`, `run_expert_audit`, `consult_expert`, `start_sparring`) to call.

The role-address heuristic ("Design Lead, …", "CTO, …", "Backend, …") is part of the system prompt that ships with the Engine, not a hard-rule pattern-match in this file. The Sidekick uses the verb to disambiguate: a build/change verb routes to `create_ticket` or `create_epic`; an analysis verb ("schau dir an", "audit", "review", "ist das konsistent") routes to `run_expert_audit`; a knowledge or diagnosis verb ("wie denkst du", "warum passiert", "best practice") routes to `consult_expert`. The terminal does not pre-classify and does not block any of those routes.

This rule documents the terminal-side mechanics: when to open a chat stream, how to handle threads, what the on-`main` guardrail does, and which Anti-Patterns still apply. The Engine — via `pipeline/lib/sidekick-system-prompt.ts` and `pipeline/lib/sidekick-reasoning-tools.ts` — owns the actual reasoning and tool selection. When this rule and the system prompt disagree, the system prompt wins.

## When this flow triggers

Any user input that looks like a Sidekick intent. The shape of the input matters less than it used to — there is no signal-checklist to satisfy. The orchestrator LLM reads the input and decides. A non-exhaustive list of inputs that should trigger a chat stream:

- **Idea (raw form):** "ich habe eine Idee", "was wäre wenn", "mir schwebt X vor"
- **Build intent:** "ich will X bauen", "lass uns X entwickeln", "baut mal X"
- **Feature wish:** "Füg X hinzu", "X fehlt noch", "ändere Y sodass …"
- **Bug report / copy tweak:** "X funktioniert nicht", "der Text auf Y sollte Z sein"
- **New product / new audience:** "ich will Y für Z bauen", "neues Projekt: …"
- **Audit / review (with or without role-address):** "Design Lead, schau dir die Mobile Experience an", "ist die Onboarding-Copy konsistent?", "review the API surface"
- **Expert question (with or without role-address):** "CTO, wie denkst du über X", "Backend, warum passiert Y immer wieder", "Design Lead, was ist best practice für Z"

What is **not** a Sidekick intent and never reaches the chat stream:

- Explicit slash commands: `/ticket`, `/develop`, `/ship`, `/recover`. They have their own flows.
- Status questions: "wie steht's", "was läuft gerade".
- Pure knowledge questions about *the codebase itself*: "wie funktioniert X im Code". Those are answered directly via Read/Grep/etc.

## The on-`main` guardrail (load-bearing)

The terminal still enforces that work happens on a feature branch. `branch-check-before-edit.md` is the source of truth — that rule decides whether the first `Edit` or `Write` of a session is allowed. This rule does **not** override it:

- If the user types something that looks like a Sidekick intent and the branch is `main` with the pipeline configured, the terminal does not start writing files. It opens the chat stream. The Sidekick reasons; if the chosen tool is `create_ticket` or `create_epic`, an artifact is created and the user is told where it landed. The actual implementation happens later in a worktree via `/develop`.
- If the user explicitly authorises direct work on `main` (the exception clause in `branch-check-before-edit.md`), the terminal honours that.
- The "Sidekick-Intake-Skill laden" step from the previous version of this rule is gone. There is no intake skill anymore; the chat stream replaces it.

## Flow

1. **Detect intent.** If the input matches a Sidekick-shape (see above), open a chat stream — do not reason locally about which "category" it falls into.
2. **Resolve thread context.** If the user references a prior conversation ("der Thread von gestern zu Notifications", "weiter mit dem Analytics-Dashboard"), call `sidekick-api.sh thread-list` first, match by title, persist the thread ID in `.claude/.sidekick-thread`. The terminal does the matching itself; **never ask the user which thread**.
3. **Stream the turn.** Call `sidekick-api.sh chat --project-id <uuid> [--thread-id <uuid>] --text "<input>"`. The SSE stream renders live: text deltas to stdout, status frames (`[tool_call …]`, `[tool_result …]`, `[thread_id=…]`) to stderr.
4. **Surface tool results.** When the Engine calls a tool, the terminal already shows the `[tool_call …]` frame from the SSE stream. After the final `message` frame, render the human-readable artifact link or audit summary in the Sidekick voice — one line, no PM ceremony, no "Soll ich das anlegen?".
5. **Handle thread state.** If the chosen tool changed thread status, fetch `sidekick-api.sh thread-get <id>` and report the transition in a single line: `Thread {title} ist jetzt {status}.` No raw JSON, no tables.

## Image attachments

Detect local image paths in the user input — `\b(?:/|\./|\.\./)[^ ]+\.(?:png|jpe?g|webp|gif)\b` or explicitly dropped paths. Before the chat call, `sidekick-api.sh attach <path> [<path>…]` uploads them and returns `files[*].url`. Pass each URL as `--attach <url>` to the chat command. The image lands as `attachments[]` in the chat request — never as a Markdown link in the text.

## Project context

Pass `--project-id` from `project.json → pipeline.project_id`. If the project is not yet on the board (no `pipeline.project_id`), the chat stream still works — the Engine falls back to a workspace-scoped flow where `create_project` is the natural first tool call.

## Fallback without Engine config

If neither `ENGINE_API_URL` nor `BOARD_API_URL` resolves (`sidekick-api.sh` exits 1), the terminal falls back to `skills/sparring.md` for an offline-style sparring conversation. This is the emergency path for projects without an Engine deployment; it cannot create artifacts.

## Output rules

- **No "Soll ich das anlegen?".** The Sidekick decides; the user steers product direction, not creation timing. The single exception is `create_project` — the system prompt forces a confirmation prompt before that tool fires, because a new project is structurally bigger than a ticket. Anything else is created silently and reported via the artifact link.
- **No PM jargon.** No "acceptance criteria", "user story", "Definition of Done" in user-facing output. The artifact body may contain those headings — the chat reply does not.
- **One line per artifact.** `Ist im Board: T-{N} — {title}. {url}` for tickets, `Ist im Board als Epic T-{N} — {title}. {url}` plus child bullet list for epics.
- **No raw JSON to the user.** Reduce thread/list responses to a single line.

## Anti-Patterns

❌ **Pre-classify locally.** The terminal does not run a four-category classifier before calling the chat stream. The classifier was killed in T-979; do not resurrect it as a local pattern-match.

❌ **Pattern-match the role-address.** Do not maintain a list of role prefixes ("Design Lead, …", "CTO, …") in this rule and use it to force a route. The Sidekick reads the verb in the input and reasons about the right tool. A "Design Lead, schau dir X an" produces an audit; a "Design Lead, bau mal X" produces a ticket — both via the same chat stream, no local routing.

❌ **Ask the user which thread to continue.** When a continuation cue appears, the terminal lists threads and matches by title itself. Asking is an autonomy violation.

❌ **Parallel chat turns in the same thread.** The Engine returns `409 thread_busy`. On 409, surface a single line and let the user decide — no retry loop.

❌ **"Soll ich das anlegen?" before `create_ticket` / `create_epic`.** Forbidden. The only confirmation prompt is for `create_project`, and the system prompt enforces it.

❌ **Inline image paths as Markdown.** The Engine expects `attachments: [{ url }]`. Inlining as Markdown breaks dedup and storage-URL rotation.

✅ **Parity with the browser widget.** Same input, same Engine endpoint, same tool call, same artifact. The only difference is the transport: terminal calls `sidekick-api.sh`, widget calls the same SSE endpoint over HTTP.

## Source of truth

The reasoning, the tool roster, and the role-address heuristics live in:

- `pipeline/lib/sidekick-system-prompt.ts` — system prompt with few-shot examples and `SIDEKICK_PROMPT_VERSION` (Sentry-tagged).
- `pipeline/lib/sidekick-reasoning-tools.ts` — the eight tool definitions with Zod schemas.
- `pipeline/lib/audit-runtime.ts` — the read-only specialist runtime that backs `run_expert_audit`.
- `skills/sidekick-converse/SKILL.md` — the converse mode used inside `start_conversation_thread`.

When this rule and any of those disagree, those win. This rule wires terminal mechanics into the Engine; it does not duplicate the reasoning.

## Plan reference

See `docs/superpowers/plans/2026-04-23-sidekick-reasoning-architecture.md` — section 5 child 5 is the rewrite of this rule. The role-address pattern-match and the four-category classifier in the previous version of this file are explicitly retired by that plan.
