# Human-in-the-Loop: Agent-Rückfragen via Board + Telegram

**Datum:** 2026-03-19
**Status:** Draft

---

## Problem

Claude Code arbeitet im Pipeline-Modus (VPS) und lokal komplett autonom. Bei komplexen Features gibt es Entscheidungen, die der Agent nicht alleine treffen sollte — Architektur-Fragen, UX-Entscheidungen, unklare Requirements. Aktuell macht der Agent dann eine konservative Annahme oder scheitert, was zu unnötigem Mehraufwand führt.

## Lösung

Ein universeller Human-in-the-Loop Kanal: Der Agent kann jederzeit eine strukturierte Frage stellen. Die Frage wird persistiert, über alle konfigurierten Kanäle gepusht (Telegram, Board, Terminal), und die Pipeline pausiert bis die Antwort kommt. Danach wird die Session resumed.

## Entscheidungen

| Frage | Entscheidung | Begründung |
|---|---|---|
| Blocking vs. Non-blocking | Blocking — Agent pausiert komplett | Vermeidet doppelte Arbeit |
| Kommunikationskanal | Telegram + Board-UI | Telegram für schnelle Reaktion, Board für Dokumentation |
| Timeout-Verhalten | Ticket pausieren, Worker-Slot freigeben | Worker wird nicht blockiert |
| Aufweck-Mechanismus | Webhook von Board-API an Pipeline-Server | Sofortige Reaktion, passt zum Event-Pattern |
| Frage-Format | Strukturiert mit Optionen + Freitext | Inline-Buttons für schnelle Antwort |
| Anzahl Fragen pro Ticket | Beliebig viele | Agent kann mehrmals pausieren |
| Lokal vs. VPS | Immer persistenter Flow wenn Board konfiguriert | Universeller Kanal, nicht nur VPS |
| Ticket-Status | Bleibt `in_progress`, `pipeline_status: 'paused'` | Kein neuer Status nötig |
| UI-Indikator | Sprechblasen-Icon + farbiger Rahmen statt Pause-Button | Kommuniziert "Nachricht für dich", nicht "klick um zu pausieren" |

---

## Architektur

### Gesamtflow

```
Agent ruft ask-human auf (Bash)
        │
        ▼
Script postet Frage an Board-API
  → Board speichert in ticket_questions (Pipeline-DB)
  → Board ruft Telegram Bot API direkt (sendMessage)
  → Board feuert Desktop Notification
  → Script gibt "__WAITING_FOR_INPUT__" zurück
        │
        ▼
PostToolUse Hook erkennt Marker
  → Hook gibt { continue: false, stopReason: 'human_in_the_loop' }
  → SDK-Session stoppt, query() Generator endet
        │
        ▼
run.ts prüft stopReason
  → 'human_in_the_loop': Return { status: 'paused', sessionId }
  → Alles andere: normaler Success/Failure-Flow
        │
        ▼
Worker/Server speichert session_id am Ticket
  → pipeline_status → 'paused'
  → Worker-Slot wird freigegeben
  → Worker pollt weiter für andere Tickets
        │
        ▼
    ⏸️  PAUSE — Minuten, Stunden, Tage (max 7 Tage Default)
        │
        ▼
User antwortet (Telegram oder Board-UI)
  → Board-API speichert Antwort (WHERE answer IS NULL)
  → Board-API sendet Webhook an Pipeline-Server
        │
        ▼
Pipeline-Server empfängt POST /api/answer
  → Liest session_id vom Ticket
  → Startet query() mit resume: sessionId
  → Prompt: "Antwort auf deine Frage: {answer}"
  → pipeline_status → 'running'
        │
        ▼
Agent sieht Konversationshistorie + Antwort
  → arbeitet weiter
```

### Session Resume: Stabile API

Statt der unstabilen `unstable_v2_resumeSession()` nutzen wir die stabile `query()` API mit der `resume` Option:

```typescript
// Erstlauf: persistSession aktivieren
for await (const message of query({
  prompt: orchestratorPrompt,
  options: {
    persistSession: true,
    // ... restliche Config
  },
})) {
  // Session-ID aus Messages extrahieren
  if (message.session_id) sessionId = message.session_id;
}

// Resume nach Antwort:
for await (const message of query({
  prompt: `Antwort auf deine Frage: ${answer}`,
  options: {
    resume: sessionId,
    persistSession: true,
    // ... restliche Config
  },
})) {
  // Normaler Message-Loop
}
```

### Fallback: Checkpoint & Restart

Falls `resume` fehlschlägt (Session-Dateien gelöscht, SDK-Update), startet die Pipeline einen frischen Run mit injiziertem Kontext:

> "Du arbeitest an T-{number}. Bisheriger Stand: [git diff main]. Du hattest gefragt: [Frage]. Antwort: [Antwort]. Mach weiter wo du aufgehört hast."

Wichtig: `git diff main` (nicht `main...HEAD`) um auch uncommittete Änderungen einzuschließen.

---

## Voraussetzungen: DB-Migration

Die bestehende DB hat einen CHECK constraint und Zod-Validation die `'paused'` nicht kennen:

```sql
-- 001_core_tables.sql, Zeile 101:
CHECK (pipeline_status IS NULL OR pipeline_status IN ('queued','running','done','failed'))

-- → Muss erweitert werden:
CHECK (pipeline_status IS NULL OR pipeline_status IN ('queued','running','done','failed','paused'))
```

```typescript
// apps/board/src/lib/constants.ts:
export const PIPELINE_STATUSES = ["queued", "running", "done", "failed", "paused"] as const;

// apps/board/src/lib/validations/ticket.ts — Zod-Schema passt sich automatisch an
```

---

## Komponenten

### 1. `ask-human` CLI Script

Bash-Script im Projekt, aufgerufen vom Agent via Bash-Tool.

**Interface:**
```bash
ask-human \
  --question "Soll die API REST oder GraphQL sein?" \
  --option "REST — passt zum bestehenden Stack" \
  --option "GraphQL — flexibler für Frontend" \
  --context "Baue User-Profile Endpunkt, brauche Architektur-Entscheidung"
```

**Modus-Erkennung:**
- Board konfiguriert (`project.json` hat `pipeline.board_url`): Voller persistenter Flow (POST an Board-API, Marker-Output)
- Kein Board: Fallback auf Terminal-Output (Agent stellt Frage direkt im Chat)

**Error-Handling:**
- Board-API nicht erreichbar → Retry (3x mit Backoff), dann Fallback auf Terminal-Output + Warnung
- Board-API gibt Fehler zurück → Kein `__WAITING_FOR_INPUT__` Marker, Agent sieht Fehlermeldung und entscheidet selbst (konservative Annahme oder alternatives Vorgehen)

**Environment-Variablen (vom Worker/Server gesetzt, via `query()` Options `env` weitergereicht):**
- `TICKET_NUMBER` — aktuelles Ticket
- `BOARD_API_URL` — Board-API Basis-URL
- `PIPELINE_KEY` — Auth für Board-API

`executePipeline()` in `run.ts` muss diese Env-Vars explizit an die `query()` Options übergeben, damit sie im Agent-Subprocess verfügbar sind.

### 2. Datenmodell

**Datenbank: Pipeline-DB (`wsmnutkobalfrceavpxs`)** — wie alle Ticket-Daten.

**Migration 007: `pipeline_status` erweitern + `session_id` + `ticket_questions`**
```sql
-- CHECK constraint erweitern
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_pipeline_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_pipeline_status_check
  CHECK (pipeline_status IS NULL OR pipeline_status IN ('queued','running','done','failed','paused'));

-- Session-ID für Resume
ALTER TABLE tickets ADD COLUMN session_id TEXT;
```

**Neue Tabelle: `ticket_questions`**
```sql
CREATE TABLE ticket_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES tickets(id) NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) NOT NULL,
  question TEXT NOT NULL,
  options JSONB,              -- [{ key: "A", label: "REST — passt zum Stack" }, ...]
  context TEXT,               -- Was der Agent gerade macht
  answer TEXT,                -- Antwort (NULL solange offen)
  answered_via TEXT,          -- 'telegram' | 'board'
  created_at TIMESTAMPTZ DEFAULT now(),
  answered_at TIMESTAMPTZ
);

-- RLS Policy (Workspace-Isolation, analog zu tickets — nutzt bestehende Helper-Funktion)
ALTER TABLE ticket_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON ticket_questions
  USING (public.is_workspace_member(workspace_id));

-- Indexes
CREATE INDEX idx_ticket_questions_ticket ON ticket_questions(ticket_id);
CREATE INDEX idx_ticket_questions_open ON ticket_questions(ticket_id) WHERE answer IS NULL;
```

**Cleanup:** Wenn ein Ticket auf `status: 'done'` wechselt, wird `session_id` auf `NULL` gesetzt. Ein Cron-Job (oder manuell) räumt alte Session-Dateien unter `~/.claude/projects/` auf.

### 3. Board-API Endpunkte

```
POST   /api/tickets/:number/questions     — Agent stellt Frage
  Auth: X-Pipeline-Key (nur Pipeline/Script)

PATCH  /api/tickets/:number/questions/:id  — User beantwortet
  Auth: Supabase Session (Board-UI) ODER X-Pipeline-Key (Telegram-Bot)
  Guard: WHERE answer IS NULL (verhindert Doppel-Antworten)
  → Trigger: Webhook POST an Pipeline-Server /api/answer
```

### 4. Pipeline-Änderungen

**`run.ts`:**
- `persistSession: true` aktivieren (aktuell `false` in Zeile 131 — muss geflippt werden; Disk-Space-Implikation beachten, siehe Cleanup)
- Session-ID aus gestreamten Messages extrahieren und speichern
- Env-Vars `TICKET_NUMBER`, `BOARD_API_URL`, `PIPELINE_KEY` an `query()` Options `env` übergeben
- PostToolUse Hook auf `Bash`: erkennt `__WAITING_FOR_INPUT__` Marker im Tool-Response
- Bei Marker: Hook setzt Closure-Variable `pauseReason = 'human_in_the_loop'` und gibt `{ continue: false, stopReason: 'human_in_the_loop' }` zurück
- **stopReason-Erkennung:** Da `stopReason` nicht auf `SDKResultMessage` exponiert wird, nutzt `run.ts` die Closure-Variable aus dem Hook-Callback. Nach dem Query-Loop prüft `run.ts`: wenn `pauseReason === 'human_in_the_loop'` → Return `{ status: 'paused', sessionId }`, sonst normaler Success/Failure-Flow
- Neuer Code-Pfad `resumePipeline(sessionId, answer)`: ruft `query()` mit `resume: sessionId` auf, überspringt Branch-Erstellung

**`PipelineResult` Interface-Änderung:**
```typescript
export interface PipelineResult {
  status: "completed" | "failed" | "paused";  // + 'paused'
  exitCode: number;
  branch: string;
  project: string;
  failureReason?: string;
  sessionId?: string;  // Neu: für Session Resume
}
```

**`worker.ts`:**
- `pipeline_status: 'paused'` als gültigen End-State behandeln (nicht als Fehler, kein consecutiveFailures++)
- Bei `paused`: session_id via Board-API PATCH am Ticket speichern, `pipeline_status: 'paused'` setzen
- Worker-Slot freigeben (Promise resolven), weiter pollen für andere Tickets
- Consecutive-Failure-Counter wird bei `paused` NICHT inkrementiert

**`server.ts`:**
- Neuer Endpunkt `POST /api/answer`:
  - Empfängt `{ ticket_number, question_id, answer }`
  - Auth: `X-Pipeline-Key`
  - Idempotenz-Check: `runningTickets` Set
  - Liest `session_id` vom Ticket
  - Ruft neuen `resumePipeline(sessionId, answer)` in `run.ts` auf (nicht `executePipeline`)
  - Setzt `pipeline_status: 'running'`
  - Fallback: Wenn `resume` fehlschlägt → Checkpoint & Restart via `executePipeline()` mit Antwort-Kontext

### 5. Board-UI Änderungen

**Ticket-Card:**
- `pipeline_status === 'paused'`: Amber/gelber Rahmen um die Card
- Action-Button wechselt von Spinner zu Sprechblasen-Icon
- Klick auf Sprechblase öffnet Frage-Panel

**Frage-Panel (am Ticket):**
- Zeigt Frage + Kontext
- Options-Buttons (wenn vorhanden)
- Freitext-Input
- Antwort-History (wenn mehrere Fragen gestellt wurden)

### 6. Telegram-Bot Erweiterungen

**Notification-Mechanismus: Board-API ruft Telegram Bot API direkt.**

Wenn eine Frage erstellt wird, ruft die Board-API `sendMessage` auf der Telegram Bot API auf (Bot-Token ist in der Workspace-Config gespeichert). Das ist einfacher als ein Realtime-Listener und erfordert keine persistente Verbindung vom Bot.

**Nachrichtenformat:**
```
T-123: Neuen User-Profile Endpunkt bauen

Soll die neue API REST oder GraphQL sein?

  [A] REST — passt zum bestehenden Stack
  [B] GraphQL — flexibler für Frontend

Kontext: Ich baue den Endpunkt und muss
   mich für die API-Architektur entscheiden.
```

- Inline-Keyboard mit Options-Buttons
- Zusätzlicher "Freitext"-Button falls keine Option passt
- Antwort wird an Board-API gesendet (PATCH `/api/tickets/:number/questions/:id`) → Webhook an Pipeline-Server

**Callback-Handling:** Der bestehende Telegram-Bot bekommt einen Callback-Query-Handler für die Inline-Buttons und leitet Antworten an die Board-API weiter.

### 7. Orchestrator-Prompt Ergänzung

Einheitliche Anweisung, unabhängig vom Modus:

> "Wenn du bei einer Entscheidung unsicher bist, die das Ergebnis wesentlich beeinflusst — Architektur, UX, Scope — nutze `ask-human` via Bash. Stelle klare Fragen mit konkreten Optionen. Triff keine Annahmen bei wichtigen Weichenstellungen."

---

## Board-UI: Pipeline-Status Icons

| pipeline_status | Icon | Aktion bei Klick | Card-Rahmen |
|---|---|---|---|
| `null` | Play | Pipeline starten | Standard |
| `running` | Spinner | — (keine Aktion) | Standard |
| `paused` | Sprechblase | Frage-Panel öffnen | Amber/Gelb |
| `done` | Check | — | Standard |
| `failed` | Retry | Pipeline neu starten | Rot |

---

## Zukunft: Settings

Konfigurierbarer Human-in-the-Loop als Projekt- oder User-Setting:

```yaml
ask-human:
  enabled: true
  channels:
    telegram: true
    board: true
    terminal: true     # Phase 2
  timeout: 7d          # Default: 7 Tage, dann auto-fail
```

---

## Technische Risiken

| Risiko | Mitigation |
|---|---|
| `query({ resume })` funktioniert nicht wie erwartet | Fallback: Checkpoint & Restart mit `git diff main` Kontext |
| Session-State wird zu groß (viele Fragen = viel Kontext) | Token-Limit monitoren, ggf. Compact vor Resume |
| User antwortet nie | Default-Timeout 7 Tage, dann auto-fail. Ticket bleibt paused, Worker nicht blockiert |
| Mehrere Fragen gleichzeitig offen | Nicht erlaubt — Agent stellt eine Frage, wartet, arbeitet weiter, stellt ggf. nächste |
| Telegram-Bot Downtime | Board-UI als Fallback immer verfügbar |
| Doppel-Antwort (Telegram + Board gleichzeitig) | `WHERE answer IS NULL` Guard auf PATCH Endpoint |
| Session-Dateien akkumulieren auf VPS | Cleanup: `session_id = NULL` bei done, Cron für alte Session-Files |
| Branch-Konflikte nach langer Pause | Bei Resume: `git pull origin main` + Rebase vor Weiterarbeit |
