# Agentic Dev Board

Multi-Tenant-SaaS-Dashboard für KI-gestütztes Ticket- und Projektmanagement. Zentrales Board für das `agentic-dev-pipeline`-System — Tickets werden manuell oder via Claude Code erstellt und von KI-Agenten autonom abgearbeitet.

**Production:** [app.agentic-dev.xyz](https://app.agentic-dev.xyz)

---

## Features

- **Kanban Board** mit Drag & Drop (@dnd-kit), Echtzeit-Agent-Indikatoren und farbigen Spalten
- **Ticket-Management** mit Priorities, Tags, Projektzuordnung und Markdown-Beschreibungen
- **Multi-Workspace** Architektur mit Einladungen und Rollen (Owner/Member)
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
git clone https://github.com/<org>/agentic-dev-board.git
cd agentic-dev-board
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

KI-Agenten (Claude Code, agentic-dev-pipeline) nutzen die REST API für Ticket-Operationen.

**Auth:** `Authorization: Bearer adp_<key>`

```bash
# Tickets auflisten
curl -H "Authorization: Bearer adp_..." \
  https://app.agentic-dev.xyz/api/v1/pipeline/<slug>/tickets

# Ticket updaten
curl -X PATCH -H "Authorization: Bearer adp_..." \
  -d '{"status": "in_progress"}' \
  https://app.agentic-dev.xyz/api/v1/pipeline/<slug>/tickets/<id>

# Agent Event loggen
curl -X POST -H "Authorization: Bearer adp_..." \
  -d '{"ticket_number": 123, "agent_type": "orchestrator", "event_type": "agent_started"}' \
  https://app.agentic-dev.xyz/api/events
```

---

## Agentic Workflow

Repos binden sich via `project.json` an das Board:

```json
{
  "pipeline": {
    "project_id": "...",
    "project_name": "Mein Projekt",
    "workspace_id": "..."
  }
}
```

Claude Code Commands:

| Command | Aktion |
|---------|--------|
| `/ticket` | Neues Ticket erstellen |
| `/develop T-123` | Ticket starten, Status `in_progress` |
| `/ship` | PR erstellen, Status `in_review` |
| `/merge` | PR mergen, Status `done` |

---

## Dokumentation

Ausführliche Dokumentation zu Architektur, Datenmodell, API und Workflows: **[docs/architecture.md](docs/architecture.md)**

---

## License

Private / Proprietary
