# `/implement` Command Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a `/implement` slash command that triggers the full agent pipeline from chat context or a description, without requiring a board ticket.

**Architecture:** A single Markdown command file (`commands/implement.md`) following the same structure as `commands/develop.md`. Because `.claude/commands` is a symlink to `commands/`, the new file is immediately available as `/implement` in Claude Code. No code compilation, no registration step needed.

**Tech Stack:** Markdown (Claude Code slash command format), Bash (git, gh CLI), Claude Code Agent tool

**Spec:** `docs/superpowers/specs/2026-03-16-implement-command-design.md`

---

## Chunk 1: Create the command file

### Task 1: Create `commands/implement.md`

**Files:**
- Create: `commands/implement.md`

**Reference files to read first:**
- `commands/develop.md` — pipeline structure to mirror (steps 4–8)
- `commands/ship.md` — commit/push/PR pattern to replicate (steps 1–3 only, NOT step 4 merge)
- `project.json` — understand build command structure

- [ ] **Step 1: Read reference files**

Read `commands/develop.md` (already done), `commands/ship.md` (already done), and `project.json` to understand the `build` and `test` command structure before writing the command.

- [ ] **Step 2: Write `commands/implement.md`**

Create the file with the following content:

```markdown
---
name: implement
description: Implementiere was gerade besprochen wurde — ohne Ticket, mit vollem Agent-Workflow
disable-model-invocation: true
---

# /implement — Implementieren ohne Ticket

Starte den vollen Agent-Workflow direkt aus dem Chat-Kontext oder einer expliziten Beschreibung.
Kein Board, kein Ticket, keine Status-Updates erforderlich.

## WICHTIGSTE REGEL

**STOPPE NICHT ZWISCHEN DEN SCHRITTEN.** Alle Schritte 1–7 hintereinander ausführen.
Kein "Soll ich...?", kein "Möchtest du...?". ALLES DURCHLAUFEN.

## NICHT verwenden

- NICHT `/ship` aufrufen (würde automatisch mergen)
- NICHT `send-event.sh` aufrufen (kein Ticket, keine Event-IDs)
- NICHT auf Board-Status-Updates warten

## Konfiguration

Lies `project.json` für:
- Build- und Test-Commands (`build`, `test`)
- Stack-Details und Pfade

Pipeline-Config wird **ignoriert** — dieser Command läuft immer im Standalone-Modus.

## Ausführung

### 1. Spec ableiten

**Mit Argument (`/implement Beschreibung`):**
Nutze `$ARGUMENTS` direkt als Spec-Basis.

**Ohne Argument (`/implement`):**
Lies die aktuelle Konversation und destilliere eine kompakte Spec:
- Was wird gebaut?
- Welche Dateien/Bereiche sind betroffen?
- Was ist das gewünschte Verhalten / die Acceptance Criteria?

Falls kein klares Implementierungsziel ableitbar (leere Session, themenfremdes Gespräch, mehrere widersprüchliche Themen):
**STOP** — Ausgabe: "Ich konnte kein klares Implementierungsziel aus dem Chat ableiten. Bitte beschreibe kurz, was gebaut werden soll."

**Spec ausgeben** (immer, egal ob aus Argument oder Chat abgeleitet):
```
▶ Spec: {einzeiliges Summary}
  Ziel: {Was wird gebaut}
  Bereich: {Betroffene Dateien/Komponenten}
```

Danach SOFORT weiter — kein Warten auf Bestätigung.

### 2. Feature-Branch erstellen

Branch-Prefix aus Spec ableiten:
- Spec enthält "bug", "fix", "fehler" → `fix/`
- Spec enthält "chore", "refactor", "cleanup", "deps" → `chore/`
- Spec enthält "docs" → `docs/`
- Alles andere → `feature/`

`{slug}` = kurze Kebab-Case-Zusammenfassung der Spec (max. 5 Wörter)

```bash
git checkout main && git pull origin main
git checkout -b {prefix}/{slug}
```

### 3. Planung (SELBST, kein Planner-Agent)

**Lies nur die 5–10 betroffenen Dateien** direkt mit Read/Glob/Grep.
Lies `CLAUDE.md` für Architektur und Konventionen.
Lies `project.json` für Pfade und Stack-Details.

**Dann: Instruktionen für Agents formulieren** — mit exakten Code-Änderungen und neuen Dateien direkt im Prompt.

### 4. Implementierung (parallel wo möglich)

Spawne Agents via Agent-Tool mit konkreten Instruktionen:

| Agent | `model` | Wann |
|-------|---------|------|
| `data-engineer` | `haiku` | Bei Schema-Änderungen |
| `backend` | `sonnet` | Bei API/Hook-Änderungen |
| `frontend` | `sonnet` | Bei UI-Änderungen |

**Ausgabe vor Agent-Start:** `▶ [{agent-type}] — {was der Agent macht}`
**Ausgabe nach Agent-Ende:** `✓ [{agent-type}] abgeschlossen`

**Prompt-Muster:** Exakte Dateiliste + Code-Snippets, NICHT "lies die Spec".

### 5. Build-Check (Bash, kein Agent)

Ausgabe: `▶ build-check — {build command}`

Lies Build-Commands aus `project.json` und führe sie aus.

Nur bei Build-Fehlern: DevOps-Agent spawnen (model: `haiku`) um Fehler zu beheben.
Ausgabe: `▶ devops — Build-Fehler beheben`

**NICHT STOPPEN.** SOFORT weiter zu Schritt 6.

### 6. Review (ein Agent)

Ausgabe: `▶ qa — Acceptance Criteria & Security prüfen`

Ein QA-Agent (model: `haiku`):
- Acceptance Criteria gegen Code prüfen
- Security-Quick-Check (Secrets, RLS, Auth, Input Validation)
- Bei Problemen: direkt fixen

Ausgabe nach Abschluss: `✓ qa abgeschlossen`

**NICHT STOPPEN.** SOFORT weiter zu Schritt 7.

### 7. Abschließen — Commit + Push + PR (KEIN Merge)

```bash
git status
```

Falls uncommitted changes:
```bash
git add <betroffene-dateien>
git commit -m "feat: {englische Beschreibung}

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Push:
```bash
git push -u origin $(git branch --show-current)
```

PR erstellen (kein Merge):
```bash
gh pr view 2>/dev/null || gh pr create \
  --title "feat: {Beschreibung}" \
  --body "$(cat <<'EOF'
## Summary
- {Bullet Points}

## Test plan
- {Was wurde getestet}

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**NICHT mergen.** Der PR bleibt offen bis der User freigibt (via `/ship` oder "passt").

### Abschluss-Ausgabe

```
✓ Implementiert: {Beschreibung}
  Branch: {branch-name}
  PR: {url}
  → Zum Mergen: /ship oder "passt"
```

## Hinweis: Board-Integration nachträglich

Falls du das Ergebnis doch im Board tracken willst:
- `/ticket` auf diesem Branch aufrufen → erstellt Ticket und verknüpft es
```

- [ ] **Step 3: Verify the file is accessible as a slash command**

```bash
ls -la .claude/commands/implement.md
```

Expected: file exists via symlink resolution (`.claude/commands` → `../commands`)

- [ ] **Step 4: Commit**

```bash
git add commands/implement.md
git commit -m "feat: add /implement command for ticket-free agent pipeline"
```

---

## Chunk 2: Manual verification (human-only, outside agent scope)

> **Agentic workers:** Skip this chunk. These steps require an interactive Claude Code session and cannot be automated.

### Task 2: Smoke test the command

This command is Markdown — no unit tests. Verification is done by triggering it in a real session.

- [ ] **Step 1: Open a new Claude Code session in any project**

The command should appear in autocomplete when typing `/implement`.

- [ ] **Step 2: Test without arguments**

Type `/implement` after having discussed something in chat.

Expected:
- Claude prints a `▶ Spec:` block summarizing what was discussed
- Claude creates a branch (`feature/...`)
- Claude reads relevant files, spawns appropriate agents
- Ends with commit + push + PR (no merge)

- [ ] **Step 3: Test with arguments**

Type `/implement Add a dark mode toggle to the nav`.

Expected:
- Claude uses the argument as spec (no chat context needed)
- Same pipeline runs

- [ ] **Step 4: Test empty-session fallback**

Open a fresh session, type `/implement` with no prior discussion.

Expected:
- Claude outputs: "Ich konnte kein klares Implementierungsziel aus dem Chat ableiten. Bitte beschreibe kurz, was gebaut werden soll."
- No branch created, no agents spawned
