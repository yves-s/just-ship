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

**Datei:** `scripts/write-config.sh` (cmd_connect Funktion)

`bin/just-ship` bleibt ein dünner Dispatcher — die gesamte Logik lebt in `write-config.sh cmd_connect`.

**Aktuell:** `just-ship connect "jsp_..."` setzt nur den Workspace. Danach muss `/add-project` separat ausgeführt werden.

**Neu:** Nach dem Workspace-Connect fragt `cmd_connect` die Board-API nach Projekten ab:

```bash
# Nach erfolgreichem add-workspace:
# 1. Board-API nach Projekten im Workspace fragen
PROJECTS_JSON=$(curl -s -H "X-Pipeline-Key: $key" "$board/api/projects")

# 2. Projekte extrahieren (node -e, nicht python3 — match existing pattern)
PROJECT_INFO=$(JS_JSON="$PROJECTS_JSON" node -e "
  const data = JSON.parse(process.env.JS_JSON);
  const projects = data.data?.projects || [];
  // Output: count|id|name (pipe-separated, one project per line)
  console.log(projects.length);
  projects.forEach(p => console.log(p.id + '|' + p.name));
")

# 3. Entscheidung (alles in cmd_connect, interaktive Abfrage via read -p)
PROJECT_COUNT=$(echo "$PROJECT_INFO" | head -1)

if [ "$PROJECT_COUNT" -eq 0 ]; then
  # Hinweis: Projekt im Board erstellen
elif [ "$PROJECT_COUNT" -eq 1 ]; then
  # Automatisch set-project mit id und name aus Zeile 2
elif [ "$PROJECT_COUNT" -gt 1 ]; then
  # Nummerierte Liste anzeigen, User wählt via read -p
fi
```

**Board-API Response Schema** (`GET /api/projects` mit `X-Pipeline-Key` Header):
```json
{
  "data": {
    "workspace_id": "ef696243-...",
    "workspace_name": "My Workspace",
    "projects": [
      { "id": "2497ae88-...", "name": "My Project", "description": "" }
    ]
  },
  "error": null
}
```

Felder für `set-project`: `projects[].id` → `--project-id`, `projects[].name` → `--project-name`.

**Edge Case: Kein `project.json` im Verzeichnis**
Falls `just-ship connect` außerhalb eines Projekt-Verzeichnisses ausgeführt wird (kein `project.json`): Nur Workspace verbinden, Projekt-Verknüpfung überspringen. Output: "Workspace verbunden. Führe `just-ship connect` erneut in deinem Projektverzeichnis aus um ein Projekt zu verknüpfen."

**Output nach erfolgreichem Connect (Deutsch, konsistent):**
```
✓ Workspace 'my-workspace' verbunden
✓ Projekt 'My Project' verknüpft
✓ Board-Verbindung verifiziert

Erstelle dein erstes Ticket mit /ticket in Claude Code.
```

**Output bei 0 Projekten:**
```
✓ Workspace 'my-workspace' verbunden

⚠ Kein Projekt im Board gefunden.
  Erstelle ein Projekt im Board unter Settings → Projects,
  dann führe 'just-ship connect' erneut aus.
```

Hinweis: Board-URL wird aus dem decodierten Token verwendet, nicht hardcoded.

### 2. `setup.sh` — Interaktiven Modus entfernen

**Datei:** `setup.sh`

**Aktuell:** `just-ship setup` ohne Flags startet einen interaktiven Modus der nach Projektname, Beschreibung und Board-Verbindung fragt. Hat veraltete UI-Referenzen ("click the terminal icon next to your project").

**Neu:**
- `just-ship setup` ohne Flags → verhält sich wie `--auto` (non-interaktiv)
- `--auto` Flag bleibt als Synonym, wird aber nicht mehr benötigt (Default-Verhalten)
- Projektname wird aus Verzeichnisname abgeleitet
- Board-Verbindung komplett raus aus setup.sh — das macht `/setup-just-ship` → `just-ship connect`
- `--update` bleibt unverändert
- `MODE` Variable hat nur noch zwei Werte: `setup` (Default + --auto) und `update`

**Konkret zu entfernen:**
- Der `else`-Branch der `if [ "$MODE" = "auto" ]` Prüfung (interaktive Abfragen: Projektname, Beschreibung, Choice 1/2) — ca. Zeilen 516-543
- Der gesamte Board-Connection-Block — ca. Zeilen 664-721
- Die `SETUP_MODE` Variable und zugehörige Logik
- Der "Next steps" Output am Ende: `/connect-board` Referenz → durch `just-ship connect` ersetzen

**Zu erhalten:** Der `--auto` Branch (Zeilen 507-515) wird zum Default-Verhalten.

**Output nach Setup:**
```
✓ Just Ship eingerichtet

Nächster Schritt:
  Öffne Claude Code und führe /setup-just-ship aus
  (erkennt Stack, füllt project.json, verbindet Board)
```

**Output im `--update` Modus:** Migration-Hint ändern:
- Alt: "Run /connect-board in Claude Code to migrate"
- Neu: "Führe 'just-ship connect' im Terminal aus um zu migrieren"

### 3. `/connect-board` — Radikal vereinfachen

**Datei:** `commands/connect-board.md`

**Aktuell:** Komplexer Command mit 3 Modi (Flags, interaktiv, Migration), Secret-Handling, jsp_/adp_ Parsing. 116 Zeilen.

**Neu:** Einfacher Verweis auf den Terminal-Befehl. Minimale Interaktion nur für den "bereits verbunden"-Check.

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
    Um einen anderen Workspace zu verbinden, führe
    'just-ship connect' mit einem neuen Code im Terminal aus."

2. Falls nicht verbunden, Ausgabe:
   "Um das Board zu verbinden:

   1. Öffne board.just-ship.io → Settings → Connect
   2. Kopiere den Terminal-Befehl
   3. Führe ihn in deinem Projekt-Terminal aus:
      just-ship connect "DEIN_CODE"

   Der Befehl verbindet Workspace und Projekt automatisch."
```

Kein Secret-Handling, keine Flags, keine Credential-Eingabe.

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

Keine Zwischenfrage mehr ("Hast du Account?"). Kein inline `/connect-board`.

Falls Board-Flags übergeben wurden (`--board`, `--workspace`, `--project`):
- Verhalten bleibt wie bisher (direkt `add-workspace` + `set-project`)
- Das ist der Flow wenn der User vom Board-ProjectSetupDialog kommt

### 5. `install.sh` — Output konsistent machen

**Datei:** `install.sh`

**Aktuell:** Output ist bereits korrekt ("Run `/setup-just-ship` in Claude Code").

**Prüfen:** Dass überall `https://just-ship.io/install` verwendet wird, nie die GitHub-Raw-URL. Falls die URL `just-ship.io/install` noch nicht als Redirect eingerichtet ist, muss das in Phase 2 (Board) passieren.

### 6. Meldungskette vereinheitlichen

Jeder Schritt zeigt genau einen nächsten Schritt. Sprache: Deutsch im CLI-Output.

| Schritt | Output | Nächster Schritt |
|---------|--------|-----------------|
| `install.sh` | "Öffne Claude Code und führe /setup-just-ship aus" | → Claude Code |
| `/setup-just-ship` | "Führe `just-ship connect` im Terminal aus" | → Terminal |
| `just-ship connect` | "Erstelle dein erstes Ticket mit `/ticket` in Claude Code" | → Claude Code |
| `/ticket` | "Ticket T-{N} erstellt" | → Fertig |

### 7. Referenzen auf `/connect-board` aktualisieren

Folgende Dateien referenzieren `/connect-board` und müssen aktualisiert werden:

| Datei | Aktuelle Referenz | Neue Referenz |
|-------|-------------------|---------------|
| `pipeline/lib/config.ts` | "Run /connect-board to migrate" (3x) | "Führe 'just-ship connect' im Terminal aus" |
| `commands/disconnect-board.md` | "erneutes /connect-board" | "erneutes 'just-ship connect'" |
| `setup.sh` (update mode) | "Run /connect-board in Claude Code to migrate" | "Führe 'just-ship connect' im Terminal aus" |

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
| `scripts/write-config.sh` | cmd_connect um API-Abfrage + automatisches set-project erweitern |
| `setup.sh` | Interaktiven Modus entfernen, Board-Verbindung raus, --update Hint ändern |
| `commands/setup-just-ship.md` | Board-Flow auf `just-ship connect` verweisen, keine inline Credentials |
| `commands/connect-board.md` | Radikal kürzen, nur Verweis auf Terminal |
| `commands/disconnect-board.md` | /connect-board Referenz → just-ship connect |
| `pipeline/lib/config.ts` | /connect-board Referenzen → just-ship connect (3 Stellen) |
| `install.sh` | Output prüfen, URL vereinheitlichen |

## Phase 2 (Board — separates Ticket)

Folgt nach Phase 1. Änderungen im just-ship-board Repo:
- Onboarding-Stepper: auf 2 Anweisungen kürzen
- ProjectSetupDialog: "paste in Claude Code" entfernen, nur Terminal-Befehl zeigen
- Connect-Settings-Page: "Fertig!" durch echten nächsten Schritt ersetzen
- Install-URL auf `https://just-ship.io/install` vereinheitlichen
- Sprache vereinheitlichen (Deutsch)
