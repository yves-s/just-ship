---
name: connect-board
description: Board-Verbindung hinzufügen oder ändern — Workspace + API Key in globale Config schreiben
---

# /connect-board — Board verbinden

Verbindet einen Workspace mit dem Just Ship Board. Schreibt Workspace-Daten in `~/.just-ship/config.json`.

## Argumente

| Flag | Beschreibung | Pflicht |
|---|---|---|
| `--board` | Board URL (z.B. `https://board.just-ship.io`) | Ja |
| `--workspace` | Workspace Slug | Ja |
| `--workspace-id` | Workspace UUID | Ja |
| `--key` | API Key (`adp_...`) | Ja |
| `--project` | Projekt UUID (optional — setzt direkt auch das Projekt) | Nein |

## Ausführung

### Modus 1: Alle Flags vorhanden

Wenn alle Pflicht-Flags übergeben wurden:

1. Schreibe Workspace-Eintrag via `scripts/write-config.sh`:
   ```bash
   ".claude/scripts/write-config.sh" add-workspace \
     --slug <workspace> --board <board> --workspace-id <workspace-id> --key <key>
   ```
   The script is located at `.claude/scripts/write-config.sh` relative to the project root.

2. Falls `--project` übergeben:
   ```bash
   ".claude/scripts/write-config.sh" set-project \
     --workspace <workspace> --project-id <project>
   ```

3. Bestätigung ausgeben:
   ```
   ✓ Workspace '<workspace>' connected to <board>
   ✓ Config written to ~/.just-ship/config.json
   ```

### Modus 2: Interaktiv (keine oder unvollständige Flags)

Frage nacheinander:
1. Board URL (Default: `https://board.just-ship.io`)
2. Workspace Slug
3. Workspace ID
4. API Key

Dann wie Modus 1 ausführen.

### Migration erkennen

Falls `project.json` noch ein `api_key` Feld hat:
```
Bestehender api_key in project.json gefunden.
In globale Config migrieren? (J/n)
```

Falls ja, rufe auf:
```bash
".claude/scripts/write-config.sh" migrate \
  --project-dir . --slug <workspace-slug>
```

### Validierung

Nach dem Schreiben: Prüfe die Verbindung via curl:
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Pipeline-Key: <key>" "<board>/api/projects"
```
- 200: `✓ Board connection verified`
- 401: `⚠ API Key rejected — check the key in Board Settings`
- Andere: `⚠ Board not reachable — check the URL`
