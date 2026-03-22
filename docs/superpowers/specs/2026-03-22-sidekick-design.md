# Just Ship Sidekick — Design Spec

> AI-powered In-App Assistant für kontextbasierte Ticket-Erstellung

**Erstellt:** 2026-03-22
**Status:** Ready for Review

---

## Vision

Ein universell einbettbares Chat-Panel, das Projekt-Admins auf jeder Website direkt im Kontext Tickets erstellen, suchen und verwalten lässt. Der Sidekick ist ein persistenter Split-View — er lebt neben der Seite, überlebt Navigationen und Refreshes, und kommuniziert mit dem Just Ship Board.

### Zielgruppe

Projekt-Admins und Workspace-Mitglieder, die auf ihren eigenen Anwendungen arbeiten (Aime, 19elf.cc, Katas Website, etc.). Nicht für Endnutzer oder anonyme Besucher.

### Referenz

Shopify Sidekick: Split-View-Panel, das die Seite verschmälert und persistent neben dem Content lebt.

---

## Architektur: Hybrid Snippet + iframe

```
┌──────────────────────────────────┬────────────────────┐
│  Host-Seite (verschmälert)       │  iframe             │
│                                  │  board.just-ship.io │
│  ┌────────────────────────────┐  │  /sidekick/[projId] │
│  │  Snippet (~3KB)            │  │                     │
│  │  - Aktivierung             │  │  ┌───────────────┐  │
│  │  - Split-View Layout       │  │  │ Sidebar       │  │
│  │  - postMessage Bridge      │  │  │ (History)     │  │
│  │  - Context Updates         │  │  ├───────────────┤  │
│  └────────────────────────────┘  │  │ Chat          │  │
│                                  │  │               │  │
│  Normale Seite, navigierbar      │  │ [Eingabe]     │  │
│                                  │  └───────────────┘  │
└──────────────────────────────────┴────────────────────┘
```

**Warum diese Architektur:**
- Snippet ist winzig (~3KB), keine Dependencies, nur Layout + Aktivierung
- Gesamte Chat-Logik lebt im iframe als Next.js-Route im Board
- Volle Code-Wiederverwendung mit Board (React, shadcn/ui, Supabase Auth)
- iframe wird bei Full-Page-Navigations neu geladen, aber State ist DB-persistiert → nahtlose Wiederherstellung
- Auth ist einfach: iframe ist Same-Origin mit Board → Supabase Session-Cookie greift
- Updates am Sidekick brauchen kein Snippet-Update

---

## 1. Snippet

### Einbettung

```html
<script
  src="https://board.just-ship.io/sidekick.js"
  data-project="mein-projekt-slug"
></script>
```

Nur eine Zeile. Keine sensiblen Daten im HTML — nur der öffentliche Projekt-Slug (kein interner UUID). Der Server resolved den Slug zur internen ID.

**Voraussetzung:** Die `projects`-Tabelle braucht eine neue `slug`-Spalte (`TEXT UNIQUE NOT NULL`). Migration generiert Slugs aus dem Projektnamen (kebab-case, unique pro Workspace). Neue Projekte bekommen den Slug automatisch bei Erstellung.

### Verhalten

**Aktivierung (unsichtbar bis getriggert):**
- `Ctrl+Shift+S` — Tastenkombination
- `?sidekick` — URL-Parameter
- Beides zeigt den Split-View, `localStorage` merkt sich den Zustand

**Split-View:**
- Wrapped `document.body` Inhalt in einen Flex-Container
- Erstellt iframe daneben (rechte Seite, ~400px breit)
- iframe lädt `board.just-ship.io/sidekick/{project-id}`
- Toggle-Button (X) zum Schließen — Body geht zurück auf volle Breite

**Context Bridge (postMessage):**
- Sendet bei Aktivierung und bei jeder Navigation:
  ```js
  { type: 'sidekick:context', url, path, title, viewport }
  ```
- Origin-Check: akzeptiert nur Messages von `board.just-ship.io`
- Listener auf `popstate` + `pushstate` für SPA-Navigation

**Persistenz:**
- `localStorage` speichert: Sidekick offen/geschlossen + aktive `conversation_id`
- Nach Refresh: wenn offen → Split-View sofort wiederherstellen, iframe lädt neu
- Chat-Zustand ist DB-persistiert → iframe lädt letzte Conversation + Nachrichten aus der DB
- Laufende Streams gehen bei Navigation verloren, aber die bis dahin gespeicherten Nachrichten bleiben

**SPA-Navigation:**
- Monkey-Patches `history.pushState` und `history.replaceState` um Navigationen zu erkennen (diese feuern nativ kein Event)
- Bei SPA-Navigation: iframe bleibt bestehen, nur Kontext-Update per postMessage

### Größe & Dependencies

~3KB minified, Vanilla JS, keine externe Abhängigkeit.

---

## 2. Sidekick App (iframe-Inhalt)

### Route

`board.just-ship.io/sidekick/[projectSlug]` — eigenständige Next.js-Seite ohne Board-Layout. Server resolved Slug zu interner Project-ID.

### Layout

**Header:**
- Projekt-Name + Logo (aus Workspace-Daten)
- Kontext-Badge: zeigt aktuelle Host-URL (via postMessage vom Snippet)
- "Neuer Chat" Button

**Sidebar (links, einklappbar):**
- Liste alter Conversations, sortiert nach letzter Aktivität
- Jede Conversation: Titel (aus erster Nachricht/erstem Ticket) + Datum
- Klick wechselt den Chat

**Chat-Bereich (rechts):**
- Nachrichtenverlauf (User + Sidekick-Antworten)
- Ticket-Karten inline: Titel + Status + Link zum Board
- Suchergebnis-Karten inline: Liste gefundener Tickets
- Eingabefeld unten mit Send-Button
- Typing-Indicator / Streaming-Anzeige während AI verarbeitet

### Auth-Flow

1. iframe lädt und ruft `supabase.auth.getSession()` auf
2. **Session vorhanden** + User ist Mitglied des Workspace → direkt rein
3. **Keine Session** → zeigt "Mit Just Ship einloggen" Button
4. Klick → `window.open('board.just-ship.io/auth/sidekick', ...)` öffnet Popup
5. User loggt sich im Popup ein (oder ist bereits eingeloggt im Board)
6. Popup-Seite schließt sich und sendet `postMessage({ type: 'sidekick:auth-complete' })` an den Opener
7. iframe empfängt Message → ruft `supabase.auth.getSession()` erneut auf → Session greift
8. Kein Reload nötig — React-State updated sich

**Middleware-Hinweis:** Die Route `/sidekick/[projectSlug]` muss in der Board-Middleware als Sonderfall behandelt werden — kein Redirect auf `/login`, da sie im iframe lebt. Stattdessen rendert die Seite selbst den Auth-UI-State.

### Technologie

React + shadcn/ui + TanStack Query — identisch zum Board.

---

## 3. Backend API

Neue Routes im Board unter `/api/sidekick/...`. Alle Endpoints erfordern Supabase Session + Workspace-Mitgliedschaft.

### Endpoints

**`POST /api/sidekick/conversations`**
- Erstellt neue Conversation
- Body: `{ project_id, page_url, page_title }`
- Returns: `{ id, title, created_at }`

**`GET /api/sidekick/conversations`**
- Listet Conversations des Users für ein Projekt
- Query: `?project_id=...&limit=50&cursor=...`
- Returns: `{ items: [{ id, title, last_message_at, ticket_count }], next_cursor? }`
- Sortiert nach `updated_at DESC`

**`POST /api/sidekick/conversations/[id]/messages`**
- Sendet User-Nachricht, bekommt AI-Antwort
- Body: `{ content, context: { url, path, title } }`
- Returns: SSE-Stream mit folgenden Event-Typen:
  - `event: delta` / `data: { text: "..." }` — Text-Chunk der AI-Antwort
  - `event: tool_call` / `data: { tool: "create_ticket", args: {...} }` — AI ruft Tool auf
  - `event: tool_result` / `data: { tool: "create_ticket", result: { ticket } }` — Tool-Ergebnis
  - `event: done` / `data: { message_id, ticket?, search_results? }` — Stream fertig, finale Message-ID

**`GET /api/sidekick/conversations/[id]/messages`**
- Lädt Nachrichtenverlauf
- Query: `?limit=100&cursor=...`
- Returns: `{ items: [{ id, role, content, ticket?, search_results?, created_at }], next_cursor? }`

### Auth

- Supabase Session aus Cookie (Same-Origin mit Board)
- Workspace-Mitgliedschaft wird bei jedem Call geprüft
- Project muss zum Workspace gehören
- Kein Pipeline-Key — User-Auth, nicht Machine-Auth

---

## 4. AI-Layer

### Kontext pro Nachricht

Das LLM erhält bei jeder User-Nachricht:
- Die Nachricht selbst
- Seitenkontext (URL, Titel)
- Bisheriger Conversation-Verlauf
- Projekt-Info (Name, Beschreibung)

### Tool Use (Actions)

Der AI entscheidet selbst, welche Action er ausführt:

| Tool | Beschreibung |
|------|-------------|
| `create_ticket(title, description, tags, priority)` | Erstellt Ticket im Board |
| `search_tickets(query)` | Durchsucht bestehende Tickets per `ILIKE` auf title + body |
| `list_my_tickets(status?)` | Zeigt eigene Tickets, optional nach Status |

### Ticket-Typen (via Tags)

Die bestehende `tickets`-Tabelle hat kein `type`-Feld. Ticket-Typen werden stattdessen über Tags abgebildet:

- Tag `feature` — Neue Funktionalität
- Tag `bug` — Etwas funktioniert nicht
- Tag `improvement` — Bestehendes verbessern

Der AI setzt den passenden Tag automatisch.

### Ticket-Erstellung

Mapping auf bestehende Ticket-Felder:
- `title` — Prägnanter Titel (max 80 Zeichen)
- `body` — Markdown-Beschreibung inkl. Seitenkontext ("Gemeldet auf: /settings/profile")
- `tags` — Auto-generierte Labels inkl. Typ-Tag (`feature`, `bug`, `improvement`)
- `priority` — Aus Kontext abgeleitet
- `created_by` — User-ID des Sidekick-Nutzers

### Ticket-Suche

`search_tickets(query)` sucht per `ILIKE '%query%'` auf `title` und `body`. Einfach und ausreichend für MVP-Volumen. Kein Full-Text-Index oder Vektor-Suche nötig — kann später ergänzt werden wenn das Ticket-Volumen es rechtfertigt.

### Duplikat-Erkennung

Vor Ticket-Erstellung sucht der AI automatisch nach ähnlichen Tickets via `search_tickets`. Bei Treffern: "Es gibt schon T-234 'Dark Mode Toggle' — soll ich trotzdem ein neues erstellen?"

### Sprache

Auto-detect — antwortet in der Sprache des Users.

### Model

Claude Sonnet via Anthropic API. Schnell genug für Chat, günstig genug für Volume.

---

## 5. Datenmodell

### Neue Tabellen (Board-DB)

```sql
CREATE TABLE public.sidekick_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  project_id      UUID NOT NULL REFERENCES projects(id),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  title           TEXT,
  page_url        TEXT,
  page_title      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.sidekick_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES sidekick_conversations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content           TEXT NOT NULL,
  context           JSONB,
  ticket_id         UUID REFERENCES tickets(id),
  search_results    JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### RLS Policies

```sql
ALTER TABLE sidekick_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own conversations"
  ON sidekick_conversations FOR ALL
  USING (auth.uid() = user_id);

ALTER TABLE sidekick_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own messages"
  ON sidekick_messages FOR ALL
  USING (
    conversation_id IN (
      SELECT id FROM sidekick_conversations WHERE user_id = auth.uid()
    )
  );
```

### Indexes

```sql
CREATE INDEX idx_sidekick_conversations_user_project
  ON sidekick_conversations(user_id, project_id);
CREATE INDEX idx_sidekick_conversations_updated
  ON sidekick_conversations(updated_at DESC);
CREATE INDEX idx_sidekick_messages_conversation
  ON sidekick_messages(conversation_id, created_at);
```

### Trigger

```sql
-- updated_at auf Conversation aktualisieren wenn neue Message kommt
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE sidekick_conversations
  SET updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_conversation_timestamp
  AFTER INSERT ON sidekick_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_timestamp();
```

### Conversation-Titel

Der Titel wird beim Erstellen der ersten Assistant-Antwort automatisch generiert: Das LLM bekommt einen kurzen Zusatzprompt "Generiere einen Titel (max 50 Zeichen) für diese Conversation" und das Ergebnis wird per UPDATE auf die Conversation geschrieben.

### Context JSONB Schema

```typescript
// Zod-Schema für context in sidekick_messages
const sidekickContextSchema = z.object({
  url: z.string().url(),
  path: z.string(),
  title: z.string(),
  viewport: z.object({
    width: z.number(),
    height: z.number(),
  }).optional(),
});
```

---

## 6. Sicherheit

### Aktivierung
- Snippet rendert nichts sichtbar — kein Hinweis auf Existenz für normale Besucher
- `localStorage`-Key unauffällig benannt
- Selbst bei Aktivierung: ohne Just Ship Login kein Zugang

### Auth
- iframe auf `board.just-ship.io` → Same-Origin → Supabase Session-Cookie greift
- Workspace-Mitgliedschaft bei jedem API-Call geprüft
- Project muss zum Workspace gehören — kein Cross-Workspace-Zugriff

### iframe-Isolation
- postMessage mit Origin-Check (beide Richtungen)
- Kein Zugriff vom iframe auf Host-DOM (Cross-Origin-Policy)

### API
- Rate Limiting auf `/api/sidekick/*`:
  - Messages: max 30/min pro User, max 200/Tag pro Projekt
  - Conversations: max 10/min pro User
- Input-Sanitization auf User-Nachrichten vor LLM-Verarbeitung
- Ticket-Erstellung nutzt bestehende Zod-Validierung
- `workspace_id` wird serverseitig aus `project_id` abgeleitet, nie vom Client gesendet

### Snippet-Integrität
- Wird von `board.just-ship.io` geladen → unter eigener Kontrolle
- SRI Hash optional für zusätzliche Absicherung

---

## 7. User Flow

### Erstmalige Nutzung

1. Entwickler fügt `<script>` Tag mit `data-project` in seine Seite ein
2. Admin besucht die Seite, drückt `Ctrl+Shift+S`
3. Seite verschmälert sich, Sidekick-Panel erscheint rechts
4. "Mit Just Ship einloggen" → OAuth Popup → Login
5. Sidekick ist bereit: "Hey! Was brauchst du auf dieser Seite?"
6. Admin tippt: "Der Filter hier funktioniert nicht richtig"
7. Sidekick fragt nach: "Was passiert genau wenn du filterst?"
8. Admin beschreibt das Problem
9. Sidekick: "Ich hab ein ähnliches Ticket gefunden: T-187 'Filterlogik ignoriert leere Werte'. Ist das dasselbe?"
10. Admin: "Nein, bei mir geht es um die Sortierung"
11. Sidekick erstellt Ticket: T-203 "Filter-Sortierung fehlerhaft auf /dashboard" → Link zum Board

### Wiederkehrende Nutzung

1. Admin drückt `Ctrl+Shift+S`
2. Session noch aktiv → kein Login nötig
3. Alte Conversations in der Sidebar sichtbar
4. Neuer Chat oder bestehenden fortsetzen

### Seiten-Navigation (Full-Page)

1. Admin navigiert auf andere Seite (Full-Page-Navigation)
2. Host-Seite refresht, Snippet re-initialisiert
3. `localStorage`: Sidekick war offen + aktive `conversation_id` → Split-View sofort wieder da
4. iframe lädt neu, aber restored letzte Conversation aus DB → nahtlose UX
5. Snippet schickt neuen Kontext per postMessage → Badge aktualisiert sich

### Seiten-Navigation (SPA)

1. Admin navigiert innerhalb einer SPA (pushState)
2. iframe bleibt bestehen — kein Reload, Chat-Zustand unverändert
3. Snippet erkennt Navigation und schickt Kontext-Update per postMessage

### Fehlerbehandlung

- **AI-API-Fehler:** "Da ist etwas schiefgelaufen. Bitte versuch es nochmal." + Retry-Button
- **Ticket-Erstellung fehlgeschlagen:** Fehlermeldung mit Details, Nachricht bleibt im Chat
- **Session abgelaufen:** "Deine Session ist abgelaufen" + "Neu einloggen" Button (kein automatischer Redirect)
- **Netzwerk-Fehler:** Offline-Banner oben im Sidekick, auto-reconnect bei Netzwerk-Rückkehr

---

## Scope-Abgrenzung

### MVP (diese Spec)
- Universelles Snippet mit Split-View
- Voller Chat mit History und Conversation-Liste
- Ticket-Erstellung, -Suche, eigene Tickets anzeigen
- Duplikat-Erkennung
- Just Ship OAuth Login
- Seitenkontext automatisch erfassen (URL, Titel)

### Spätere Phasen (nicht in dieser Spec)
- Screenshot/Screen-Capture als Ticket-Anhang
- Bestehende Tickets bearbeiten
- Direkte Konfigurationsänderungen in der App
- Adapter-System für verschiedene Backends
- Endnutzer-Zugang (nicht nur Admins)
