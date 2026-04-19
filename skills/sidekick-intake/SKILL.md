---
name: sidekick-intake
description: Classify a raw Sidekick user input (idea, request, bug report) into one of four buckets — ticket, epic, conversation, or project — using business signals only.
---

# Sidekick Intake — Classifier

The Sidekick is the entry point for every idea a user has. Most product platforms force users to pick "is this a bug? a feature? an epic?" up front. That always lies — users don't know which bucket their idea fits, and asking creates friction before the idea is even captured.

This skill gives the Sidekick the judgment to pick the right bucket itself, in 1-2 turns, based on what the user actually said.

## The four categories

| # | Category | When to pick it |
|---|---|---|
| 1 | **ticket** | One concrete change to something that already exists, with a clear outcome. Bug fixes, copy tweaks, single feature additions to an existing surface, single-screen edits. |
| 2 | **epic** | Several related changes that share a feature name. "We need X in Y" where X spans multiple screens or flows. Anything that would naturally split into 3+ child tickets. |
| 3 | **conversation** | Direction is unclear. The user is exploring ("should we", "what do you think", "I'm not sure"), business context is missing, or the request needs more shape before any concrete artifact can exist. |
| 4 | **project** | A new product name, a new user audience, or "I want to build X" where X is genuinely new (not an addition to an existing project). |

## Signals

| Signal in the input | Push toward |
|---|---|
| One concrete change to something that exists, clear outcome | 1 (ticket) |
| Multiple connected changes / a feature name appears / "we need X in Y" | 2 (epic) |
| Direction-uncertainty, "should we", missing business context | 3 (conversation) |
| New product name, distinct user audience, "I want to build X" (X is new) | 4 (project) |

## Decision Authority — the rule that makes this work (T-871)

The classifier weighs **only business signals** — what changes for the end user, what new product surface would exist, what scope feels involved.

It **never** weighs implementation signals — which framework, which database, which deployment target, how it would be built. Those are decided autonomously later by the engineering team. If the user mentions implementation details ("…in React", "…with a webhook", "…using Stripe"), the classifier ignores those when assigning a category.

This is what keeps the four buckets clean. A "tiny database migration" is not a ticket because it's small in code — it's a ticket because it's a single concrete change with a clear outcome. A "rebuild the whole frontend" is not an epic because it touches many files — it's a conversation if the user has no clear outcome, or a project if it implies a new product surface.

## Confidence

The classifier returns a confidence score between 0 and 1.

- **≥ 0.7** → return the chosen category directly.
- **< 0.7** → force category to `conversation`, regardless of which the model originally picked. The Sidekick then opens a conversation to shape the request — it never asks the user "what did you mean?". The whole point of T-871 is that the platform makes the call.

The original (low) confidence and the model's first pick are preserved in the response so they can be logged for evaluation.

## Project context

The classifier is called with optional context about the active project: project name, type, recent ticket titles, and existing epic titles. Use this context to disambiguate cases like:

- "Add a notifications panel" — if the project already has a Notifications epic, this is probably a **ticket** under that epic. If not, it's probably an **epic** itself.
- "I want a new dashboard" — inside an existing project this is an **epic**. As a new product name with a new audience, this is a **project**.

Context is signal, not authority. A clearly-new-product input stays a `project` even inside an existing workspace.

## API contract

Endpoint: `POST /api/sidekick/classify` on the Engine server.

**Request:**
```json
{
  "text": "string — the raw user input",
  "project_context": {
    "projectName": "string?",
    "projectSlug": "string?",
    "projectType": "string?",
    "existingTickets": [{"number": 123, "title": "..."}],
    "existingEpics": [{"number": 456, "title": "..."}]
  }
}
```

`project_context` is optional. If omitted, the classifier still works but has no project disambiguation.

**Response:**
```json
{
  "category": "ticket" | "epic" | "conversation" | "project",
  "confidence": 0.0,
  "reasoning": "one sentence, business-signal-based",
  "fallback_applied": false
}
```

`fallback_applied` is `true` when the result was forced to `conversation` by the confidence floor.

**Auth:** `X-Pipeline-Key` header (same as every other Engine endpoint).

**Rate limit:** 30 requests per minute per project.

**Errors:**
- `400` — missing or empty `text`.
- `401` — missing or invalid `X-Pipeline-Key`.
- `429` — rate limit exceeded.
- `500` — internal failure. The classifier degrades gracefully on model failures: it returns a `conversation` result with `confidence: 0` and a `reasoning` field that explains the failure, rather than 500ing — the Sidekick can always continue talking to the user.

## Logging

Every classification logs (Pino structured):
- `textPreview` (first 200 chars of input)
- `category` (final, post-fallback)
- `modelCategory` (what the model originally said)
- `confidence`
- `reasoning`
- `fallback_applied`
- `projectSlug` (if provided)
- `durationMs`

Errors log `err`, `modelOutput` (truncated to 500 chars), and the input preview.

## Examples

| Input | Project context | Expected category |
|---|---|---|
| "The sidekick toggle on the board doesn't reopen after closing it once" | just-ship | ticket |
| "Change the empty-state text on the tickets page from 'Nothing here' to 'No tickets yet'" | just-ship | ticket |
| "Add a copy-link button next to each ticket title in the kanban view" | just-ship | ticket |
| "We need a Notifications system across the board — settings page, bell icon, email digest, and in-app inbox" | just-ship | epic |
| "Build out the Workspace billing feature — usage page, invoices, plan switcher, and payment-method management" | just-ship | epic |
| "We need full keyboard navigation in the board — j/k for tickets, c for create, / for search" | just-ship | epic |
| "Should we maybe add some kind of analytics dashboard? I'm not sure if it's worth it yet" | just-ship | conversation |
| "What do you think about reworking how onboarding feels?" | just-ship | conversation |
| "I have an idea for something cool but I don't know how to describe it yet" | (none) | conversation |
| "I want to build Aime Coach — an AI accountability buddy app for therapists" | (none) | project |
| "I want to build a new shopify analytics tool for fashion brands, separate from anything we have" | (none) | project |
| "Let's set up Just Ship Edu — a guided coding curriculum for high schoolers, totally separate workspace" | (none) | project |

## Out of scope (other tickets)

- Actual ticket/epic creation — T-876
- Project creation flow — T-877
- Conversation flow — T-878
- Decision Authority application beyond classification — T-879
- Terminal command `/sidekick` — T-880
- UI rewire — T-881
