---
name: recover
description: Stuck-Ticket recovern — Resume bei vorhandenem Code, Restart bei leerem Worktree
---

# /recover — Stuck-Ticket recovern

**Du selbst (Hauptkontext) führst KEIN Recovery aus.** Deine einzige Aufgabe: Ticket-Nummer ermitteln, Concurrency-Guard prüfen, dann einen `orchestrator`-Subagent spawnen, der entscheidet ob Resume oder Restart und entsprechend ausführt.

## Ausführung

### Schritt 1 — Ticket-Nummer ermitteln + Concurrency-Guard

```bash
TICKET_NUMBER=$(echo "$ARGUMENTS" | grep -oE '[0-9]+' | head -1)
if [ -z "$TICKET_NUMBER" ] && [ -f .claude/.active-ticket ]; then
  TICKET_NUMBER=$(cat .claude/.active-ticket | grep -oE '[0-9]+' | head -1)
fi
if [ -z "$TICKET_NUMBER" ]; then
  echo "ERROR: /recover benötigt Ticket-Nummer (z.B. /recover T-123) oder aktives Ticket in .claude/.active-ticket" >&2
  exit 1
fi

ACTIVE=$(cat .claude/.active-ticket 2>/dev/null || echo "")
if [ "$ACTIVE" = "$TICKET_NUMBER" ]; then
  # Concurrency-Guard: aktiv bearbeitet
  echo "T-$TICKET_NUMBER wird gerade aktiv bearbeitet." >&2
  exit 1
fi

echo "▶ Recover T-$TICKET_NUMBER"
```

### Schritt 2 — Orchestrator-Subagent spawnen

**Das ist der einzige Implementation-Schritt.** Spawne via Agent-Tool:

```
subagent_type: "orchestrator"
description: "Recover T-{TICKET_NUMBER}"
prompt: |
  ERSTER TOOL-CALL DIESER SESSION (vor allem anderen):
  Read('.claude/agents/orchestrator.md')

  Diese Datei enthält deine Identity, deinen Workflow und deine Skill-Mapping-Tabelle. Befolge sie wörtlich.

  Repo-Root: {REPO_ROOT}
  Ticket: T-{TICKET_NUMBER}

  ## Aufgabe — Recover T-{TICKET_NUMBER}

  Ein Pipeline-Ticket ist möglicherweise stuck. Deine Aufgabe: diagnose, dann Resume oder Restart entscheiden, dann ausführen.

  Diagnose:
  1. Falls Pipeline konfiguriert (`pipeline.workspace_id` in `project.json`): Ticket-State holen via `bash .claude/scripts/board-api.sh get "tickets/{N}"`. Lies `status` und `pipeline_status`.
     - `pipeline_status == "paused"` → STOPP, "T-{N} wartet auf Input — kein Recovery nötig."
     - `status != "in_progress"` UND `pipeline_status` ist NICHT `running`/`crashed` → STOPP, "T-{N} ist nicht blockiert."
  2. Worktree prüfen: `ls -d .worktrees/T-{N}` — existiert?
     - Falls ja: `cd` rein, `git diff --stat $(git merge-base main HEAD)..HEAD` und `git status --porcelain` auswerten.
     - `DIFF_STAT` oder `UNCOMMITTED` nicht leer → **RESUME** (vorhandene Arbeit ist verwertbar).
     - Beide leer → **RESTART** (Worktree existiert aber ohne Inhalt).
     - Falls kein Worktree → **RESTART**.

  Resume-Pfad:
  3. Triage und Planung sind bereits passiert (Code im Worktree IST das Ergebnis). Spawne KEINE Triage erneut.
  4. Bestimme Einstiegspunkt aus dem State:
     - Uncommitted Änderungen → ab Build-Check (siehe Phase 3 in deiner orchestrator.md).
     - Commits aber kein PR → ab Push/PR-Erstellung.
     - PR existiert → ab Automated QA.
  4b. Sync `.active-ticket` IN BEIDE Orte (Hauptrepo + Worktree), damit Subagent-Hooks (`on-agent-start.sh`, `on-agent-stop.sh`) Events ans Board senden können — ohne diesen Sync ist die Resume-Telemetrie unsichtbar (T-1063):
     ```bash
     REPO_ROOT=$(git -C .worktrees/T-{N} rev-parse --git-common-dir 2>/dev/null | xargs -I{} dirname {} 2>/dev/null) || REPO_ROOT=$(pwd)
     echo "{N}" > "$REPO_ROOT/.claude/.active-ticket"
     mkdir -p ".worktrees/T-{N}/.claude"
     echo "{N}" > ".worktrees/T-{N}/.claude/.active-ticket"
     ```
  5. Spawne die jeweils nötigen Subagents (devops bei Build-Failure, qa für Verifikation, code-review wenn nötig). Push + PR + Status-Patch wie gewohnt.
  6. Beende mit Reporter-Voice: `recover — T-{N} fortgesetzt ab {Phase}`.

  Restart-Pfad:
  3. Worktree entfernen: `git worktree remove .worktrees/T-{N} --force`.
  4. Branch löschen (alle Prefixe prüfen):
     ```bash
     for PREFIX in feature fix chore docs; do
       BRANCH=$(git branch --list "${PREFIX}/T-{N}-*" | head -1 | xargs)
       [ -n "$BRANCH" ] && git branch -D "$BRANCH" 2>/dev/null || true
     done
     ```
  5. `.claude/.active-ticket` in beiden Orten leeren falls = {N} (Hauptrepo + Worktree, falls Worktree-Pfad noch existiert):
     ```bash
     REPO_ROOT=$(git rev-parse --show-toplevel)
     [ "$(cat "$REPO_ROOT/.claude/.active-ticket" 2>/dev/null | tr -d '[:space:]')" = "{N}" ] && : > "$REPO_ROOT/.claude/.active-ticket"
     # Worktree wurde in Schritt 3 entfernt — kein zusätzlicher Cleanup nötig.
     ```
  6. Falls Pipeline: Ticket auf `ready_to_develop` zurücksetzen + `pipeline_status: null` via `board-api.sh patch`.
  7. STOPP. NICHT `/develop` selbst aufrufen — der User entscheidet, wann.
  8. Beende mit Reporter-Voice: `recover — T-{N} zurückgesetzt, bereit für /develop`.

  Befolge die Reporter-Voice (`skills/reporter/SKILL.md`) für alle User-sichtbaren Ausgaben — `▶`/`✓`/`↻`/`✗`-Zeilen, keine Prosa.

  Verboten: Triage neu spawnen im Resume-Pfad. `git push --force`. Destruktive Operationen ohne explizite User-Bestätigung im Resume-Pfad.

  Output: kurze Zusammenfassung am Ende. Keine Optionen-Listen, keine Rückfragen.
```

### Schritt 3 — Ergebnis anzeigen

Wenn der Orchestrator-Subagent zurückkommt, zeige sein Output direkt an. Keine zusätzliche Prosa.

## Was DU (Hauptkontext) NICHT tust

- Keine Worktree-Prüfung selbst.
- Kein Branch-Cleanup selbst.
- Kein Status-Reset selbst.
- Keine `/develop`-Wiederaufnahme selbst.

## Fehlerbehandlung

- **Board nicht erreichbar:** Orchestrator-Subagent macht nur lokales Recovery (kein Status-Update).
- **Worktree korrupt:** Orchestrator entfernt mit `--force`, dann Restart.
