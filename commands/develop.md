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

1. **Board API** (bevorzugt): Credentials auflösen:
   - **Neues Format:** Falls `pipeline.workspace` gesetzt → Workspace-Config aus globaler Config lesen:
     ```bash
     bash .claude/scripts/write-config.sh read-workspace --slug <workspace>
     ```
     Aus dem JSON-Output `board_url` als API URL und `api_key` verwenden. `pipeline.project_id` aus `project.json`.
   - **Altes Format (Fallback):** Falls `pipeline.api_url` UND `pipeline.api_key` direkt in `project.json` → diese verwenden.
2. **Legacy Supabase MCP**: Falls nur `pipeline.project_id` gesetzt (ohne `workspace` und ohne `api_url`/`api_key`) → `execute_sql` verwenden, Warnung ausgeben: "Kein Board API konfiguriert. Nutze Legacy Supabase MCP. Fuehre /setup-just-ship aus um zu upgraden."
3. **Standalone**: Falls weder Board API noch `pipeline.project_id` konfiguriert → Alle Pipeline-Schritte überspringen. Ticket-Infos werden per `$ARGUMENTS` übergeben.

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
   curl -s -H "X-Pipeline-Key: {pipeline.api_key}" \
     "{pipeline.api_url}/api/tickets/162"
   ```

**Bei fehlendem Argument (Suche nach "ready_to_develop"):**
```bash
curl -s -H "X-Pipeline-Key: {pipeline.api_key}" \
  "{pipeline.api_url}/api/tickets?status=ready_to_develop&project={pipeline.project_id}"
```
Nimm das erste Ticket aus der Response (`data[0]` oder `data.tickets[0]`).

#### Legacy Supabase MCP (Fallback)

Falls nur `pipeline.project_id` gesetzt (ohne `api_url`/`api_key`), nutze `mcp__claude_ai_Supabase__execute_sql`:

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
curl -s -X PATCH -H "X-Pipeline-Key: {pipeline.api_key}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress", "branch": "{branch}", "project_id": "{pipeline.project_id}"}' \
  "{pipeline.api_url}/api/tickets/{N}"
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

**3b) Feature-Branch erstellen:**
```bash
git checkout main && git pull origin main
git checkout -b {abgeleiteter-prefix}/{ticket-nummer}-{kurzbeschreibung}
```

**3c) Pipeline-Event senden** (Board zeigt aktiven Orchestrator):
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

Bestimme anhand der geänderten Dateien, welche Docs geprüft werden müssen:

| Geänderte Dateien | Zu prüfende Docs |
|---|---|
| `commands/*.md` | README.md → Commands-Tabelle + Architecture-Abschnitt |
| `agents/*.md` | README.md → Agents-Tabelle |
| `skills/*.md` | README.md → Skills-Tabelle |
| `pipeline/**`, `agents/*.md`, `commands/*.md` | README.md → Workflow-Diagramm |
| Pipeline/Architektur-Strukturen | CLAUDE.md |
| Keine der obigen | Schritt überspringen |

Falls Anpassung nötig: direkt mit Edit-Tool ändern. Nur `README.md` und `CLAUDE.md` — keine anderen Docs.

Ausgabe:
- `✓ docs — README.md aktualisiert` (falls Änderungen gemacht)
- `✓ docs — keine Änderungen nötig` (falls nichts zu tun)

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

**9d. Status auf "in_review":**

**Board API (bevorzugt):**
```bash
curl -s -X PATCH -H "X-Pipeline-Key: {pipeline.api_key}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_review"}' \
  "{pipeline.api_url}/api/tickets/{N}"
```

**Legacy Supabase MCP (Fallback):**
```sql
UPDATE public.tickets SET status = 'in_review' WHERE number = {N} AND workspace_id = '{pipeline.workspace_id}' RETURNING number, title, status;
```

Der PR bleibt offen bis der User ihn freigibt (via `/ship` oder "passt").

### 9a. Vercel Preview URL (nur wenn `pipeline.hosting` === "vercel")

**Nur ausführen wenn `pipeline.hosting` in `project.json` den Wert `"vercel"` hat.** Ohne dieses Feld: Schritt komplett überspringen.

```bash
PREVIEW_URL=$(bash .claude/scripts/get-preview-url.sh 30)
```

Falls eine URL gefunden wurde (`$PREVIEW_URL` nicht leer), ins Ticket schreiben:

**Board API:**
```bash
if [ -n "$PREVIEW_URL" ]; then
  curl -s -X PATCH -H "X-Pipeline-Key: {pipeline.api_key}" \
    -H "Content-Type: application/json" \
    -d '{"preview_url": "'"$PREVIEW_URL"'"}' \
    "{pipeline.api_url}/api/tickets/{N}"
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

### Checkliste vor Abschluss

Bevor du den Workflow als fertig meldest, prüfe:
- [ ] **Falls Pipeline konfiguriert:** Status wurde auf "in_progress" gesetzt (Schritt 3)
- [ ] **Falls Pipeline konfiguriert:** Status wurde auf "in_review" gesetzt (Schritt 9d)
Falls ein Status-Update fehlt und Pipeline konfiguriert ist: **JETZT nachholen**, nicht überspringen.
