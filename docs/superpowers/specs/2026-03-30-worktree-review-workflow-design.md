# Worktree Review Workflow — Design Spec

**Datum:** 2026-03-30
**Status:** Approved
**Kontext:** Lokaler und VPS-basierter Workflow, Tickets in Review gehen unter weil kein Mechanismus existiert der den Zustand sichtbar macht und lokales Testen + Shippen ermoeglicht.

---

## Problem

Wenn der VPS (oder eine andere Claude-Session) ein Ticket implementiert und in `in_review` setzt, gibt es keinen Workflow um:

1. Zu sehen welche Tickets/Branches offen sind
2. Einen Branch lokal auszuchecken und den Dev-Server zu starten
3. Nach dem Testen direkt zu shippen

Das fuehrt dazu, dass Tickets in Review versauern, Worktrees und Branches stale werden, und der User manuell `git checkout`, `npm install`, `npm run dev` etc. ausfuehren muss.

## Loesung

Drei Aenderungen am Command-Set:

1. **`/status`** — Read-only Uebersicht ueber den lokalen Repo-Zustand
2. **`/review`** — Branch auschecken, builden, Dev-Server starten, auf Feedback warten
3. **`/ship` Erweiterung** — Ticket-Argument, Dev-Server-Cleanup, Stale-Hinweis

### Lifecycle

```
VPS: /develop T-385
  -> implementiert, pushed, PR erstellt, Board -> in_review

User (lokal):
  -> /status                          # Uebersicht: "T-385 ist in_review"
  -> /review                          # Popup: Branch auswaehlen
     oder /review T-{N}              # Direkteinstieg
       -> checkout, install, build, dev-server
       -> "Laeuft auf localhost:3000"
       -> User testet im Browser
       -> "passt"                    # -> /ship autonom
          -> commit (falls noetig), push, merge, cleanup
          -> Dev-Server gestoppt
          -> Branch + Worktree aufgeraeumt
          -> Zurueck auf main
          -> Board -> done
```

---

## 1. `/status` Command

### Zweck

Read-only Uebersicht ueber den lokalen Zustand des Repos. Keine Aktionen, nur Anzeige.

### Output-Format

```
Lokaler Zustand — {project-name}
----------------------------------------------
Branch                                  PR       Board
feature/287-universal-event-streaming   -        -
fix/T-385-members-unknown-display       -        in_review
fix/worktree-stale-cleanup              gone     -

Worktrees: keine aktiven

Empfehlungen:
  fix/worktree-stale-cleanup — Remote geloescht, Branch kann weg
  fix/T-385-members-unknown-display — 41 Commits hinter main
```

### Datenquellen

| Daten | Quelle |
|---|---|
| Lokale Branches + behind/ahead | `git branch -v` |
| Offene PRs | `gh pr list` |
| Board-Ticket-Status | Board API (nur wenn `pipeline.workspace_id` konfiguriert) |
| Aktive Worktrees | `git worktree list` |

### Regeln

- Keine Aktionen, reine Anzeige
- Board-Abfrage nur wenn `pipeline.workspace_id` in `project.json` existiert
- Empfehlungen generieren fuer:
  - Stale Branches (`[gone]` auf Remote)
  - Branches die >50 Commits hinter main sind
  - Worktrees ohne aktives Ticket
- Falls keine Feature/Fix-Branches existieren: "Keine offenen Branches."

### Board API Credentials

Gleiche Aufloesung wie in `/develop` und `/ship`:
```bash
WS_ID=$(node -e "process.stdout.write(require('./project.json').pipeline?.workspace_id || '')")
WS_JSON=$(bash .claude/scripts/write-config.sh read-workspace --id "$WS_ID")
BOARD_URL=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).board_url)")
API_KEY=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).api_key)")
```

Nur ausfuehren wenn `pipeline.workspace_id` in `project.json` gesetzt ist.

---

## 2. `/review` Command

### Zweck

Den fehlenden Schritt zwischen Board und `/ship` — Branch lokal auschecken, builden, Dev-Server starten, testen, dann shippen oder fixen.

### Zwei Modi

#### `/review` (ohne Argument) — Branch-Auswahl

Sammelt alle Feature/Fix-Branches mit Kontext (PR-Status, Board-Status) und praesentiert sie als Auswahl (Multiple-Choice-Optionen im Chat):

```
Welchen Branch willst du reviewen?

a) fix/T-385-members-unknown-display (in_review, PR vorhanden)
b) feature/287-universal-event-streaming (kein PR)
c) fix/worktree-stale-cleanup (remote gone)
```

Der User waehlt eine Option, dann weiter mit dem Review-Flow.

Falls keine Branches vorhanden: "Keine offenen Branches zum Reviewen."

#### `/review T-{N}` (mit Ticket-Nummer) — Direkteinstieg

Findet den zugehoerigen Branch automatisch via Pattern-Match:
- `*/T-{N}-*` (z.B. `fix/T-385-members-unknown-display`)
- `*/{N}-*` (z.B. `feature/287-universal-event-streaming`)

Falls kein Branch gefunden: Fehlermeldung.

### Review-Flow

| Schritt | Aktion | Details |
|---|---|---|
| 1 | Branch finden | Ticket-Nummer -> Branch-Name matchen |
| 2 | Auschecken | Worktree reaktivieren falls in `.worktrees/` vorhanden, sonst `git checkout {branch}` |
| 3 | Dependencies | Install-Command aus `project.json` oder auto-detect (`npm install`, `pip install`, etc.) |
| 4 | Build | Build-Command aus `project.json` ausfuehren |
| 5 | Dev-Server | Dev-Command aus `project.json` im Background starten |
| 6 | Meldung | "Laeuft auf localhost:{port} — schau's dir an. Sag 'passt' zum Shippen oder beschreib was gefixt werden soll." |
| 7 | Warten | User testet im Browser |
| 8a | "passt" | -> `/ship` autonom ausfuehren |
| 8b | "fix X" | -> Claude fixt, dann zurueck zu Schritt 4 (siehe Fix-Loop) |

### Fix-Loop (Schritt 8b)

Wenn der User einen Fix beschreibt:
1. Claude fixt direkt in der aktuellen Session (kein Sub-Agent)
2. Dependencies werden NUR neu installiert wenn `package.json` / `requirements.txt` etc. geaendert wurde
3. Build wird neu ausgefuehrt
4. Dev-Server wird neu gestartet (alter Prozess gekillt, neuer gestartet)
5. Meldung: "Fix angewendet, Dev-Server laeuft. Nochmal testen?"
6. Kein Iterations-Limit — der User entscheidet wann "passt"

Falls der Fix den Build bricht: Output zeigen, Claude versucht den Build-Fehler zu beheben.

### Worktree-Handling

- Falls ein Worktree fuer den Branch existiert (`.worktrees/T-{N}` oder `.worktrees/worker-*` mit passendem Branch): diesen benutzen
- Falls nicht: `git checkout {branch}` im aktuellen Repo (kein neuer Worktree — der Branch existiert bereits)

### Dev-Server

- Command aus `project.json` Feld `build.dev` (z.B. `npm run dev`)
- Wird im Background gestartet (Bash `run_in_background`)
- Falls `build.dev` nicht konfiguriert: Dev-Server ueberspringen, nur Build-Ergebnis melden
- Port-Erkennung: aus dem Dev-Server-Output parsen oder aus `project.json` Feld `build.dev_port`

### Error Handling

- Build-Fehler: Output zeigen, fragen ob trotzdem Dev-Server starten
- Checkout-Fehler (uncommitted changes): Warnung, abbrechen
- Kein Branch gefunden: Fehlermeldung mit Hinweis auf `/status`
- Bereits auf einem Review-Branch mit laufendem Dev-Server: alten Dev-Server stoppen (PID aus `.claude/.dev-server-pid`), dann neuen Branch auschecken

---

## 3. `/ship` Erweiterung

### Neues Verhalten

| Feature | Aktuell | Neu |
|---|---|---|
| Ticket-Argument | - | `/ship T-{N}` findet Branch, checkt aus, shipped |
| Dev-Server stoppen | - | Falls ein Background Dev-Server laeuft, Prozess killen vor Merge |
| Lokalen Branch loeschen | Implizit via `--delete-branch` (Remote) | Auch lokal: `git branch -d {branch}` nach Merge |
| Stale-Branch-Hinweis | - | Nach Ship: wenn andere Branches `[gone]` oder >50 Commits behind, kurzer Hinweis |

### `/ship` ohne Argument

Wie bisher: shipped den aktuellen Branch. Fehler wenn auf `main`.

### `/ship T-{N}` mit Argument

1. Branch zum Ticket finden (gleiche Logik wie `/review`)
2. `git checkout {branch}`
3. Normaler `/ship`-Flow ab Schritt 1

### Dev-Server Cleanup

**PID-Tracking:** Wenn `/review` den Dev-Server startet, wird die PID in `.claude/.dev-server-pid` gespeichert.

Vor dem Merge-Schritt:
1. `.claude/.dev-server-pid` lesen
2. Falls PID existiert und Prozess laeuft: `kill {PID}`
3. PID-Datei loeschen
4. Fallback falls PID-Datei fehlt: Port-basiert via `lsof -ti :{port} | xargs kill` (nur wenn `build.dev_port` konfiguriert)

---

## 4. `project.json` Erweiterung

Neue optionale Felder unter dem bestehenden `build`-Key (kein neuer Top-Level-Key):

```json
{
  "build": {
    "web": "npm run build",
    "test": "npm run test",
    "install": "npm install",
    "dev": "npm run dev",
    "dev_port": 3000
  }
}
```

| Feld | Pflicht | Default | Beschreibung |
|---|---|---|---|
| `build.install` | nein | Auto-detect aus `package.json`, `requirements.txt` etc. | Dependency-Installation |
| `build.web` | nein | - | Build-Command (bereits bestehend) |
| `build.dev` | nein | - | Dev-Server starten |
| `build.dev_port` | nein | Aus Output parsen | Port fuer die "laeuft auf localhost:X" Meldung |

**Keine Breaking Changes:** `build.web` und `build.test` bleiben wie gehabt. Neue Felder sind additiv.

---

## 5. Betroffene Dateien

| Datei | Aenderung |
|---|---|
| `commands/status.md` | Ersetzt (aktuell Legacy Supabase, wird auf Board API + erweiterten Scope umgeschrieben) |
| `commands/review.md` | Neu |
| `commands/ship.md` | Erweitert (Ticket-Argument, Dev-Server-Cleanup, Stale-Hinweis, lokaler Branch-Cleanup) |
| `project.json` | Doku: neue `build.dev`, `build.dev_port`, `build.install` Felder |
| `templates/project.json` | Template um `build.dev` erweitern |

---

## Nicht im Scope

- Notifications (Slack/Mail wenn Ticket in Review) — Zukunft
- Automatisches Stale-Branch-Cleanup — nur Hinweis, kein Loeschen
- Board-UI-Integration fuer Review-Flow
- VPS-Worker-Aenderungen — der Worker hat seinen eigenen WorktreeManager
