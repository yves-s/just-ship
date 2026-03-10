---
name: ticket
description: Ticket aufnehmen und autonome Entwicklung starten
disable-model-invocation: true
---

# /ticket — Ticket aufnehmen und implementieren

Nimm ein Ticket auf und starte den autonomen Entwicklungsflow.

## Konfiguration

Lies `project.json` für Konventionen.

**Branch-Prefix:** Wird aus dem Ticket-Inhalt abgeleitet — NICHT aus der Config:
- Tags/Titel enthalten "bug", "fix", "fehler" → `fix/`
- Tags/Titel enthalten "chore", "refactor", "cleanup", "deps" → `chore/`
- Tags/Titel enthalten "docs" → `docs/`
- Alles andere → `feature/`

**Pipeline (optional):** Falls `pipeline.project_id` in `project.json` gesetzt ist:
- `pipeline.project_id` — Supabase Project ID des Agentic Dev Boards
- `pipeline.project_name` — Projektname für Ticket-Filterung
- `pipeline.workspace_id` — Workspace ID für Multi-Tenancy-Scoping

Falls `pipeline.project_id` **leer oder nicht vorhanden** ist: Alle Supabase-Schritte in diesem Command überspringen. Ticket-Infos werden dann per `$ARGUMENTS` übergeben.

## WICHTIGSTE REGEL

**STOPPE NICHT ZWISCHEN DEN SCHRITTEN.** Nach Build-Check (Schritt 6) kommt Review (Schritt 7), dann Ship (Schritt 8). Du darfst NICHT nach dem Build dem User die Ergebnisse zeigen und auf Antwort warten. ALLES durchlaufen bis Schritt 8 fertig ist.

## Ausführung

### 1. Ticket finden

> **Ohne Supabase:** Nutze `$ARGUMENTS` direkt als Ticket-ID und Beschreibung. Springe zu Schritt 3 (nur Feature-Branch).

Falls `$ARGUMENTS` übergeben: Nutze als Ticket-ID oder Suchbegriff.
Falls kein Argument: Suche nach Tickets mit Status "ready_to_develop".

**Bei übergebener Ticket-ID (z.B. `T--162`):**
1. Nummer extrahieren: `T--162` → `162`
2. Via `mcp__claude_ai_Supabase__execute_sql`:
   ```sql
   SELECT * FROM public.tickets
   WHERE number = 162
     AND workspace_id = '{pipeline.workspace_id}';
   ```
   Mit `project_id` aus `pipeline.project_id` in project.json.

**Bei fehlendem Argument (Suche nach "ready_to_develop"):**

Falls `pipeline.project_name` gesetzt ist:
```sql
SELECT number, title, body, priority, tags
FROM public.tickets
WHERE status = 'ready_to_develop'
  AND workspace_id = '{pipeline.workspace_id}'
  AND project_id = (
    SELECT id FROM public.projects
    WHERE name = '{pipeline.project_name}'
      AND workspace_id = '{pipeline.workspace_id}'
  )
ORDER BY
  CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
  created_at ASC
LIMIT 5;
```

Falls `pipeline.project_name` null ist:
```sql
SELECT number, title, body, priority, tags
FROM public.tickets
WHERE status = 'ready_to_develop'
  AND workspace_id = '{pipeline.workspace_id}'
ORDER BY
  CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
  created_at ASC
LIMIT 5;
```

Via `mcp__claude_ai_Supabase__execute_sql` mit `project_id` aus `pipeline.project_id` in project.json.

### 2. Ticket auswählen

- **Mehrere:** Kurze Liste, User wählen lassen
- **Eines:** Automatisch nehmen
- **Keines:** User informieren

### 3. Status auf "in_progress" + Feature-Branch

**Falls Pipeline konfiguriert — PFLICHT, NICHT ÜBERSPRINGEN:**

Via `mcp__claude_ai_Supabase__execute_sql`:
```sql
UPDATE public.tickets
SET status = 'in_progress', branch = '{branch}'
WHERE number = {N}
  AND workspace_id = '{pipeline.workspace_id}'
RETURNING number, title, status;
```
Warte auf die Bestätigung, dass das Update erfolgreich war, bevor du weitermachst.

```bash
git checkout main && git pull origin main
git checkout -b {abgeleiteter-prefix}/{ticket-nummer}-{kurzbeschreibung}
```

### 4. Planung (SELBST, kein Planner-Agent)

**Lies nur die 5-10 betroffenen Dateien** direkt mit Read/Glob/Grep.
Lies `CLAUDE.md` für Architektur und Konventionen.
Lies `project.json` für Pfade und Stack-Details.

**Dann: Instruktionen für Agents formulieren** — mit exakten Code-Änderungen und neuen Dateien direkt im Prompt.

### 5. Implementierung (parallel wo möglich)

Spawne Agents via Task-Tool mit konkreten Instruktionen:

| Agent | `model` | Wann |
|-------|---------|------|
| `data-engineer` | `haiku` | Bei Schema-Änderungen |
| `backend` | `sonnet` | Bei API/Hook-Änderungen |
| `frontend` | `sonnet` | Bei UI-Änderungen |

**Prompt-Muster:** Exakte Dateiliste + Code-Snippets, NICHT "lies die Spec".

### 6. Build-Check (Bash, kein Agent)

Lies Build-Commands aus `project.json` und führe sie aus.
Nur bei Build-Fehlern: DevOps-Agent mit `model: "haiku"` spawnen.

**NICHT STOPPEN.** Zeige dem User NICHT die Build-Ergebnisse und warte NICHT auf Antwort. SOFORT weiter zu Schritt 7.

### 7. Review (ein Agent)

Ein QA-Agent mit `model: "haiku"`:
- Acceptance Criteria gegen Code prüfen
- Security-Quick-Check (Secrets, RLS, Auth, Input Validation)
- Bei Problemen: direkt fixen

**NICHT STOPPEN.** SOFORT weiter zu Schritt 8.

### 8. Ship — `/ship` ausführen

**Führe den `/ship` Command aus.** Dieser macht autonom: Commit → Push → PR → Supabase "in_review".

NICHT den Skill `finishing-a-development-branch` aufrufen.
NICHT dem User Optionen präsentieren.
NICHT fragen ob committed/gepusht werden soll.

**NICHT automatisch mergen.** Der PR bleibt offen bis der User ihn freigibt (via `/merge` oder "passt").

### Checkliste vor Abschluss

Bevor du den Workflow als fertig meldest, prüfe:
- [ ] **Falls Pipeline konfiguriert:** Status wurde auf "in_progress" gesetzt (Schritt 3)
- [ ] **Falls Pipeline konfiguriert:** Status wurde auf "in_review" gesetzt (Schritt 8 via `/ship`)
Falls ein Status-Update fehlt und Pipeline konfiguriert ist: **JETZT nachholen**, nicht überspringen.
