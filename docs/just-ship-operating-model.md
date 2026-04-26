# Just Ship — Operating Model

**Status:** Foundation document — referenced by all framework-level tickets.
**Date:** 2026-04-24
**Supersedes:** Informal architecture descriptions scattered across CLAUDE.md, PRODUCT.md, and plan documents.
**Related:** `docs/superpowers/plans/2026-04-23-sidekick-reasoning-architecture.md`, Epic T-978.

---

## Purpose of this document

Just Ship has grown in layers — Pipeline, Sidekick, Board, Skills, Agents, Rules, Commands. Each layer was built to solve a concrete need, and each works. But there is no single place that says *what Just Ship actually is, how its parts relate, and which principles decide trade-offs*.

This is that place. Every framework-level ticket — CLAUDE.md changes, skill reorganizations, new commands, hook additions — must be checked against this document. If a proposed intervention conflicts with the Operating Model, the intervention is wrong or the Operating Model must change first. Not both.

The document is intentionally short. It is the constitution, not the law.

---

## What Just Ship is

Just Ship is a multi-agent framework for autonomous software development with Claude Code. The user is the CEO. The installed framework is the engineering team.

A single ticket triggers a full flow: intake → planning → implementation → testing → PR. The user decides *what* gets built and *whether* it ships. The team decides *how* it gets built.

Just Ship runs in two places: the user's terminal (interactive) and a VPS engine (autonomous, explicitly triggered). Both places run the same logic — the difference is only where the user sits.

---

## Four building blocks

### 1. Reasoning

Every orchestrator in the system reasons about what is needed, rather than running classification rules. This includes the Sidekick (user-facing orchestrator), the interactive Session-Assistant that drives `/develop` and `/ship`, and the VPS pipeline orchestrator.

**Principle:** decision-making through reasoning, not classification scores.

Concretely:
- System prompts encode heuristics, not decision trees.
- Rules are for hard guardrails where the blast radius is irreversible (writing to main, merging, editing secrets). Everything else is reasoned about in context.
- When the system needs a new capability, the first question is *"can the orchestrator reason about this with the right heuristic?"* — not *"which rule file do we add?"*

This is the principle the Sidekick rebuild landed (docs/superpowers/plans/2026-04-23-sidekick-reasoning-architecture.md §3.4). It applies framework-wide.

### 2. Skills

Skills are knowledge modules that load on demand. When the orchestrator reasons *"I need UX expertise to decide this"*, it invokes the `Skill` tool with `ux-planning`. The skill content enters the orchestrator's context. The orchestrator now reasons with that expertise active.

Skills are not decision trees. They do not prescribe procedural steps. They are senior experts that the orchestrator consults.

**Structure (per Anthropic guidance):**
- `skills/<name>/SKILL.md` ≤ 500 lines, with YAML frontmatter (`name`, `description` as "what + when").
- Bundled files alongside SKILL.md for deep references (the skill links to them one level deep).
- Skill metadata (~100 tokens per skill) is always loaded so the orchestrator knows which skills exist; the body loads only when triggered.

**Announcement of active expertise** (`⚡ Role joined`) is the natural artifact of a real Skill tool call — not a separate ceremony the orchestrator performs. If the Skill tool was not called, no announcement is produced. Visibility follows mechanism.

### 3. Agent-Mode

The Agent tool spawns specialist subagents with:
- **Own context window** — the parent session's context does not leak in.
- **Own tool allowlist** — a read-only audit agent cannot write. A backend agent can edit but cannot merge.
- **Model selection** — haiku for mechanical work, sonnet for creative work, opus for architectural decisions.
- **Skill assignment** — the subagent loads its domain skill as its first action in its own context.

The orchestrator reasons: *"does this work need an isolated specialist with its own tools, or can I do it in-context?"* — and spawns an agent when isolation, parallelism, or blast-radius containment is the right choice.

Agent definitions (`agents/*.md`) contain the specialist's role, methodology, output format, and tool whitelist. They do not contain orchestrator-level decision logic.

### 4. Sidekick

The Sidekick is the user-facing orchestrator. Every user interaction that proposes new work — an idea, a feature request, a bug report, a copy tweak, a new project pitch — flows through the Sidekick.

The Sidekick runs with **max effort, always reasoning, best decision**. This is not a performance setting — it is the core invariant. The Sidekick never takes shortcuts, never classifies in a reduced mode, never ships a second-best choice because it is faster.

**Tools** (from the reasoning architecture plan §3.1):

| Tool | Purpose |
|---|---|
| `create_ticket` | Single concrete change to something that exists |
| `create_epic` | Multiple related changes under one feature name |
| `create_project` | New product, new audience — the one tool that requires confirmation |
| `start_conversation_thread` | Direction unclear, needs multi-turn dialog |
| `run_expert_audit` | User wants analysis or a review — read-only specialist |
| `consult_expert` | User has a knowledge or diagnosis question for a role |
| `start_sparring` | Strategic discussion with specified expert peers |
| `start_development` | Trigger the autonomous flow for an existing ticket (replaces the old polling path) |

**Environment parity:** the Sidekick runs identically in the terminal (Claude Code session) and in the browser widget (board UI → `/api/sidekick/chat`). Same system prompt, same tools, same reasoning logic. The transport differs; the behavior does not.

---

## Supporting primitives

These are not building blocks of the reasoning system — they are the physical substrate the system runs on.

- **Board** — the single source of truth for tickets, epics, projects, and thread state. The Sidekick writes to it; the pipeline reads from it. The user views and steers through it.
- **Threads** — persistent conversations with a status machine (`draft → waiting_for_input → ready_to_plan → planned → approved → delivered`). The place where discussions live that have not (yet) converged into a ticket.
- **Worktrees** — isolation mechanism. Each ticket works in its own git worktree, so parallel tickets do not collide. The pipeline and the interactive `/develop` both use worktrees identically.

---

## Two execution paths

Just Ship offers two ways for a ticket to be turned into code. Both run the same orchestrator, the same agents, the same skills. The difference is the trigger and the user's position relative to it.

### Path 1 — Interactive (primary)

The user types `/develop T-N` in the terminal. Claude Code is the orchestrator. The user can interrupt, redirect, and feedback at any moment. This is the default mode — the CEO sitting with their team, directing and reviewing in real time.

### Path 2 — Autonomous (explicit play-trigger)

The user clicks Play on a ticket in the Board. The Board calls an Engine endpoint. The Engine spawns the same orchestrator flow on the VPS, without a terminal session. The user watches progress on the Board (events, status updates, PR link) rather than in a terminal stream.

**No polling.** The Engine does nothing unbidden. Every autonomous run is the result of an explicit user action on the Board. The previously existing `pipeline/worker.ts` polling loop is replaced by a push-trigger endpoint.

This removes ambiguity about what the system does when the user is away: nothing, until told. It also removes the class of bugs caused by workers silently picking up tickets in unexpected states.

---

## The Sidekick as orchestration hub

The Sidekick is not only the intake layer. It is the single orchestrator that sits between the user and the rest of the system. Concretely:

- User in the terminal says *"build X"* → Sidekick reasons, decides it is a ticket → calls `create_ticket` → optionally calls `start_development` to push it through.
- User clicks Play on a board ticket → board triggers the Engine → the orchestrator runs the flow.
- User in the terminal says *"Design Lead, audit mobile"* → Sidekick reasons, decides it is an audit → calls `run_expert_audit(expert=design-lead)`.

The paths converge: the Sidekick is the single place where user intent is read and routed. Commands like `/develop` and `/ship` are direct entrypoints the user can still invoke, but they are the same underlying flow the Sidekick invokes through its tools.

---

## Architecture of loaded context

This section makes the three-tier loading model concrete, because getting it wrong is what caused the drift we saw during the April 2026 Sidekick wave.

| Tier | What lives here | When loaded | Size ceiling |
|---|---|---|---|
| **Constitution** — `CLAUDE.md` | Identity, decision authority, universal boundaries, rule imports | Always, every session | ≤ 200 lines |
| **Rules** — `.claude/rules/*.md` | Hard guardrails, single-responsibility, imported into CLAUDE.md via `@` | Always, but modular | Each file small |
| **Skills** — `skills/<name>/SKILL.md` | Domain expertise, reasoning aids, how-to knowledge | On demand, via Skill tool or description-trigger | ≤ 500 lines body |
| **Agents** — `agents/*.md` | Specialist system prompts, loaded by the Agent tool | When a subagent is spawned | Role-specific |
| **Hooks** — `.claude/settings.json` | Deterministic must-fire automation | Automatic, not by Claude | — |

**The principle:** the always-loaded layer holds who-we-are and what-is-forbidden. The on-demand layer holds how-to-think-about-this-domain. Procedural depth, classification tables, domain workflows — all on-demand.

A CLAUDE.md that exceeds ~200 lines forces Claude to compete for attention across too many instructions. New rules get drowned out. The Sidekick-wave drift (skill announcements dropping from sessions in the week of 2026-04-22) is consistent with this mechanism.

---

## How to use this document

**Before every framework-level intervention, check:**

1. Does the intervention keep reasoning as the primary mechanism, or does it reintroduce classification?
2. Does it put knowledge in the right tier? (Constitution vs rule vs skill vs agent vs hook.)
3. Does it preserve the max-effort, always-reasoning Sidekick invariant?
4. Does it preserve the two-path model with no-polling?
5. Does it work identically in terminal and browser, or does it silently diverge them?

If any answer is no, the intervention is wrong or this document must change first. Not both.

---

## Shadow rollout for the reasoning-first chat (T-1020)

The reasoning-first Sidekick chat path (eight tools wired into the SDK as in-process MCP tools) ships behind the `SIDEKICK_REASONING_ENABLED` environment flag. The flag is **off by default in production** so existing deployments keep the legacy tool-less stream they have been running on. Engine repos and dev environments opt in by setting the flag to `1` / `true` / `yes` / `on`.

**Why shadow, not hard cutover.** The Browser-Widget classifier from the pre-1020 era used a separate code path; the new path may classify identical inputs differently because tool-use is a fundamentally different signal than a fixed classifier. A hard cutover would risk surprising regressions for live workspaces during a single deploy. Shadow mode keeps the old path live in production while the new path is exercised in the engine repo and any opted-in environments — every divergence becomes observable before the cutover.

**Cutover criteria.** The flag flips from default-off to default-on once **all** of:

1. The engine repo has run with the flag enabled for ≥ 7 consecutive days with no `expert_runtime_not_implemented` failure spikes in Sentry (`area: sidekick-chat` + `tool: …`).
2. At least one ticket per artifact tool (`create_ticket`, `create_epic`, `create_project`, `start_conversation_thread`, `update_thread_status`) has been driven from the chat path end-to-end and ended in the expected board state.
3. The CI grep guard (`pipeline/lib/sidekick-allowed-tools-guard.test.ts`) is green and no production callsite has been added that uses `allowedTools: []` without an explicit `// CI-AUDIT-EXEMPT:` annotation.
4. The shadow-mode prompt version (`SIDEKICK_PROMPT_VERSION`) has not been bumped in the cutover window (a bump resets the timer — too much can drift between observed and post-flip behaviour otherwise).

After cutover the legacy classifier modules (`sidekick-policy.ts`, `sidekick-converse.ts`, `sidekick-tools.ts`) become deletion candidates — that work lands in a follow-up ticket (out of scope for T-1020 per the ticket's "Out of Scope" list).

**Reversibility.** Flipping the flag back to off restores the legacy path in a single deploy; the chat code keeps both branches reachable through the cutover window. Once the legacy modules are deleted, the flag becomes vestigial and can be removed in the same PR.

---

## What this document does not do

- It does not prescribe which skills to create. That is product work.
- It does not define the Board UI. That is product work.
- It does not specify model choices per agent. That is engineering work inside the agent definitions.
- It does not replace PRODUCT.md, CLAUDE.md, or the reasoning-architecture plan. It names the principles they all implement.

---

## Follow-up tickets referenced

These are the tickets that implement the Operating Model where the current codebase diverges from it. Each ticket's scope is checked against this document.

1. **CLAUDE.md diet** — shrink from 422 lines to ≤ 200, move procedural content into skills, use `@`-imports for rules.
2. **Skill/Agent-loading fix** — couple `⚡ Role joined` announcement to the actual Skill tool call, stop performative announcements, make agents load their skills as their first action.
3. **Sidekick `start_development` tool** — eighth tool, so the Sidekick can trigger `/develop` from reasoning instead of requiring the user to type a slash-command.
4. **Polling → push-trigger** — replace `pipeline/worker.ts` polling with a Board-initiated `POST /api/pipeline/start` endpoint. Remove all polling infrastructure.

These tickets are independent; they share this document as their reference.
