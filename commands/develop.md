---
name: develop
description: Nächstes ready_to_develop Ticket holen und autonom implementieren
---

# /develop — Nächstes Ticket implementieren

Hole das nächste Ticket mit Status `ready_to_develop` und starte den autonomen Entwicklungsflow.

## Konfiguration

Lies `project.json` für Konventionen.

**Branch-Prefix:** Wird aus dem Ticket-Inhalt abgeleitet — NICHT aus der Config:
- Tags/Titel enthalten "bug", "fix", "fehler" → `fix/`
- Tags/Titel enthalten "chore", "refactor", "cleanup", "deps" → `chore/`
- Tags/Titel enthalten "docs" → `docs/`
- Alles andere → `feature/`

**Pipeline (optional):** Lies `project.json` und bestimme den Pipeline-Modus:

1. **Board API** (bevorzugt): Falls `pipeline.workspace_id` gesetzt → Credentials auflösen:
   ```bash
   WS_JSON=$(bash .claude/scripts/write-config.sh read-workspace --id <workspace_id>)
   ```
   Aus dem JSON-Output `board_url` und `api_key` verwenden. `pipeline.project_id` aus `project.json`.
2. **Legacy Supabase MCP**: Falls nur `project_id` gesetzt (ohne `workspace_id`), und `project_id` hat keine Bindestriche → `execute_sql` verwenden, Warnung ausgeben: "Kein Board API konfiguriert. Nutze Legacy Supabase MCP. Fuehre /setup-just-ship aus um zu upgraden."
3. **Standalone**: Falls weder `workspace_id` noch `project_id` konfiguriert → Alle Pipeline-Schritte überspringen. Ticket-Infos werden per `$ARGUMENTS` übergeben.

**project_id Format-Check:** Falls `pipeline.project_id` gesetzt ist und KEINE Bindestriche enthält (kurzer alphanumerischer String wie `wsmnutkobalfrceavpxs`), ist es eine alte Supabase-Projekt-ID. Warnung ausgeben: "pipeline.project_id sieht nach einer alten Supabase-ID aus. Fuehre /setup-just-ship aus um auf Board-UUID zu migrieren."

## WICHTIGSTE REGEL

**STOPPE NICHT ZWISCHEN DEN SCHRITTEN.** Nach Build-Check (Schritt 6) kommt Review (Schritt 7), dann Docs-Check (Schritt 8), dann Ship (Schritt 9). Du darfst NICHT nach dem Build dem User die Ergebnisse zeigen und auf Antwort warten. ALLES durchlaufen bis Schritt 9 fertig ist.

## Ausführung

### 1. Ticket finden

> **Standalone-Modus (kein Pipeline):** Nutze `$ARGUMENTS` direkt als Ticket-Beschreibung. Springe zu Schritt 3 (nur Feature-Branch).

Falls `$ARGUMENTS` übergeben: Nutze als Ticket-ID oder Suchbegriff.
Falls kein Argument: Suche nach dem nächsten Ticket mit Status "ready_to_develop".

#### Board API (bevorzugt)

**Bei übergebener Ticket-ID (z.B. `T-162`):**
1. Nummer extrahieren: `T-162` → `162`
2. Via Bash curl:
   ```bash
   curl -s -H "X-Pipeline-Key: {api_key}" \
     "{board_url}/api/tickets/162"
   ```

**Bei fehlendem Argument (Suche nach "ready_to_develop"):**
```bash
curl -s -H "X-Pipeline-Key: {api_key}" \
  "{board_url}/api/tickets?status=ready_to_develop&project={pipeline.project_id}"
```
Nimm das erste Ticket aus der Response (`data[0]` oder `data.tickets[0]`).

#### Legacy Supabase MCP (Fallback)

Falls nur `pipeline.project_id` gesetzt (ohne `workspace_id`), nutze `mcp__claude_ai_Supabase__execute_sql`:

**Bei übergebener Ticket-ID:**
```sql
SELECT * FROM public.tickets
WHERE number = 162
  AND workspace_id = '{pipeline.workspace_id}';
```

**Bei fehlendem Argument:**
```sql
SELECT number, title, body, priority, tags
FROM public.tickets
WHERE status = 'ready_to_develop'
  AND workspace_id = '{pipeline.workspace_id}'
  AND (
    project_id = (SELECT id FROM public.projects WHERE name = '{pipeline.project_name}' AND workspace_id = '{pipeline.workspace_id}')
    OR project_id IS NULL
  )
ORDER BY
  CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
  created_at ASC
LIMIT 1;
```

**Kein Ticket gefunden:** User informieren und stoppen.

### 2. Ticket übernehmen

Zeige kurz an: `▶ Ticket T-{N}: {title}` — dann direkt weiter, NICHT auf Bestätigung warten.

### 3. Status auf "in_progress" + Feature-Branch + Pipeline-Event

**Falls Pipeline konfiguriert — PFLICHT, NICHT ÜBERSPRINGEN. Alle Aktionen ausführen:**

**3a) Status updaten + Projekt zuordnen:**

**Board API (bevorzugt):** Via Bash curl:
```bash
curl -s -X PATCH -H "X-Pipeline-Key: {api_key}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress", "branch": "{branch}", "project_id": "{pipeline.project_id}"}' \
  "{board_url}/api/tickets/{N}"
```
Hinweis: `branch` wird mitgesendet damit das Board anzeigt welcher Branch aktiv ist. `project_id` ordnet das Ticket dem Projekt zu falls noch nicht geschehen.

**Legacy Supabase MCP (Fallback):** Via `mcp__claude_ai_Supabase__execute_sql`:
```sql
UPDATE public.tickets
SET status = 'in_progress',
    branch = '{branch}',
    project_id = COALESCE(project_id, (
      SELECT id FROM public.projects
      WHERE name = '{pipeline.project_name}'
        AND workspace_id = '{pipeline.workspace_id}'
    ))
WHERE number = {N}
  AND workspace_id = '{pipeline.workspace_id}'
RETURNING number, title, status;
```

Warte auf die Bestätigung, dass das Update erfolgreich war, bevor du weitermachst.

**3b) Feature-Branch in Worktree erstellen (parallelsicher):**

Prüfe zuerst ob das aktuelle Verzeichnis bereits ein Worktree ist:
```bash
git rev-parse --git-dir 2>/dev/null
```
Falls die Ausgabe `.git` enthält (kein Worktree) UND das Projekt `pipeline.max_workers` > 1 hat (oder nicht gesetzt):

```bash
# Worktree erstellen für parallele Ausführung
git fetch origin main
BRANCH="{abgeleiteter-prefix}/{ticket-nummer}-{kurzbeschreibung}"
WORKTREE_DIR=".worktrees/T-{N}"
git worktree add "$WORKTREE_DIR" -b "$BRANCH" origin/main
```

Danach: **Alle weiteren Schritte (4-11) im Worktree-Verzeichnis ausführen.** Nutze `$WORKTREE_DIR` als Arbeitsverzeichnis für alle Bash-Befehle (`cwd`), Read, Edit, Glob, Grep.

Ausgabe: `▶ worktree — .worktrees/T-{N} erstellt`

Falls bereits in einem Worktree (z.B. bei Resume): einfach den Branch erstellen wie bisher:
```bash
git checkout main && git pull origin main
git checkout -b {abgeleiteter-prefix}/{ticket-nummer}-{kurzbeschreibung}
```

**3c) Active-Ticket für Shell-Hooks setzen** (damit SubagentStop-Events den Board erreichen):

Nutze das **Write-Tool** (nicht Bash `echo >`) um die Datei `.claude/.active-ticket` mit dem Inhalt `{N}` zu schreiben. Das Write-Tool ist per `Write(**)` erlaubt und löst keine Permission-Prompt aus.

**3d) Pipeline-Event senden** (Board zeigt aktiven Orchestrator):
```bash
bash .claude/scripts/send-event.sh {N} orchestrator agent_started
```

### 3.5 Triage — Ticket-Qualitätsprüfung

```bash
bash .claude/scripts/send-event.sh {N} triage agent_started
```
Ausgabe: `▶ triage — Ticket-Qualität prüfen`

Spawne einen Triage-Agent mit `model: "haiku"` und `subagent_type: "triage"`:

Prompt:
```
Lies .claude/agents/triage.md für deine Rolle.

Analysiere folgendes Ticket:

Ticket-ID: T-{N}
Titel: {title}
Beschreibung:
{body}
Labels: {labels}
```

Verarbeite das JSON-Ergebnis des Agents:
- **verdict = "sufficient"**: Ticket ist klar. Weiter mit Schritt 4.
- **verdict = "enriched"**: Nutze `enriched_body` als verbesserte Beschreibung für alle weiteren Schritte (Planung, Agent-Prompts).
- **qa_tier**: Merke `qa_tier` (full/light/skip), `qa_pages` und `qa_flows` für Schritt 10 (Automated QA).

```bash
bash .claude/scripts/send-event.sh {N} triage completed '{"verdict": "{verdict}"}'
```
Ausgabe:
- `✓ triage — Ticket ausreichend klar` (bei sufficient)
- `✓ triage — Ticket angereichert` (bei enriched, zeige 1-Zeiler Analysis)

**NICHT STOPPEN.** SOFORT weiter zu Schritt 4.

### 4. Planung (SELBST, kein Planner-Agent)

**Lies nur die 5-10 betroffenen Dateien** direkt mit Read/Glob/Grep.
Lies `CLAUDE.md` für Architektur und Konventionen.
Lies `project.json` für Pfade und Stack-Details.

**Dann: Instruktionen für Agents formulieren** — mit exakten Code-Änderungen und neuen Dateien direkt im Prompt.

### 5. Implementierung (parallel wo möglich)

**Für JEDEN Agent-Spawn — Events senden UND Ausgabe anzeigen:**

Vor Agent-Start:
```bash
bash .claude/scripts/send-event.sh {N} {agent-type} agent_started
```
Ausgabe: `▶ [{agent-type}] — {was der Agent macht}`

Nach Agent-Ende — Token-Verbrauch aus dem Agent-Ergebnis extrahieren:
```bash
bash .claude/scripts/send-event.sh {N} {agent-type} completed '{"tokens_used": {total_tokens}}'
```
Dabei `{total_tokens}` aus dem `<usage>total_tokens: X</usage>` Block des Agent-Ergebnisses lesen. Falls kein Usage-Block vorhanden, `0` senden.
Ausgabe: `✓ [{agent-type}] abgeschlossen ({formatted_tokens} tokens)`

Spawne Agents via Agent-Tool mit konkreten Instruktionen:

| Agent | `model` | Wann |
|-------|---------|------|
| `data-engineer` | `haiku` | Bei Schema-Änderungen |
| `backend` | `sonnet` | Bei API/Hook-Änderungen |
| `frontend` | `sonnet` | Bei UI-Änderungen |

**Prompt-Muster:** Exakte Dateiliste + Code-Snippets, NICHT "lies die Spec".

### 6. Build-Check (Bash, kein Agent)

Ausgabe: `▶ build-check — {build command}`
Lies Build-Commands aus `project.json` und führe sie aus.
Nur bei Build-Fehlern:
```bash
bash .claude/scripts/send-event.sh {N} devops agent_started
```
Ausgabe: `▶ devops — Build-Fehler beheben` und DevOps-Agent mit `model: "haiku"` spawnen.
Nach DevOps-Agent:
```bash
bash .claude/scripts/send-event.sh {N} devops completed
```

**NICHT STOPPEN.** Zeige dem User NICHT die Build-Ergebnisse und warte NICHT auf Antwort. SOFORT weiter zu Schritt 7.

### 7. Review (ein Agent)

```bash
bash .claude/scripts/send-event.sh {N} qa agent_started
```
Ausgabe: `▶ qa — Acceptance Criteria & Security prüfen`

Ein QA-Agent mit `model: "haiku"`:
- Acceptance Criteria gegen Code prüfen
- Security-Quick-Check (Secrets, RLS, Auth, Input Validation)
- Bei Problemen: direkt fixen

```bash
bash .claude/scripts/send-event.sh {N} qa completed
```
Ausgabe nach Abschluss: `✓ qa abgeschlossen`

**NICHT STOPPEN.** SOFORT weiter zu Schritt 8.

### 8. Docs-Check

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
| `vps/**`, `pipeline/worker.ts`, `pipeline/server.ts` | `vps/README.md` | VPS-spezifische Doku |
| Workflow, Conventions, Dev-Setup | `CONTRIBUTING.md` | Contributing Guidelines |
| Keine der obigen Trigger-Dateien | — | Teil 2 überspringen |

Falls Anpassung nötig: direkt mit Edit-Tool ändern.

Ausgabe pro geprüfter Datei:
- `✓ docs — CHANGELOG.md aktualisiert`
- `✓ docs — README.md aktualisiert`
- `✓ docs — docs/ARCHITECTURE.md aktualisiert`
- `✓ docs — templates/CLAUDE.md aktualisiert`
- `✓ docs — vps/README.md aktualisiert`
- `✓ docs — CONTRIBUTING.md aktualisiert`
- `✓ docs — keine Änderungen nötig` (falls nur CHANGELOG und sonst nichts zu tun war)

**NICHT STOPPEN.** SOFORT weiter zu Schritt 9.

### 9. Commit → Push → PR (KEIN `/ship`, KEIN Merge)

**Pipeline-Event senden** (Orchestrator abgeschlossen):
```bash
bash .claude/scripts/send-event.sh {N} orchestrator completed
```

**WICHTIG: `/ship` wird NICHT aufgerufen.** `/ship` mergt automatisch — das darf nur der User auslösen.
Stattdessen: Commit, Push und PR manuell durchführen.

NICHT den Skill `finishing-a-development-branch` aufrufen.
NICHT dem User Optionen präsentieren.
NICHT fragen ob committed/gepusht werden soll.
NICHT mergen. NICHT auf main wechseln. NICHT Status auf "done" setzen.

**9a. Commit:**
```bash
git add <betroffene-dateien>
git commit -m "feat(T-{N}): {englische Beschreibung}

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

**9b. Push:**
```bash
git push -u origin $(git branch --show-current)
```

**9c. PR erstellen:**
```bash
gh pr view 2>/dev/null || gh pr create --title "feat(T-{N}): {Beschreibung}" --body "$(cat <<'EOF'
## Summary
- {Bullet Points}

## Test plan
- {Was wurde getestet}

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**9d. Change Summary ins Ticket schreiben:**

Generiere eine Zusammenfassung der Änderungen auf diesem Branch und schreibe sie ins Ticket:

```bash
MERGE_BASE=$(git merge-base main HEAD)
CHANGED_FILES=$(git diff --name-status $MERGE_BASE..HEAD)
COMMIT_LOG=$(git log --oneline $MERGE_BASE..HEAD)
DIFF_STAT=$(git diff --stat $MERGE_BASE..HEAD | tail -1)
REVIEW_URL=$(gh pr view --json url -q .url 2>/dev/null || echo "")
```

Baue daraus einen Markdown-String für das `summary`-Feld:
- `## Changes Summary` als Überschrift
- Geänderte Dateien gruppiert nach Status (Added/Modified/Deleted)
- Commit-Liste
- Diff-Statistik (letzte Zeile von `git diff --stat`)
- PR-Link (falls vorhanden)

**Board API (bevorzugt):**
```bash
curl -s -X PATCH -H "X-Pipeline-Key: {api_key}" \
  -H "Content-Type: application/json" \
  -d '{"summary": "{summary_markdown}"}' \
  "{board_url}/api/tickets/{N}"
```

**Legacy Supabase MCP (Fallback):**
```sql
UPDATE public.tickets SET summary = '{summary_markdown}' WHERE number = {N} AND workspace_id = '{pipeline.workspace_id}';
```

Ausgabe: `✓ summary — Änderungszusammenfassung ins Ticket geschrieben`

**9e. Status auf "in_review" + Review-URL:**

PR-URL extrahieren (falls nicht schon in 9d geschehen):
```bash
REVIEW_URL=$(gh pr view --json url -q .url 2>/dev/null || echo "")
```

**Board API (bevorzugt):**
```bash
curl -s -X PATCH -H "X-Pipeline-Key: {api_key}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_review", "review_url": "'"$REVIEW_URL"'"}' \
  "{board_url}/api/tickets/{N}"
```

**Legacy Supabase MCP (Fallback):**
```sql
UPDATE public.tickets SET status = 'in_review', review_url = '$REVIEW_URL' WHERE number = {N} AND workspace_id = '{pipeline.workspace_id}' RETURNING number, title, status;
```

Der PR bleibt offen bis der User ihn freigibt (via `/ship` oder "passt").

### 9f. Vercel Preview URL

**Immer ausführen** — das Script erkennt automatisch ob ein Vercel-Deployment existiert und returned leer wenn nicht. Kein Config-Gate nötig.

**WICHTIG:** Die Preview-URL MUSS eine Vercel-Deployment-URL sein (z.B. `https://<project>-<hash>.vercel.app`). NIEMALS einen GitHub-Link, PR-URL oder Repository-URL als `preview_url` setzen. Das `preview_url`-Feld ist ausschließlich für die live deployete Vorschau.

```bash
PREVIEW_URL=$(bash .claude/scripts/get-preview-url.sh 30)
```

Falls eine URL gefunden wurde (`$PREVIEW_URL` nicht leer), ins Ticket schreiben:

**Board API:**
```bash
if [ -n "$PREVIEW_URL" ]; then
  curl -s -X PATCH -H "X-Pipeline-Key: {api_key}" \
    -H "Content-Type: application/json" \
    -d '{"preview_url": "'"$PREVIEW_URL"'"}' \
    "{board_url}/api/tickets/{N}"
fi
```

**Legacy Supabase MCP (Fallback):**
```bash
if [ -n "$PREVIEW_URL" ]; then
  mcp__claude_ai_Supabase__execute_sql "UPDATE public.tickets SET preview_url = '$PREVIEW_URL' WHERE number = {N} AND workspace_id = '{pipeline.workspace_id}' RETURNING number, preview_url;"
fi
```

Ausgabe:
- `✓ preview — {PREVIEW_URL}` (falls URL gefunden)
- `✓ preview — kein Vercel-Deployment gefunden, übersprungen` (falls keine URL)

**Kein Fehler wenn keine URL gefunden wird.** Das Script exits immer mit Code 0. Projekte ohne Vercel-Integration überspringen diesen Schritt automatisch.

### 10. Automated QA

Nutze das `qa_tier` aus der Triage (Schritt 3.5). Falls die Triage kein `qa_tier` lieferte, default auf `light`.

```bash
bash .claude/scripts/send-event.sh {N} qa-auto agent_started
```
Ausgabe: `▶ qa-auto — Automatisierte QA ({qa_tier} tier)`

| Tier | Was passiert |
|------|-------------|
| **full** | Build + Tests + Playwright Smoke Tests gegen Vercel Preview (falls `pipeline.hosting === "vercel"` und `$PREVIEW_URL` aus Schritt 9a vorhanden) |
| **light** | Build + Tests (falls konfiguriert) |
| **skip** | Nur Build-Check |

#### 10a. Build + Tests (alle Tiers)

Lies Build- und Test-Commands aus `project.json` und führe sie aus (identisch zu Schritt 6, aber als erneute Verification nach PR-Push).

#### 10b. Playwright Smoke Tests (nur `full` tier + Vercel Preview)

**Voraussetzung:** `qa_tier === "full"` UND `pipeline.hosting === "vercel"` in `project.json` UND `$PREVIEW_URL` aus Schritt 9a ist nicht leer.

Falls eine dieser Bedingungen nicht erfüllt: Playwright komplett überspringen.

**Playwright installieren (falls nötig):**
```bash
npx playwright install chromium 2>/dev/null || true
```

**Für jede Seite aus `qa_pages`** (oder `["/"]` falls leer) ein Smoke-Test-Script ausführen.
Generiere `safeName` als filename-sicherer String aus `qa_page` (z.B. "/" → "index", "/about" → "about", "/" und "." durch "-" ersetzen):

```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  const resp = await page.goto('${PREVIEW_URL}{qa_page}', { waitUntil: 'networkidle', timeout: 60000 });
  const status = resp?.status() ?? 0;
  await page.screenshot({ path: '/tmp/qa-screenshot-{safeName}.png' });
  await browser.close();
  console.log(JSON.stringify({ status, errors, ok: status >= 200 && status < 400 }));
})();
"
```

Ergebnis auswerten:
- HTTP Status 2xx/3xx → passed
- HTTP Status 4xx/5xx oder Navigation-Error → failed
- Console-Errors erfassen aber nicht als blocking werten

Screenshots per `Read`-Tool inspizieren und im QA-Report referenzieren.

#### 10c. Fix-Loop (bei Fehlern)

**Bei Fehlern:** Automatisch fixen (max 3 Versuche). Jeder Fix als eigener Commit: `fix(qa): address QA failures (attempt {N})`.
Nach 3 gescheiterten Versuchen: trotzdem weitermachen, Fehler im PR-Kommentar dokumentieren.

#### 10d. QA-Report als PR-Kommentar + Labels

```bash
gh pr comment --body-file /tmp/qa-report-{N}.md
gh pr edit --add-label "qa:passed"        # alles grün
gh pr edit --add-label "qa:needs-review"  # nach 3 Fix-Versuchen nicht grün
gh pr edit --add-label "qa:skipped"       # skip tier
```

```bash
bash .claude/scripts/send-event.sh {N} qa-auto completed '{"tier": "{qa_tier}", "status": "{passed|failed}"}'
```
Ausgabe: `✓ qa-auto — {qa_tier} tier {passed|needs-review|skipped}`

### Checkliste vor Abschluss

Bevor du den Workflow als fertig meldest, prüfe:
- [ ] **Falls Pipeline konfiguriert:** Status wurde auf "in_progress" gesetzt (Schritt 3)
- [ ] **Falls Pipeline konfiguriert:** Status wurde auf "in_review" gesetzt (Schritt 9d)
- [ ] **QA-Report:** PR hat ein `qa:*` Label (Schritt 10)
Falls ein Status-Update fehlt und Pipeline konfiguriert ist: **JETZT nachholen**, nicht überspringen.

**Hinweis:** Worktree wird NICHT hier aufgeräumt — das passiert in `/ship` nach dem Merge, damit Nachbesserungen nach Code Review im Worktree möglich bleiben.
