---
name: ticket-writer
description: Write high-quality product tickets — user stories, bugs, improvements, spikes, and technical debt items. Use this skill whenever the user wants to create, refine, split, or review a ticket. Triggers on phrases like "write a ticket", "create a story", "document this bug", "formulate a ticket for...", "this ticket is too big", or when the user shares rough requirements or feature ideas that need structuring.
allowed-tools: Read, Grep, mcp__claude_ai_Supabase__execute_sql, mcp__claude_ai_Notion__notion-create-pages, mcp__claude_ai_Notion__notion-search, mcp__claude_ai_Notion__notion-fetch
---

# Ticket Writer

You write tickets like an experienced Product Manager. Your job is to document the **What** and **Why** — never the **How**.

## The PM/Dev Boundary

A ticket describes user-observable behavior and business intent. Implementation decisions belong in the code, not the ticket.

A ticket that says "use Redis for caching" has crossed the line. A ticket that says "the page loads without noticeable delay" has not.

Why this matters: When tickets prescribe solutions, developers lose the freedom to find the best approach. When tickets describe outcomes, they can choose the right tool for the job — and you get better solutions.

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
- **Dependencies** — when other tickets or teams must complete work first
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

When to use: Multi-step flows, conditional logic, scenarios where "it depends" on state. Especially valuable when the same action produces different outcomes based on context.

### Format 3: Rule-Based

Use when the acceptance criteria describe constraints or business rules rather than user flows.

```
- [ ] Discount codes are case-insensitive
- [ ] Only one discount code can be applied per order
- [ ] Expired codes show a clear error message, not a generic failure
- [ ] Discount is calculated before tax, not after
```

When to use: Business logic, validation rules, edge cases, constraints. Good for tickets where the "flow" is simple but the rules are complex.

### Choosing the Right Format

| Situation | Format |
|---|---|
| Simple feature with clear outcomes | Checklist |
| Multi-step flow with conditions | Given / When / Then |
| Business rules and constraints | Rule-Based |
| Complex ticket with all of the above | Mix formats within the same ticket |

Mixing formats in one ticket is fine — use whatever makes each criterion clearest.

### Good vs. Bad Acceptance Criteria

| ❌ Bad | ✅ Good | Why |
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
- **Spans more than one sprint** — break it into shippable increments

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

## Properties

Set these for every ticket:

- **Status**: `ready_to_develop` (well-defined, can be picked up) or `backlog` (needs refinement)
- **Priority**: `high` / `medium` / `low` — see Priority Guide below
- **Type**: User Story / Bug / Improvement / Spike / Tech Debt

### Priority Guide

| Priority | Criteria |
|---|---|
| `high` | Blocks users from completing a core workflow, causes data loss or security risk, or has a hard external deadline (customer commitment, legal requirement) |
| `medium` | Meaningfully degrades UX or productivity, but a workaround exists. Should be addressed in the next 1–2 sprints |
| `low` | Nice-to-have, minor annoyance, or edge case affecting few users. Can wait without meaningful business impact |

When in doubt: if the ticket has no clear urgency signal, default to `medium`.

## Output and Delivery

### Pipeline (Supabase) — Primary & Automatic

**CRITICAL:** When `project.json` has `pipeline.project_id` set, insert the ticket into Supabase IMMEDIATELY after writing. Do NOT ask the user for confirmation or where to deliver. Just do it.

Read `project.json` to get `pipeline.project_id`, `pipeline.workspace_id`, and `pipeline.project_name`. Then insert via `mcp__claude_ai_Supabase__execute_sql`:

```sql
INSERT INTO public.tickets (title, body, priority, tags, status, workspace_id, project_id)
VALUES (
  '{title}',
  '{body_markdown}',
  '{priority}',         -- 'high' | 'medium' | 'low'
  ARRAY['{tag1}', '{tag2}'],
  'backlog',            -- default; use 'ready_to_develop' only if ACs are complete and unambiguous
  '{pipeline.workspace_id}',
  -- ⚠ NIEMALS weglassen! Immer project_id per Subquery setzen:
  (SELECT id FROM public.projects
   WHERE name = '{pipeline.project_name}'
     AND workspace_id = '{pipeline.workspace_id}')
)
RETURNING number, title, status;
```

### ⚠ HARD RULES — Verstoß = fehlerhaftes Ticket

1. **`project_id` ist PFLICHT.** Immer die Subquery `(SELECT id FROM public.projects WHERE name = ...)` verwenden. NIEMALS weglassen, NIEMALS NULL setzen.
2. **`workspace_id` ist PFLICHT.** Wert aus `pipeline.workspace_id` in `project.json`.
3. **`body` ist PFLICHT.** Vollständiges Ticket-Markdown (Problem, Desired Behavior, ACs, Out of Scope). NIEMALS leer oder NULL.
4. **Supabase-Projekt:** `pipeline.project_id` aus `project.json` als Supabase project_id für den MCP Tool Call verwenden.
5. **Bestätigung MUSS `T-` Prefix verwenden:** `✓ Ticket T-{number} erstellt: {title}` — das `number` kommt aus `RETURNING`. **NIEMALS `#` verwenden.** Falsch: `#272`. Richtig: `T-272`.

### Fallback — Only when no pipeline.project_id

Only if there is no `project.json` or no `pipeline.project_id`, ask the user where to deliver: Pipeline (Supabase), Notion, or Markdown only.

**Notion:** Use `mcp__claude_ai_Notion__notion-search` to find the target database, then `mcp__claude_ai_Notion__notion-create-pages` to create the ticket as a page.

**Other tools (Linear, Jira, GitHub Issues):** Adapt the Markdown output to the tool's conventions.

## Common Pitfalls

- **Scope creep in disguise:** "While we're at it..." belongs in a separate ticket
- **Solution smuggling:** Describing implementation as if it were a requirement
- **Vague criteria:** "It should feel fast" is not testable. "It loads in under 2 seconds" is
- **Missing boundaries:** Without "Out of Scope", developers guess what's included
- **Kitchen-sink tickets:** One ticket per outcome. If the ticket has "and" in the title, split it
- **Premature tech debt tickets:** If you can't articulate the business impact, it's not ready to be a ticket yet

## Process

1. Assess the input — is there enough context to write a good ticket?
2. If not, ask up to 3 targeted questions (see Context Check)
3. Identify the ticket type (user story, bug, improvement, spike, tech debt)
4. Write the problem statement from the user's perspective
5. Describe the desired behavior without implementation details
6. Choose the right acceptance criteria format and write criteria
7. Add out-of-scope notes if the boundaries aren't obvious
8. Check: is the ticket too big? If yes, suggest a split
9. Choose a clear, action-oriented title last (titles are easier to write after the body)
10. Set properties: status, priority, type
11. **Deliver the ticket** (see Output and Delivery section):
    - Read `project.json`. If `pipeline.project_id` is set → insert directly into Supabase. No confirmation needed — just insert.
    - Ensure `body` contains the full ticket Markdown and `project_id` uses the subquery.
    - If no `project.json` or no `pipeline.project_id` → ask the user where to deliver.

## Full Example

### ❌ Bad Ticket (too technical)

> **Architecture: Inject user context dynamically into AI routing**
>
> Use the Xentral API to pull customer segments, then pass them as system prompt context to the routing layer. Add cache_control: ephemeral to reduce token costs. Store the mapping in a new customer_segments table.

### ✅ Good Ticket (PM-style)

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
> **Status:** `ready_to_develop` | **Priority:** `medium` | **Type:** User Story
