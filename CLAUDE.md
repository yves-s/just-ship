# CLAUDE.md – just-ship Project Instructions

> Dieses Dokument wird von Claude Code automatisch gelesen.
> Projektspezifische Konfiguration (Stack, Build-Commands, Pfade, Pipeline-Verbindung) liegt in `project.json`.

---

## Decision Authority

This project operates with a clear boundary between human decisions and team decisions.

### The Human Decides (ask them):
- Product vision, priorities, scope, go/no-go
- Target audience and business context
- Brand direction and creative impulses
- "Build A or B first?", "MVP or full version?", "Is this worth the complexity?"

### The Team Decides (never ask — consult skills, decide, explain briefly):
- ALL architecture: database schema, API design, caching, queues, sync vs async
- ALL design: spacing, colors, typography, layout, component patterns, animations
- ALL UX: navigation patterns, interaction patterns, mobile vs desktop approach, states
- ALL ops: logging structure, monitoring, alerting, deployment, CI/CD, error handling
- ALL security: auth patterns, RLS policies, input validation, rate limiting
- ALL testing: test strategy, what to test, coverage approach

### The Rule
**If a Senior Engineer / Designer / UX Lead at a top company would make this decision without asking their CEO → make it without asking the user.**

### Context vs. Decision
- ✅ Ask for CONTEXT: "Is this mobile-first or desktop-first?" (only the user knows this)
- ❌ Ask for DECISION: "Should I use a bottom sheet or modal?" (you know the answer)
- ❌ Ask for DECISION: "Should I use Redis or Postgres for caching?" (you know the answer)
- ❌ Ask for DECISION: "Want me to add tests?" (yes, always — that's your job)
- ❌ Present options: "We could do A, B, or C — which do you prefer?" (recommend one, explain why)

### When the User Gives an Impulse
"I saw this and liked it" or "make it feel like Linear" = creative brief, not specification.
1. Extract the principle (what specifically resonated?)
2. Apply it through your expert lens
3. State what you extracted: "Taking the information density and animation restraint from Linear."

### Escalation — Only When Genuinely Needed
Escalate to the user ONLY when:
- Two valid approaches lead to fundamentally different products (not different implementations)
- A business constraint or context is needed that you can't infer
- The scope is significantly larger/smaller than expected and needs confirmation
- Something will visibly break existing user expectations

Frame escalations as recommendations: "I recommend X because Y. Alternative Z trades off A for B. Your call on the product direction."

### Agent Application

**Orchestrator:** Before delegating to agents, the Orchestrator resolves all implementation questions by consulting the relevant skill or domain knowledge. Agents receive clear decisions, not open questions. If the Orchestrator encounters a question it would normally ask the user, it checks:
1. Does a skill cover this? → Apply the skill's recommendation
2. Is there a project convention? → Follow it
3. Is this an expert-level decision? → Make it based on best practices
4. Is this genuinely a product/vision question? → Only then escalate

**Agents (Backend, Frontend, Data Engineer, DevOps, QA, Security):** Each agent operates as a senior specialist. They make autonomous decisions within their domain, apply their skill's standards without asking for confirmation, log decisions briefly in commit messages or PR descriptions, and never produce output that asks the user "which approach do you prefer?"

**QA Agent:** Reviews not just for correctness but for autonomy violations — if any agent asked the user a question it should have answered itself, that's a quality issue equivalent to a missing test.

### Skill Loading

Skills are loaded for every task, not on request. The Orchestrator reads relevant skills before planning and injects their standards into agent instructions. Skills are experts on the team — they're always in the room, not called in optionally.

Priority order:
1. Decision Authority (this section) — always
2. Domain skill for the task (backend, frontend-design, data-engineer, etc.)
3. Cross-cutting skills (product-cto, design-lead) for features that span domains

### Quality Standard

The baseline for every output is: **Would a senior engineer at Linear/Vercel/Stripe ship this?**

Not "does it work?" but "is it excellent?" Every agent asks themselves this before marking a task complete. If the answer is no, they improve it — they don't ask the user if "good enough" is acceptable.

---

## Projekt

**just-ship** – Portables Multi-Agent-Framework für autonome Softwareentwicklung mit Claude Code. Installierbar in beliebige Projekte via `setup.sh`.

### Ecosystem

Dieses Repo ist die **Engine** des Just Ship Produkts. Für den vollständigen Überblick über alle Repos (Board, Bot, Web), Features und wie sie zusammenhängen, lies `PRODUCT.md` im Root dieses Repos.

---

## Konventionen

### Git
- **Branches:** `feature/{ticket-id}-{kurzbeschreibung}`, `fix/...`, `chore/...`
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`)
- **Sprache:** Commit Messages auf Englisch

### Code
- TypeScript (Pipeline SDK unter `pipeline/`), Bash (`setup.sh`, Scripts), Markdown (Agents, Commands, Skills)
- Conventional Commits auf Englisch (`feat:`, `fix:`, `chore:`)
- Commands und Agent-Definitionen auf Deutsch, Skills auf Englisch

### Dateien
- Keine Dateien löschen ohne explizite Anweisung

---

## Autonomer Modus

Dieses Repo nutzt ein Multi-Agent-System. Ob lokal oder auf dem Server:

1. **Arbeite autonom** — keine interaktiven Fragen, keine manuellen Bestätigungen
2. **Plane selbst** — kein Planner-Agent, keine Spec-Datei. Lies betroffene Dateien direkt und gib Agents konkrete Instruktionen
3. **Wenn unklar:** Konservative Lösung wählen, nicht raten
4. **Commit + PR** am Ende des Workflows → Board-Status "in_review"
5. **Merge erst nach Freigabe** — User sagt "passt"/"ship it" oder `/ship`

### Workflow-Modi

Es gibt drei Modi, je nach Situation. Punkte 4+5 oben gelten für **Geplant** und **Ad-hoc**, nicht für Auto-Heal:

| Modus | Trigger | Ticket | Branch | Review | Board |
|---|---|---|---|---|---|
| **Geplant** | User wählt Ticket (`/develop`) | existiert bereits | `feature/T-xxx-...` | PR + User-Review | `in_progress` → `in_review` → `done` |
| **Ad-hoc** | User sagt "fix das" | optional | `fix/beschreibung` | PR + User-Review | — |
| **Auto-Heal** | System erkennt Fehler | wird automatisch erstellt | `fix/auto-heal-T-xxx` | **kein PR, direkt merge** | `created` → `done` |

**Geplant** = Standard-Workflow via `/develop` → `/ship`. Ticket existiert, Board-Updates sind Pflicht.

**Ad-hoc** = User findet Bug in Session, will sofort fixen. Worktree erstellen, fix, PR. Kein Ticket nötig, kein Board-Update.

**Auto-Heal** = Pipeline erkennt Fehler und fixt ihn selbstständig:
1. Error Handler klassifiziert den Fehler (rule-based + AI triage)
2. Bei `auto_heal`: Bug-Ticket wird erstellt (Audit-Trail)
3. Fix wird implementiert und direkt gemergt (kein PR, kein Review)
4. Bei Fehlschlag: Ticket bleibt auf `ready_to_develop`, User entscheidet

## Ticket-Workflow (Just Ship Board)

> Nur aktiv wenn `pipeline.workspace_id` und `pipeline.project_id` in `project.json` gesetzt sind. Ohne Pipeline-Config werden diese Schritte übersprungen.

Falls Pipeline konfiguriert ist, sind Status-Updates **PFLICHT**:

| Workflow-Schritt | Board-Status | Wann |
|---|---|---|
| `/ticket` — Ticket schreiben | — | Erstellt ein neues Ticket im Board |
| `/develop` — Ticket implementieren | **`in_progress`** | Sofort nach Ticket-Auswahl, VOR dem Coding |
| `/ship` — PR mergen & abschließen | **`done`** | Nach erfolgreichem Merge |

**Board-API-Aufrufe** — IMMER `board-api.sh` verwenden (versteckt Credentials im Terminal-Output):
```bash
# GET request
bash .claude/scripts/board-api.sh get "tickets/{N}"

# GET with query params
bash .claude/scripts/board-api.sh get "tickets?status=ready_to_develop&project={UUID}"

# PATCH request
bash .claude/scripts/board-api.sh patch "tickets/{N}" '{"status": "in_progress"}'

# POST request
bash .claude/scripts/board-api.sh post tickets '{"title": "...", "body": "..."}'
```

**WICHTIG:**
- **NIEMALS** direkt `curl` mit `X-Pipeline-Key` Header verwenden — das zeigt den API-Key im Terminal
- **NIEMALS** `cat ~/.just-ship/config.json` ausgeben oder manuell nach Workspaces suchen
- **NIEMALS** `write-config.sh read-workspace` in inline Bash aufrufen — das gibt Credentials auf stdout aus
- `board-api.sh` löst Credentials intern auf und gibt nur die API-Response zurück

**Überspringe KEINEN dieser Schritte.** Falls ein Update fehlschlägt, versuche es erneut oder informiere den User.

---

## Architektur

```
agents/              Agent-Definitionen (Orchestrator, Backend, Frontend, etc.)
commands/            Slash-Commands (/develop, /ship, etc.)
skills/              Pipeline-Skills (ticket-writer, frontend-design, etc.)
pipeline/            SDK Pipeline Runner (TypeScript)
  ├── run.ts         Einzellauf + Session Resume (human-in-the-loop)
  ├── worker.ts      Supabase-Polling Worker
  ├── server.ts      HTTP Server (Webhooks, /api/answer für Resume)
  └── lib/           Config, Agent-Loading, Event-Hooks
templates/           CLAUDE.md + project.json Templates
vps/                 VPS-Infrastruktur (systemd, Setup-Script)
.claude/             Claude Code Config (symlinks auf agents/, commands/, skills/ + settings + scripts)
setup.sh             Install/Update Script
```

---

## Sicherheit

- Keine API Keys, Tokens oder Secrets im Code
- Input Validation auf allen Endpoints

---

## Konversationelle Trigger

**"passt"**, **"done"**, **"fertig"**, **"klappt"**, **"sieht gut aus"** → automatisch `/ship` ausführen

**Wichtig:** `/ship` läuft **vollständig autonom** — keine Rückfragen bei Commit, Push, PR oder Merge. Der User hat seine Freigabe bereits gegeben.
