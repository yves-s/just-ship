# CLAUDE.md – just-ship Project Instructions

> Dieses Dokument wird von Claude Code automatisch gelesen.
> Projektspezifische Konfiguration (Stack, Build-Commands, Pfade, Pipeline-Verbindung) liegt in `project.json`.

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
