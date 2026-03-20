---
name: connect-board
description: Board-Verbindung einrichten — verweist auf Terminal-Befehl
---

# /connect-board — Board verbinden

Verbindet das aktuelle Projekt mit dem Just Ship Board.

## Ausführung

### 1. Status prüfen

Lies `project.json` — falls `pipeline.workspace` bereits gesetzt:

```
Board ist bereits verbunden (Workspace: {workspace}).

Um einen anderen Workspace zu verbinden, führe
'just-ship connect' mit einem neuen Code im Terminal aus.
```

### 2. Falls nicht verbunden

Ausgabe:
```
Um das Board zu verbinden:

1. Öffne board.just-ship.io → Settings → Connect
2. Kopiere den Terminal-Befehl
3. Führe ihn in deinem Projekt-Terminal aus:
   just-ship connect "DEIN_CODE"

Der Befehl verbindet Workspace und Projekt automatisch.
```

Das ist alles. Kein Secret-Handling, keine Flags, keine Credential-Eingabe in Claude Code.
