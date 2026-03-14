# Just Ship Board

Multi-Tenant-SaaS-Dashboard für KI-gestütztes Ticket- und Projektmanagement. Zentrales Board für das `just-ship`-System — Tickets werden manuell oder via Claude Code erstellt und von KI-Agenten autonom abgearbeitet.

**Production:** [board.just-ship.io](https://board.just-ship.io)

---

## Features

- **Kanban Board** mit Drag & Drop (@dnd-kit), Echtzeit-Agent-Indikatoren und farbigen Spalten
- **Ticket-Management** mit Priorities, Tags, Projektzuordnung und Markdown-Beschreibungen
- **Multi-Workspace** Architektur mit Einladungen und Rollen (Owner/Member)
- **Project Setup Flow** — Projekt erstellen, API Key generieren, Connect-Command kopieren, Pipeline verbinden
- **Pipeline API** (REST) für programmatischen Zugriff durch KI-Agenten
- **Realtime Updates** via Supabase Subscriptions auf Agent-Events
- **Activity Timeline** pro Ticket — zeigt Agent-Aktionen chronologisch
- **Command Palette** (Cmd+K) für schnelle Navigation

---

## Tech Stack

| | Technologie |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4, shadcn/ui |
| Backend | Supabase (Auth, PostgreSQL, RLS, Realtime) |
| State | TanStack Query 5 |
| Forms | React Hook Form + Zod v4 |
| DnD | @dnd-kit |

---

## Getting Started

### Voraussetzungen

- Node.js 20+
- npm
- Supabase Projekt (mit Schema laut [docs/architecture.md](docs/architecture.md))

### Installation

```bash
git clone https://github.com/<org>/just-ship-board.git
cd just-ship-board
npm install
```

### Environment

```bash
cp .env.example .env.local
```

Werte eintragen:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

### Entwicklung

```bash
npm run dev     # Dev Server starten
npm run build   # Production Build
npm run lint    # ESLint
```

---

## Projektstruktur

```
src/
├── app/
│   ├── (auth)/          # Login, Register, Forgot Password
│   ├── [slug]/          # Workspace-Scope
│   │   ├── board/       # Kanban Board
│   │   ├── tickets/     # Ticket-Liste
│   │   └── settings/    # Settings, Members, API Keys
│   └── api/             # REST API Routes
│       ├── tickets/     # PATCH /api/tickets/[number], POST /api/tickets
│       ├── projects/    # GET/POST /api/projects
│       ├── events/      # POST /api/events
│       └── workspace/   # API Key management (regenerate)
├── components/
│   ├── board/           # Board, Column, TicketCard, AgentPanel
│   ├── tickets/         # CreateDialog, DetailSheet, ListView
│   ├── settings/        # Members, API Keys, Invites
│   ├── shared/          # StatusBadge, CommandPalette, Markdown
│   └── ui/              # shadcn/ui Primitives
└── lib/
    ├── supabase/        # Client, Server, Service, Middleware
    ├── api/             # Auth Helpers, Error Responses
    ├── validations/     # Zod Schemas
    ├── types.ts         # TypeScript Interfaces
    └── constants.ts     # Status, Priority, Agent Enums
```

---

## Pipeline API

KI-Agenten (Claude Code, just-ship) nutzen die REST API für Ticket- und Projekt-Operationen.

**Auth:** `X-Pipeline-Key: adp_<key>`

```bash
# Ticket updaten (Status, Summary)
curl -X PATCH -H "X-Pipeline-Key: adp_..." \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}' \
  https://board.just-ship.io/api/tickets/<number>

# Ticket erstellen
curl -X POST -H "X-Pipeline-Key: adp_..." \
  -H "Content-Type: application/json" \
  -d '{"title": "...", "body": "...", "priority": "medium", "project_id": "<uuid>"}' \
  https://board.just-ship.io/api/tickets

# Agent Event loggen
curl -X POST -H "X-Pipeline-Key: adp_..." \
  -H "Content-Type: application/json" \
  -d '{"ticket_number": 123, "agent_type": "orchestrator", "event_type": "agent_started"}' \
  https://board.just-ship.io/api/events

# Projekte auflisten
curl -H "X-Pipeline-Key: adp_..." \
  https://board.just-ship.io/api/projects

# Projekt erstellen
curl -X POST -H "X-Pipeline-Key: adp_..." \
  -H "Content-Type: application/json" \
  -d '{"name": "My Project"}' \
  https://board.just-ship.io/api/projects
```

---

## Agentic Workflow

Repos binden sich via `project.json` an das Board. Die vollständige Config wird beim Projekt-Setup generiert:

```json
{
  "pipeline": {
    "project_id": "<board-project-uuid>",
    "project_name": "Mein Projekt",
    "workspace_id": "<workspace-uuid>",
    "api_url": "https://board.just-ship.io",
    "api_key": "adp_..."
  }
}
```

**Setup-Flow:** Workspace erstellen → Projekt auf dem Board erstellen → Connect-Command kopieren → in Claude Code ausführen (`/setup-pipeline --board ... --key ... --project ...`). Der Setup-Dialog zeigt auch eine Installationsanleitung für Erstnutzer.

Claude Code Commands:

| Command | Aktion |
|---------|--------|
| `/ticket` | Neues Ticket erstellen |
| `/develop T-123` | Ticket starten, Status `in_progress` |
| `/ship` | PR erstellen, mergen, Status `done` |

---

## Dokumentation

Ausführliche Dokumentation zu Architektur, Datenmodell, API und Workflows: **[docs/architecture.md](docs/architecture.md)**

---

## License

Private / Proprietary
