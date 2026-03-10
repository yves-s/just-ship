# CLAUDE.md – agentic-dev-board Project Instructions

> Dieses Dokument wird von Claude Code automatisch gelesen.
> Projektspezifische Konfiguration (Supabase-Config, Build-Commands, Pfade) liegt in `project.json`.

---

## Projekt

**agentic-dev-board** – Next.js 16 Dashboard für das claude-pipeline System. Multi-tenant SaaS für Ticket-/Projektmanagement mit Workspaces, Projekten und Tickets.

---

## Konventionen

### Git
- **Branches:** `feature/{ticket-id}-{kurzbeschreibung}`, `fix/...`, `chore/...`
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`)
- **Sprache:** Commit Messages auf Englisch

### Code
- **Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui (base-nova), Supabase, TanStack Query 5, React Hook Form + Zod, @dnd-kit
- **Package Manager:** npm
- Commands: `npm run dev` / `npm run build` / `npm run lint`
- Server Components für initiales Data-Fetching via Supabase server client
- Client Components nutzen TanStack Query + Browser Supabase Client für Mutations
- `WorkspaceContext` (`src/lib/workspace-context.tsx`) — Workspace in `[slug]/` Tree
- RLS enforced auf DB-Ebene (kein clientseitiges workspace-Filtering nötig)

### Dateien
- Keine Dateien löschen ohne explizite Anweisung

---

## Autonomer Modus

Dieses Repo nutzt ein Multi-Agent-System. Ob lokal oder auf dem Server:

1. **Arbeite autonom** — keine interaktiven Fragen, keine manuellen Bestätigungen
2. **Plane selbst** — kein Planner-Agent, keine Spec-Datei. Lies betroffene Dateien direkt und gib Agents konkrete Instruktionen
3. **Wenn unklar:** Konservative Lösung wählen, nicht raten
4. **Commit + PR** am Ende des Workflows → Supabase "in_review"
5. **Merge erst nach Freigabe** — User sagt "passt"/"merge" oder `/merge`

## Ticket-Workflow (Supabase)

> Nur aktiv wenn `supabase.project_id` in `project.json` gesetzt ist. Ohne Supabase werden diese Schritte übersprungen.

Falls Supabase konfiguriert ist, sind Status-Updates **PFLICHT**:

| Workflow-Schritt | Supabase-Status | Wann |
|---|---|---|
| `/ticket` — Ticket aufnehmen | **`in_progress`** | Sofort nach Ticket-Auswahl, VOR dem Coding |
| `/ship` — PR erstellen | **`in_review`** | Nach PR-Erstellung |
| `/merge` — PR mergen | **`done`** | Nach erfolgreichem Merge |

Status-Updates via `mcp__claude_ai_Supabase__execute_sql`:
```sql
UPDATE public.tickets SET status = '{status}' WHERE number = {N} RETURNING number, title, status;
```

**Überspringe KEINEN dieser Schritte.** Falls ein Supabase-Update fehlschlägt, versuche es erneut oder informiere den User.

---

## Architektur

```
src/
├── app/
│   ├── (auth)/login|register|forgot-password/   # Auth-Seiten (kein Prefix in URL)
│   ├── auth/callback/                            # Supabase OAuth Callback
│   ├── invite/[token]/                           # Invite-Akzeptierung (public)
│   ├── [slug]/                                   # Workspace-Scope
│   │   ├── board/                                # Kanban Board (Hauptansicht)
│   │   ├── tickets/                              # Ticket-Liste
│   │   └── settings/{members,api-keys}/          # Settings
│   └── api/
│       ├── v1/pipeline/[slug]/tickets/           # Pipeline REST API (Bearer adp_...)
│       └── workspace/[slug]/api-keys/            # API Key Creation (service role)
├── components/
│   ├── board/                                    # Board, BoardColumn, TicketCard
│   ├── layout/                                   # Sidebar
│   ├── settings/                                 # InviteMemberDialog, CreateApiKeyDialog
│   ├── tickets/                                  # CreateTicketDialog, TicketDetailSheet
│   ├── shared/                                   # EmptyState, StatusBadge, PriorityBadge
│   ├── ui/                                       # shadcn/ui Primitives
│   └── providers.tsx                             # TanStack Query Provider
└── lib/
    ├── supabase/{client,server,service,middleware}.ts
    ├── api/{workspace-auth,pipeline-auth,error-response}.ts
    ├── validations/{ticket,workspace,project,api-key}.ts
    ├── workspace-context.tsx                     # WorkspaceProvider + useWorkspace()
    ├── types.ts                                  # TS Interfaces
    └── constants.ts                              # Statuses, Colors, Board Columns
```

### Routing
- `/` → redirect: auth → first workspace `/[slug]/board`, no auth → `/login`
- `/[slug]/` → redirect to `/[slug]/board`
- Middleware schützt alle Routes außer `/`, `/login`, `/register`, `/forgot-password`, `/invite/*`, `/auth/*`, `/api/v1/pipeline/*`

### Pipeline API
- Authentifizierung via `Authorization: Bearer adp_<key>`
- Keys werden als SHA-256 Hash in `api_keys` gespeichert (plaintext nie gespeichert)
- Env Vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

---

## Sicherheit

- Keine API Keys, Tokens oder Secrets im Code
- Input Validation auf allen Endpoints

---

## Konversationelle Trigger

**"passt"**, **"done"**, **"fertig"**, **"klappt"**, **"sieht gut aus"** → automatisch `/merge` ausführen

**Wichtig:** `/ship` und `/merge` laufen **vollständig autonom** — keine Rückfragen bei Commit, Push, PR oder Merge. Der User hat seine Freigabe bereits gegeben.
