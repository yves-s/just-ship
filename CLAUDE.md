# CLAUDE.md – just-ship Project Instructions

> Dieses Dokument wird von Claude Code automatisch gelesen.
> Projektspezifische Konfiguration (Stack, Build-Commands, Pfade, Pipeline-Verbindung) liegt in `project.json`.

---

## Projekt

**just-ship** – Portables Multi-Agent-Framework für autonome Softwareentwicklung mit Claude Code. Installierbar in beliebige Projekte via `setup.sh`.

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

## Ticket-Workflow (Just Ship Board)

> Nur aktiv wenn `pipeline.project_id` in `project.json` gesetzt ist. Ohne Pipeline-Config werden diese Schritte übersprungen.

Falls Pipeline konfiguriert ist, sind Status-Updates **PFLICHT**:

| Workflow-Schritt | Board-Status | Wann |
|---|---|---|
| `/ticket` — Ticket schreiben | — | Erstellt ein neues Ticket im Board |
| `/develop` — Ticket implementieren | **`in_progress`** | Sofort nach Ticket-Auswahl, VOR dem Coding |
| `/ship` — PR mergen & abschließen | **`done`** | Nach erfolgreichem Merge |

Status-Updates via `mcp__claude_ai_Supabase__execute_sql` mit `pipeline.project_id`:
```sql
UPDATE public.tickets
SET status = '{status}'
WHERE number = {N}
  AND workspace_id = '{pipeline.workspace_id}'
RETURNING number, title, status;
```

**Überspringe KEINEN dieser Schritte.** Falls ein Update fehlschlägt, versuche es erneut oder informiere den User.

---

## Architektur

```
agents/              Agent-Definitionen (Orchestrator, Backend, Frontend, etc.)
commands/            Slash-Commands (/develop, /ship, etc.)
skills/              Pipeline-Skills (ticket-writer, frontend-design, etc.)
pipeline/            SDK Pipeline Runner (TypeScript)
  ├── run.ts         Einzellauf
  ├── worker.ts      Supabase-Polling Worker
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
