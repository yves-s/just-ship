---
applies_to: all-agents
name: connect-board
description: Board-Verbindung einrichten — Status prüfen oder auf Terminal verweisen
---

# /connect-board — Board verbinden

Prüft den Verbindungsstatus oder verweist auf `just-ship connect` im Terminal.

## Ausführung

### 1. Token-Argument prüfen

Falls ein Argument übergeben wurde (z.B. `/connect-board jsp_xxxx`):

**Nicht verarbeiten.** Stattdessen ausgeben (NICHT in einem Code-Block):

> ⚠ Tokens werden aus Sicherheitsgründen nicht im Chat verarbeitet.
>
> Führe stattdessen im Terminal aus:
>
> `just-ship connect {token}`
>
> Das CLI speichert die Credentials sicher in `.env.local` (gitignored).

Das ist alles. Keine weitere Verarbeitung.

---

### 2. Kein Token-Argument — Status prüfen

Lies `project.json` und prüfe `pipeline.workspace_id`.

**Prüfe Credential-Quellen (in dieser Reihenfolge):**

1. Plugin-Credentials: `CLAUDE_USER_CONFIG_BOARD_API_KEY` gesetzt?
2. Env-Var: `PIPELINE_KEY` gesetzt?
3. `.env.local` im Projektverzeichnis: enthält `JSP_BOARD_API_KEY`?

```bash
# Check .env.local for credentials
grep -q '^JSP_BOARD_API_KEY=' .env.local 2>/dev/null && echo "LOCAL_CREDS=yes" || echo "LOCAL_CREDS=no"
```

**Ergebnis auswerten:**

| `project.json` | Credentials | Status |
|---|---|---|
| `workspace_id` + `project_id` gesetzt | Credentials vorhanden (Plugin, Env, oder .env.local) | **Voll verbunden** |
| `workspace_id` gesetzt, `project_id` fehlt | Credentials vorhanden | **Workspace verbunden, Projekt fehlt** |
| `workspace_id` gesetzt | Keine Credentials gefunden | **Credentials fehlen** |
| `workspace_id` nicht gesetzt | — | **Nicht verbunden** |

**Voll verbunden:**
```
✓ Board verbunden (Workspace: {workspace_id}, Projekt: {project_id})
  Credentials: {Quelle — "Plugin-Config", "Environment", oder ".env.local"}
```

**Workspace verbunden, Projekt fehlt:**
```
✓ Workspace verbunden ({workspace_id}), aber kein Projekt verknüpft.

Führe 'just-ship connect' im Terminal aus um ein Projekt auszuwählen.
```

**Credentials fehlen:**
```
⚠ Workspace in project.json gesetzt, aber keine Credentials gefunden.

Führe 'just-ship connect' mit einem Connect-Code im Terminal aus.
```

**Nicht verbunden** → weiter zu Schritt 3.

---

### 3. Falls nicht verbunden

Ausgabe (NICHT in einem Code-Block, damit der Link klickbar ist):

Öffne https://board.just-ship.io — das Board führt dich durch die Einrichtung. Sag Bescheid wenn du fertig bist.

---

## Wichtig

- **Tokens NIEMALS im Chat verarbeiten** — immer auf `just-ship connect` im Terminal verweisen
- **Keine Credentials im Chat ausgeben** — weder API Keys noch Token-Inhalte
- **Nicht erklären wie das Board funktioniert** — das Board hat seinen eigenen Onboarding-Flow

---

## Multi-Projekt-Szenarien (`just-ship connect` in bereits verbundenem Projekt)

Wenn der User `just-ship connect <token>` in einem Projekt ausführt, das schon eine Verbindung hat, vergleicht das CLI den Token mit `project.json` und reagiert abhängig davon:

| Szenario | Was das CLI tut |
|---|---|
| **fresh** — Kein `workspace_id` in `project.json` | Normaler Erst-Connect. |
| **refresh** — Token zeigt auf denselben Workspace + dasselbe Projekt (oder v2-Token ohne Projekt) | Silent key rotation — nur `.env.local` wird aktualisiert. |
| **switch** — Token zeigt auf dasselbe Workspace, aber anderes Projekt | Einmalige Bestätigung im Terminal: `Auf das neue Projekt wechseln? (Y/n)`. Default = Yes. |
| **mismatch** — Token zeigt auf einen **anderen** Workspace | Warnung (`bist du im richtigen Ordner?`). Default-Antwort = No. Ohne explizite Bestätigung wird nichts geschrieben. |

**Für den Skill heißt das:** Beim Status-Check (Schritt 2) reflektiert `project.json` immer den zuletzt bestätigten Zustand — der User muss nichts zusätzlich tun. Wenn der User fragt "warum hat mein `just-ship connect` nichts gemacht?", ist die Antwort meist: das CLI hat den Mismatch erkannt und die Bestätigung wurde abgelehnt. Dann verweise auf das Terminal-Output des CLI-Aufrufs.

**Workspace-Key-Hinweis:** Wenn ein Workspace-Key mehrere Projekte sieht, zeigt das CLI nach erfolgreichem Connect einmalig die Projekt-Liste mit Markierung des aktuellen Default-Projekts. Das ist rein informativ — `project.json` speichert weiterhin genau **ein** `pipeline.project_id` als Default-Hint.
