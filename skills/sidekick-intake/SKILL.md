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

## Autonomous creation — T-876

Once the classifier picks `ticket` or `epic`, the Sidekick creates the artifact itself without asking the user. The rule is the same one that makes the classifier work: the platform decides, the user steers. Asking "soll ich das so anlegen?" leaks PM vocabulary into a conversational product.

The creation endpoint is stateless: the caller passes the classification plus the structured input (title + body, optionally priority/tags, or an epic + children). The Engine writes it to the Board and returns enough info for the Sidekick to reply "Ist im Board: T-{N} — {Titel}. [Link]" with no further turns.

### Create endpoint

`POST /api/sidekick/create`

**Request — category 1 (ticket):**
```json
{
  "category": "ticket",
  "project_id": "uuid",
  "board_url": "https://board.just-ship.io",
  "ticket": {
    "title": "string",
    "body": "string (Markdown)",
    "priority": "high" | "medium" | "low",
    "tags": ["optional"]
  }
}
```

**Request — category 2 (epic + children):**
```json
{
  "category": "epic",
  "project_id": "uuid",
  "board_url": "https://board.just-ship.io",
  "epic":     { "title": "[Epic] X", "body": "…" },
  "children": [ { "title": "Y", "body": "…" }, … ]
}
```

Children get `parent_ticket_id` pointing to the Epic automatically. The Epic is created first (sequentially); children are created in parallel. A child-level failure does not fail the whole request — the Epic is still usable, and failed children are listed so the Sidekick can tell the user ("2 von 3 Child-Tickets angelegt, c2 hat gehangen — willst du's nochmal?") and/or retry.

**Response — category 1:**
```json
{
  "status": "created",
  "category": "ticket",
  "ticket": { "number": 501, "id": "…", "title": "…", "url": "https://board.…/t/501" }
}
```

**Response — category 2:**
```json
{
  "status": "created",
  "category": "epic",
  "epic":     { "number": 500, "id": "…", "title": "[Epic] …", "url": "…" },
  "children": [ { "number": 501, … }, { "number": 502, … } ],
  "failed_children": [ { "index": 2, "title": "c3", "reason": "…" } ]
}
```

`failed_children` is only present when at least one child failed.

**Errors:**
- `400` — validation (missing `category`, invalid title/body length, empty children array, too many children, unknown priority).
- `401` — missing/invalid `X-Pipeline-Key`.
- `429` — rate limit exceeded.
- `502` — Board API upstream failure while creating the Epic itself.

**Limits:**
- Title: 200 chars. Body: 20 000 chars. Children: 20 per Epic.
- Rate limit: 30 requests per minute per project.

### Update endpoint (correction flow)

When the user corrects the Sidekick after creation ("ne anders, der Titel soll X sein"), the Sidekick patches the existing ticket instead of creating a new one. It keeps the ticket number from the previous `create` response in its session state and hands it back via this endpoint.

`POST /api/sidekick/update`

**Request:**
```json
{
  "ticket_number": 501,
  "board_url": "https://board.just-ship.io",
  "patch": {
    "title": "optional new title",
    "body": "optional new body",
    "priority": "high" | "medium" | "low",
    "tags": ["optional"],
    "status": "backlog" | "ready_to_develop"
  }
}
```

Only fields present in `patch` are changed. At least one field is required.

**Response:**
```json
{
  "status": "updated",
  "ticket": { "number": 501, "id": "…", "title": "…", "url": "…" }
}
```

**Rate limit:** 30 requests per minute per ticket.

### Sidekick reply format

The caller formats the final chat message. Recommended templates — no PM jargon, no "Soll ich das anlegen?":

| Category | Reply template |
|---|---|
| ticket | `Ist im Board: T-{N} — {title}. {url}` |
| epic   | `Ist im Board als Epic T-{N} — {title}. {url}` + a short bullet list of child titles with their T-numbers |
| epic with `failed_children` | append `Ein paar Child-Tickets haben gehangen, ich probier die gleich nochmal.` — then retry in the background |

When the user later corrects ("ne, andere Formulierung"), the Sidekick calls `/api/sidekick/update` with the ticket number from its session state and replies `Hab's angepasst: T-{N} — {neuer Titel}. {url}` — never a second Ist-im-Board sentence.

## Project creation — T-877

Category 4 (`project`) is the one exception to "never confirm before creating". A new project is structurally larger than a ticket — new workspace scope, new repo implications, new audience — so the Sidekick asks exactly once:

> "Das klingt nach einem neuen Projekt. Soll ich {Name} als Projekt anlegen?"

On confirmation the Sidekick calls the create-project endpoint, which writes **three things in sequence**:

1. New **project** in the workspace (via `POST /api/projects`).
2. Init-**Epic** `[Epic] Projekt-Grundgeruest {Name}` scoped to the new project (priority `high`).
3. Three default **child tickets** under the Epic, each with `parent_ticket_id` pointing at the Epic:
   - `Projekt-Scope klären: {Name}` — MVP scope, target audience, core user journey, out-of-scope list.
   - `Tech-Stack-Entscheidung: {Name}` — framework, backend, hosting, auth.
   - `Erste User-Journey bauen: {Name}` — end-to-end flow with all four states (loading/error/empty/success).

Children are created in parallel. Partial child-failures go into `failed_children` — the project + epic still count as success. If the project itself or the epic fails, the request throws `BoardApiError` and nothing further is attempted (a project without an epic is an acceptable degenerate state for the user to clean up; an epic without a project cannot exist).

The endpoint does **not** trigger an automatic develop pipeline — project creation is an authoring act, not a build signal.

### Create-project endpoint

`POST /api/sidekick/create-project`

**Request:**
```json
{
  "workspace_id": "uuid",
  "project_name": "string (<=100 chars)",
  "description": "string (<=2000 chars) — the user's initial pitch",
  "confirmed": true,
  "board_url": "https://board.just-ship.io"
}
```

`confirmed` **must be the literal boolean `true`**. Any other value — missing, `false`, `"true"`, `1` — is rejected with `400`. This is the endpoint's own guard against a buggy caller sidestepping the confirmation step; the Sidekick must forward the user's "ja" as `true`.

**Response:**
```json
{
  "status": "created",
  "project":  { "id": "…", "name": "…", "slug": "…", "url": "https://board.…/p/…" },
  "epic":     { "number": 800, "id": "…", "title": "[Epic] Projekt-Grundgeruest …", "url": "…" },
  "children": [
    { "number": 801, "title": "Projekt-Scope klären: …", "url": "…" },
    { "number": 802, "title": "Tech-Stack-Entscheidung: …", "url": "…" },
    { "number": 803, "title": "Erste User-Journey bauen: …", "url": "…" }
  ],
  "failed_children": [ … ]
}
```

**Errors:**
- `400` — validation (missing fields, length overflow, `confirmed !== true`).
- `401` — missing/invalid `X-Pipeline-Key`.
- `429` — rate limit exceeded (5 requests per minute per workspace — deliberately lower than ticket/epic because one idea = one call).
- `403` — Board API rejects project creation for this API key (project-scoped keys cannot create new projects; workspace-scoped key required).
- `502` — other Board API upstream failure while creating the project or the epic.

### Sidekick reply format — category 4

```
Projekt {Name} ist angelegt: {project.url}
Erste Schritte sind im Epic T-{epic.number}:
  • T-{children[0].number} — Projekt-Scope klären
  • T-{children[1].number} — Tech-Stack-Entscheidung
  • T-{children[2].number} — Erste User-Journey bauen
```

If `failed_children` is non-empty, append `Ein paar Init-Tickets haben gehangen, ich probier die gleich nochmal.` and retry the failed ones in the background.

Optional follow-up (out of scope for this endpoint): the Sidekick may offer to start a product-cto + design-lead conversation about the new project — but only after the user has seen the confirmation, never as part of the create call.

## User Question Policy — T-879

The Sidekick is the only user-facing agent in the just-ship platform. It is the first touchpoint for every idea. If it asks the user implementation questions, the Decision Authority rule (T-871) is broken at the one place it matters most — everything downstream runs through experts, but the intake leaks PM/tech questions at the user.

This policy applies to **every user-visible turn the Sidekick produces** — classification prompts, clarifying questions in the conversation flow, project-creation confirmation, correction handling. No exceptions.

### Allowed — business/vision topics the Sidekick may ask

| Topic | Why it's allowed | Example |
|---|---|---|
| Target audience (Zielgruppe) | Only the user knows who this is for | "Für wen genau — User, Admins, oder beide?" |
| Timing / urgency (Timing, Dringlichkeit) | Business priority decision | "Muss das noch vor Launch stehen oder danach?" |
| Scope boundary | Defines *what* product exists, not *how* | "Ist das eine Änderung oder mehrere zusammen?" |
| Replaces vs augments (Ersetzt-oder-Ergänzt) | Product-direction decision | "Soll das die bestehende Suche ersetzen oder daneben leben?" |
| Priority (Priorität) | Belongs to the user as CEO | "High, medium, oder low?" (only if ambiguous) |
| Success criteria (Erfolgskriterien) | Describes *what* done looks like | "Was merkt der User konkret, wenn das da ist?" |

### Forbidden — implementation topics the Sidekick never asks

These are delegated internally to experts (`product-cto`, `design-lead`, `backend`, `frontend-design`, `data-engineer`, `ux-planning`). The Sidekick consults them silently during finalisation and folds their decision into the artifact body. The user never sees the consultation — only the final artifact.

| Category | Forbidden examples |
|---|---|
| Tech-Stack / Framework | "React oder Vue?", "Welches Framework?", "Next or Remix?" |
| Datenbank / Storage | "Postgres oder SQLite?", "Which database?" |
| API-Design | "REST oder GraphQL?", "Which endpoint shape?" |
| Hosting / Deployment | "Coolify oder Vercel?", "Which hosting?" |
| Visual Design | "Welche Farbe?", "Which font?", "Which colors?" |
| Layout / IA | "Sidebar oder Topbar?", "Which layout?", "Which navigation?" |
| Component-Wahl | "Modal oder Bottom-Sheet?", "Kanban oder Liste?", "Which component library?" |
| Flow-Patterns / Screens | "Welche Interaction?", "Which interaction pattern?" |
| Architektur / Performance / Caching | "Which caching?", "Sync or async?" |
| Auth | "Which auth flow?" |

### Internal expert consultation (never visible to the user)

When the Sidekick hits technical uncertainty during finalisation — inferring Acceptance Criteria, choosing the artifact shape, writing the body — it **internally** routes to the relevant expert skill:

- **`product-cto`** — architecture, performance, ops, security strategy, non-obvious data shape decisions.
- **`design-lead`** — product structure, interaction philosophy, cross-feature UX consistency.
- **`backend` / `frontend-design` / `data-engineer` / `ux-planning`** — domain-level concerns at finalise time.

The expert output flows into the artifact body. The user never sees which expert was consulted, never sees a "checking with the team" message, and is never asked a technical question as a result.

### Enforcement

The policy is enforced at three layers:

1. **System prompt.** The converse system prompt (`SYSTEM_PROMPT` in `pipeline/lib/sidekick-converse.ts`) contains both the allowed and forbidden topic lists with examples. This is the primary gate — the model is told the rule before it generates a turn.
2. **Shared policy module.** `pipeline/lib/sidekick-policy.ts` exports `FORBIDDEN_QUESTION_TOPICS` and `detectImplementationLeak(text)`. Both the classifier and the converse flow import from it. New forbidden patterns added here are automatically picked up by the runtime metric layer (#3). The system prompt (#1) is a separate literal — when a pattern is added to `FORBIDDEN_QUESTION_TOPICS`, the matching category's anti-example in `SYSTEM_PROMPT` must be updated in the same commit so the model sees the new rule up-front instead of relying on detect-after-the-fact.
3. **Runtime metric.** Every user-visible assistant turn from the converse flow (both questions on turns 1-2 and the finalize wrap on turn 3) is run through `detectImplementationLeak` after generation. If it matches a forbidden pattern, the turn is logged with `implementationLeak: true`, a `leakSurface` tag ("question" or "finalize"), and Sentry captures it. This is a telemetry layer, not a hard block — the team sees leaks and tightens the prompt (or upgrades the list) rather than surprising the user with a rejection.

### Test corpus

`pipeline/lib/sidekick-policy.test.ts` enforces the policy through a curated corpus of 20+ scenarios. Each scenario is shaped as:

- A user input where the Sidekick might be tempted to ask a technical question.
- An example of the forbidden question text that would leak implementation scope.

The tests assert that:

- `detectImplementationLeak` flags every canonical forbidden phrasing.
- The system prompt contains an explicit "never ask implementation questions" clause.
- `FORBIDDEN_QUESTION_TOPICS` covers the representative categories from this policy (stack, DB, hosting, visual, layout, navigation, auth, caching, API shape).

When a new forbidden pattern is added to the policy, the corpus gains the canonical phrasing in the same commit.

## Out of scope (other tickets)

- Conversation flow — T-878
- Terminal command `/sidekick` — T-880
- UI rewire — T-881
- Hook-based output enforcement (hard-block a leaking turn before it reaches the user) — separate ticket
- User-side escalation ("möchte selbst entscheiden") — separate ticket
