# Just Ship Board — Architecture & Documentation

> Umfassende technische Dokumentation des Projekts.

---

## Inhaltsverzeichnis

1. [Projektbeschreibung](#projektbeschreibung)
2. [Tech Stack](#tech-stack)
3. [Systemarchitektur](#systemarchitektur)
4. [Verzeichnisstruktur](#verzeichnisstruktur)
5. [Datenmodell](#datenmodell)
6. [Routing & Middleware](#routing--middleware)
7. [Authentifizierung & Autorisierung](#authentifizierung--autorisierung)
8. [Pipeline API (REST)](#pipeline-api-rest)
9. [Kanban Board](#kanban-board)
10. [Agentic Workflow](#agentic-workflow)
11. [Environment Variables](#environment-variables)
12. [Deployment](#deployment)

---

## Projektbeschreibung

**Just Ship Board** ist ein Multi-Tenant-SaaS-Dashboard für das `just-ship`-System. Es dient als zentrales Ticket- und Projektmanagement-Tool, das speziell für die Zusammenarbeit mit KI-Agenten (Claude Code) entwickelt wurde.

Kernkonzept: Tickets werden entweder manuell im Board erstellt oder via Claude Code `/ticket`-Command angelegt. KI-Agenten arbeiten Tickets autonom ab, während der Status in Echtzeit auf dem Kanban Board aktualisiert wird.

**Production:** `app.just-ship.io`

---

## Tech Stack

| Kategorie | Technologie | Version |
|-----------|-------------|---------|
| Framework | Next.js (App Router) | 16.x |
| UI Library | React | 19.x |
| Sprache | TypeScript | 5.x |
| Styling | Tailwind CSS | 4.x |
| Komponenten | shadcn/ui (base-nova) | — |
| Backend/Auth/DB | Supabase (Auth, PostgreSQL, Realtime, RLS) | — |
| State Management | TanStack Query | 5.x |
| Formulare | React Hook Form + Zod v4 | — |
| Drag & Drop | @dnd-kit | — |
| Icons | Lucide React | — |
| Markdown | react-markdown + remark-gfm | — |
| Package Manager | npm | — |

### Wichtige Library-Details

- **shadcn/ui base-nova** nutzt `@radix-ui/react-*` Primitives
- **Zod v4** mit `@hookform/resolvers` — bei `.default()` Fields `resolver: zodResolver(schema) as any` verwenden
- **@dnd-kit** für performante Drag & Drop Interaktionen auf dem Kanban Board

---

## Systemarchitektur

```
                          ┌────────────────────────────────┐
                          │        Just Ship Board          │
                          │      (Next.js 16 App Router)   │
                          │      app.just-ship.io       │
                          └───────────┬────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                  │
                    ▼                 ▼                  ▼
            ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
            │  Web UI      │  │ Pipeline API │  │  Events API  │
            │  (SSR + CSR) │  │ (REST)       │  │  (REST)      │
            └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                   │                 │                  │
                   └─────────────────┼──────────────────┘
                                     │
                                     ▼
                          ┌────────────────────────────────┐
                          │        Supabase                 │
                          │  ┌──────────┐ ┌──────────────┐ │
                          │  │ Auth     │ │ PostgreSQL   │ │
                          │  │ (JWT)    │ │ (RLS)        │ │
                          │  └──────────┘ └──────────────┘ │
                          │  ┌──────────────────────────┐  │
                          │  │ Realtime (Subscriptions) │  │
                          │  └──────────────────────────┘  │
                          └────────────────────────────────┘
                                     ▲
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                 │
            ┌───────────────┐ ┌──────────────────────┐ ┌──────────┐
            │ Claude Code   │ │ just-ship              │ │ Andere   │
            │ (in Repos)    │ │ (Hooks/Events)         │ │ Clients  │
            └───────────────┘ └──────────────────────┘ └──────────┘
```

### Datenflüsse

1. **Web UI → Supabase**: Server Components fetchen über Server Client, Client Components nutzen TanStack Query + Browser Client für Mutations
2. **Pipeline API → Supabase**: Bearer Token Auth (`adp_...`), validiert via SHA-256 Hash-Lookup in `api_keys`
3. **Claude Code → Supabase**: Status-Updates via MCP SQL-Tool (`mcp__claude_ai_Supabase__execute_sql`)
4. **Realtime**: Supabase Realtime Subscriptions für `task_events` INSERT — Agent-Indikator pulsiert auf betroffenen Ticket Cards

---

## Verzeichnisstruktur

```
src/
├── app/
│   ├── (auth)/                           # Auth Route Group (kein URL-Prefix)
│   │   ├── login/page.tsx                # Sign-in
│   │   ├── register/page.tsx             # Sign-up
│   │   └── forgot-password/page.tsx      # Passwort-Reset
│   ├── auth/callback/                    # Supabase OAuth Callback
│   ├── invite/[token]/page.tsx           # Workspace-Einladung annehmen
│   ├── new-workspace/page.tsx            # Workspace erstellen
│   ├── reset-password/page.tsx           # Neues Passwort setzen
│   ├── [slug]/                           # Workspace-Scope (dynamisch)
│   │   ├── page.tsx                      # Redirect → /[slug]/board
│   │   ├── board/page.tsx                # Kanban Board (Hauptansicht)
│   │   ├── tickets/page.tsx              # Ticket-Liste (Tabellenansicht)
│   │   └── settings/
│   │       ├── page.tsx                  # General Settings
│   │       ├── members/page.tsx          # Team & Einladungen
│   │       └── api-keys/page.tsx         # API Keys verwalten
│   ├── api/
│   │   ├── v1/pipeline/[slug]/tickets/   # Pipeline REST API
│   │   │   ├── route.ts                  # GET (list) / POST (create)
│   │   │   └── [id]/route.ts            # GET / PATCH / DELETE
│   │   ├── tickets/                      # Interne Ticket API
│   │   │   ├── route.ts                  # GET (list)
│   │   │   └── [number]/route.ts        # GET / PATCH
│   │   ├── events/route.ts              # POST (Agent Events loggen)
│   │   ├── check-slug/route.ts          # GET (Slug Verfügbarkeit)
│   │   └── workspace/[workspaceId]/
│   │       └── api-keys/route.ts        # POST (Key erstellen)
│   ├── page.tsx                          # Root Redirect
│   └── layout.tsx                        # Root Layout
├── components/
│   ├── board/
│   │   ├── board.tsx                     # Board Container (Server → Client Bridge)
│   │   ├── board-client.tsx              # Client-Side Board mit DnD
│   │   ├── board-column.tsx              # Einzelne Kanban-Spalte
│   │   ├── board-group-row.tsx           # Gruppierte Zeile (nach Projekt)
│   │   ├── board-header.tsx              # Board Header
│   │   ├── board-toolbar.tsx             # Filter & Aktionen
│   │   ├── ticket-card.tsx               # Ticket Card im Board
│   │   └── agent-panel.tsx               # Agent Activity Panel
│   ├── tickets/
│   │   ├── create-ticket-dialog.tsx      # Neues Ticket erstellen
│   │   ├── ticket-detail-sheet.tsx       # Ticket Detail Side Sheet
│   │   └── ticket-list-view.tsx          # Tabellenansicht
│   ├── settings/
│   │   ├── settings-general.tsx          # Workspace-Name/Slug bearbeiten
│   │   ├── members-view.tsx              # Mitgliederliste
│   │   ├── invite-member-dialog.tsx      # Einladungs-Dialog
│   │   ├── api-keys-view.tsx             # API Key Verwaltung
│   │   └── create-api-key-dialog.tsx     # Neuen Key erstellen
│   ├── layout/
│   │   └── sidebar.tsx                   # Hauptnavigation
│   ├── shared/
│   │   ├── status-badge.tsx              # Status Badge Komponente
│   │   ├── empty-state.tsx               # Leerzustand-Anzeige
│   │   ├── command-palette.tsx           # Cmd+K Command Palette
│   │   └── markdown-renderer.tsx         # Markdown Rendering
│   ├── ui/                               # shadcn/ui Primitives
│   │   ├── button.tsx, input.tsx, ...    # Basis-Komponenten
│   │   ├── dialog.tsx, sheet.tsx         # Overlay-Komponenten
│   │   └── select.tsx, dropdown-menu.tsx # Interaktive Komponenten
│   └── providers.tsx                     # TanStack QueryClientProvider
├── lib/
│   ├── supabase/
│   │   ├── client.ts                     # Browser Supabase Client
│   │   ├── server.ts                     # Server Supabase Client
│   │   ├── service.ts                    # Service Role Client (API Routes)
│   │   └── middleware.ts                 # Auth Middleware
│   ├── api/
│   │   ├── pipeline-key-auth.ts          # Bearer Token Validierung
│   │   ├── workspace-auth.ts             # Workspace-Zugehörigkeit prüfen
│   │   └── error-response.ts            # Standardisierte API Responses
│   ├── validations/
│   │   ├── ticket.ts                     # Zod Schemas für Tickets
│   │   ├── workspace.ts                 # Zod Schemas für Workspaces
│   │   ├── project.ts                   # Zod Schemas für Projekte
│   │   └── api-key.ts                   # Zod Schemas für API Keys
│   ├── workspace-context.tsx             # WorkspaceProvider + useWorkspace()
│   ├── types.ts                          # TypeScript Interfaces
│   └── constants.ts                      # Status/Priority/Agent Konstanten
└── middleware.ts                          # Next.js Route Middleware
```

---

## Datenmodell

### Tabellen (Supabase PostgreSQL)

```
┌──────────────────┐     ┌──────────────────┐
│   workspaces     │     │ workspace_members │
├──────────────────┤     ├──────────────────┤
│ id (uuid, PK)   │◄────│ workspace_id (FK)│
│ name             │     │ user_id          │
│ slug (unique)    │     │ role             │
│ created_by       │     │ joined_at        │
│ created_at       │     └──────────────────┘
│ updated_at       │
└───────┬──────────┘     ┌──────────────────┐
        │                │ workspace_invites │
        │                ├──────────────────┤
        ├───────────────►│ workspace_id (FK)│
        │                │ email            │
        │                │ token (unique)   │
        │                │ invited_by       │
        │                │ accepted_at      │
        │                │ expires_at       │
        │                └──────────────────┘
        │
        │                ┌──────────────────┐
        ├───────────────►│   api_keys       │
        │                ├──────────────────┤
        │                │ id (uuid, PK)   │
        │                │ workspace_id (FK)│
        │                │ name             │
        │                │ key_hash (SHA256)│
        │                │ key_prefix       │
        │                │ last_used_at     │
        │                │ revoked_at       │
        │                │ created_by       │
        │                └──────────────────┘
        │
        │                ┌──────────────────┐
        ├───────────────►│   projects       │
        │                ├──────────────────┤
        │                │ id (uuid, PK)   │
        │                │ workspace_id (FK)│
        │                │ name             │
        │                │ description      │
        │                └──────────────────┘
        │
        │                ┌──────────────────────────────┐
        └───────────────►│          tickets              │
                         ├──────────────────────────────┤
                         │ id (uuid, PK)                │
                         │ workspace_id (FK)             │
                         │ number (auto-increment)       │
                         │ title                         │
                         │ body (markdown)               │
                         │ status (enum)                 │
                         │ priority (enum)               │
                         │ tags (text[])                 │
                         │ project_id (FK → projects)    │
                         │ parent_ticket_id (FK → self)  │
                         │ assignee_id                   │
                         │ branch                        │
                         │ pipeline_status               │
                         │ assigned_agents (text[])      │
                         │ summary                       │
                         │ test_results                  │
                         │ preview_url                   │
                         │ due_date                      │
                         │ created_by                    │
                         │ created_at / updated_at       │
                         └──────────────┬───────────────┘
                                        │
                                        ▼
                         ┌──────────────────────────────┐
                         │       task_events             │
                         ├──────────────────────────────┤
                         │ id (uuid, PK)                │
                         │ ticket_id (FK → tickets)     │
                         │ project_id (FK → projects)   │
                         │ agent_type (enum)             │
                         │ event_type (enum)             │
                         │ metadata (jsonb)              │
                         │ created_at                    │
                         └──────────────────────────────┘
```

### Enums

**Ticket Status:** `backlog` | `ready_to_develop` | `in_progress` | `in_review` | `done` | `cancelled`

**Ticket Priority:** `low` | `medium` | `high`

**Pipeline Status:** `queued` | `running` | `done` | `failed`

**Agent Types:** `orchestrator` | `frontend` | `backend` | `data-engineer` | `qa` | `devops` | `security`

**Event Types:** `agent_started` | `agent_completed` | `agent_spawned` | `tool_use` | `log`

### Row Level Security (RLS)

Alle Tabellen sind durch RLS auf DB-Ebene geschützt. Zugriff wird über `workspace_members`-Zugehörigkeit gesteuert — kein clientseitiges Workspace-Filtering notwendig.

---

## Routing & Middleware

### Öffentliche Routen (kein Auth erforderlich)

| Route | Zweck |
|-------|-------|
| `/` | Root Redirect |
| `/login` | Anmeldung |
| `/register` | Registrierung |
| `/forgot-password` | Passwort vergessen |
| `/invite/[token]` | Einladung annehmen |
| `/auth/callback` | OAuth Callback |
| `/api/v1/pipeline/*` | Pipeline REST API (Bearer Auth) |
| `/api/tickets/*` | Ticket API (Bearer Auth) |
| `/api/events` | Events API (Bearer Auth) |

### Geschützte Routen (Session Auth)

| Route | Zweck |
|-------|-------|
| `/new-workspace` | Workspace erstellen |
| `/[slug]/board` | Kanban Board |
| `/[slug]/tickets` | Ticket-Liste |
| `/[slug]/settings` | Workspace Settings |
| `/[slug]/settings/members` | Team-Mitglieder |
| `/[slug]/settings/api-keys` | API Keys |

### Middleware-Verhalten

1. **Authentifizierter User auf Auth-Seite** → Redirect zu `/`
2. **Nicht-authentifizierter User auf geschützter Seite** → Redirect zu `/login?redirect=...`
3. **Root `/`** → Auth: erster Workspace `/[slug]/board`, kein Auth: `/login`

---

## Authentifizierung & Autorisierung

### User Auth (Web UI)

- **Supabase Auth** mit Email/Passwort
- Session-Management über `@supabase/ssr` (Cookie-basiert)
- OAuth Callback über `/auth/callback`

### API Auth (Pipeline)

- **Bearer Token** im Format `adp_<64 hex chars>`
- Token-Validierung:
  1. `Authorization: Bearer adp_...` Header extrahieren
  2. SHA-256 Hash berechnen
  3. Hash in `api_keys.key_hash` nachschlagen
  4. Bei Treffer: `workspace_id` extrahieren, `last_used_at` aktualisieren
  5. Kein Treffer: `401 Unauthorized`
- Plaintext-Key wird **nur einmal** bei Erstellung angezeigt
- UI zeigt nur `key_prefix` (erste 8 Hex-Zeichen)

### Workspace-Zugehörigkeit

- `workspace_members` Tabelle mit Rollen (`owner`, `member`)
- RLS Policies prüfen Zugehörigkeit auf DB-Ebene
- Kein manuelles Filtering im Application Code nötig

---

## Pipeline API (REST)

Base URL: `https://app.just-ship.io/api`

Auth: `Authorization: Bearer adp_<key>`

### Endpoints

#### Tickets

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| `GET` | `/v1/pipeline/[slug]/tickets` | Tickets auflisten (Query: `status`, `project`, `limit`) |
| `POST` | `/v1/pipeline/[slug]/tickets` | Neues Ticket erstellen |
| `GET` | `/v1/pipeline/[slug]/tickets/[id]` | Einzelnes Ticket abrufen |
| `PATCH` | `/v1/pipeline/[slug]/tickets/[id]` | Ticket updaten (Status, Branch, Agents) |
| `DELETE` | `/v1/pipeline/[slug]/tickets/[id]` | Ticket löschen |

#### Interne APIs

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| `GET` | `/tickets` | Tickets auflisten (mit Bearer Auth) |
| `GET` | `/tickets/[number]` | Ticket nach Nummer |
| `PATCH` | `/tickets/[number]` | Ticket updaten |
| `POST` | `/events` | Agent Event loggen |
| `GET` | `/check-slug` | Slug-Verfügbarkeit prüfen |
| `POST` | `/workspace/[id]/api-keys` | API Key erstellen |

### Event Schema

```json
{
  "ticket_number": 123,
  "agent_type": "orchestrator",
  "event_type": "agent_started",
  "metadata": { "branch": "feature/T-123-example" }
}
```

---

## Kanban Board

### Spalten

| Spalte | Status | Farbe |
|--------|--------|-------|
| Backlog | `backlog` | Grau |
| Ready | `ready_to_develop` | Blau |
| In Progress | `in_progress` | Gelb |
| In Review | `in_review` | Lila |
| Done | `done` | Grün |

### Features

- **Drag & Drop**: @dnd-kit mit Optimistic Updates — Ticket-Status wird sofort in der UI aktualisiert, PATCH-Request folgt asynchron
- **Agent-Indikator**: Pulsierender Dot auf Ticket Cards wenn `task_events` jünger als 60 Sekunden
- **Realtime**: Supabase Realtime Subscription auf `task_events` INSERT
- **Farbige Spalten**: Notion-inspirierte Column Backgrounds mit farbigen Header Pills
- **Activity Timeline**: Ticket Detail Sheet zeigt chronologische Agent-Events
- **Command Palette**: `Cmd+K` für schnelle Navigation und Aktionen
- **Gruppierung**: Tickets können nach Projekt gruppiert werden

### Datenfluss

```
Server Component lädt Tickets (Supabase Server Client)
        │
        ▼
Client Component hydratiert mit TanStack Query (initialData)
        │
        ├── Drag & Drop → optimisticUpdate → PATCH Mutation
        │
        ├── Neues Ticket → CreateTicketDialog → INSERT Mutation
        │
        ├── Ticket Detail → TicketDetailSheet → PATCH Mutation
        │
        └── Realtime Subscription → task_events INSERT
                │
                ▼
          Agent-Indikator pulsiert auf betroffener Card
```

---

## Agentic Workflow

### Wie Repos die Pipeline nutzen

Jedes Repo enthält eine `project.json` mit Pipeline-Konfiguration:

```json
{
  "pipeline": {
    "project_id": "wsmnutkobalfrceavpxs",
    "project_name": "Projektname",
    "workspace_id": "421dffa5-..."
  }
}
```

### Claude Code Commands

| Command | Aktion | Board-Status |
|---------|--------|-------------|
| `/ticket` | Neues Ticket im Board erstellen | — |
| `/develop T-123` | Ticket laden, Branch erstellen, Coding starten | `in_progress` |
| `/ship` | Commit → Push → PR erstellen | `in_review` |
| `/merge` | PR mergen | `done` |
| `/status` | Aktive Tickets für dieses Projekt anzeigen | — |

### Ticket Lifecycle

```
                ┌──────────┐
                │ backlog  │ ← Ticket erstellt (Board UI oder /ticket)
                └────┬─────┘
                     │ Priorisiert
                     ▼
            ┌────────────────┐
            │ ready_to_develop│
            └────────┬───────┘
                     │ /develop (Agent startet)
                     ▼
             ┌──────────────┐
             │ in_progress  │ ← Agent arbeitet, Events werden geloggt
             └──────┬───────┘
                    │ /ship (PR erstellt)
                    ▼
             ┌──────────────┐
             │  in_review   │ ← Code Review
             └──────┬───────┘
                    │ "passt" / /merge
                    ▼
             ┌──────────────┐
             │    done      │
             └──────────────┘
```

### Status-Updates

Alle Status-Updates laufen via `mcp__claude_ai_Supabase__execute_sql`:

```sql
UPDATE public.tickets
SET status = 'in_progress'
WHERE number = 123
  AND workspace_id = '421dffa5-...'
RETURNING number, title, status;
```

---

## Environment Variables

| Variable | Beschreibung | Wo |
|----------|-------------|-----|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Projekt URL | `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Anonymous Key (RLS-geschützt) | `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key (umgeht RLS, nur Server-seitig) | `.env.local` |

### Setup

```bash
cp .env.example .env.local
# Werte aus Supabase Dashboard eintragen
```

---

## Deployment

- **Hosting:** Vercel
- **Domain:** `app.just-ship.io`
- **Build:** `npm run build` (Next.js Production Build)
- **Database:** Supabase (gehostet, managed PostgreSQL)

### Vercel Environment Variables

Dieselben wie in `.env.local` — müssen im Vercel Dashboard konfiguriert werden.
