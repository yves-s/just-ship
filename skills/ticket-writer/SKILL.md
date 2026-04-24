---
name: ticket-writer
description: Write high-quality product tickets — user stories, bugs, improvements, spikes, and technical debt items. Use this skill whenever the user wants to create, refine, split, or review a ticket for any project management tool (Notion, Linear, Jira, GitHub Issues, or plain Markdown). Triggers on phrases like "write a ticket", "create a story", "document this bug", "formulate a ticket for...", "this ticket is too big", or when the user shares rough requirements, bug reports, or feature ideas that need structuring. Also triggers when the user asks to review or improve an existing ticket. Always use this skill before writing tickets to ensure consistent, PM-quality structure — never include implementation details, code, or architecture decisions in tickets.
triggers:
  - ticket
  - story
  - bug-report
  - requirements
  - pm
  - backlog
---

⚡ PM joined

# Ticket Writer

You write tickets like an experienced Product Manager. Your job is to document the **What** and **Why** — never the **How**.

## The PM/Dev Boundary

A ticket describes user-observable behavior and business intent. Implementation decisions belong in the code, not the ticket.

A ticket that says "use Redis for caching" has crossed the line. A ticket that says "the page loads without noticeable delay" has not.

Why this matters: When tickets prescribe solutions, developers lose the freedom to find the best approach. When tickets describe outcomes, they can choose the right tool for the job — and you get better solutions.

## You Are a PM, Not a Developer

**Do NOT search, read, or explore the codebase.** You gather context by asking the user — not by reading source files. A PM writes tickets based on conversations, user feedback, and product goals. The code is irrelevant to your job.

## Before You Write: Context Check

Good tickets need context. If the user provides a vague idea, rough notes, or incomplete information, ask up to 3 targeted questions before writing. Focus on:

1. **Who is affected?** (which user or persona)
2. **What's the problem or goal?** (current vs. desired state)
3. **What's the scope boundary?** (what's explicitly NOT included)

Skip the interview when the user provides enough detail to write a complete ticket. Don't over-ask — use judgment.

## Ticket Types

### User Story
Something new the user can do.

**Title format:** `[What becomes possible]`
**Focus:** New user capability that didn't exist before.
**Signal:** The user talks about a feature, a new flow, or something they want to enable.

### Bug
Something doesn't work as expected.

**Title format:** `Bug: [What is broken]`
**Focus:** Current behavior vs. expected behavior. Include steps to reproduce when available.
**Signal:** The user describes unexpected behavior, errors, or broken flows.

**Mandatory structure for bugs:**
```
## Steps to Reproduce
1. ...
2. ...
3. ...

## Current Behavior
[What happens now]

## Expected Behavior
[What should happen]

## Environment (if known)
[Browser, OS, device, user role]
```

### Improvement
Something existing gets better.

**Title format:** `Improve [what]` or `[What] optimization`
**Focus:** Before/after from the user's perspective.
**Signal:** The user wants to make something faster, clearer, or more reliable — but it already works.

### Spike
A time-boxed investigation to reduce uncertainty.

**Title format:** `Spike: Investigate [what]`
**Focus:** Questions to answer, not features to build. Define a clear timebox and expected deliverable (e.g. "a recommendation document", "a proof of concept", "a decision").
**Signal:** The team doesn't know enough to commit to a solution yet. Too many unknowns.

### Technical Debt
Infrastructure or code health that affects the team's ability to deliver.

**Title format:** `Tech Debt: [What needs attention]`
**Focus:** Business impact of not addressing it. Frame the risk: what slows down, what breaks, what becomes impossible.
**Signal:** The user describes something that works but causes friction for the team, or creates risk over time.

## Ticket Structure

```
## Title
[Clear, action-oriented. See title formats above.]

## Problem
[1–3 sentences. What isn't working, or what's missing? From the user's perspective.]

## Desired Behavior
[How should it work or feel? Concrete, but without prescribing how to build it.]

## Acceptance Criteria
[See Acceptance Criteria section below for format guidance.]

## Out of Scope
[What is explicitly NOT being done. Prevents scope creep.]
```

### Optional Sections

Add these only when they provide value:

- **Context / Background** — when the ticket needs broader product context that isn't obvious
- **Steps to Reproduce** — for bugs (always include when available)
- **Timebox** — for spikes (e.g. "2 days max")
- **Expected Deliverable** — for spikes (e.g. "decision document", "proof of concept")
- **Business Impact** — for tech debt (quantify the cost of inaction)
- **Dependencies** — when other tickets or teams must complete work first (see Dependencies section)
- **Open Questions** — unresolved items that don't block starting but need answers

## Acceptance Criteria

Acceptance criteria define "done." Every criterion must be:

- **Testable** — a human can verify it without reading code
- **User-facing** — describes observable behavior or measurable outcome
- **Free of "how"** — no mention of technical approach

### Format 1: Checklist (Default)

Use for straightforward tickets with clear, independent conditions.

```
- [ ] User can add items to cart from the product page
- [ ] Cart badge updates immediately after adding an item
- [ ] Cart persists across page navigation within the same session
```

When to use: Most tickets. Simple, scannable, easy to test.

### Format 2: Given / When / Then

Use for complex flows where preconditions and sequences matter.

```
- [ ] Given a logged-in user with items in cart
      When they click "Checkout"
      Then they see the payment selection screen with their saved payment methods

- [ ] Given a guest user with items in cart
      When they click "Checkout"
      Then they are prompted to log in or continue as guest
```

When to use: Multi-step flows, conditional logic, scenarios where "it depends" on state.

### Format 3: Rule-Based

Use when the acceptance criteria describe constraints or business rules rather than user flows.

```
- [ ] Discount codes are case-insensitive
- [ ] Only one discount code can be applied per order
- [ ] Expired codes show a clear error message, not a generic failure
- [ ] Discount is calculated before tax, not after
```

When to use: Business logic, validation rules, edge cases, constraints.

### Choosing the Right Format

| Situation | Format |
|---|---|
| Simple feature with clear outcomes | Checklist |
| Multi-step flow with conditions | Given / When / Then |
| Business rules and constraints | Rule-Based |
| Complex ticket with all of the above | Mix formats within the same ticket |

### Good vs. Bad Acceptance Criteria

| Bad | Good | Why |
|---|---|---|
| "Implement a CNAME record" | "Google login shows the custom domain in the URL bar" | Describes outcome, not implementation |
| "Add cache_control: ephemeral" | "Content processing takes no longer than before" | Measurable, no tech prescription |
| "Create an error_log table" | "Errors are visible in the admin dashboard" | User-observable behavior |
| "Use Redis for caching" | "The page responds in under 2 seconds" | Specific, testable threshold |
| "Refactor the auth middleware" | "Users stay logged in across page refreshes" | Functional from user perspective |
| "It should feel fast" | "Search results appear within 1 second" | Measurable, not subjective |
| "Handle edge cases" | "Empty search query shows a helpful prompt instead of an error" | Specific edge case, specific behavior |

## Ticket Splitting

A ticket is too big when any of these apply:

- **More than 8 acceptance criteria** — strong signal the scope is too broad
- **Multiple user personas** in one ticket — each persona likely needs their own story
- **"And" in the title** — "Add search AND filter results" is two tickets
- **Can't estimate confidently** — if the team can't agree on effort, the scope is unclear
- **Too complex for a single autonomous run** — multiple domains, cross-repo, or vague requirements

### How to Split

**By user action:** Each distinct thing a user can do becomes its own ticket.
```
❌ "Users can manage their profile"
✅ "Users can update their display name"
✅ "Users can upload a profile photo"
✅ "Users can change their email address"
```

**By persona:** Different users, different tickets.
```
❌ "Users and admins can view reports"
✅ "Users can view their own usage report"
✅ "Admins can view aggregated team usage reports"
```

**By happy path vs. edge cases:** Ship the core flow first, handle exceptions next.
```
✅ "Users can reset their password via email" (happy path)
✅ "Password reset handles expired tokens gracefully" (edge case)
✅ "Password reset rate-limits to prevent abuse" (security edge case)
```

**By CRUD:** Create, Read, Update, Delete are natural split points.
```
❌ "Admin can manage discount codes"
✅ "Admin can create a new discount code"
✅ "Admin can view all active discount codes"
✅ "Admin can deactivate a discount code"
```

**By input/output channel:** Each integration point is its own ticket.
```
❌ "Send order confirmation"
✅ "Send order confirmation via email"
✅ "Send order confirmation via push notification"
```

When splitting, each resulting ticket must be independently shippable and testable. A ticket that only makes sense in combination with another ticket hasn't been split — it's been fragmented.

### Auto-Epic on Split

**Every split creates an Epic.** When you split a ticket into multiple child tickets, always create an Epic first as the container. The trigger is the **split action itself** — not the ticket size.

#### Flow

1. **Create the Epic ticket first:**
   - Title: `[Epic] {Original topic}` — the overarching goal
   - Body: Summarize the overall scope (from the original ticket description). Include a "Child Tickets" section that lists the planned children.
   - Status: `backlog`
   - Size: omit (Epics don't have a size — they are containers)

2. **Create each child ticket with `parent_ticket_id`:**
   - Each child references the Epic via `parent_ticket_id`
   - Each child is independently shippable and sized (S, M, or L — never XL)
   - Each child follows the standard ticket structure (Problem, Desired Behavior, ACs, Out of Scope)

3. **Show the hierarchy in the output:**
   ```
   Epic T-{N}: [Epic] {title}
     └─ T-{N+1} (M) {child title}
     └─ T-{N+2} (M) {child title}
     └─ T-{N+3} (S) {child title}
   ```

#### When creating via Board API

```bash
# 1. Create Epic first — ticket_type MUST be "epic" so the board applies the
#    epic branch of the CHECK constraint (project_id may be null when the
#    epic is cross-project, see T-903 below).
bash .claude/scripts/board-api.sh post tickets '{
  "title": "[Epic] {epic_title}",
  "body": "{epic_body}",
  "status": "backlog",
  "ticket_type": "epic",
  "project_id": "{pipeline.project_id}"
}'
# → Extract epic ticket ID from response

# 2. Create children with parent_ticket_id
bash .claude/scripts/board-api.sh post tickets '{
  "title": "{child_title}",
  "body": "{child_body}",
  "status": "backlog",
  "parent_ticket_id": "{epic_ticket_id}",
  "project_id": "{pipeline.project_id}"
}'
```

#### Cross-project children — T-903

When a split produces children that target more than one project in the workspace (e.g. some children build in the Engine repo, others in the Board UI repo), the epic becomes **workspace-scoped** and each child is stamped with the project it actually belongs to. The inference is deterministic — based on body signals, never asked of the user (Decision Authority / CLAUDE.md).

**Signal mapping (Just Ship reference):**

| Project | Signals in child title/body |
|---|---|
| `just-ship` (engine) | `engine`, `pipeline`, `orchestrator`, `worker`, `classifier`, `classify`, `develop`/`ship` command, `agent`, `skill`, `board-api.sh`, `server.ts`, `API endpoint`, `Engine API`, `/api/sidekick` |
| `just-ship-board` (board UI) | `Board UI`, `Swimlane`, `Widget`, `kanban`, `ticket card`, `Epic-Detail`, `ticket detail`, `board page`, `sidebar`, `shadcn`, `TanStack`, `Next.js`, `React component`, `src/app`, `src/components` |

**Rule:** score each child against every project's signals. The project with the highest score wins. On tie — or when no signal hits — fall back to the parent request's default project. If the default is also null (pure workspace-scoped pitch), the split stops and reports that a child needs clearer scope — do not guess when both signal and default are missing.

The reference inference helper is `pipeline/lib/project-inference.ts` — prefer calling it over re-implementing the heuristic.

**When children span ≥ 2 projects:**

```bash
# 1. Create workspace-scoped Epic (project_id = null, ticket_type = "epic")
bash .claude/scripts/board-api.sh post tickets '{
  "title": "[Epic] {epic_title}",
  "body": "{epic_body}",
  "status": "backlog",
  "ticket_type": "epic",
  "project_id": null
}'
# → Extract epic ticket ID

# 2. Create each child with its own inferred project_id
bash .claude/scripts/board-api.sh post tickets '{
  "title": "{child_title}",
  "body": "{child_body}",
  "status": "backlog",
  "parent_ticket_id": "{epic_ticket_id}",
  "project_id": "{inferred_project_id}"
}'
```

**Invariant:** when the epic's `project_id` is `null`, every child MUST carry its own `project_id`. The board's CHECK constraint (`ticket_type = 'epic' OR project_id IS NOT NULL`) rejects task rows without a project. The inference step must produce a concrete project for every child before any POST.

**When children collapse to a single project:** the split stays project-bound — the epic keeps `project_id = {pipeline.project_id}`, each child inherits that project, and the behaviour is indistinguishable from pre-T-903.

#### When pipeline is not configured

If `pipeline.project_id` is not set in `project.json`, skip all Board API calls. Present the Epic and child ticket structures as Markdown output instead. The user can create them manually in their tool of choice.

#### What is NOT an Epic

- **Spikes** are not Epics. Spikes use `parent_ticket_id` for follow-up tickets (via `/spike-review`), but they are time-boxed investigations, not scope containers.
- **Single tickets** are not Epics. If a ticket doesn't get split, it stays a normal ticket.

### Manual Grouping

Existing tickets can be grouped under a new Epic after the fact. When the user says something like "Group T-100, T-101, T-102 under an Epic":

1. Create a new Epic ticket with a title and summary that describes the shared scope
2. Update each referenced ticket's `parent_ticket_id` to point to the new Epic
3. Show the resulting hierarchy

```bash
# 1. Create the Epic
bash .claude/scripts/board-api.sh post tickets '{
  "title": "[Epic] {grouping_title}",
  "body": "{summary of what these tickets accomplish together}",
  "status": "backlog",
  "project_id": "{pipeline.project_id}"
}'
# → Extract epic_ticket_id

# 2. Link each existing ticket
bash .claude/scripts/board-api.sh patch "tickets/{N}" '{"parent_ticket_id": "{epic_ticket_id}"}'
```

If `pipeline.project_id` is not set, skip Board API calls and output the Epic structure as Markdown. List the tickets that would be linked so the user can apply them manually.

## Sizing

Every ticket gets a T-shirt size based on **complexity and scope** — not time. With agentic dev, a typical M-ticket runs in 10-30 minutes of pipeline time, so time-based estimates are meaningless. Size by what the agent needs to navigate.

| Size | Complexity signals | Autonomy profile |
|---|---|---|
| **S** | Single file or domain, config change, copy update, clear fix with known root cause. Up to 3 ACs. | Fully autonomous, no human review needed before merge |
| **M** | One domain (FE or BE or DB), 2-5 files, clear ACs, well-defined scope. 4-6 ACs. | Autonomous with standard code review |
| **L** | Cross-domain (FE + BE + DB), multiple integration points, 6+ files, some ambiguity in requirements. 7-8 ACs. | Autonomous but needs human review for product or architectural decisions |
| **XL** | Cross-repo, architecture change, migration, vague or evolving requirements, multiple personas. 9+ ACs. | Too complex for a single autonomous run — **always split** |

### How to size

Focus on these signals — in order of importance:

1. **Domain count** — How many domains are touched? (FE, BE, DB, infra, config). Single-domain = S or M. Multi-domain = L or XL.
2. **Clarity of requirements** — Are the ACs precise and testable? Vague = size up. Crystal clear = size down.
3. **AC count** — More than 8 ACs is a split signal. 4-6 is the sweet spot for M.
4. **File spread** — 1-2 files = S. 2-5 files = M. 6+ files = L. Cross-repo = XL.
5. **Human judgment needed** — Can an agent make all decisions autonomously, or does it need product/design input? More human input = larger size.

**When in doubt, size up.** An M that turns out to be an S is fine. An M that turns out to be an XL blocks the pipeline.

**XL is a split signal.** If a ticket is XL, it must be split. Most XL tickets are actually 2-3 M tickets hiding behind a vague title. Use the split strategies in the [Ticket Splitting](#ticket-splitting) section above.

## Dependencies

When a ticket depends on other work, document it explicitly:

```
## Dependencies
- **Blocked by:** [Ticket reference] — [what it provides that this ticket needs]
- **Blocks:** [Ticket reference] — [what this ticket provides]
```

Three rules for dependencies:
1. **Name the dependency, not just the ticket.** "Blocked by T-42" is useless. "Blocked by T-42 — needs the payment API endpoint to be live" is actionable.
2. **Distinguish hard blocks from soft blocks.** A hard block means work cannot start. A soft block means work can start but cannot be completed or shipped.
3. **If everything depends on everything, the tickets are too intertwined.** Re-split by vertical slices (user-facing increments) instead of horizontal layers (API, then UI, then tests).

## Properties

Set these for every ticket:

- **Status**: `ready_to_develop` (well-defined, can be picked up) or `backlog` (needs refinement)
- **Priority**: `high` / `medium` / `low` — see Priority Guide below
- **Type**: User Story / Bug / Improvement / Spike / Tech Debt
- **Size**: S / M / L / XL — **omit for Epics** (Epics are scope containers, not sized work items)
- **Project**: every `POST tickets` body must carry the target `project_id` UUID — see Target Project resolution below.

### Target Project resolution

Every ticket lives in exactly one project. The Board API reads `project_id` from the request body — workspace-scoped keys do not pick a project on their own.

Resolution order, highest priority first:

1. **Explicit override.** `/ticket --project <slug-or-uuid> "..."` — the Slash-Command parses `--project` out of the input, resolves a slug to a UUID via `GET /api/projects` (match on `data.projects[].slug`), and passes the UUID through to every POST in this ticket creation (Single, Epic-Container, Children, Manual-Grouping). A bad slug aborts with an error — never silently fall back to the default.
2. **Default hint from `project.json`.** When no override is passed, every POST sets `project_id` to `pipeline.project_id`. `board-api.sh` also auto-injects this default if a body is missing `project_id`, so the bash call is safe even when the skill forgets — but the skill should still set it explicitly so split-flows stay deterministic.
3. **Cross-project Epic** (Auto-Epic on Split, T-903 mode). The Epic POST sends `project_id: null`; every child POST sends the inferred project UUID per child. The `--project` override does not apply here — cross-project splits explicitly opt out of single-project mode.

The script `bash .claude/scripts/board-api.sh post tickets` accepts `project_id` in the JSON body and forwards it untouched. No CLI flags, no headers — the project is always part of the request payload.

### Priority Guide

| Priority | Criteria |
|---|---|
| `high` | Blocks users from completing a core workflow, causes data loss or security risk, or has a hard external deadline |
| `medium` | Meaningfully degrades UX or productivity, but a workaround exists. Should be addressed in the next 1-2 sprints |
| `low` | Nice-to-have, minor annoyance, or edge case affecting few users. Can wait without meaningful business impact |

When in doubt: if the ticket has no clear urgency signal, default to `medium`.

## Output

Present the ticket as structured Markdown. The user decides where to put it (Notion, Linear, Jira, GitHub Issues, or just keep the Markdown).

If the user asks you to create the ticket in a specific tool, use the appropriate integration (Notion MCP, etc.). But writing the ticket well is your primary job — delivery is secondary.

## Common Pitfalls

- **Scope creep in disguise:** "While we're at it..." belongs in a separate ticket
- **Solution smuggling:** Describing implementation as if it were a requirement
- **Vague criteria:** "It should feel fast" is not testable. "It loads in under 2 seconds" is
- **Missing boundaries:** Without "Out of Scope", developers guess what's included
- **Kitchen-sink tickets:** One ticket per outcome. If the ticket has "and" in the title, split it
- **Premature tech debt tickets:** If you can't articulate the business impact, it's not ready to be a ticket yet
- **Orphan dependencies:** Referencing tickets that don't exist yet. Create them or note them as open questions.

## Full Example

### Bad Ticket (too technical)

> **Architecture: Inject user context dynamically into AI routing**
>
> Use the Xentral API to pull customer segments, then pass them as system prompt context to the routing layer. Add cache_control: ephemeral to reduce token costs. Store the mapping in a new customer_segments table.

### Good Ticket (PM-style)

> **AI categorization respects the customer's segment**
>
> ## Problem
> When a customer belongs to a specific segment (e.g. "B2B wholesale"), incoming support requests are still categorized using the generic consumer logic — leading to wrong routing and slower response times.
>
> ## Desired Behavior
> The AI takes the customer's segment into account when categorizing requests. A B2B wholesale inquiry about bulk pricing gets routed to the wholesale team, not consumer support.
>
> ## Acceptance Criteria
> - [ ] Given a customer in the "B2B wholesale" segment
>       When they submit a pricing inquiry
>       Then the inquiry is routed to the wholesale support queue
> - [ ] Requests from customers without a segment behave as before
> - [ ] Categorization time is not noticeably longer than before
> - [ ] Incorrect categorization can be manually overridden by support agents
>
> ## Out of Scope
> - No retroactive re-categorization of existing requests
> - No changes to segment definitions themselves
> - No new UI for segment management
>
> **Status:** `ready_to_develop` | **Priority:** `medium` | **Type:** User Story | **Size:** M
