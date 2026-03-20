# Onboarding Flow Consolidation — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the fragmented onboarding flow into a single linear path where `just-ship connect` sets up workspace AND project in one step, and every surface shows exactly one next step.

**Architecture:** `write-config.sh cmd_connect` becomes the single source of truth for board connection — it parses the jsp_ token, saves the workspace, queries the Board API for projects, and auto-links the project. All other surfaces (setup.sh, /setup-just-ship, /connect-board) point to `just-ship connect` in the terminal instead of handling credentials themselves.

**Tech Stack:** Bash (write-config.sh, setup.sh, bin/just-ship), Markdown (Claude Code commands), TypeScript (pipeline/lib/config.ts)

**Spec:** `docs/superpowers/specs/2026-03-20-onboarding-flow-consolidation-design.md`

---

### Task 1: Extend `cmd_connect` with automatic project linking

**Files:**
- Modify: `scripts/write-config.sh:496-593` (cmd_connect function)

This is the core change. After connecting the workspace, query the Board API for projects and auto-link.

- [ ] **Step 1: Add project query + auto-link logic after workspace connect**

After the existing validation curl (line 575), add project query logic. Insert before the success output block (line 579):

```bash
  # --- Auto-link project ---
  PROJECT_ID=""
  PROJECT_NAME_RESOLVED=""

  if [ -f "$project_dir/project.json" ] && [ "$http_code" = "200" ]; then
    PROJECTS_JSON=$(curl -s --max-time 5 -H "X-Pipeline-Key: $key" "$board/api/projects")

    if [ -n "$PROJECTS_JSON" ]; then
      PROJECT_INFO=$(JS_JSON="$PROJECTS_JSON" node -e "
        const data = JSON.parse(process.env.JS_JSON);
        const projects = (data.data && data.data.projects) || [];
        console.log(projects.length);
        projects.forEach(p => console.log(p.id + '|' + p.name));
      " 2>/dev/null || echo "0")

      PROJECT_COUNT=$(echo "$PROJECT_INFO" | head -1)

      if [ "$PROJECT_COUNT" -eq 1 ]; then
        PROJECT_LINE=$(echo "$PROJECT_INFO" | sed -n '2p')
        PROJECT_ID="${PROJECT_LINE%%|*}"
        PROJECT_NAME_RESOLVED="${PROJECT_LINE#*|}"
      elif [ "$PROJECT_COUNT" -gt 1 ]; then
        echo ""
        echo "Mehrere Projekte im Board gefunden:"
        echo ""
        local i=1
        echo "$PROJECT_INFO" | tail -n +2 | while IFS='|' read -r pid pname; do
          echo "  $i) $pname"
          i=$((i + 1))
        done
        echo ""
        read -p "Welches Projekt verknüpfen? (1-$PROJECT_COUNT): " CHOICE
        PROJECT_LINE=$(echo "$PROJECT_INFO" | tail -n +2 | sed -n "${CHOICE}p")
        if [ -n "$PROJECT_LINE" ]; then
          PROJECT_ID="${PROJECT_LINE%%|*}"
          PROJECT_NAME_RESOLVED="${PROJECT_LINE#*|}"
        fi
      fi

      if [ -n "$PROJECT_ID" ]; then
        cmd_set_project --workspace "$workspace" --project-id "$PROJECT_ID" \
          --project-name "$PROJECT_NAME_RESOLVED" --project-dir "$project_dir" >/dev/null 2>&1
      fi
    fi
  fi
```

- [ ] **Step 2: Update success output to reflect project linking**

Replace the existing output block (lines 579-592) with:

```bash
  echo ""
  if [ "$http_code" = "200" ]; then
    echo "✓ Workspace '${workspace}' verbunden"
    if [ -n "$PROJECT_ID" ]; then
      echo "✓ Projekt '${PROJECT_NAME_RESOLVED}' verknüpft"
    fi
    echo "✓ Board-Verbindung verifiziert"
    echo ""
    if [ -n "$PROJECT_ID" ]; then
      echo "Erstelle dein erstes Ticket mit /ticket in Claude Code."
    elif [ "$PROJECT_COUNT" = "0" ] 2>/dev/null; then
      echo "⚠ Kein Projekt im Board gefunden."
      echo "  Erstelle ein Projekt im Board unter Settings → Projects,"
      echo "  dann führe 'just-ship connect' erneut aus."
    elif [ ! -f "$project_dir/project.json" ]; then
      echo "Workspace verbunden. Führe 'just-ship connect' in deinem"
      echo "Projektverzeichnis erneut aus um ein Projekt zu verknüpfen."
    else
      echo "Erstelle dein erstes Ticket mit /ticket in Claude Code."
    fi
  elif [ "$http_code" = "401" ]; then
    echo "⚠ Workspace gespeichert, aber API Key abgelehnt (HTTP 401)"
    echo "  Prüfe den API Key unter Board → Settings → API Keys"
  else
    echo "✓ Workspace '${workspace}' gespeichert (offline — Verbindung konnte nicht verifiziert werden)"
  fi
```

- [ ] **Step 3: Test the changes manually**

```bash
# Test with existing workspace (test-5)
cd /Users/yschleich/Developer/klapital
bash ~/.just-ship/scripts/write-config.sh connect --token "jsp_eyJ2IjoxLCJiIjoiaHR0cHM6Ly9ib2FyZC5qdXN0LXNoaXAuaW8iLCJ3IjoidGVzdC01IiwiaSI6ImVmNjk2MjQzLWJhYTYtNDNhZi1hYTViLTI2OTgzMjk4YmUzNiIsImsiOiJhZHBfMTIzMjQwNzgzMzRiNWU5MTVlNjZlMTFkNjc4ZDA4ZmJkNWMwMjFiYjJhZDhhMGZlZTc4ODU5ZDRlYTcyNjNhNiJ9" --project-dir .
```

Expected: workspace connected + project auto-linked + "Erstelle dein erstes Ticket" message

- [ ] **Step 4: Commit**

```bash
git add scripts/write-config.sh
git commit -m "feat: just-ship connect auto-links project via Board API query"
```

---

### Task 2: Remove interactive mode from `setup.sh`

**Files:**
- Modify: `setup.sh:507-748` (setup mode section)

- [ ] **Step 1: Replace interactive mode with auto-mode as default**

The `if [ "$MODE" = "auto" ]` block (lines 507-513) becomes the default. Remove the `else` branch (lines 516-543) that asks for project name, description, and board choice. Remove the `SETUP_MODE` variable entirely.

Replace lines 507-543 with:

```bash
# --- Derive project name from directory ---
PROJECT_NAME=$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/-\+/-/g' | sed 's/^-\|-$//g')
PROJECT_NAME=${PROJECT_NAME:-myproject}
PROJECT_DESC=""
OVERWRITE_CONFIG="N"

if [ "$MODE" = "auto" ]; then
  echo "Auto mode — project name: $PROJECT_NAME"
  echo ""
fi

if [ -f "project.json" ] && [ "$MODE" != "auto" ]; then
  echo "project.json already exists."
  read -p "Overwrite project.json? (y/N): " OVERWRITE_CONFIG
  OVERWRITE_CONFIG=${OVERWRITE_CONFIG:-N}
fi
```

- [ ] **Step 2: Remove board connection block**

Delete the entire board connection section (lines 663-721) and the `SETUP_MODE` references.

- [ ] **Step 3: Update "Next steps" output**

Replace lines 731-747 with:

```bash
echo ""
echo "================================================"
echo "  Setup complete → $FRAMEWORK_VERSION"
echo "================================================"
echo ""
echo "Nächster Schritt:"
echo "  Öffne Claude Code und führe /setup-just-ship aus"
echo "  (erkennt Stack, füllt project.json, verbindet Board)"
echo ""
```

- [ ] **Step 4: Update `--update` mode migration hint**

Find the migration hint in the update section (around line 450-453) that says "Run /connect-board in Claude Code to migrate" and replace with:

```bash
echo "     Führe 'just-ship connect' im Terminal aus um zu migrieren"
```

- [ ] **Step 5: Update help text**

Update the help text (line 53-58) to reflect that `--auto` is now default behavior:

```bash
echo "  (no flags)   Non-interactive setup (default)"
echo "  --auto       Alias for default (backward compat)"
echo "  --update     Update framework files only"
echo "  --dry-run    Preview changes without applying them"
```

- [ ] **Step 6: Test setup**

```bash
cd /tmp && mkdir test-project && cd test-project && git init
~/.just-ship/setup.sh
```

Expected: Non-interactive setup, project name derived from directory, no board question, ends with "Führe /setup-just-ship aus"

```bash
rm -rf /tmp/test-project
```

- [ ] **Step 7: Commit**

```bash
git add setup.sh
git commit -m "feat: remove interactive setup mode, default to auto-detect"
```

---

### Task 3: Simplify `/connect-board` command

**Files:**
- Modify: `commands/connect-board.md` (full rewrite)

- [ ] **Step 1: Replace with simplified version**

Replace the entire file content with:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add commands/connect-board.md
git commit -m "feat: simplify /connect-board to terminal pointer"
```

---

### Task 4: Update `/setup-just-ship` board flow

**Files:**
- Modify: `commands/setup-just-ship.md:209-239` (Section 5: Board verbinden)

- [ ] **Step 1: Replace Section 5 board connection logic**

Replace the current Section 5 content (lines ~209-239) with:

```markdown
### 5. Board verbinden?

Falls `pipeline.workspace` in `project.json` noch nicht gesetzt ist, frage:

```
Möchtest du das Just Ship Board verbinden? (j/n)
```

**Falls nein:** Abschließen mit:
```
Fertig! Erstelle dein erstes Ticket mit /ticket.
```

**Falls ja:** Ausgabe:
```
Um das Board zu verbinden:

1. Öffne board.just-ship.io → Settings → Connect
2. Kopiere den Terminal-Befehl
3. Führe ihn in deinem Projekt-Terminal aus:
   just-ship connect "DEIN_CODE"

Der Befehl verbindet Workspace und Projekt automatisch.
```

Keine Zwischenfrage ("Hast du Account?"). Kein inline `/connect-board`. Kein Secret-Handling.

Falls Board-Flags übergeben wurden (`--board`, `--workspace`, `--project`):
- Verhalten bleibt wie bisher (direkt `add-workspace` + `set-project`)
- Das ist der Flow wenn der User vom Board-ProjectSetupDialog kommt
```

- [ ] **Step 2: Commit**

```bash
git add commands/setup-just-ship.md
git commit -m "feat: /setup-just-ship points to just-ship connect for board"
```

---

### Task 5: Update `/connect-board` references across codebase

**Files:**
- Modify: `pipeline/lib/config.ts:84,103,111`
- Modify: `commands/disconnect-board.md`

- [ ] **Step 1: Update pipeline/lib/config.ts references**

Replace all 3 occurrences of `/connect-board` with `just-ship connect`:

Line 84 (approx): Change warning message from referencing `/connect-board` to:
```typescript
"  Führe 'just-ship connect' im Terminal aus um zu migrieren"
```

Line 103 (approx): Change to:
```typescript
"  Führe 'just-ship connect' im Terminal aus um die Verbindung einzurichten."
```

Line 111 (approx): Change to:
```typescript
"  Führe 'just-ship connect' im Terminal aus um die Verbindung einzurichten."
```

- [ ] **Step 2: Update disconnect-board.md**

Find the reference to `/connect-board` and replace with `just-ship connect`:
```
damit ein erneutes 'just-ship connect' den Workspace wiederherstellen kann.
```

- [ ] **Step 3: Commit**

```bash
git add pipeline/lib/config.ts commands/disconnect-board.md
git commit -m "fix: update /connect-board references to just-ship connect"
```

---

### Task 6: Verify install.sh output consistency

**Files:**
- Modify: `install.sh:56-75` (if needed)

- [ ] **Step 1: Check install.sh output**

Read `install.sh` and verify the output matches the messaging chain:
- Should say: "Öffne Claude Code und führe /setup-just-ship aus" (or English equivalent)
- Should NOT reference `/connect-board` or `just-ship setup`

If the install URL uses `https://raw.githubusercontent.com/...`, note it for Phase 2 (Board changes).

- [ ] **Step 2: Update output language to German if needed**

If output is in English, update to match the German messaging chain. The current English output ("Open your project in Claude Code and run: /setup-just-ship") is acceptable as install.sh runs in an English terminal context — leave as-is unless inconsistent.

- [ ] **Step 3: Commit (only if changes needed)**

```bash
git add install.sh
git commit -m "fix: install.sh output consistency"
```

---

### Task 7: End-to-end verification

- [ ] **Step 1: Verify the full messaging chain**

Check that each step points to exactly one next step:

```bash
# 1. Check install.sh output
grep -A5 "Next step" install.sh

# 2. Check setup.sh output
grep -A5 "Nächster Schritt" setup.sh

# 3. Check just-ship connect output
grep -A5 "Erstelle dein erstes" scripts/write-config.sh

# 4. Check /connect-board points to terminal
grep "just-ship connect" commands/connect-board.md

# 5. Check /setup-just-ship points to terminal
grep "just-ship connect" commands/setup-just-ship.md

# 6. Check no remaining /connect-board references (except the command itself)
grep -r "/connect-board" commands/ skills/ pipeline/ setup.sh install.sh --include="*.md" --include="*.ts" --include="*.sh" | grep -v "connect-board.md" | grep -v "disconnect-board.md"
```

Expected: No stale `/connect-board` references remain.

- [ ] **Step 2: Final commit + push**

```bash
git push origin main
```

Then run `just-ship self-update` + `just-ship update` in a test project to verify the files propagate correctly.
