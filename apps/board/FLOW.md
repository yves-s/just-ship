# Just Ship Board — Flow Documentation

## 1. Registration & Setup

### User-Registrierung

```
User besucht /register
        │
        ▼
  Email + Passwort eingeben
        │
        ▼
  Supabase Auth: signUp()
        │
        ▼
  Bestätigungs-Email wird gesendet
        │
        ▼
  User klickt Link in Email
        │
        ▼
  /auth/callback → Session wird erstellt
        │
        ▼
  Redirect auf / (Root Page)
        │
        ▼
  Hat User Workspaces? ──── Ja ──→ Redirect zu /{slug}/board
        │
       Nein
        │
        ▼
  Redirect zu /new-workspace
```

### Workspace-Erstellung

```
User gibt Name + Slug ein
        │
        ▼
  RPC: create_workspace(name, slug)
  (Atomare Transaktion:
    1. Workspace erstellen
    2. User als "owner" in workspace_members)
        │
        ▼
  Auto-API-Key wird generiert
  POST /api/workspace/{id}/api-keys
  Name: "Pipeline"
  Format: adp_ + 64 hex chars
        │
        ▼
  ┌─────────────────────────────────┐
  │  API Key wird einmalig angezeigt │
  │  (danach nie wieder sichtbar)    │
  │                                  │
  │  adp_a1b2c3d4e5f6...           │
  │  [Kopieren]  [Weiter zum Board] │
  └─────────────────────────────────┘
        │
        ▼
  Redirect zu /{slug}/board
```

### API-Key Speicherung

```
Plaintext:  adp_<64 hex chars>     → wird EINMALIG dem User gezeigt
Hash:       SHA256(plaintext)       → gespeichert in api_keys.key_hash
Prefix:     adp_<8 hex chars>      → gespeichert in api_keys.key_prefix (für UI-Anzeige)
```

---

## 2. Architektur

```
┌─────────────────────────────────────────────────────────┐
│                  Pipeline-DB (Supabase)                  │
│              wsmnutkobalfrceavpxs.supabase.co            │
│                                                         │
│  Workspace: "Just Ship"                                  │
│  ├── Projekt: Aime                                      │
│  ├── Projekt: Just Ship Board                           │
│  ├── Projekt: Aime Superadmin Dashboard                 │
│  └── Projekt: Aime Web                                  │
│                                                         │
│  Tabellen: workspaces, workspace_members, projects,     │
│            tickets, api_keys, task_events                │
└─────────────────────────────────────────────────────────┘
         ▲                              ▲
         │ SQL via MCP                  │ REST API
         │ (ticket status updates)      │ (agent events)
         │                              │
    ┌────┴─────────┐            ┌───────┴──────────┐
    │  Claude Code  │            │  claude-pipeline  │
    │  (in jedem    │            │  (Hooks, Agent-   │
    │   Repo)       │            │   Events)         │
    └──────────────┘            └──────────────────┘
```

### Wie Repos die Pipeline nutzen

Jedes Repo hat in seiner `project.json`:

```json
{
  "pipeline": {
    "project_id": "wsmnutkobalfrceavpxs",
    "project_name": "Aime",
    "workspace_id": "421dffa5-..."
  }
}
```

| Feld | Bedeutung |
|------|-----------|
| `project_id` | Supabase-Projekt der Pipeline-DB (gleich fuer alle Repos) |
| `project_name` | Filtert Tickets zum jeweiligen Projekt |
| `workspace_id` | Der Workspace in dem die Tickets leben |

---

## 3. Ticket-Lifecycle

```
Board erstellt Ticket
        │
        ▼
   ┌──────────┐     /ticket oder manuell
   │ backlog  │ ──────────────────────────────┐
   └──────────┘                               │
        │                                     │
        ▼                                     ▼
┌────────────────┐                    ┌──────────────┐
│ ready_to_develop│ ◄── Priorisiert  │  in_progress  │
└────────────────┘                    └──────────────┘
                                              │
                                         /ship (PR)
                                              │
                                              ▼
                                      ┌──────────────┐
                                      │  in_review    │
                                      └──────────────┘
                                              │
                                      "passt" / /ship
                                              │
                                              ▼
                                      ┌──────────────┐
                                      │    done       │
                                      └──────────────┘
```

### Claude Code Commands

| Command | Aktion | SQL |
|---------|--------|-----|
| `/ticket T-123` | Ticket laden, Status -> `in_progress` | `UPDATE tickets SET status = 'in_progress' WHERE number = 123` |
| `/ship` | Commit -> Push -> PR -> Merge, Status -> `done` | `UPDATE tickets SET status = 'done' WHERE number = 123` |
| `/status` | Zeigt aktive Tickets fuer dieses Projekt | `SELECT ... WHERE status = 'in_progress' AND project_id = (...)` |

Alle SQL-Calls gehen via `mcp__claude_ai_Supabase__execute_sql` mit `project_id` aus `pipeline.project_id`.

---

## 4. REST API

Authentifizierung via `Authorization: Bearer adp_...` (API-Key wird bei Workspace-Erstellung auto-generiert).

### Endpoints

```
GET   /api/tickets              Tickets auflisten (Query: status, project, limit)
GET   /api/tickets/:number      Einzelnes Ticket
PATCH /api/tickets/:number      Status/Branch/Agents updaten
POST  /api/events               Agent-Events loggen (task_events)
```

### Auth-Validierung

```
Request mit Bearer Token
        │
        ▼
  Token extrahieren (adp_...)
        │
        ▼
  SHA256 Hash berechnen
        │
        ▼
  Lookup in api_keys WHERE key_hash = hash
        │
        ├── Nicht gefunden → 401 Unauthorized
        │
        └── Gefunden → workspace_id extrahieren
                │
                ▼
          last_used_at aktualisieren
                │
                ▼
          Request mit workspace_id scope ausfuehren
```

---

## 5. Just Ship Board Web-UI

### Seiten

| Route | Beschreibung |
|-------|-------------|
| `/login` | Sign-in |
| `/register` | Sign-up |
| `/new-workspace` | Workspace + API-Key erstellen |
| `/[slug]/board` | Kanban Board (Hauptansicht) |
| `/[slug]/tickets` | Ticket-Liste |
| `/[slug]/settings` | Workspace Settings |
| `/[slug]/settings/members` | Team-Mitglieder |
| `/[slug]/settings/api-keys` | API-Keys verwalten |
| `/invite/[token]` | Einladung annehmen |

### Kanban Board

- 5 Spalten: Backlog, To Do, In Progress, In Review, Done
- Drag & Drop via @dnd-kit (optimistic updates)
- Agent-Indikator: pulsierender Dot auf Cards wenn task_events < 60s
- Supabase Realtime Subscription auf task_events INSERT

### Datenfluss

```
Server Component laedt Tickets (Supabase Server Client)
        │
        ▼
  Client hydratiert mit TanStack Query
        │
        ├── Drag & Drop → Optimistic Update → PATCH Mutation
        │
        ├── Neues Ticket → Modal → INSERT Mutation
        │
        └── Realtime Subscription → task_events INSERT
                │
                ▼
          Agent-Indikator pulsiert auf betroffener Card
```
