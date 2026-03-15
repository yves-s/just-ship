---
name: add-project
description: Neues Projekt im aktuellen Workspace verknüpfen — nur Projekt-ID in project.json schreiben
---

# /add-project — Projekt verknüpfen

Verknüpft ein neues Board-Projekt mit dem lokalen Projekt. Schreibt nur `workspace` + `project_id` in `project.json`. Kein API Key nötig — der Workspace muss bereits verbunden sein.

## Argumente

| Flag | Beschreibung | Pflicht |
|---|---|---|
| `--project` | Projekt UUID vom Board | Ja |
| `--name` | Projektname (optional, für Lesbarkeit) | Nein |

## Ausführung

1. Prüfe ob ein Workspace konfiguriert ist:
   - Lies `project.json` → `pipeline.workspace`
   - Falls nicht vorhanden: Lies `~/.just-ship/config.json` → `default_workspace`
   - Falls beides fehlt: Fehler: "Kein Workspace konfiguriert. Führe zuerst /connect-board aus."

2. Schreibe Projekt-Referenz:
   ```bash
   ".claude/scripts/write-config.sh" set-project \
     --workspace <workspace> --project-id <project> [--project-name <name>]
   ```

3. Bestätigung:
   ```
   ✓ Projekt '<project-id>' verknüpft mit Workspace '<workspace>'
   ✓ project.json aktualisiert
   ```
