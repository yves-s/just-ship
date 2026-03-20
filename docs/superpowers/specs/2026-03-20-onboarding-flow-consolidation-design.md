# Onboarding Flow Consolidation — Phase 1: Framework

> Erstellt: 2026-03-20
> Scope: just-ship Repo (CLI, Commands, Scripts)
> Vorgänger: [Onboarding Consistency Analysis](2026-03-20-onboarding-consistency-analysis.md)

---

## Problem

Der Onboarding-Flow ist über drei Oberflächen verteilt (Board, Terminal, Claude Code) und jede gibt widersprüchliche Anweisungen. 12 Inkonsistenzen, 5 verschiedene Wege einen Workspace zu verbinden, 5-7 Oberflächenwechsel. Details in der Analyse.

## Ziel

Ein linearer, konsistenter Onboarding-Flow:
- **Ein Weg** zum Verbinden (nicht fünf)
- **Jeder Schritt nennt genau einen nächsten Schritt** (keine Mehrfachoptionen)
- **Kein Secret-Handling in Claude Code** (Secrets nur im Terminal)
- **`just-ship connect` verknüpft Workspace UND Projekt** in einem Schritt

## SOLL-Flow

```
Board                    Terminal                 Claude Code
-----                    --------                 -----------
1. Register + Login
   Workspace erstellen

2. Stepper: "Projekt
   verbinden"
   → curl ... | bash     ──>
                          3. install.sh
                          Output: "Run
                          /setup-just-ship
                          in Claude Code"    ──>
                                              4. /setup-just-ship
                                              Stack erkennen,
                                              project.json füllen
                                              → "Board verbinden?"
                                              → Falls ja: "Geh zu
                                                Settings → Connect
                                                und kopiere den Code.
                                                Führe just-ship connect
                                                im Terminal aus."
   <──
   5. Settings → Connect
   User kopiert Code
                          <──
                          6. just-ship connect
                          "jsp_..."
                          Setzt Workspace UND
                          Projekt automatisch
                          Output: "Verbunden!
                          Erstelle dein erstes
                          Ticket mit /ticket
                          in Claude Code."     ──>
                                              7. /ticket
```

**6 Schritte, 4 Oberflächenwechsel, 0 Widersprüche.**

---

## Änderungen

### 1. `just-ship connect` — Projekt automatisch verknüpfen

**Datei:** `bin/just-ship` (connect Subcommand) + `scripts/write-config.sh` (connect Command)

**Aktuell:** `just-ship connect "jsp_..."` setzt nur den Workspace. Danach muss `/add-project` separat ausgeführt werden.

**Neu:** Nach dem Workspace-Connect fragt das Script die Board-API nach Projekten ab:

```bash
# Nach erfolgreichem add-workspace:
# 1. Board-API nach Projekten im Workspace fragen
PROJECTS=$(curl -s -H "X-Pipeline-Key: $API_KEY" "$BOARD_URL/api/projects")

# 2. Projekte zählen
PROJECT_COUNT=$(echo "$PROJECTS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
projects = data.get('data', {}).get('projects', [])
print(len(projects))
")

# 3. Entscheidung
# - 0 Projekte: Hinweis "Erstelle ein Projekt im Board"
# - 1 Projekt: automatisch set-project
# - 2+ Projekte: User fragen welches (nummerierte Liste)
```

**Output nach erfolgreichem Connect:**
```
✓ Workspace 'my-workspace' connected
✓ Project 'My Project' linked
✓ Board connection verified

Erstelle dein erstes Ticket mit /ticket in Claude Code.
```

**Output bei 0 Projekten:**
```
✓ Workspace 'my-workspace' connected

⚠ Kein Projekt im Board gefunden.
  Erstelle ein Projekt unter board.just-ship.io → Settings → Projects,
  dann führe 'just-ship connect' erneut aus.
```

### 2. `setup.sh` — Interaktiven Modus entfernen

**Datei:** `setup.sh`

**Aktuell:** `just-ship setup` ohne Flags startet einen interaktiven Modus der nach Projektname, Beschreibung und Board-Verbindung fragt. Hat veraltete UI-Referenzen ("click the terminal icon next to your project").

**Neu:**
- `just-ship setup` ohne Flags → verhält sich wie `--auto` (non-interaktiv)
- Projektname wird aus Verzeichnisname abgeleitet (wie `--auto` es bereits tut)
- Board-Verbindung komplett raus aus setup.sh — das macht `/setup-just-ship` → `just-ship connect`
- `--update` bleibt unverändert

Der interaktive Block (ca. Zeilen 507-543 und 664-721) wird entfernt. Setup kopiert Framework-Dateien, generiert project.json Grundgerüst, fertig.

**Output nach Setup:**
```
✓ Just Ship eingerichtet

Next: Run /setup-just-ship in Claude Code
      (detects stack, fills project.json, connects board)
```

### 3. `/connect-board` — Radikal vereinfachen

**Datei:** `commands/connect-board.md`

**Aktuell:** Komplexer Command mit 3 Modi (Flags, interaktiv, Migration), Secret-Handling, jsp_/adp_ Parsing. 116 Zeilen.

**Neu:** Einfacher Verweis auf den Terminal-Befehl. Kein Secret-Handling in Claude Code.

```markdown
---
name: connect-board
description: Board-Verbindung einrichten — verweist auf Terminal-Befehl
---

# /connect-board — Board verbinden

Verbindet das aktuelle Projekt mit dem Just Ship Board.

## Ausführung

1. Lies `project.json` — falls `pipeline.workspace` bereits gesetzt:
   "Board ist bereits verbunden (Workspace: {workspace}).
    Neuen Workspace verbinden? (j/n)"
   Falls nein: Abbrechen.

2. Ausgabe:
   "Um das Board zu verbinden:

   1. Öffne board.just-ship.io → Settings → Connect
   2. Kopiere den Terminal-Befehl
   3. Führe ihn in deinem Projekt-Terminal aus:
      just-ship connect "DEIN_CODE"

   Der Befehl verbindet Workspace und Projekt automatisch."

Das ist alles. Kein Secret-Handling, keine Flags, keine interaktive Eingabe.
```

### 4. `/setup-just-ship` — Board-Flow anpassen

**Datei:** `commands/setup-just-ship.md`

**Änderungen im Board-Verbindungs-Teil (Schritt 5):**

**Aktuell:** Fragt ob Board verbinden → falls ja, fragt ob Account vorhanden → falls ja, führt `/connect-board` inline aus (interaktiver Modus mit Credentials-Abfrage).

**Neu:** Fragt ob Board verbinden → falls ja:
```
Um das Board zu verbinden:

1. Öffne board.just-ship.io → Settings → Connect
2. Kopiere den Terminal-Befehl
3. Führe ihn in deinem Projekt-Terminal aus:
   just-ship connect "DEIN_CODE"

Der Befehl verbindet Workspace und Projekt automatisch.
```

Falls Board-Flags übergeben wurden (`--board`, `--workspace`, `--project`):
- Verhalten bleibt wie bisher (direkt `add-workspace` + `set-project`)
- Das ist der Flow wenn der User vom Board-ProjectSetupDialog kommt

### 5. `install.sh` — Output konsistent machen

**Datei:** `install.sh`

**Aktuell:** Output ist bereits korrekt ("Run `/setup-just-ship` in Claude Code").

**Prüfen:** Dass überall `https://just-ship.io/install` verwendet wird, nie die GitHub-Raw-URL. Falls die URL `just-ship.io/install` noch nicht als Redirect eingerichtet ist, muss das in Phase 2 (Board) passieren.

### 6. Meldungskette vereinheitlichen

Jeder Schritt zeigt genau einen nächsten Schritt:

| Schritt | Output | Nächster Schritt |
|---------|--------|-----------------|
| `install.sh` | "Run `/setup-just-ship` in Claude Code" | → Claude Code |
| `/setup-just-ship` | "Führe `just-ship connect` im Terminal aus" | → Terminal |
| `just-ship connect` | "Erstelle dein erstes Ticket mit `/ticket` in Claude Code" | → Claude Code |
| `/ticket` | "Ticket T-{N} erstellt" | → Fertig |

---

## Was sich NICHT ändert

- `just-ship update` / `just-ship self-update` — bleiben gleich
- `just-ship connect` Token-Parsing (jsp_ decode) — bleibt gleich, wird nur um API-Abfrage erweitert
- `/add-project` — bleibt als Datei bestehen, wird nicht mehr im Flow referenziert
- `/ticket`, `/develop`, `/ship` — unverändert
- `write-config.sh` Kern-Logik (add-workspace, set-project, read-workspace) — bleibt gleich
- Globale Config-Architektur (~/.just-ship/config.json + project.json) — bleibt gleich
- `send-event.sh`, `get-preview-url.sh` — unverändert

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `bin/just-ship` | connect Subcommand um Projekt-Abfrage erweitern |
| `scripts/write-config.sh` | connect Command um API-Abfrage + set-project erweitern |
| `setup.sh` | Interaktiven Modus entfernen, Board-Verbindung raus |
| `commands/setup-just-ship.md` | Board-Flow auf `just-ship connect` verweisen |
| `commands/connect-board.md` | Radikal kürzen, nur Verweis auf Terminal |
| `install.sh` | Output prüfen, URL vereinheitlichen |

## Phase 2 (Board — separates Ticket)

Folgt nach Phase 1. Änderungen im just-ship-board Repo:
- Onboarding-Stepper: auf 2 Anweisungen kürzen
- ProjectSetupDialog: "paste in Claude Code" entfernen, nur Terminal-Befehl zeigen
- Connect-Settings-Page: "Fertig!" durch echten nächsten Schritt ersetzen
- Install-URL auf `https://just-ship.io/install` vereinheitlichen
- Sprache vereinheitlichen (DE oder EN, kein Mix)
