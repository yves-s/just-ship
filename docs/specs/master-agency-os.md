# Just Ship — Agency OS Master Spec

> Strategisches Leitdokument. Definiert Positionierung, Architektur, Phasen-Abhängigkeiten und Entscheidungslog.
> Dieses Dokument ist das "Warum". Die Phase-Specs (p0–p5) sind das "Was genau".

---

## 1. Positionierung

**Just Ship ist das Betriebssystem für AI-native Agenturen und Freelancer** — mit Shopify-Spezialisierung als erstem Vertikal.

Just Ship ist kein AI Coding Tool. Die Execution Engine (Claude Code, GSD, etc.) wird commodity. Was keiner löst:

1. **Multi-Projekt-Orchestration** — 15 Kundenprojekte mit einer Pipeline
2. **Client-Facing Layer** — Kunde sieht Board, erstellt Tickets via Sidekick, bekommt Reports
3. **Domain-spezifische Intelligence** — Agents die Shopify/Liquid/Hydrogen verstehen
4. **Ökonomisches Modell** — Kosten pro Kunde trackbar, Budget Ceilings, Reporting

Das ist der Moat. Nicht die Engine.

### Abgrenzung

| Layer | Just Ship | GSD 2 / OMC / Aider | Devin / Copilot | Lovable / Bolt |
|---|---|---|---|---|
| **Execution Engine** | Nutzt bestehende (pluggable) | Sind die Engine | Proprietäre Engine | Prompt-to-App |
| **Orchestration** | Multi-Projekt, Multi-Kunde | Single-Projekt | Single-Projekt | Single-Projekt |
| **PM / Client Layer** | Board, Sidekick, Intake | Keiner | Keiner | Keiner |
| **Domain Skills** | Shopify-spezialisiert | Generisch | Generisch | Generisch |
| **Zielgruppe** | Agenturen / Freelancer | Solo-Devs | Teams / Enterprise | Non-technical |

---

## 2. Architektur

```
┌─────────────────────────────────────────────────────┐
│                    AGENCY LAYER                      │
│                                                      │
│  Board (Kanban, Multi-Workspace, Agent Activity)     │
│  Sidekick (Client Chat, Ticket Creation, Kontext)    │
│  Project Intake (Onboarding ohne Account)            │
│  Reports (HTML, pro Kunde, pro Woche)                │
│  Cost Tracking (pro Projekt, pro Ticket)             │
│  Notifications (Telegram, Slack, Email)              │
│                                                      │
├─────────────────────────────────────────────────────┤
│                 ORCHESTRATION LAYER                   │
│                                                      │
│  Ticket Queue (HTTP Trigger / Supabase)              │
│  Agent Router (welcher Agent für welchen Task)       │
│  Skill Loader (Domain Skills pro Projekt)            │
│  State Machine (Triage → Plan → Impl → QA → Ship)   │
│  Budget Controller (Ceiling, Alerts, Tracking)       │
│  Crash Recovery (Checkpoint Persistence, Resume)     │
│                                                      │
├─────────────────────────────────────────────────────┤
│                  EXECUTION ENGINE                    │
│              (pluggable / austauschbar)               │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Claude   │  │ GSD 2    │  │ Future   │          │
│  │ Code +   │  │ (Future) │  │ Engines  │          │
│  │ Agent SDK│  │          │  │          │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                      │
├─────────────────────────────────────────────────────┤
│                   DOMAIN SKILLS                      │
│              (pro Vertikal / pro Projekt)             │
│                                                      │
│  ┌──────────────────────────────────────────┐       │
│  │ Shopify Skills (Liquid, Hydrogen,        │       │
│  │ Storefront API, Admin API, Checkout,     │       │
│  │ Metafields, Theme Architecture, Apps)    │       │
│  └──────────────────────────────────────────┘       │
│  ┌──────────────────────────────────────────┐       │
│  │ Projekt-spezifische Skills               │       │
│  │ (Custom Skills pro Kunde)                │       │
│  └──────────────────────────────────────────┘       │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Skill-Architektur

Skills sind Markdown-Dateien die Agent-Verhalten steuern. Sie werden pro Projekt über `project.json` konfiguriert:

```json
{
  "stack": {
    "platform": "shopify",
    "variant": "liquid"
  },
  "skills": {
    "domain": ["shopify-liquid", "shopify-theme", "shopify-metafields"],
    "custom": ["client-design-system"]
  },
  "pipeline": {
    "skip_agents": ["security", "data-engineer"]
  }
}
```

Der **Skill-Loader** (`pipeline/lib/load-skills.ts`) liest die Projekt-Config und injiziert relevante Skills in die Agent-Prompts. Agents bekommen nur die Skills die für ihre Rolle relevant sind.

### Engine Abstraction (Zukunft — P5)

```typescript
interface ExecutionEngine {
  execute(task: TaskDefinition): Promise<TaskResult>;
  healthCheck(): Promise<boolean>;
  getTokenUsage(): Promise<TokenUsage>;
  canResume(taskId: string): boolean;
  resume(taskId: string): Promise<TaskResult>;
}
```

Phase 1: Claude Code + Agent SDK (aktuell, einzige Implementierung)
Phase 2: GSD 2 als Alternative evaluieren
Phase 3: Weitere Engines nach Bedarf

Das Interface wird in P5 definiert und implementiert. Bis dahin bleibt Claude Code die einzige Engine.

---

## 3. Phasen-Abhängigkeiten

```
                    ┌──────────┐
                    │    P0    │
                    │ Shopify  │
                    │ Skills & │
                    │Foundation│
                    └────┬─────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
              v          │          v
        ┌──────────┐    │    ┌──────────┐
        │    P1    │    │    │    P3    │
        │ Pipeline │    │    │ Shopify  │
        │Stability │    │    │ Advanced │
        └────┬─────┘    │    └──────────┘
             │          │
             v          │
        ┌──────────┐    │
        │    P2    │    │
        │ Agency   │    │
        │ Layer    │    │
        └────┬─────┘    │
             │          │
             │ (soft)   │
             v          │
        ┌──────────┐    │
        │    P4    │    │
        │Ecosystem │    │
        └──────────┘    │
                        │
        ┌──────────┐    │
        │    P5    │◄───┘ (P0 + P1)
        │ Engine   │
        │Abstrac.  │
        └──────────┘
```

### Abhängigkeitsregeln

| Phase | Hard Dependencies | Soft Dependencies | Parallel möglich mit |
|---|---|---|---|
| **P0** | — | — | — |
| **P1** | P0 (Token-Felder, Skill-Loader) | — | P3 |
| **P2** | P1 (Budget Views) | — | P3 |
| **P3** | P0 (Skill-Loader, project.json Schema) | — | P1, P2, P4 |
| **P4** | Board-API (existiert) | P2 (Notifications) | P3 |
| **P5** | P0 (Skill-Loader) + P1 (Resume-Logik) | — | — |

**Kritischer Pfad:** P0 → P1 → P2
**Paralleler Pfad:** P0 → P3 (unabhängig von P1/P2)
**Flexibler Pfad:** P4 kann standalone mit direktem Telegram-Call starten

---

## 4. Done-Metriken (binär, eine pro Phase)

| Phase | Done wenn... |
|---|---|
| **P0** | Der Shopify Test Case läuft komplett über die Pipeline — Ticket erstellt, Skills geladen, Agents mit Shopify-Kontext, Verification Command ausgeführt, Token-Usage in Events |
| **P1** | Der VPS-Worker läuft 48 Stunden ohne manuellen Eingriff durch — inklusive Recovery nach simuliertem Crash, Timeout-Handling, und Budget-Check |
| **P2** | Ein Kunde sieht sein Kosten-Dashboard im Board |
| **P3** | Ein Hydrogen-Projekt läuft komplett über die Pipeline — Ticket erstellt, Hydrogen-Skills geladen, Route gebaut, auf Oxygen deployed |
| **P4** | Das Absorption-System erkennt ein neues GSD 2 Release, analysiert den Changelog, und erstellt automatisch ein Ticket im Board |
| **P5** | Das Engine-Interface existiert als TypeScript-Interface, Claude Code implementiert es, und `pipeline/run.ts` nutzt es statt direkter SDK-Calls |

---

## 5. Entscheidungslog

Entscheidungen getroffen während des Brainstormings am 2026-03-29.

| # | Entscheidung | Begründung |
|---|---|---|
| 1 | **Gesamtes Konzept als Spec** — Master + Phase Specs | Pipeline-Orchestrator braucht pro Ticket klar abgegrenzten Scope. Phase-Specs sind direkt als Ticket-Quelle nutzbar. Master-Spec ist das "stimmt die Richtung noch?"-Dokument. |
| 2 | **Engine Abstraction = Zukunft (P5)** | Die Engine wird commodity, aber aktuell läuft alles über Claude Code + Agent SDK. Interface definieren in P5, nicht implementieren. Keine vorzeitige Abstraktion. |
| 3 | **Feature Absorption vollständig spezifiziert** | Auch P4/P5 Features bekommen vollständige technische Specs mit DB-Schema, Edge Functions, Prompts. So detailliert dass man es bauen kann. |
| 4 | **Existierende 3 Shopify Skills = done** | shopify-liquid, shopify-theme, shopify-metafields sind validiert (Eval-Workspace existiert). Spec spezifiziert nur die 5 fehlenden Skills. |
| 5 | **Sidekick Shopify-Kontext = P0** | Sidekick erkennt `stack.platform` aus Projekt-Config und bietet domainspezifische Ticket-Templates. Trivial zu implementieren, sofort bessere Tickets. Shopify-Daten-Zugriff (API) = separates Feature P3/P4, eventuell als App Extension. |
| 6 | **Cost-Tracking = Event-Schema erweitern** | 4 Felder auf task_events (input_tokens, output_tokens, model, estimated_cost_usd). Keine separate Tabelle. Infrastruktur existiert (Events, Realtime-Subscriptions). Relevante Granularität ist pro Ticket/Projekt, nicht pro Tool-Call. |
| 7 | **Notifications = Event-driven** | task_events INSERT → Edge Function → Kanal-Routing pro Workspace. Telegram Bot existiert, Edge Functions existieren, Events existieren. Zusammenstecken, nicht neu bauen. |
| 8 | **Notification-Secrets raus aus JSONB** | notification_config referenziert Channel-IDs, Credentials in separater workspace_secrets Tabelle mit restriktiver RLS (nur Owner). Secrets nie im selben JSONB wie Config. |
| 9 | **Intake Flow in P2 vorgezogen** | Stärkster Verkaufsmoment: Kunde bekommt Link, beschreibt was er will, 10 Minuten später existiert Projekt + Ticket + Sidekick-Embed. Kein Onboarding-Call, kein Account-Setup. |
| 10 | **pipeline_checkpoint auf tickets** | State-Persistence als JSONB-Feld auf tickets, nicht in task_events. Trennt Pipeline-internen State (Checkpoints) von User-facing Events (Agent-Activity). Einfacher zu lesen, einfacher zu resumen. |
| 11 | **skip_agents in P0** | `pipeline.skip_agents: ["security", "data-engineer"]` in project.json. Simples Feature-Flag statt Declarative Workflow Engine. Shopify-Projekte brauchen keinen Security-Agent für Theme-Changes. Volles YAML-System bleibt P5. |
| 12 | **P3 parallel zu P1/P2** | Shopify Advanced Skills hängen nur an P0 (Skill-Loader existiert). Wenn ein Hydrogen-Kunde kommt bevor P1 fertig ist, blockiert nichts. |
| 13 | **P4 Absorption = soft dependency auf P2** | Nutzt P2 Notification-System wenn vorhanden, funktioniert aber standalone mit direktem Telegram-Call. Linear/GitHub Integration ist komplett unabhängig (hängt nur am Board-API). |
| 14 | **Done-Metriken = binär, eine pro Phase** | Nicht "80% Test Coverage" oder abstrakte KPIs. P0 = Shopify Test Case läuft. P1 = VPS 48h ohne Eingriff. P2 = Kunde sieht Dashboard. Messbar, nicht interpretierbar. |

---

## 6. Shopify Skills Map

### Skill-Agent-Zuordnung

| Agent | Shopify Skills | Wann |
|---|---|---|
| **Orchestrator** | Alle (Überblick) | Immer — plant und delegiert |
| **Frontend** | liquid, theme, hydrogen, checkout (UI) | UI/Theme Changes |
| **Backend** | storefront-api, admin-api, apps, checkout (Functions) | API/Logic Changes |
| **Data Engineer** | admin-api (Bulk Ops), metafields | Daten/Schema Changes |
| **QA** | theme (Theme Check) | Review Phase |
| **DevOps** | theme (CLI), hydrogen (Oxygen) | Build/Deploy |

### Skill-Loader Automatik

| `stack.variant` | Automatisch geladene Skills |
|---|---|
| `liquid` | shopify-liquid, shopify-theme |
| `hydrogen` | shopify-hydrogen, shopify-storefront-api |

`skills.domain` Array in project.json überschreibt die Automatik bei Bedarf.

---

## 7. Bestandsaufnahme (Stand 2026-03-29)

### Existiert und funktioniert
- Board (Kanban, Multi-Workspace, Agent Activity, Realtime)
- Sidekick (AI Chat, Ticket Creation, Search, Image Upload, Page Context)
- Pipeline SDK (run.ts, server.ts, 8 Agents, Event-Hooks)
- VPS-Infrastruktur (Docker, Caddy, HTTP Endpoints)
- 3 Shopify Skills (liquid, theme, metafields) + Eval-Workspace
- 14 CLI Commands, 25+ Skills
- Telegram Bot
- setup.sh (Installation/Update)

### Existiert nicht (wird gebaut)
- Skill-Loader (pipeline/lib/load-skills.ts)
- project.json Schema-Erweiterungen (platform, skills, skip_agents)
- Verification Commands in Pipeline
- Sidekick Shopify-Kontext
- Token-Tracking in Events
- Crash Recovery / Checkpoint Persistence
- Budget Tracking / Ceiling
- Kosten-Dashboard
- HTML Reports
- Notification-System (Event-driven)
- Project Intake Flow
- 5 weitere Shopify Skills
- Feature Absorption System
- Engine Abstraction Interface
- Declarative Workflow Engine

---

## Phase-Specs

- [P0 — Shopify Skills & Foundation](p0-shopify-skills.md)
- [P1 — Pipeline-Stabilität](p1-pipeline-stability.md)
- [P2 — Agency Layer](p2-agency-layer.md)
- [P3 — Shopify Advanced Skills](p3-shopify-advanced.md)
- [P4 — Ecosystem & Feature Absorption](p4-ecosystem.md)
- [P5 — Engine Abstraction & Scale](p5-engine-abstraction.md)
