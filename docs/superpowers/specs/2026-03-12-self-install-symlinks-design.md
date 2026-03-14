# Self-Install via Symlinks

## Problem

Das Framework-Repo (`just-ship`) hat Commands, Skills und Agents in Root-Verzeichnissen (`commands/`, `skills/`, `agents/`), aber Claude Code erwartet sie unter `.claude/`. Dadurch sind `/develop`, `/ship` etc. im Framework-Repo selbst nicht verfügbar — das Repo kann nicht mit den eigenen Tools weiterentwickelt werden.

## Lösung

Relative Symlinks von `.claude/` auf die Source-Verzeichnisse im Repo-Root.

## Änderungen

### 1. Symlinks erstellen

```
.claude/commands → ../commands
.claude/skills   → ../skills
.claude/agents   → ../agents
```

Git trackt relative Symlinks nativ. Contributors bekommen sie beim Clone automatisch.

**Resultierende `.claude/` Struktur:**

```
.claude/
├── agents → ../agents          (symlink)
├── commands → ../commands      (symlink)
├── skills → ../skills          (symlink)
├── scripts/
│   └── send-event.sh           (real file)
├── settings.json               (real file)
├── worktrees/                  (gitignored)
└── .pipeline-version           (nach setup)
```

`settings.json` und `scripts/` bleiben reale Dateien — sie existieren nur unter `.claude/`, nicht auf Root-Ebene (anders als commands/skills/agents, deren Source of Truth die Root-Verzeichnisse sind).

### 2. setup.sh — Self-Install Guard

`setup.sh` muss erkennen wenn `FRAMEWORK_DIR == PROJECT_DIR` (jemand führt es im Framework-Repo selbst aus) und Symlinks statt Kopien respektieren:

```bash
# Am Anfang beider Modi (setup + update):
if [ "$(cd "$FRAMEWORK_DIR" && pwd -P)" = "$(cd "$PROJECT_DIR" && pwd -P)" ]; then
  echo "Error: Cannot install framework into itself."
  echo "The framework repo uses symlinks — see .claude/commands, .claude/skills, .claude/agents."
  exit 1
fi
```

Zusätzlich: Falls `.claude/commands` ein Symlink ist, Copy-Schritte für dieses Verzeichnis überspringen (Schutz gegen Fehlbedienung):

```bash
# Vor jedem cp-Block:
if [ -L "$PROJECT_DIR/.claude/agents" ]; then
  echo "  ✓ .claude/agents → symlink (skipping)"
else
  cp "$FRAMEWORK_DIR/agents/"*.md "$PROJECT_DIR/.claude/agents/"
fi
```

### 3. CLAUDE.md erstellen

Basierend auf `templates/CLAUDE.md`, mit ausgefüllten Feldern:

**Projekt-Abschnitt:**
> **just-ship** – Portables Multi-Agent-Framework für autonome Softwareentwicklung mit Claude Code. Installierbar in beliebige Projekte via `setup.sh`.

**Code-Konventionen:**
> - TypeScript (Pipeline SDK unter `pipeline/`), Bash (setup.sh, scripts), Markdown (Agents, Commands, Skills)
> - Conventional Commits auf Englisch (`feat:`, `fix:`, `chore:`)
> - Commands, Skills und Agent-Definitionen auf Deutsch

**Architektur:**
```
agents/              Agent-Definitionen (Orchestrator, Backend, Frontend, etc.)
commands/            Slash-Commands (/develop, /ship, /merge, etc.)
skills/              Pipeline-Skills (ticket-writer, frontend-design, etc.)
pipeline/            SDK Pipeline Runner (TypeScript)
  ├── run.ts         Einzellauf
  ├── worker.ts      Supabase-Polling Worker
  └── lib/           Config, Agent-Loading, Event-Hooks
templates/           CLAUDE.md + project.json Templates
vps/                 VPS-Infrastruktur (systemd, Setup-Script)
.claude/             Claude Code Config (symlinks + settings + scripts)
setup.sh             Install/Update Script
```

### 4. project.json

Existiert bereits mit korrekter Pipeline-Config. Stack-Feld aktualisieren:

```json
"stack": {
  "language": "TypeScript / Bash",
  "package_manager": "npm"
}
```

### 5. .gitignore

Keine Änderung nötig — Symlinks werden nicht ignoriert.

## Bekannte Einschränkungen

**Skills-Verzeichnis-Semantik:** Da `.claude/skills/` ein Symlink auf `skills/` ist, landen Framework-eigene Custom-Skills (falls welche hinzugefügt werden) auch in der Source-Directory. Das ist gewollt — im Framework-Repo SIND alle Skills Framework-Skills.

**Windows:** Symlinks erfordern Developer Mode oder WSL. Für das Framework-Repo akzeptabel, da Entwicklung primär auf macOS/Linux stattfindet.

## Nicht im Scope

- Keine Änderung an der Funktionsweise für Zielprojekte (setup.sh kopiert weiterhin)
- Kein neues Tooling oder Build-Step
