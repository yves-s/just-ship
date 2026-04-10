---
name: just-ship:implement
description: Implementiere was gerade besprochen wurde — ohne Ticket, mit vollem Agent-Workflow
disable-model-invocation: true
---

# /implement — Implementieren ohne Ticket

Starte den vollen Agent-Workflow direkt aus dem Chat-Kontext oder einer expliziten Beschreibung.
Kein Board, kein Ticket, keine Status-Updates erforderlich.
Gleicher Prozess wie `/develop`, aber ohne Pipeline-Events, Triage und Ticket-Status.

## WICHTIGSTE REGEL

**STOPPE NICHT ZWISCHEN DEN SCHRITTEN.** Alle Schritte 1–9 hintereinander ausführen.
Kein "Soll ich...?", kein "Möchtest du...?". ALLES DURCHLAUFEN.
Schritt 8 endet mit einem offenen PR — **KEIN Merge**, nicht warten auf Bestätigung.

## NICHT verwenden

- NICHT auf Board-Status-Updates warten (kein Ticket, keine Event-IDs)

## Verboten

- `git add -A` oder `git add .`
- `--force` push
- `--amend` bei Hook-Failure
- `/ship` aufrufen
- `send-event.sh` aufrufen
- Zwischen Schritten stoppen oder fragen

## Konfiguration

Lies `project.json` für:
- Build- und Test-Commands (`build`, `test`)
- Stack-Details und Pfade

Pipeline-Config wird **ignoriert** — dieser Command läuft immer im Standalone-Modus.

## Ausführung

### 1. Spec ableiten

> **Guard:** Falls kein Argument übergeben wurde UND kein klares Implementierungsziel aus der Konversation ableitbar ist (leere Session, themenfremdes Gespräch, mehrere widersprüchliche Themen) → **STOP**: "Ich konnte kein klares Implementierungsziel aus dem Chat ableiten. Bitte beschreibe kurz, was gebaut werden soll."

**Mit Argument (`/implement Beschreibung`):**
Nutze `$ARGUMENTS` direkt als Spec-Basis.

**Ohne Argument (`/implement`):**
Lies die aktuelle Konversation und destilliere eine kompakte Spec:
- Was wird gebaut?
- Welche Dateien/Bereiche sind betroffen?
- Was ist das gewünschte Verhalten / die Acceptance Criteria?

**Spec ausgeben** (immer, egal ob aus Argument oder Chat abgeleitet):
```
▶ Spec: {einzeiliges Summary}
  Ziel: {Was wird gebaut}
  Bereich: {Betroffene Dateien/Komponenten}
```

Danach SOFORT weiter — kein Warten auf Bestätigung.

### 2. Feature-Branch in Worktree erstellen (parallelsicher)

Branch-Prefix aus Spec ableiten:
- Spec enthält "bug", "fix", "fehler" → `fix/`
- Spec enthält "chore", "refactor", "cleanup", "deps" → `chore/`
- Spec enthält "docs" → `docs/`
- Alles andere → `feature/`

`{slug}` = kurze Kebab-Case-Zusammenfassung der Spec (max. 5 Wörter)

Prüfe zuerst ob das aktuelle Verzeichnis bereits ein Worktree ist:
```bash
git rev-parse --git-dir 2>/dev/null
```
Falls die Ausgabe `.git` enthält (kein Worktree):

```bash
# Worktree erstellen für parallele Ausführung
git fetch origin main
BRANCH="{prefix}/{slug}"
WORKTREE_DIR=".worktrees/{slug}"
git worktree add "$WORKTREE_DIR" -b "$BRANCH" origin/main
```

Danach: **Alle weiteren Schritte (3-9) im Worktree-Verzeichnis ausführen.** Nutze `$WORKTREE_DIR` als Arbeitsverzeichnis für alle Bash-Befehle (`cwd`), Read, Edit, Glob, Grep.

Ausgabe: `▶ worktree — .worktrees/{slug} erstellt`

Falls bereits in einem Worktree (z.B. bei Resume): einfach den Branch erstellen wie bisher:
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

### 7. Docs-Check

Ausgabe: `▶ docs — Dokumentation prüfen`

Ermittle alle geänderten Dateien auf diesem Branch:
```bash
git diff --name-only $(git merge-base main HEAD) HEAD
git status --porcelain
```

Der Docs-Check hat zwei Teile: einen **universellen** Teil (läuft in jedem Projekt) und einen **projektspezifischen** Teil (nur wenn die jeweiligen Dateien existieren).

#### Teil 1: CHANGELOG (universell — immer ausführen)

**CHANGELOG.md wird bei JEDER Änderung aktualisiert** — egal welches Projekt, egal welche Dateien sich geändert haben.

Falls `CHANGELOG.md` nicht existiert, erstelle sie mit diesem Header:
```markdown
# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/)

## [Unreleased]
```

Falls `CHANGELOG.md` existiert aber keine `[Unreleased]`-Sektion hat, füge sie als erste Sektion nach dem Header ein.

**Format:** Keep-a-Changelog mit Gruppen `### Added`, `### Changed`, `### Fixed`, `### Removed`. Beschreibung auf Englisch, 1 Zeile pro Änderung. Nur Gruppen verwenden, die auch Einträge haben.

#### Teil 2: Projektspezifische Docs (nur wenn Datei existiert)

Prüfe ob die jeweilige Zieldatei existiert. **Nur bestehende Dateien aktualisieren** — keine neuen Docs anlegen. Falls eine Zieldatei nicht existiert, diesen Eintrag überspringen.

| Geänderte Dateien | Zu prüfende Docs | Aktion |
|---|---|---|
| `commands/*.md` | `README.md` | Commands-Tabelle + Architecture-Abschnitt |
| `agents/*.md` | `README.md` | Agents-Tabelle |
| `skills/*.md` | `README.md` | Skills-Tabelle |
| `pipeline/**`, `agents/*.md`, `commands/*.md` | `README.md` | Workflow-Diagramm |
| `pipeline/**`, `agents/*.md`, `.claude/**` | `docs/ARCHITECTURE.md` | Betroffene Sektionen (Agent System, Slash Commands, Pipeline SDK, etc.) |
| Pipeline/Architektur-Strukturen | `CLAUDE.md` | Architektur-Abschnitt |
| `commands/*.md`, `agents/*.md`, `skills/*.md` | `templates/CLAUDE.md` | Template aktualisieren falls Commands/Agents/Skills-Referenzen enthalten |
| `pipeline/worker.ts`, `pipeline/server.ts` | `docs/ARCHITECTURE.md` | Pipeline-Server Abschnitt |
| Workflow, Conventions, Dev-Setup | `CONTRIBUTING.md` | Contributing Guidelines |
| Keine der obigen Trigger-Dateien | — | Teil 2 überspringen |

Falls Anpassung nötig: direkt mit Edit-Tool ändern.

Ausgabe pro geprüfter Datei:
- `✓ docs — CHANGELOG.md aktualisiert`
- `✓ docs — README.md aktualisiert`
- `✓ docs — docs/ARCHITECTURE.md aktualisiert`
- `✓ docs — templates/CLAUDE.md aktualisiert`
- `✓ docs — docs/ARCHITECTURE.md aktualisiert (Pipeline-Server)`
- `✓ docs — CONTRIBUTING.md aktualisiert`
- `✓ docs — keine Änderungen nötig` (falls nur CHANGELOG und sonst nichts zu tun war)

**NICHT STOPPEN.** SOFORT weiter zu Schritt 8.

### 8. Abschließen — Commit + Push + PR (KEIN Merge)

NICHT den Skill `finishing-a-development-branch` aufrufen.
NICHT dem User Optionen präsentieren.
NICHT fragen ob committed/gepusht werden soll.
NICHT mergen. NICHT auf main wechseln.

**8a. Commit:**
```bash
git add <betroffene-dateien>
git commit -m "feat: {englische Beschreibung}

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

**8b. Push:**
```bash
git push -u origin $(git branch --show-current)
```

**8c. PR erstellen:**
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

### 9. Vercel Preview URL

**Immer ausführen** — das Script erkennt automatisch ob ein Vercel-Deployment existiert und returned leer wenn nicht. Kein Config-Gate nötig.

**WICHTIG:** Die Preview-URL MUSS eine Vercel-Deployment-URL sein (z.B. `https://<project>-<hash>.vercel.app`). NIEMALS einen GitHub-Link, PR-URL oder Repository-URL als Preview-URL verwenden.

```bash
PREVIEW_URL=$(bash .claude/scripts/get-preview-url.sh 30)
```

Falls eine URL gefunden wurde, nur ausgeben:
- `✓ preview — {PREVIEW_URL}`
- `✓ preview — kein Vercel-Deployment gefunden, übersprungen` (falls keine URL)

**Kein Fehler wenn keine URL gefunden wird.** Projekte ohne Vercel-Integration überspringen diesen Schritt automatisch.

### Abschluss-Ausgabe

```
✓ Implementiert: {Beschreibung}
  Branch: {branch-name}
  Worktree: {worktree-dir}
  PR: {url}
  → Zum Mergen: /ship oder "passt"
```

**Hinweis:** Worktree wird NICHT hier aufgeräumt — das passiert in `/ship` nach dem Merge, damit Nachbesserungen nach Code Review im Worktree möglich bleiben.
