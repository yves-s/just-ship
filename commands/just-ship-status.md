---
name: just-ship-status
description: /just-ship-status — Lokalen Repo-Zustand anzeigen (Branches, PRs, Board, Worktrees)
---

# /status — Lokalen Repo-Zustand anzeigen

Read-only Uebersicht ueber den lokalen Zustand des Repos. Keine Aktionen, nur Anzeige.

## WICHTIGSTE REGEL

**Dieser Command aendert NICHTS.** Kein Commit, kein Push, kein Status-Update, kein Branch-Wechsel. Reine Informationsanzeige.

## Konfiguration

Lies `project.json` fuer Projekt-Name und Pipeline-Config.

**Pipeline (optional):** Falls `pipeline.workspace_id` gesetzt → Credentials aufloesen:
```bash
WS_ID=$(node -e "process.stdout.write(require('./project.json').pipeline?.workspace_id || '')")
WS_JSON=$(bash .claude/scripts/write-config.sh read-workspace --id "$WS_ID")
BOARD_URL=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).board_url)")
API_KEY=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).api_key)")
```

Falls `pipeline.workspace_id` NICHT gesetzt: Board-Abfrage komplett ueberspringen, nur lokale Daten anzeigen.

## Ausfuehrung

### 1. Daten sammeln

Fuehre folgende Abfragen parallel aus:

**1a. Lokale Branches mit Tracking-Status:**
```bash
git fetch origin --prune 2>/dev/null
git for-each-ref --format='%(refname:short) %(upstream:track) %(upstream:short)' refs/heads/ | grep -v '^main$'
```

Fuer jeden Feature/Fix/Chore-Branch: Behind/Ahead gegenueber main ermitteln:
```bash
git rev-list --left-right --count main...{branch}
```

**1b. Offene PRs:**
```bash
gh pr list --json number,headRefName,url,state --limit 50
```

**1c. Board-Ticket-Status (nur wenn Pipeline konfiguriert):**

Ticket-Nummern aus Branch-Namen extrahieren (Pattern: `T-{N}` oder `{N}-` am Anfang nach dem Prefix).

Fuer jede gefundene Ticket-Nummer:
```bash
curl -s -H "X-Pipeline-Key: {api_key}" "{board_url}/api/tickets/{N}"
```

Status-Feld (`status`) aus der Response extrahieren.

**1d. Aktive Worktrees:**
```bash
git worktree list --porcelain
```

### 2. Ausgabe formatieren

Projekt-Name aus `project.json` lesen (`name` Feld) oder aus dem Verzeichnisnamen ableiten.

```
Lokaler Zustand — {project-name}
----------------------------------------------
Branch                                  PR       Board
feature/T-287-universal-event-streaming -        -
fix/T-385-members-unknown-display       -        in_review
fix/worktree-stale-cleanup              gone     -
```

**Spalten:**
- **Branch:** Alle lokalen Branches ausser `main` (Feature-, Fix-, Chore-, Docs-Branches)
- **PR:** PR-Nummer (`#N`) falls ein offener PR fuer diesen Branch existiert, `-` falls keiner, `gone` falls der Remote-Branch geloescht wurde
- **Board:** Ticket-Status aus dem Board (z.B. `in_progress`, `in_review`, `done`), `-` falls kein Ticket zugeordnet oder Pipeline nicht konfiguriert

### 3. Worktrees anzeigen

Falls aktive Worktrees vorhanden (ausser dem Haupt-Worktree):
```
Worktrees:
  .worktrees/T-287  feature/T-287-universal-event-streaming
  .worktrees/T-385  fix/T-385-members-unknown-display
```

Falls keine aktiven Worktrees:
```
Worktrees: keine aktiven
```

### 4. Empfehlungen generieren

Analysiere die gesammelten Daten und generiere Empfehlungen fuer:

- **Stale Branches:** Remote-Tracking zeigt `[gone]` → Branch kann geloescht werden
- **Veraltete Branches:** Branch ist >50 Commits hinter main → sollte rebased oder geloescht werden
- **Verwaiste Worktrees:** Worktree existiert, aber kein offenes Ticket/PR dafuer

Nur anzeigen wenn es Empfehlungen gibt:
```
Empfehlungen:
  fix/worktree-stale-cleanup — Remote geloescht, Branch kann weg
  fix/T-385-members-unknown-display — 41 Commits hinter main
  .worktrees/T-290 — kein offenes Ticket, Worktree kann aufgeraeumt werden
```

Falls keine Empfehlungen: Abschnitt weglassen.

### 5. Sonderfall: Keine Branches

Falls keine Feature/Fix/Chore-Branches existieren (nur `main`):
```
Lokaler Zustand — {project-name}
----------------------------------------------
Keine offenen Branches.

Worktrees: keine aktiven
```

## Hinweise

- Dieser Command ist **rein informativ** — er aendert nichts am Repo, Board oder Git-Status
- Board-Abfrage nur wenn `pipeline.workspace_id` in `project.json` existiert
- Ticket-Nummern immer mit `T-` Prefix anzeigen, NIEMALS mit `#`
- Falls Board-API nicht erreichbar: Board-Spalte mit `?` fuellen und Hinweis ausgeben
- Falls `gh` nicht verfuegbar: PR-Spalte mit `?` fuellen
