# Sidekick: project_id aus Tool-Args entfernen — Design

**Datum:** 2026-04-27
**Status:** Spec — bereit für Plan
**Scope:** Engine-Code (Tool-Schemas, System-Prompt, Snapshot-Test)
**Out-of-Scope:** Auth-Hardening, Telemetrie, Conversation-History-Migration, UI-Feedback (alle separates Follow-up-Ticket)

---

## Problem

Der Sidekick-Tool-Layer verlangt vom Modell, in jedem Tool-Call (`create_ticket`, `create_epic`, `start_conversation_thread`, `run_expert_audit`, `consult_expert`, `start_sparring`) eine `project_id` zu schreiben. Im System-Prompt sind diese als `project_id: "<active>"` Literal-Platzhalter modelliert. Es findet keine Substitution statt.

**Konsequenz heute:**

- Das Modell sieht 20+ Few-Shot-Beispiele mit `project_id: "<active>"` und ist gezwungen, die ID selbst zu erzeugen.
- Das Modell rät — entweder den Literal-String "<active>" (→ 400 Invalid UUID) oder eine UUID aus dem Konversations-Kontext (z.B. aus einem angehängten Bild, das Tickets aus anderen Workspaces zeigt → 403 forbidden).
- Bei Tool-Fail loopt der SDK bis zu 4× über denselben Fehler, bevor er aufgibt. Der User sieht nur "verarbeite", dann "max_turns" — keinen Hinweis, was schiefging.

**Beobachteter Incident:** Browser-Sidekick im Board, User pasted Bild + Text, Chat hängt 35s, endet mit `max_turns`. Engine-Logs zeigen 4× `400 Invalid UUID` auf `create_ticket` — Modell hat `project_id: "<active>"` als Literal geschickt.

**Bug-Klasse:** strukturell. Solange das Modell `project_id` selbst schreiben muss, wird es ein Fenster für Halluzination/Verwechslung geben.

---

## Lösung

**B1 — Strict: Das Modell schreibt nie eine `project_id`.**

Der Server stempelt `project_id` aus `ctx.projectId` (gesetzt durch den HTTP-Handler aus dem Request-Context). Das Tool-Surface des Page-Sidekicks ist projekt-implizit: alle Tool-Calls beziehen sich auf das aktive Projekt der Seite, auf der der Sidekick eingebettet ist.

**Cross-Project-Epics fallen aus dem Tool-Surface raus.** Der zugrundeliegende Code-Pfad (`validateCreateRequest` im `sidekick-create`-Primitiv, aus T-903) bleibt als Library-Funktion erhalten — er wird vom Page-Sidekick-Tool nicht mehr getriggert. Wenn später ein Workspace-Sidekick gebaut wird, kann er ein eigenes Tool freischalten (`create_workspace_epic` oder ähnlich), das den Pfad nutzt.

---

## Section 1 — Tool-Schema-Änderungen

**Datei:** `pipeline/lib/sidekick-reasoning-tools.ts`

### Schemas (Zod) — was sich ändert

| Schema | Vorher | Nachher |
|---|---|---|
| `CreateTicketSchema` | `{ title, body, priority, project_id, tags? }` | `{ title, body, priority, tags? }` |
| `CreateEpicSchema` | `{ title, body, children: [{title, body, priority?, tags?, project_id?}], project_id: union(uuid, null), priority, tags? }` | `{ title, body, children: [{title, body, priority?, tags?}], priority, tags? }` |
| `StartConversationThreadSchema` | `{ topic, initial_context, project_id }` | `{ topic, initial_context }` |
| `RunExpertAuditSchema` | `{ scope, expert_skill, project_id }` | `{ scope, expert_skill }` |
| `ConsultExpertSchema` | `{ question, expert_skill, project_id }` | `{ question, expert_skill }` |
| `StartSparringSchema` | `{ topic, experts, project_id? }` | `{ topic, experts }` |
| `UpdateThreadStatusSchema` | unverändert (hat kein `project_id`) | unverändert |
| `CreateProjectSchema` | unverändert (Sonderfall: erzeugt das Projekt selbst, hat `workspace_id` statt `project_id`) | unverändert |

### `ToolContext` — neues Feld

```ts
interface ToolContext {
  apiUrl: string;
  apiKey: string;
  workspaceId: string;
  projectId: string;          // ← NEU, required für alle Tools außer create_project
  userId?: string;
  boardUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}
```

`projectId` ist required für jeden Chat-Turn. Der HTTP-Handler in `pipeline/server.ts` (`/sidekick/chat`-Endpoint) liest `project_id` aus dem Request-Body und stempelt sie in den `ToolContext`. **Heute fehlt:** Server-seitige Validierung, dass die `project_id` zum aktiven Workspace gehört. Diese Validierung kommt im Follow-up-Ticket (Auth-Hardening), **nicht** in diesem Ticket.

### Handler-Pattern

Alle Handler außer `execCreateProject` ersetzen `args.project_id` durch `ctx.projectId`:

```ts
async function execCreateTicket(ctx, args) {
  const req: CreateRequest = {
    category: "ticket",
    project_id: ctx.projectId,   // ← war: args.project_id
    ...(ctx.boardUrl ? { board_url: ctx.boardUrl } : {}),
    ticket: { title: args.title, body: args.body, priority: args.priority, ... },
  };
  ...
}
```

**`execCreateEpic`** wird strukturell einfacher: kein `project_id: null`-Pfad mehr im Tool-Surface, keine per-Child Project-Override mehr. Children erben automatisch `ctx.projectId`. Der Code-Pfad in `validateCreateRequest` für cross-project bleibt erhalten — er wird vom Page-Sidekick-Tool aber nicht mehr getriggert.

**`execCreateProject`** bleibt unverändert. Es nutzt `args.workspace_id`, weil es ja gerade ein Projekt erzeugt — dort gibt es keine `ctx.projectId`.

### Tool-Description-Updates

Die `description`-Texte in `SIDEKICK_REASONING_TOOLS` (siehe `sidekick-reasoning-tools.ts:686+`) müssen aktualisiert werden, sodass sie nicht mehr von `project_id`-Argumenten reden. Konkret z.B. die Beschreibung von `create_epic` heute:

> "Create an epic plus its child tickets when the user wants multiple connected changes (feature with several parts, cross-cutting initiative). Pass `project_id: null` for workspace-scoped cross-project epics; every child must then carry its own project_id."

Wird zu:

> "Create an epic plus its child tickets when the user wants multiple connected changes (feature with several parts, cross-cutting initiative). The epic and all children land in the active project."

---

## Section 2 — System-Prompt & Few-Shot-Beispiele

**Datei:** `pipeline/lib/sidekick-system-prompt.ts`

### Few-Shot-Beispiele — `<active>` raus

Alle 20+ Beispiele in `SIDEKICK_PROMPT_EXAMPLES`: das `project_id: "<active>"`-Feld aus den `args_sketch`-Strings entfernen. Beispiel:

```ts
// VORHER:
{
  input: "Fix the typo in the header on /pricing — it says \"recieve\" instead of \"receive\".",
  tool: "create_ticket",
  args_sketch: `{ title: "Fix typo on /pricing header", body: "...", priority: "low", project_id: "<active>" }`,
}

// NACHHER:
{
  input: "Fix the typo in the header on /pricing — it says \"recieve\" instead of \"receive\".",
  tool: "create_ticket",
  args_sketch: `{ title: "Fix typo on /pricing header", body: "...", priority: "low" }`,
}
```

Bei `create_epic` zusätzlich: kein `project_id: "<active>"` auf Top-Level, keine `project_id` auf Children.

**Sonderfall `create_project`:** Das Beispiel zeigt heute `workspace_id: "<active>"`. Hier ist `<active>` ebenfalls problematisch (Modell könnte den Literal-String schicken). Drei Optionen:

a) `<active>` durch echte `ctx.workspaceId` substituieren in `buildSidekickSystemPrompt`. Erfordert dass die UUID in den Prompt landet.
b) Den Wortlaut umstellen auf `workspace_id: "<the active workspace_id from the per-turn context block above>"` — eine Anweisung an das Modell, statt eines Markers.
c) Die Per-Turn-Context-Block bekommt eine Zeile `Active workspace ID: <UUID>`, das Beispiel referenziert das.

**Empfehlung:** Kombination aus (b) und (c). Per-Turn-Context-Block bekommt die echte `workspace_id`, der Few-Shot referenziert sie als Englisch-Phrase. Der Snapshot-Test-Guard (Section 3) erkennt die Englisch-Phrase nicht als Platzhalter.

### Neuer Abschnitt im Prompt-Body

Direkt vor "Few-shot grounding" wird ein neuer Abschnitt eingefügt:

```markdown
## Project context

You are always operating in the active project — the one the user is looking at. Tools that create or reference project-scoped artifacts (`create_ticket`, `create_epic`, `start_conversation_thread`, `run_expert_audit`, `consult_expert`, `start_sparring`) **do not** take a `project_id` argument. The server stamps it from the active context. Do not invent, guess, or pass project IDs.

Two exceptions:
- `create_project` takes `workspace_id` because it creates a new project inside the workspace.
- `update_thread_status` takes `thread_id` because it targets a specific thread.
```

Das ist die zweite Verteidigungslinie: selbst wenn das Modell ein nicht-existierendes Feld halluziniert, hat der Prompt eine explizite Klausel, die das verbietet.

### `buildSidekickSystemPrompt` — Signatur erweitern

```ts
buildSidekickSystemPrompt(opts: {
  projectName?: string;
  projectType?: string;
  pageUrl?: string;
  pageTitle?: string;
  workspaceId?: string;        // ← NEU, für die Per-Turn-Context-Block-Zeile "Active workspace ID: ..."
}): string
```

Der HTTP-Handler reicht `workspaceId` aus dem Request durch.

### Version-Bump

`SIDEKICK_PROMPT_VERSION`: `"v3"` → `"v4"`. Snapshot-Test in `sidekick-system-prompt.test.ts` muss neu generiert werden — das ist eine intentionale, materielle Prompt-Änderung.

---

## Section 3 — Snapshot-Test-Guard gegen Platzhalter-Lecks

**Datei:** `pipeline/lib/sidekick-system-prompt.test.ts`

Neuer Test, der explizit prüft, dass der gerenderte Prompt keine nicht-substituierten Platzhalter enthält:

```ts
test("rendered prompt contains no unresolved placeholders", () => {
  const prompt = buildSidekickSystemPrompt({
    projectName: "Test Project",
    projectType: "web",
    workspaceId: "00000000-0000-0000-0000-000000000000",
    pageUrl: "https://example.com",
    pageTitle: "Test Page",
  });

  // Forbidden placeholder patterns. If a few-shot example or context block
  // ever leaves an unsubstituted "<...>" marker visible to the model, this
  // test catches it before merge.
  const FORBIDDEN_PATTERNS = [
    /<active>/,
    /<workspace>/,
    /<project>/,
    /<TODO>/,
    /\{\{[^}]+\}\}/,  // Mustache-style {{var}}
  ];

  for (const pattern of FORBIDDEN_PATTERNS) {
    expect(prompt).not.toMatch(pattern);
  }
});
```

**Begründung:** `<active>` ist 8 Monate durch CI durchgekommen, weil der Snapshot-Test den String "<active>" als legitimen Prompt-Inhalt akzeptierte. Dieser Guard schließt die Tür.

---

## Non-Goals (explizit out-of-scope)

| Punkt | Wo behandelt |
|---|---|
| Authorization-Klausel für `ctx.projectId` (Server-Validation, dass User Zugriff aufs Projekt hat) | Follow-up-Ticket "Sidekick Auth-Hardening" |
| Telemetrie auf `tool_result.is_error: true` mit Sentry-Tags | Follow-up-Ticket "Sidekick Auth-Hardening" |
| Conversation-History-Verträglichkeit (alte `tool_use`-Blöcke mit `project_id` in History) | Follow-up-Ticket — verifizieren ob Zod's `.strip()`-Default das schon stillschweigend wegschneidet |
| Rollback-Pfad-Dokumentation | Follow-up-Ticket (ist Doc, kein Code) |
| `maxTurns: 4` Magic-Constant | Follow-up-Ticket "Sidekick Tool-loop Budget" |
| UI-Feedback im Board-Widget ("verarbeite" zu lange ohne Updates) | `just-ship-board` Repo, eigenes Ticket |
| Cross-Project-Epics als Page-Sidekick-Feature | Bewusst gestrichen. Future-Workspace-Sidekick kann eigenes Tool freischalten. |
| Storage-Migration | Keine. Bestehende Threads/Chats bleiben unverändert. |
| `/converse`-Endpoint | Unverändert. |

**Zusicherung:** Bestehende Threads (siehe Board-Sidekick-Liste mit "Darstellungsprobleme bei klei…", "Ticket-Layout Problem behebt…", etc.) bleiben 1:1. Thread-Storage-Layer wird nicht angefasst. SSE-Frame-Format unverändert. Image-Upload unverändert. Tool-Roster (8 Tools) unverändert in Anzahl/Namen.

---

## Test-Plan

### Unit Tests

1. **Schema-Validation:** Für jedes der 5 betroffenen Tool-Schemas ein Test, dass `project_id` im Args-Objekt zu einem `ZodError` führt (oder still gestrippt wird, je nach Zod-Mode-Entscheidung).
2. **Handler-Stempel:** Für jeden Handler ein Test, dass der ausgehende `CreateRequest` die `project_id` aus `ctx.projectId` trägt, nicht aus `args`.
3. **Snapshot-Test-Guard:** Der neue Test in Section 3.
4. **Snapshot-Test:** `SIDEKICK_PROMPT_VERSION = "v4"` Snapshot-File neu generieren.

### Integration Tests

5. **End-to-end Tool-Call durch den SDK-Adapter:** Mit Mock-MCP-Server prüfen, dass ein `create_ticket`-Call ohne `project_id` im Args durchgeht und die richtige `project_id` im Board-API-Request landet.
6. **`create_epic` ohne `project_id`:** prüfen dass alle Children die richtige `project_id` erben.

### Smoke Test (manuell, vor Merge)

7. **Lokaler Sidekick-Chat-Turn:** "Fix typo in header" → Ticket landet im aktiven Projekt, ohne dass das Modell `project_id` in den Tool-Call schreibt.
8. **Bestehender Thread:** einen alten Thread aus dem Board-Sidekick öffnen, neue Nachricht schicken, prüfen dass die Antwort durchläuft (verifiziert Conversation-History-Verträglichkeit). Falls dieser Test fehlschlägt → Conversation-History-Verträglichkeit muss in dieses Ticket statt ins Follow-up.

---

## Definition of Done

- [ ] Alle 5 Tool-Schemas in `sidekick-reasoning-tools.ts` ohne `project_id` (außer `create_project` mit `workspace_id` und `update_thread_status` mit `thread_id`).
- [ ] `ToolContext.projectId` als required Feld; alle Handler nutzen es.
- [ ] `SIDEKICK_PROMPT_EXAMPLES`: `<active>` aus allen `args_sketch`-Strings entfernt.
- [ ] Neuer "Project context"-Abschnitt im `PROMPT_BODY`.
- [ ] `buildSidekickSystemPrompt` nimmt `workspaceId` entgegen, Per-Turn-Context-Block enthält `Active workspace ID: <UUID>`.
- [ ] `SIDEKICK_PROMPT_VERSION = "v4"`.
- [ ] Snapshot-Test-Guard ergänzt; alle bestehenden Tests grün.
- [ ] HTTP-Handler in `pipeline/server.ts` reicht `project_id` und `workspace_id` aus dem Request-Body in den `ToolContext` durch (ohne neue Auth-Validierung — das ist Follow-up).
- [ ] Smoke-Test 7 + 8 manuell durchgelaufen.
- [ ] Folge-Ticket "Sidekick Auth-Hardening" angelegt mit den 4 Out-of-Scope-Punkten als Acceptance Criteria.

---

## Rollback

Feature-Flag `SIDEKICK_REASONING_ENABLED=false` setzen → Engine fällt auf den Legacy-Tool-less-Chat-Pfad zurück. Kein Code-Revert, kein Git-Backout. Default ist heute `false` (siehe `sidekick-chat.ts:isSidekickReasoningEnabled`); Production setzt vermutlich auf `true`.

**Rollback-Trigger:** Ein post-Deploy-Spike auf `tool_failure_rate > 5%` über 15 min, oder Sentry-Alerts auf `prompt_version=v4` mit `error_code=validation_error`. (Beobachtung erfolgt im Follow-up-Ticket — in diesem Ticket gibt's noch kein Telemetrie-Hook.)

---

## Bezüge

- **Bug-Diskussion:** Konversation 2026-04-27 mit dem User, ausgelöst durch Browser-Sidekick-Hänger.
- **T-903:** Workspace-scoped Epic Invariant (validiert in `validateCreateRequest`) — Code-Pfad bleibt erhalten als Library-Funktion, ist aber nicht mehr Teil des Page-Sidekick-Tool-Surface.
- **T-924:** Threads + Conversations als First-Class Engine-Resource. **Wechselwirkung:** Wenn T-924 die `project_id` in einer Thread-Resource speichert, muss der HTTP-Handler nach Implementierung von T-924 die `project_id` aus der Thread-Resource ziehen statt aus dem Chat-Request-Body. Das ist ein Migrations-Punkt, kein Konflikt — die Tool-Surface-Änderung in B1 ist unabhängig davon.
- **T-979:** Klassifikator-Architektur ersetzt durch Reasoning-Tools — `<active>`-Platzhalter sind ein Erbstück aus dieser Migration.
