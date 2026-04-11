---
name: connect-board
description: Board-Verbindung einrichten — via jsp_ Token oder Status prüfen
---

# /connect-board — Board verbinden

Verbindet das aktuelle Projekt mit dem Just Ship Board.

## Ausführung

### 1. Token-Argument prüfen

Falls ein Argument übergeben wurde (z.B. `/connect-board jsp_xxxx`), ist das ein Verbindungs-Token.

**Plugin-Modus erkennen:** Prüfe ob die Env-Var `CLAUDE_PLUGIN_ROOT` gesetzt ist.

```bash
echo "${CLAUDE_PLUGIN_ROOT:-not_set}"
```

#### Bei Plugin-Modus (CLAUDE_PLUGIN_ROOT gesetzt):

```bash
bash .claude/scripts/write-config.sh connect --token "$TOKEN" --plugin-mode --project-dir .
```

Parst die JSON-Ausgabe und gibt Feedback:

**Bei `"success": true`:**

```
✓ Workspace verbunden: {workspace_slug}
✓ Projekt verknüpft: {project_id}        (nur wenn project_id vorhanden)
✓ Verbindung verifiziert                 (nur wenn verified: true)
```

Dann Plugin-Credentials setzen (Anleitung ausgeben):

```
API-Key in Plugin-Konfiguration setzen:

  claude plugin config set just-ship board_api_key "{api_key}"
  claude plugin config set just-ship board_api_url "{board_url}"
```

**Bei `"verify_error": "invalid_api_key"`:**
```
⚠ Verbunden, aber API-Key wurde abgelehnt (HTTP 401).
  Prüfe deinen API-Key im Board unter Settings → API Keys.
```

**Bei `"verify_error": "board_unreachable"`:**
```
✓ Workspace verbunden: {workspace_slug}
⚠ Board nicht erreichbar — Verbindung offline gespeichert.
```

#### Ohne Plugin-Modus (Standard-Installation):

```bash
bash .claude/scripts/write-config.sh connect --token "$TOKEN" --project-dir .
```

Gibt das Terminal-Feedback der Standardausgabe weiter.

---

### 2. Kein Token-Argument — Status prüfen

Lies `project.json` und prüfe `pipeline.workspace_id`. Falls gesetzt, validiere die vollständige Verbindung:

```bash
bash .claude/scripts/write-config.sh read-workspace --id <workspace_id>
```

**Prüfe zusätzlich Plugin-Credentials:**
Falls `CLAUDE_USER_CONFIG_BOARD_API_KEY` gesetzt ist, gilt das als "Plugin-Credentials konfiguriert".

**Ergebnis auswerten:**

| `project.json` | Credentials | Status |
|---|---|---|
| `workspace_id` + `project_id` gesetzt | `api_key` vorhanden (config oder Plugin-Env) | **Voll verbunden** |
| `workspace_id` gesetzt, `project_id` fehlt | `api_key` vorhanden | **Workspace verbunden, Projekt fehlt** |
| `workspace_id` gesetzt | `api_key` leer oder read-workspace schlägt fehl | **Credentials fehlen** |
| — | `CLAUDE_USER_CONFIG_BOARD_API_KEY` gesetzt | **Plugin-Credentials konfiguriert** |
| `workspace_id` nicht gesetzt | — | **Nicht verbunden** |

**Voll verbunden:**
```
✓ Board verbunden (Workspace: {slug || workspace_id}, Projekt: {project_id})
```

**Workspace verbunden, Projekt fehlt:**
```
✓ Workspace verbunden ({slug || workspace_id}), aber kein Projekt verknüpft.

Führe 'just-ship connect' im Terminal aus um ein Projekt auszuwählen.
```

**Credentials fehlen:**
```
⚠ Workspace in project.json gesetzt, aber API-Key fehlt in ~/.just-ship/config.json.

Führe 'just-ship connect' mit einem neuen Code im Terminal aus.
```

**Plugin-Credentials konfiguriert (kein project.json):**
```
✓ Plugin-Credentials konfiguriert (board_api_key gesetzt via Plugin-Config).
```

**Nicht verbunden** → weiter zu Schritt 3.

---

### 3. Falls nicht verbunden

Ausgabe (NICHT in einem Code-Block, damit der Link klickbar ist):

Öffne https://board.just-ship.io — das Board führt dich durch die Einrichtung. Sag Bescheid wenn du fertig bist.

Das ist alles. Keine weiteren Erklärungen, keine Schritte. Das Board hat einen Onboarding-Stepper der alles erklärt.

---

### 4. Wenn der User zurückkommt (nach Board-Onboarding)

Prüfe ob die Verbindung eingerichtet wurde:

```bash
bash .claude/scripts/write-config.sh read-workspace --id <workspace_id> 2>/dev/null || echo "NOT_CONNECTED"
```

**Falls verbunden:** Prüfe ob `project.json` den Workspace hat. Falls nicht, setze ihn:
```bash
".claude/scripts/write-config.sh" set-project --workspace-id <uuid> --project-id <project-id>
```

Bestätigung (zeige slug wenn verfügbar):
```
✓ Board verbunden (Workspace: {slug || uuid})
```

**Falls NOT_CONNECTED:** Informiere den User dass etwas nicht geklappt hat und weise auf `just-ship connect` im Terminal hin.

## Wichtig

- **Secrets nur im Plugin-Setup-Kontext** — In Plugin-Modus wird der API-Key einmalig für `claude plugin config set` ausgegeben. In Standard-Mode werden Credentials ausschließlich via `just-ship connect` im Terminal gespeichert, nie im Chat ausgegeben
- **Nicht erklären wie das Board funktioniert** — das Board hat seinen eigenen Onboarding-Flow
- **v2-Token (ohne project_id):** In Plugin-Modus wird `project_id` als fehlend markiert — User muss manuell konfigurieren
- **v3-Token (mit project_id):** Vollständige Auto-Konfiguration ohne interaktive Auswahl
