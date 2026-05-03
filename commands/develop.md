---
name: develop
description: Nächstes ready_to_develop Ticket holen und autonom implementieren
---

# /develop — Ticket implementieren

**Du selbst (Hauptkontext) führst KEINE Implementation aus.** Deine einzige Aufgabe in diesem Command: einen `orchestrator`-Subagent spawnen. Der Orchestrator liest sein eigenes Workflow-Definition (`agents/orchestrator.md` bzw. installiert unter `.claude/agents/orchestrator.md`), lädt seine Skills automatisch über den Skill-Loader, und führt den gesamten Flow aus — Triage, Planung, Implementation-Subagents, Build, Code-Review, QA, PR. Du siehst alles live im Stream (`⚡ Orchestrator joined`, dann `⚡ Triage joined`, dann `⚡ Backend Dev joined`, etc.) — keine Hintergrundprozesse, keine TypeScript-Pipeline, kein Bun.

## Ausführung

### Schritt 1 — Ticket-Nummer ermitteln

```bash
TICKET_NUMBER=$(echo "$ARGUMENTS" | grep -oE '[0-9]+' | head -1)
if [ -z "$TICKET_NUMBER" ] && [ -f .claude/.active-ticket ]; then
  TICKET_NUMBER=$(cat .claude/.active-ticket | grep -oE '[0-9]+' | head -1)
fi
if [ -z "$TICKET_NUMBER" ]; then
  echo "ERROR: /develop benötigt eine Ticket-Nummer (z.B. /develop T-123) oder ein aktives Ticket in .claude/.active-ticket" >&2
  exit 1
fi
echo "▶ Ticket T-$TICKET_NUMBER"
```

### Schritt 2 — Branch-Check

Falls aktueller Branch `main` ist UND Pipeline konfiguriert (`pipeline.workspace_id` in `project.json` gesetzt):

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
WORKTREE_DIR="$REPO_ROOT/.worktrees/T-$TICKET_NUMBER"
if [ ! -d "$WORKTREE_DIR" ]; then
  git -C "$REPO_ROOT" fetch origin main 2>/dev/null || true
  git -C "$REPO_ROOT" worktree add "$WORKTREE_DIR" -b "feature/T-$TICKET_NUMBER" origin/main 2>&1 \
    || git -C "$REPO_ROOT" worktree add "$WORKTREE_DIR" "feature/T-$TICKET_NUMBER" 2>&1
  ln -sf "$REPO_ROOT/.env.local" "$WORKTREE_DIR/.env.local" 2>/dev/null || true
  # Bootstrap .claude/ tools into worktree (siehe T-1015)
  for sub in scripts skills agents rules hooks; do
    [ -d "$REPO_ROOT/.claude/$sub" ] && cp -RnL "$REPO_ROOT/.claude/$sub" "$WORKTREE_DIR/.claude/" 2>/dev/null || true
  done
  [ -f "$REPO_ROOT/.claude/settings.json" ] && [ ! -f "$WORKTREE_DIR/.claude/settings.json" ] && cp "$REPO_ROOT/.claude/settings.json" "$WORKTREE_DIR/.claude/settings.json"
  echo "▶ worktree — .worktrees/T-$TICKET_NUMBER erstellt"
fi
# Write .active-ticket to BOTH locations: main repo (for main-context CWD) AND
# worktree (for subagent CWD). Subagent hooks read $CWD/.claude/.active-ticket;
# without the worktree copy, agent_started/completed events are silently dropped.
# See T-1063 (.active-ticket worktree-aware sync).
echo "$TICKET_NUMBER" > "$REPO_ROOT/.claude/.active-ticket"
mkdir -p "$WORKTREE_DIR/.claude"
echo "$TICKET_NUMBER" > "$WORKTREE_DIR/.claude/.active-ticket"
```

### Schritt 3 — Status auf in_progress (falls Pipeline konfiguriert)

```bash
if jq -e '.pipeline.workspace_id != ""' project.json >/dev/null 2>&1; then
  bash .claude/scripts/board-api.sh patch "tickets/$TICKET_NUMBER" \
    "{\"status\":\"in_progress\",\"branch\":\"feature/T-$TICKET_NUMBER\"}" >/dev/null 2>&1 || echo "⚠ Board-Status-Update fehlgeschlagen — weiter ohne Blockade"
fi
```

### Schritt 4 — Orchestrator-Subagent spawnen

**Das ist der einzige Implementation-Schritt.** Du selbst implementierst nichts. Du spawnst **einen** Subagent und wartest auf das Ergebnis. Der Orchestrator macht alles weitere.

Spawne via Agent-Tool:

```
subagent_type: "orchestrator"
description: "Implement T-{TICKET_NUMBER}"
prompt: |
  ERSTER TOOL-CALL DIESER SESSION (vor allem anderen):
  Read('.claude/agents/orchestrator.md')

  Diese Datei enthält deine Identity, deinen Workflow (Phase 1: Planung, Phase 2: Implementierung mit Subagents, Phase 3: Build/Review/QA/PR) und deine Skill-Mapping-Tabelle. Befolge sie wörtlich. Ohne diesen Read ist deine Antwort ungültig.

  Arbeitsverzeichnis: {WORKTREE_DIR — siehe Schritt 2}
  Branch: feature/T-{TICKET_NUMBER}
  Ticket: T-{TICKET_NUMBER}

  ## Aufgabe

  Implementiere T-{TICKET_NUMBER} Ende-zu-Ende:

  1. Ticket holen: `bash .claude/scripts/board-api.sh get "tickets/{TICKET_NUMBER}"` — lies title, body, acceptance criteria.
  2. Triage-Subagent spawnen (`subagent_type: "triage"`) zur Qualitätsprüfung des Tickets.
  3. Planung im Kopf: welche Files, welche Subagents (backend / frontend / data-engineer / ...).
  4. Implementation-Subagents spawnen — jeder mit dem Prompt-Muster aus deiner orchestrator.md (ERSTER TOOL-CALL: Read auf den richtigen Skill-Pfad, dann Aufgabe).
  5. Build-Check, Code-Review-Subagent, QA-Subagent, Docs-Check.
  6. Commit, Push, PR via `gh pr create`. Status auf `in_review` patchen.

  Befolge die Reporter-Voice (`skills/reporter/SKILL.md`) für alle User-sichtbaren Ausgaben — `▶`/`✓`/`↻`/`✗`-Zeilen, keine Prosa.

  Output: kurze Zusammenfassung am Ende — was wurde gemacht, PR-Link, Status. Keine Optionen-Listen, keine Rückfragen.
```

### Schritt 5 — Ergebnis anzeigen

Wenn der Orchestrator-Subagent zurückkommt, zeige sein Output direkt an. Keine zusätzliche Prosa, keine eigene Formatierung. Der Orchestrator hat bereits gerendert.

## Was DU (Hauptkontext) NICHT tust

- Keine Triage selbst.
- Kein Planning selbst.
- Keine Backend-/Frontend-/QA-Implementation selbst.
- Keine Build-Checks selbst.
- Keine PR-Erstellung selbst.
- Keine Subagent-Spawns ausser dem einen Orchestrator-Spawn.

Wenn du den Drang verspürst, irgendeinen dieser Schritte selbst zu machen: **STOP**. Du bist nicht der Orchestrator. Spawne ihn.

## Warum das so ist

Subagents (wie der Orchestrator) gehen durch `pipeline/lib/load-skills.ts` → bekommen ihre Skills automatisch injiziert → joinen sichtbar mit `⚡ Orchestrator joined` → können selbst weitere Subagents spawnen, die wieder ihre Skills laden. Das Hauptkontext-Modell hat keinen Skill-Loader und kann den Workflow nicht ersetzen — jeder Versuch produziert die T-1051/T-1053-Symptome (kein Triage, kein Orchestrator, leere assigned_agents, Tickets stehen still).
