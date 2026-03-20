---
name: connect-board
description: Board-Verbindung einrichten — verweist aufs Board
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

Ausgabe (NICHT in einem Code-Block, damit der Link klickbar ist):

Öffne https://board.just-ship.io — das Board führt dich durch die Einrichtung. Sag Bescheid wenn du fertig bist.

Das ist alles. Keine weiteren Erklärungen, keine Schritte. Das Board hat einen Onboarding-Stepper der alles erklärt.

### 3. Wenn der User zurückkommt

Prüfe ob die Verbindung eingerichtet wurde:

```bash
cat "$HOME/.just-ship/config.json" 2>/dev/null | node -e "
  const c=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
  const ws=Object.keys(c.workspaces||{});
  console.log(ws.length ? 'CONNECTED:' + ws.join(',') : 'NOT_CONNECTED');
"
```

**Falls CONNECTED:** Prüfe ob `project.json` den Workspace hat. Falls nicht, setze ihn:
```bash
".claude/scripts/write-config.sh" set-project --workspace <slug> --project-id <project-id>
```

Bestätigung:
```
✓ Board verbunden (Workspace: {workspace})
```

**Falls NOT_CONNECTED:** Frage ob etwas nicht geklappt hat und hilf weiter.

## Wichtig

- **Keine Secrets im Chat** — Credentials werden im Terminal via `just-ship connect` eingegeben, nie hier
- **Nicht erklären wie das Board funktioniert** — das Board hat seinen eigenen Onboarding-Flow
