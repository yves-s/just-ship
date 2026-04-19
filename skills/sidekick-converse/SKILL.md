---
name: sidekick-converse
description: Run a short Sidekick conversation that shapes a fuzzy idea into a concrete artifact (ticket, epic, or spike) in at most 3 turns, using only business-level questions.
---

# Sidekick Converse — Conversation Mode for category 3

When the intake classifier (T-875) lands on **conversation** — the user's direction is unclear, business context is missing, or they're exploring ("should we…", "I'm not sure…") — the Sidekick enters this mode. It is deliberately short: at most 3 turns, and every session ends with a created artifact. No open-ended chats.

The point is not to be helpful-sounding. The point is to capture the idea as a workable artifact without pushing PM ceremony onto the user.

## The three-turn rule

| Turn | What happens |
|---|---|
| 1 | User's first message arrives here. The Sidekick either asks one business question (`question`) or, if the idea is already clear enough, finalises immediately (`finalize`). |
| 2 | Same mechanics: one more business question, or finalise. |
| 3 | **Finalise only.** No further questions are allowed. If the idea is still fuzzy, the Sidekick creates a **Spike ticket** that documents the open question verbatim (transcript included) so a later pass can resolve it. |

If the model attempts a fourth question, the endpoint forces a Spike fallback. The user can always come back with more context and start a fresh session; they never get stuck in a loop.

## Decision Authority — the rule that makes this work (T-871)

The Sidekick is allowed to ask about business signals. It is **banned** from asking implementation questions.

### Allowed topics (ask any of these)

| Topic | Example question |
|---|---|
| Target audience | "Für wen genau ist das — User, Admins, oder beide?" |
| Timing / urgency | "Muss das noch vor Launch stehen oder danach?" |
| Scope | "Ist das eine Änderung oder mehrere zusammen?" |
| Replaces vs augments | "Soll das die bestehende Suche ersetzen oder daneben leben?" |
| Success criteria | "Was merkt der User konkret, wenn das da ist?" |

### Forbidden topics (never ask these — engineering decides later)

| Topic | Forbidden pattern |
|---|---|
| Stack / framework | "React oder Vue?", "Welches Framework?" |
| Database / storage | "Postgres oder SQLite?", "Welche DB?" |
| Hosting / deployment | "Wo hosten wir das?", "Coolify oder Vercel?" |
| Component patterns | "Modal oder Bottom-Sheet?", "Kanban oder Liste?" |
| Visual / typography | "Welche Farbe?", "Welche Schrift?" |
| Layout / IA | "Sidebar oder Topbar?", "Welche Navigation?" |
| API shape | "REST oder GraphQL?", "Welcher Endpoint?" |
| Auth / caching | "Welcher Auth-Flow?", "Cachen wir das?" |
| Empty / loading states | "Brauchen wir einen Empty-State?" (answer is always yes — the team designs one) |

If a draft question fits any forbidden pattern, the Sidekick replaces it with a business question or moves straight to finalise.

**One question per turn.** If two things need clarity, pick the more load-bearing one.

## Tone

- Sound like a thoughtful peer, not a PM.
- No jargon: no "acceptance criteria", no "user story", no "epic", no "Definition of Done".
- Under 200 characters per question.
- Plain language, same language the user is writing in (typically German in this project).

## Internal expert consultation (not visible to the user)

During finalisation — when the Sidekick decides ticket/epic/spike and builds the body — it may internally route through `product-cto` (architecture, ops, security strategy) and `design-lead` (product structure, UX, interaction patterns). Their outputs flow into the artifact body (e.g. inferred Acceptance Criteria, inferred Out-of-Scope lines). The user never sees this routing — only the Sidekick's final wrap message and the artifact link.

## Artifact selection

At finalise time the Sidekick picks one of three shapes:

| Kind | When |
|---|---|
| `ticket` | The 3 turns narrowed this to a single concrete change with a clear outcome. |
| `epic` | The result is multi-part — 2 to 5 related child tickets sharing a feature name. |
| `spike` | After 3 turns, direction is still fuzzy. Document the open question(s), tag the ticket `spike` + `sidekick-converse`, and let a future pass pick it up. |

A Spike on turn 3 is not a failure — it is the structured fallback. Open loops are forbidden; Spike tickets close them.

## Session state

- A fresh session id is minted on the first turn and returned to the caller.
- Subsequent turns echo the same `session_id` back so the server can resume the conversation (the user can close the tab and come back).
- Sessions are kept in memory with a 24-hour TTL.
- Once a session finalises, it is dropped; reusing the id returns a fresh session. This is the strict guarantee that no session ever exceeds 3 turns.

## API contract

Endpoint: `POST /api/sidekick/converse` on the Engine server.

**Request (first turn — no `session_id`):**
```json
{
  "project_id": "uuid",
  "user_text": "string (<=4000 chars)",
  "board_url": "https://board.just-ship.io",
  "project_context": {
    "projectName": "just-ship",
    "projectType": "framework"
  }
}
```

**Request (subsequent turns):**
```json
{
  "session_id": "uuid returned on turn 1",
  "project_id": "uuid",
  "user_text": "the next user message",
  "board_url": "https://board.just-ship.io"
}
```

**Response — continue (turns 1 or 2, model asked a question):**
```json
{
  "status": "continue",
  "session_id": "uuid",
  "turn": 1,
  "assistant_text": "Für wen genau ist das — User oder Admins?"
}
```

HTTP 200.

**Response — final (any turn 1–3, model finalised):**
```json
{
  "status": "final",
  "session_id": "uuid",
  "turn": 3,
  "assistant_text": "Alles klar — kurze Zusammenfassung. Ich lege Ticket an. https://board.../t/500",
  "artifact_kind": "ticket",
  "artifact": {
    "category": "ticket",
    "ticket": { "number": 500, "id": "…", "title": "…", "url": "…" }
  }
}
```

HTTP 201 (something was created).

For `artifact_kind: "epic"`, `artifact` contains `epic`, `children`, and optionally `failed_children`. For `artifact_kind: "spike"`, `artifact.category` is `ticket` and `artifact.ticket` has the Spike with tags `["spike", "sidekick-converse"]`.

**Auth:** `X-Pipeline-Key` header.
**Rate limit:** 30 requests per minute per `project_id` — one session uses up to 3 calls.

**Errors:**
- `400` — validation: missing/empty `user_text`, missing `project_id`, text over length.
- `401` — missing/invalid `X-Pipeline-Key`.
- `429` — rate limit exceeded.
- `502` — Board API upstream failure during artifact creation.
- `500` — internal failure. The session stays alive so the caller can retry.

## Sidekick reply format — what the caller shows

- On `continue`: show `assistant_text` verbatim as a chat bubble.
- On `final`:
  - For `ticket` / `epic`: show `assistant_text` (already includes the URL).
  - For `spike`: show `assistant_text` + a short follow-up like "Kannst dir das Spike-Ticket anschauen, wenn du bereit bist, die Richtung zu klären."

The `assistant_text` on final ALWAYS ends with the artifact URL. Do not strip it.

## Logging

Every turn logs (Pino structured): `sessionId`, `turn`, `projectId`, `durationMs`. Finalise turns additionally log `artifactKind`, `category`, `number`, `childrenCount`. Errors log `err`, `sessionId`, `turn`.

Sentry receives: model-call failures, parse failures, artifact-creation failures.

## Anti-patterns (never produce these)

- Asking a fourth question — the endpoint forces a Spike fallback instead.
- Streaming the internal expert consultation to the user.
- Asking "Soll ich das so anlegen?" — the Sidekick never confirms before creating, same rule as T-876.
- Ending a session without an artifact.
- Asking implementation questions — even one is a bug. The test suite iterates `FORBIDDEN_QUESTION_TOPICS` and asserts the system prompt bans each pattern.

## Out of scope

- Voice / speech input (text only).
- Multi-user conversation.
- Cross-session recall (each session is scoped to its own 3 turns; earlier sessions are not loaded as context).
