# Spike: Paperclip Deep-Dive — Analyse & Vergleich mit just-ship

> Ticket: T-398 | Datum: 2026-03-21 | Timebox: 1–2 Tage

---

## 1. Was ist Paperclip?

[Paperclip](https://paperclip.ing) ([GitHub](https://github.com/paperclipai/paperclip), 30k+ Stars, MIT) ist ein Open-Source-Orchestrierungssystem für autonome AI-Agent-Teams. Die Kernidee: "Wenn OpenClaw ein Angestellter ist, dann ist Paperclip die Firma."

Paperclip modelliert nicht nur Tasks, sondern eine komplette Unternehmensstruktur — mit Organigrammen, Budgets, Governance und Accountability. Der Claim: "Zero-human companies."

**Tech-Stack:** TypeScript (96.7%), Node.js 20+, React 19, PostgreSQL 17, Drizzle ORM, pnpm Monorepo, Vite 6.

---

## 2. Feature-Vergleichsmatrix

| Feature | just-ship | Paperclip | Bewertung |
|---------|-----------|-----------|-----------|
| **Orchestrierung** | Command-basiert (`/develop`, `/ship`), Orchestrator-Agent (Opus) plant und delegiert | Heartbeat-Scheduling, Control Plane triggert Agents periodisch | Verschiedene Paradigmen — beide valide |
| **Agent-Modell** | 7 spezialisierte Agents (Orchestrator, Backend, Frontend, Data Engineer, DevOps, QA, Security) mit festen Rollen | Beliebig viele Agents mit Org-Chart, Hierarchie, Reporting-Lines, Jobtiteln | Paperclip flexibler, just-ship fokussierter |
| **Task-System** | Kanban-Board mit Ticket-Lifecycle (`ready_to_develop` → `in_progress` → `in_review` → `done`) | Issue-System mit atomischem Checkout, Goal-Ancestry, threaded Conversations | Paperclip hat mehr Features, just-ship ist schlanker |
| **Doppelarbeit-Vermeidung** | Implizit durch Ticket-Status + Branch | Atomic Checkout mit DB-Level Locks (`checkoutRunId`, `executionLockedAt`) | Paperclip robuster bei Multi-Agent-Szenarien |
| **Budget-Kontrolle** | Keine (Token-Verbrauch wird getrackt, aber nicht limitiert) | Monthly Budgets pro Agent in Dollar/Tokens, atomisch enforced, Agent stoppt bei Limit | **Klarer Vorteil Paperclip** |
| **Cost-Tracking** | Event-basiert (Token-Verbrauch pro Agent-Run im Board sichtbar) | CostEvent-Entities, Per-API-Call-Tracking, Real-Time-Monitoring | Paperclip granularer |
| **Multi-Runtime** | Claude Code only (Opus/Sonnet/Haiku) | 10 Adapter: Claude, Codex, Gemini, Cursor, OpenClaw, Hermes, HTTP, Process, etc. | **Klarer Vorteil Paperclip** |
| **Skill-System** | Framework-Skills + Superpowers-Plugin, zur Build-Time installiert | Runtime Skill Injection — Skills werden zur Laufzeit injiziert, adapter-agnostisch | Paperclip flexibler |
| **Governance** | Human-in-the-loop: PR-Review → "passt" → merge | Board-Modell: Approval Gates, Agent-Hiring, Strategy-Override, Rollbacks, revisionierte Config | Paperclip umfangreicher |
| **Event-Streaming** | Shell/SDK Hooks → Board API (`/api/events`) | WebSocket LiveEvents, Real-Time-UI-Updates | Ähnlich, Paperclip hat native WebSocket |
| **Multi-Projekt** | Ein Board mit mehreren Projekten, VPS-Worker pro Projekt | Multi-Company in einer Instanz, vollständige Daten-Isolation | Paperclip für Agentur-Modell, just-ship für Solo/Team |
| **Setup** | `curl | bash` + `just-ship setup` (portabel, in bestehende Projekte) | `npx paperclipai onboard --yes` (eigene Instanz mit embedded Postgres) | Verschiedene Ansätze — just-ship integriert sich, Paperclip steht alleine |
| **Deployment** | VPS-Worker (systemd), Board als SaaS | Local, Docker, Vercel, Self-hosted, Tailscale | Paperclip mehr Optionen |
| **Audit Trail** | Event-Log im Board (Agent-Start/Stop, Token-Verbrauch) | Immutable ActivityLog, vollständiges Tool-Call-Tracing | **Klarer Vorteil Paperclip** |
| **Architektur** | Portable Files (Agents/Commands/Skills als Markdown), installiert in bestehende Projekte | Eigenständige Applikation (Monorepo: Server + UI + DB + Adapters) | Grundlegend verschieden |
| **Fokus** | Software-Entwicklung (Ticket → PR) | Beliebige Business-Operationen ("Zero-human company") | just-ship spezialisiert, Paperclip generalistisch |

---

## 3. Detailanalyse

### 3.1 Board & Task-System

**Paperclip:**
- Issues sind die atomare Arbeitseinheit mit Status-Lifecycle: `backlog → todo → in_progress → in_review → done` (+ `blocked`, `cancelled`)
- Atomic Checkout: Agent macht `POST /api/issues/:id/checkout`, erhält DB-Level-Lock — kein anderer Agent kann denselben Task beanspruchen
- Goal Ancestry: Jeder Task tracet zurück zur Company-Mission (Company Goal → Project → Task)
- Threaded Conversations: Agents kommunizieren via Kommentare auf Issues, nicht nur Status-Updates
- Full Tracing: Jeder Tool-Call wird geloggt, immutables Audit-Log

**just-ship:**
- Tickets mit linearem Status-Flow: `ready_to_develop → in_progress → in_review → done`
- Kein formaler Checkout-Mechanismus — implizit durch Branch + Status
- Flache Hierarchie: Ticket steht für sich, keine Goal-Ancestry
- Event-Streaming zeigt Agent-Aktivität im Board, aber keine threaded Conversations
- Token-Tracking pro Agent-Run

**Bewertung:** Paperclips Task-System ist deutlich ausgereifter — besonders Atomic Checkout und Goal Ancestry sind wertvoll. Allerdings ist das für just-ships Fokus (ein Orchestrator → PR) aktuell Overengineering. Relevant wird es bei Multi-Agent-Parallelarbeit über mehrere Tickets.

### 3.2 Agent-Orchestrierung

**Paperclip — Heartbeat-Modell:**
- Agents werden periodisch "aufgeweckt" (Timer, Assignment, On-Demand, Automation)
- Jeder Heartbeat erzeugt einen `HeartbeatRun` mit Context
- `AgentTaskSession` persistiert State über mehrere Heartbeats — Agent setzt fort wo er aufgehört hat
- Adapter-Config definiert was der Agent pro Heartbeat tut — kein hardcodierter Standard-Loop
- CEO-Agents können kontinuierlich laufen, Spezialisten auf festen Schedules

**just-ship — Command-basiertes Modell:**
- Orchestrator (Opus) plant einmalig und delegiert an Sub-Agents
- Sub-Agents laufen parallel, arbeiten Task ab, beenden sich
- Pipeline-Worker pollt Supabase-Queue (ähnlich Heartbeat, aber für den Orchestrator selbst)
- Kein Session-State über Runs hinweg — jeder `/develop` ist ein frischer Start

**Bewertung:** Grundlegend verschiedene Paradigmen. Paperclips Heartbeat eignet sich für langlebige, kontinuierliche Arbeit. just-ships Command-Modell ist optimiert für den Dev-Workflow: Ticket rein → PR raus. Session-Persistence über Runs wäre für just-ship interessant (z.B. bei unterbrochenen Workflows).

### 3.3 Multi-Runtime-Support

**Paperclip:** 10 Adapter — Claude, Codex, Gemini, Cursor, OpenClaw, Hermes, HTTP, Process, etc. Jeder Adapter hat drei Module: Server (Execution), UI (Config-Form), CLI (Terminal-Output). Custom Adapter sind dokumentiert.

**just-ship:** Claude Code only. Model-Tiering (Opus/Sonnet/Haiku) als Optimierung, aber kein Runtime-Wechsel.

**Bewertung:** Paperclips Multi-Runtime ist beeindruckend und zukunftssicher. Für just-ship aktuell kein Pain-Point — Claude Code ist der Goldstandard. Aber: ein Adapter-Layer könnte Codex/Gemini-Support ermöglichen, falls Anthropic-Preise steigen oder andere Modelle besser werden.

### 3.4 Budget & Cost-Tracking

**Paperclip:**
- `budgetMonthlyCents` pro Agent, atomisch enforced
- CostEvent-Entities tracken jeden API-Call
- Agent stoppt automatisch bei Budget-Limit
- Real-Time-Monitoring im Dashboard

**just-ship:**
- Token-Verbrauch wird pro Agent-Run getrackt (`send-event.sh` mit Token-Count)
- Keine Budget-Limits — Agent läuft bis er fertig ist
- Kosten sichtbar im Board, aber kein Enforcement

**Bewertung:** Budget-Kontrolle ist einer der stärksten Paperclip-Features. Für just-ship relevant: ein einfacher Budget-Guard pro Ticket oder pro Pipeline-Run könnte Runaway-Costs verhindern. Muss nicht so komplex sein wie Paperclips Agent-Level-Budgets.

### 3.5 Governance & Approvals

**Paperclip:**
- Human = "Board of Directors"
- Approval-Gates für Agent-Hiring, Config-Changes, Strategy-Pivots
- Config-Changes sind revisioniert mit Rollback
- Formal Approval-Entities in der DB

**just-ship:**
- Human = PR-Reviewer
- Einziger Gate: PR-Review → "passt" → merge
- Kein formales Approval-System, aber effektiv für Dev-Workflow

**Bewertung:** Paperclips Governance ist für Business-Operationen gebaut. just-ships PR-basiertes Gate ist für Software-Entwicklung ideal — Code Review ist bereits der Gold-Standard. Kein Handlungsbedarf.

### 3.6 Setup & Developer Experience

**Paperclip:**
```bash
npx paperclipai onboard --yes
# oder
git clone + pnpm install + pnpm dev
```
- Embedded PostgreSQL (PGlite) für lokale Entwicklung
- React-Dashboard auf localhost:3100
- Eigenständige Applikation — nicht in bestehende Projekte integriert
- Watch-Mode mit Hot-Reload

**just-ship:**
```bash
curl -fsSL https://just-ship.io/install | bash
just-ship setup
```
- Installiert sich in bestehende Projekte (`.claude/`, `project.json`, `CLAUDE.md`)
- Board als SaaS (board.just-ship.io)
- Keine eigene Infrastruktur nötig
- Funktioniert auch ohne Board (Standalone-Modus)

**Bewertung:** Fundamental verschiedene Ansätze. Paperclip ist eine eigenständige Plattform, just-ship ist ein portables Framework. just-ships Ansatz (in bestehende Projekte integrieren) ist für Entwickler natürlicher — kein Context-Switch nötig.

### 3.7 Architektur

**Paperclip:**
```
paperclip/
├── cli/           # CLI (onboard, etc.)
├── server/        # Express.js API
├── ui/            # React 19 Dashboard
├── packages/      # Shared Libraries
├── skills/        # Skill Definitions
├── docker/        # Container Configs
└── tests/         # Test Suite
```
- Monorepo mit pnpm Workspaces
- Drizzle ORM + PostgreSQL
- Adapter als pluggable Module
- WebSocket für Real-Time-Events

**just-ship:**
```
just-ship/
├── agents/        # Agent-Definitionen (Markdown)
├── commands/      # Slash-Commands (Markdown)
├── skills/        # Skills (Markdown)
├── pipeline/      # SDK Runner (TypeScript)
├── vps/           # VPS-Deployment
└── .claude/       # Claude Code Config
```
- Flache Dateistruktur, Markdown-basiert
- Board als externe SaaS-Komponente
- Event-Hooks via Shell-Scripts
- Agent SDK (TypeScript) für Pipeline

**Bewertung:** Paperclip ist eine vollständige Plattform mit eigenem Tech-Stack. just-ship ist bewusst minimal — Agents und Commands als Markdown, portabel in jedes Projekt. Beide Ansätze haben Stärken: Paperclip für Kontrolle und Skalierung, just-ship für Einfachheit und Integration.

---

## 4. Hands-on-Erkenntnisse

### Setup-Erfahrung

- `npx paperclipai onboard --yes` ist beeindruckend smooth — Zero-Config mit embedded Postgres
- Dashboard startet auf localhost:3100, Agent-Verwaltung ist intuitiv
- Company-Erstellung, Agent-Hiring und Task-Erstellung funktionieren über das UI
- Paperclip erfordert aber eine eigene laufende Instanz — anders als just-ship, das in Claude Code lebt

### Board/Dashboard

- Professionelles UI mit Org-Chart-Visualisierung, Agent-Status, Cost-Overview
- Real-Time-Updates via WebSocket — Agent-Aktivität ist live sichtbar
- Issue-Management mit Conversations, Status-Tracking, Tracing
- Mobile-Ready — funktioniert auf dem Handy
- Deutlich umfangreicher als just-ships Board, aber auch komplexer

### Task-Workflow

- Agent erhält Task via Heartbeat, checkt ihn aus (Atomic Lock), arbeitet, reportet
- Session-Persistence funktioniert — Agent setzt fort statt neu zu starten
- Goal-Ancestry gibt Agents Kontext ("warum mache ich das?")
- Für reinen Dev-Workflow ist das Overhead — der Dev-Agent braucht Ticket-Inhalt, nicht Company-Mission

---

## 5. Konkrete Empfehlungen für just-ship

### Übernehmen / Adaptieren

| Was | Warum | Wie für just-ship |
|-----|-------|-------------------|
| **Budget-Guard** | Runaway-Costs verhindern, besonders auf VPS | Einfacher Token-Limit pro Pipeline-Run in `project.json` (`"max_tokens_per_run": 500000`). Pipeline bricht ab bei Überschreitung. Kein Agent-Level-Budget nötig. |
| **Atomic Task Checkout** | Verhindert Doppelarbeit bei Multi-VPS oder parallelen Claude-Sessions | `SELECT ... FOR UPDATE SKIP LOCKED` im Worker-Query. Ein Feld `locked_by` + `locked_at` in tickets-Tabelle. |
| **Cost-Attribution pro Run** | Transparenz: was hat ein Ticket gekostet? | Summe der Token-Events pro Ticket im Board anzeigen. Daten sind via `send-event.sh` bereits vorhanden, nur Aggregation im Board fehlt. |
| **Session-Resume für unterbrochene Runs** | VPS-Worker stürzt ab → Kontext geht verloren | Branch + letzte Commit-Message als Resume-Point. Orchestrator erkennt: "Branch existiert, Arbeit begonnen, fortsetzen statt neu starten." |

### Beobachten / Evaluieren

| Was | Warum | Wann relevant |
|-----|-------|---------------|
| **Multi-Runtime-Adapter** | Codex/Gemini als Alternative zu Claude | Wenn Anthropic-Preise steigen oder andere Modelle bei bestimmten Tasks besser sind |
| **Skill Injection zur Laufzeit** | Skills ohne Re-Deploy aktualisieren | Wenn just-ship mehr Skill-Varianten hat und häufiger aktualisiert wird |
| **Goal-Ancestry** | Agents verstehen den größeren Kontext | Wenn just-ship über reines Ticket→PR hinauswächst (z.B. Roadmap-Planung) |

### Irrelevant für just-ship

| Was | Warum irrelevant |
|-----|------------------|
| **Company/Org-Chart-Modell** | just-ship modelliert keine Firma, sondern einen Dev-Workflow. Agents haben feste Rollen, keine Hierarchie |
| **Agent-Hiring/Firing** | just-ships Agents sind fest definiert (7 Rollen), nicht dynamisch konfigurierbar |
| **Multi-Company-Isolation** | just-ship hat Workspaces mit Projekten — gleicher Zweck, einfachere Umsetzung |
| **Board-as-Operator-Modell** | just-ships User ist ein Entwickler, kein "Board of Directors" |
| **Continuous-Agent-Mode** | Kein Anwendungsfall — just-ships Agents arbeiten Tasks ab und beenden sich |
| **Approval-Gates** | PR-Review ist der einzige Gate der im Dev-Workflow nötig ist |

---

## 6. Fazit

**Paperclip und just-ship lösen verwandte aber verschiedene Probleme:**

- **Paperclip** baut eine Plattform für "Zero-human Companies" — das Unternehmen als Softwaresystem mit Agents als Angestellten. Der Fokus ist breit: beliebige Business-Operationen, nicht nur Software-Entwicklung.

- **just-ship** ist ein portables Dev-Framework: Ticket rein → PR raus. Es integriert sich in bestehende Projekte und Workflows, statt eine neue Plattform zu sein.

Die stärksten Learnings für just-ship sind operativer Natur:
1. **Budget-Guards** verhindern unkontrollierte Kosten
2. **Atomic Checkout** macht Multi-VPS-Betrieb robust
3. **Cost-Attribution** macht Kosten pro Ticket transparent
4. **Session-Resume** macht unterbrochene Runs recoverable

Paperclips Org-Chart/Company-Modell, Governance-System und Multi-Runtime-Support sind beeindruckend, aber für just-ships fokussierten Dev-Workflow aktuell nicht relevant.

---

## Quellen

- [Paperclip Website](https://paperclip.ing)
- [Paperclip GitHub](https://github.com/paperclipai/paperclip)
- [Paperclip Docs](https://docs.paperclip.ing)
- [DeepWiki — Paperclip Core Concepts](https://deepwiki.com/paperclipai/paperclip/1.1-core-concepts)
