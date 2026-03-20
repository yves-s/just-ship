---
name: disconnect-board
description: Board-Verbindung entfernen — zurück zu CLI-only
---

# /disconnect-board — Board-Verbindung entfernen

Entfernt die Board-Anbindung für den aktuellen Workspace. Die Pipeline läuft danach im CLI-only Modus (keine Events, keine Status-Updates).

## Ausführung

1. Lese aktuellen Workspace aus `project.json` → `pipeline.workspace`
2. Falls nicht gesetzt: Fehler: "Kein Workspace konfiguriert."
3. Entferne Board-Verbindung:
   ```bash
   ".claude/scripts/write-config.sh" remove-board --slug <workspace>
   ```
4. Bestätigung:
   ```
   ✓ Board-Verbindung für '<workspace>' entfernt
   ✓ Pipeline läuft jetzt im CLI-only Modus
   ```

**Hinweis:** `project.json` wird nicht verändert — der `workspace` Verweis bleibt bestehen, damit ein erneutes 'just-ship connect' den Workspace wiederherstellen kann.
