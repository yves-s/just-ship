---
applies_to: all-agents
name: recover
description: Stuck-Ticket recovern — Resume bei vorhandenem Code, Restart bei leerem Worktree
---

# /recover — Stuck-Ticket recovern

Erkennt ob ein Pipeline-Ticket steckengeblieben ist und recovered es automatisch: Resume bei vorhandenem Code, Restart bei leerem Worktree.

## Konfiguration

Lies `project.json`. Bestimme den Pipeline-Modus:

1. **Board API** (bevorzugt): Falls `pipeline.workspace_id` gesetzt -> `board-api.sh` verwenden:
   ```bash
   bash .claude/scripts/board-api.sh get "tickets/{N}"
   bash .claude/scripts/board-api.sh patch "tickets/{N}" '{"status": "ready_to_develop"}'
   ```
   Credentials werden intern aufgelöst. `pipeline.project_id` aus `project.json`.
2. **Standalone**: Falls `pipeline.workspace_id` NICHT gesetzt -> Nur lokales Recovery, keine Board-Updates.

## WICHTIGSTE REGEL

**KEINE RUECKFRAGEN.** Entscheide selbst ob Resume oder Restart. Fuehre alle Schritte autonom aus.

## Ausfuehrung

### 0. Ticket-Nummer extrahieren

Aus `$ARGUMENTS`:
- `T-501` -> `501`
- `501` -> `501`

Falls kein Argument uebergeben:
```bash
ACTIVE=$(cat .claude/.active-ticket 2>/dev/null || echo "")
```
Falls `$ACTIVE` nicht leer: verwende `$ACTIVE` als Ticket-Nummer.
Falls leer: Fehlermeldung "Keine Ticket-Nummer angegeben. Nutzung: /recover T-{N}" und stoppen.

### 1. Concurrency Guard

```bash
ACTIVE=$(cat .claude/.active-ticket 2>/dev/null || echo "")
```

Falls `$ACTIVE` == `{N}`: Abbruch mit Meldung "T-{N} wird gerade aktiv bearbeitet." und stoppen.

### 2. Ticket-Status pruefen (falls Pipeline konfiguriert)

Ticket vom Board holen:
```bash
bash .claude/scripts/board-api.sh get "tickets/{N}"
```

`status` und `pipeline_status` aus der Response auslesen.

**Entscheidungslogik:**

- `pipeline_status == paused` -> Meldung "T-{N} wartet auf Input." -> Stop. Das ist human-in-the-loop, NICHT stuck.
- `status != in_progress` UND `pipeline_status` ist NICHT `running`/`crashed` -> Meldung "T-{N} ist nicht blockiert (status={status}, pipeline_status={pipeline_status})." -> Stop.
- Board nicht erreichbar (curl-Fehler, Timeout) -> Warnung ausgeben, nur lokales Recovery fortsetzen.

Falls die Bedingungen erfuellt sind: weiter zu Schritt 3.

### 3. Agent-Failed Event senden

Bevor Cleanup passiert — Evidenz erhalten:

```bash
bash .claude/scripts/send-event.sh {N} orchestrator agent_failed '{"reason": "manual_stop"}'
```

### 4. Worktree pruefen und Modus waehlen

Pruefe ob `.worktrees/T-{N}` existiert:
```bash
ls -d .worktrees/T-{N} 2>/dev/null
```

**Falls Worktree existiert:**

Aenderungen pruefen:
```bash
cd .worktrees/T-{N}
MERGE_BASE=$(git merge-base main HEAD 2>/dev/null || echo "")
DIFF_STAT=""
if [ -n "$MERGE_BASE" ]; then
  DIFF_STAT=$(git diff --stat "$MERGE_BASE"..HEAD)
fi
UNCOMMITTED=$(git status --porcelain)
```

- `$DIFF_STAT` nicht leer ODER `$UNCOMMITTED` nicht leer -> **RESUME** (Schritt 5a)
- Beide leer -> **RESTART** (Schritt 5b)

**Falls kein Worktree existiert:**

Pruefe ob ein Branch fuer das Ticket existiert:
```bash
git branch --list "feature/T-{N}-*" "fix/T-{N}-*" "chore/T-{N}-*" "docs/T-{N}-*" | head -1
```

- Branch mit Commits vorhanden -> **RESTART** (Schritt 5b) — Branch wird aufgeraeumt
- Kein Branch -> **RESTART** (Schritt 5b) — nur Ticket-Reset

### 5a. RESUME Modus

Ausgabe: `Resume — T-{N} hat vorhandene Arbeit, setze fort`

**1. Infrastruktur re-etablieren:**

> **Note:** `.active-ticket` wird automatisch vom PostToolUse-Hook (`detect-ticket-post.sh`) gesetzt, sobald der erste Bash-Befehl im Worktree läuft. Kein manuelles Schreiben nötig.

Orchestrator-Event senden:
```bash
bash .claude/scripts/send-event.sh {N} orchestrator agent_started
```

**2. Vorhandene Arbeit analysieren:**
```bash
cd .worktrees/T-{N}
git diff --stat $(git merge-base main HEAD)..HEAD
git status --porcelain
git log --oneline $(git merge-base main HEAD)..HEAD
```

**3. Phase bestimmen:**

Pruefe ob ein Checkpoint existiert (z.B. `.claude/.checkpoint-T-{N}` oder aehnliche Marker). Falls ja, verwende den Checkpoint.

Falls kein Checkpoint — Heuristik:

| Zustand | Einstiegspunkt |
|---|---|
| Uncommitted Aenderungen vorhanden | Ab Schritt 6 (Build-Check) aus `/develop` |
| Commits vorhanden, kein PR existiert | Ab Schritt 9 (Commit/Push/PR) aus `/develop` |
| PR existiert bereits | Ab Schritt 10 (Automated QA) aus `/develop` |

PR-Existenz pruefen:
```bash
cd .worktrees/T-{N}
gh pr view 2>/dev/null && echo "PR_EXISTS=true" || echo "PR_EXISTS=false"
```

**4. /develop-Schritte fortsetzen:**

Lies `commands/develop.md` und fuehre die Schritte ab dem bestimmten Schritt aus. Alle Schritte im Worktree `.worktrees/T-{N}/` ausfuehren. Ticket-Daten aus dem Board-Response (Schritt 2) verwenden.

**5. WICHTIG:** Triage und Planung werden NICHT wiederholt. Der Code im Worktree IST das Ergebnis der Planung.

### 5b. RESTART Modus

Ausgabe: `Restart — T-{N} hat keine verwertbare Arbeit, starte neu`

**1. Event wurde bereits in Schritt 3 gesendet** (Evidenz erhalten bevor Cleanup).

**2. Aufraeumen:**

Worktree entfernen (falls vorhanden):
```bash
git worktree remove .worktrees/T-{N} --force 2>/dev/null || true
```

Branch loeschen — alle moeglichen Prefixe pruefen:
```bash
for PREFIX in feature fix chore docs; do
  BRANCH=$(git branch --list "${PREFIX}/T-{N}-*" | head -1 | xargs)
  if [ -n "$BRANCH" ]; then
    git branch -D "$BRANCH" 2>/dev/null || true
  fi
done
```

Active-Ticket aufraeumen:
```bash
rm -f .claude/.active-ticket
```

**3. Ticket zuruecksetzen (falls Pipeline konfiguriert):**

```bash
bash .claude/scripts/board-api.sh patch "tickets/{N}" '{"status": "ready_to_develop", "pipeline_status": null}'
```

Beide Felder muessen zurueckgesetzt werden: `status` auf `ready_to_develop` UND `pipeline_status` auf `null`.

**4. /develop aufrufen:**

Rufe `/develop T-{N}` auf — der vollstaendige Entwicklungsflow startet von vorne.

### 6. Abschluss-Ausgabe

**Resume:**
```
recover -- T-{N} fortgesetzt ab Schritt {X}
```

**Restart:**
```
recover -- T-{N} neu gestartet via /develop
```

## Fehlerbehandlung

- **Board nicht erreichbar:** Nur lokales Recovery (Worktree/Branch Cleanup), keine Status-Updates
- **Worktree korrupt:** `git worktree remove --force`, dann RESTART
- **Branch existiert nicht:** Nur Ticket-Reset, dann `/develop`
- **send-event.sh fehlgeschlagen:** Ignorieren, Recovery fortsetzen (Events sind best-effort)
