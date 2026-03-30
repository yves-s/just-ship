---
name: ship
description: Alles abschliessen — commit, push, PR, merge, zurück auf main. Vollständig autonom, NULL Rückfragen.
---

# /ship — ALLES abschliessen, ein Befehl

Vom uncommitted Code bis zum gemergten PR auf main. **Ein Befehl, keine Unterbrechung.**

## WICHTIGSTE REGEL

**DU DARFST NICHT STOPPEN ODER FRAGEN.** Führe ALLE Schritte 1-8 hintereinander aus. Kein "Soll ich...?", kein "Möchtest du...?", kein "Ich habe committed, soll ich jetzt pushen?". EINFACH ALLES DURCHLAUFEN.

Falls du den Drang hast eine Frage zu stellen: **UNTERDRÜCKE IHN** und mach einfach den nächsten Schritt.

## NICHT verwenden

- NICHT den Skill `finishing-a-development-branch` aufrufen
- NICHT den User nach Optionen fragen
- NICHT nach Bestätigung fragen
- NICHT zwischen Schritten stoppen

## Konfiguration

Lies `project.json`. Bestimme den Pipeline-Modus:

1. **Board API** (bevorzugt): Falls `pipeline.workspace_id` gesetzt → Credentials auflösen:
   ```bash
   WS_JSON=$(bash .claude/scripts/write-config.sh read-workspace --id <workspace_id>)
   ```
   Aus dem JSON-Output `board_url` und `api_key` verwenden. `pipeline.project_id` aus `project.json`.
2. **Legacy Supabase MCP**: Falls nur `project_id` gesetzt (ohne `workspace_id`), und `project_id` hat keine Bindestriche → `execute_sql` verwenden, Warnung ausgeben: "Kein Board API konfiguriert. Nutze Legacy Supabase MCP. Fuehre /setup-just-ship aus um zu upgraden."
3. **Standalone**: Falls weder `workspace_id` noch `project_id` konfiguriert → Pipeline-Schritte überspringen

**project_id Format-Check:** Falls `pipeline.project_id` gesetzt ist und KEINE Bindestriche enthält (kurzer alphanumerischer String wie `wsmnutkobalfrceavpxs`), ist es eine alte Supabase-Projekt-ID. Warnung ausgeben: "pipeline.project_id sieht nach einer alten Supabase-ID aus. Fuehre /setup-just-ship aus um auf Board-UUID zu migrieren."

## Trigger

- `/ship`
- "passt", "done", "sieht gut aus", "klappt", "fertig", "ship it", "mach zu"

## Ablauf — ALLE Schritte ohne Pause durchführen

### 1. Commit (falls nötig)

```bash
git status
```

Falls uncommitted changes:
```bash
git add <betroffene-dateien>
git commit -m "feat(T-{ticket}): {englische Beschreibung}

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

SOFORT WEITER ZU SCHRITT 2.

### 2. Push

```bash
git push -u origin $(git branch --show-current)
```

SOFORT WEITER ZU SCHRITT 3.

### 3. PR erstellen (falls keiner existiert)

```bash
gh pr view 2>/dev/null || gh pr create --title "feat(T-{ticket}): {Beschreibung}" --body "$(cat <<'EOF'
## Summary
- {Bullet Points}

## Test plan
- {Was wurde getestet}

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

SOFORT WEITER ZU SCHRITT 3a.

### 3a. Review-URL ins Ticket schreiben (nur wenn Pipeline konfiguriert)

PR-URL extrahieren und ins Ticket patchen:
```bash
REVIEW_URL=$(gh pr view --json url -q .url 2>/dev/null || echo "")
```

**Board API (bevorzugt):**
```bash
if [ -n "$REVIEW_URL" ]; then
  curl -s -X PATCH -H "X-Pipeline-Key: {api_key}" \
    -H "Content-Type: application/json" \
    -d '{"review_url": "'"$REVIEW_URL"'"}' \
    "{board_url}/api/tickets/{N}"
fi
```

**Legacy Supabase MCP (Fallback):**
```bash
if [ -n "$REVIEW_URL" ]; then
  mcp__claude_ai_Supabase__execute_sql "UPDATE public.tickets SET review_url = '$REVIEW_URL' WHERE number = {N} AND workspace_id = '{pipeline.workspace_id}' RETURNING number, review_url;"
fi
```

SOFORT WEITER ZU SCHRITT 3b.

### 3b. Vercel Preview URL

**Immer ausführen** — das Script erkennt automatisch ob ein Vercel-Deployment existiert und returned leer wenn nicht. Kein Config-Gate nötig.

**WICHTIG:** Die Preview-URL MUSS eine Vercel-Deployment-URL sein (z.B. `https://<project>-<hash>.vercel.app`). NIEMALS einen GitHub-Link, PR-URL oder Repository-URL als `preview_url` setzen. Das `preview_url`-Feld ist ausschließlich für die live deployete Vorschau.

```bash
PREVIEW_URL=$(bash .claude/scripts/get-preview-url.sh 30)
```

Falls eine URL gefunden wurde (`$PREVIEW_URL` nicht leer):

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

Falls keine URL gefunden: still überspringen, kein Fehler. Das Script exits immer mit Code 0.

SOFORT WEITER ZU SCHRITT 4.

### 4. Merge

```bash
gh pr merge --squash --delete-branch
```

SOFORT WEITER ZU SCHRITT 5.

### 5. Zurück auf main

```bash
git checkout main && git pull origin main
```

SOFORT WEITER ZU SCHRITT 5a.

### 5a. Shopify Theme Cleanup (falls Shopify-Projekt)

```bash
HOSTING=$(node -e "
  const c = require('./project.json');
  const h = c.hosting || (c.stack?.framework === 'shopify' ? 'shopify' : '');
  process.stdout.write(h);
")

if [ "$HOSTING" = "shopify" ]; then
  # Falls Worktree: Theme-ID-Datei liegt dort
  THEME_ID_FILE=".worktrees/T-${N}/.claude/.shopify-theme-id"
  [ ! -f "$THEME_ID_FILE" ] && THEME_ID_FILE=".claude/.shopify-theme-id"
  SHOPIFY_THEME_ID_FILE="$THEME_ID_FILE" bash .claude/scripts/shopify-preview.sh cleanup
fi
```

Ausgabe:
- `✓ shopify — Theme gelöscht` (falls Theme-ID vorhanden)
- Still überspringen falls kein Shopify-Projekt oder keine Theme-ID

SOFORT WEITER ZU SCHRITT 5b.

### 5b. Worktree Cleanup (falls Worktree existiert)

Prüfe ob ein Worktree für dieses Ticket existiert:
```bash
if [ -d ".worktrees/T-{N}" ]; then
  git worktree remove .worktrees/T-{N} --force 2>/dev/null || true
fi
```
Ausgabe: `✓ worktree — .worktrees/T-{N} aufgeräumt` (falls vorhanden)

Falls kein Worktree existiert: still überspringen.

SOFORT WEITER ZU SCHRITT 6.

**Hinweis:** Schritt 3b (Vercel Preview URL) bleibt unverändert. Für Shopify-Projekte returned das Vercel-Script leer, und die Preview-URL wurde bereits während `/develop` Schritt 9f ins Ticket geschrieben.

### 6. Pipeline-Status auf "done" (nur wenn konfiguriert)

**Board API (bevorzugt):** Via Bash curl:
```bash
curl -s -X PATCH -H "X-Pipeline-Key: {api_key}" \
  -H "Content-Type: application/json" \
  -d '{"status": "done", "summary": "{pr_summary}"}' \
  "{board_url}/api/tickets/{N}"
```
Hinweis: `summary` wird mitgesendet damit das Board eine Zusammenfassung des abgeschlossenen Tickets anzeigt.

**Legacy Supabase MCP (Fallback):** Via `mcp__claude_ai_Supabase__execute_sql`:
```sql
UPDATE public.tickets SET status = 'done', summary = '{summary}' WHERE number = {N} AND workspace_id = '{pipeline.workspace_id}' RETURNING number, title, status;
```

SOFORT WEITER ZU SCHRITT 7.

### 7. Bestätigung (EINZIGE Ausgabe an den User)

```
✓ Shipped: feat(T-{ticket}): {Beschreibung}
  PR: {url}
  Branch: {branch} → deleted
  Worktree: .worktrees/T-{N} → aufgeräumt (falls vorhanden)
  Board: done (falls konfiguriert)
```

## Fehlerbehandlung

- **Pre-Commit Hook Failure:** Fixen, NEUEN Commit, weiter
- **Push rejected:** `git pull --rebase origin {branch}`, dann nochmal pushen
- **Merge-Konflikte:** NUR DANN dem User zeigen — das ist der EINZIGE Grund zum Stoppen
- **PR existiert bereits:** Überspringen, direkt mergen
- **Alles schon auf main:** Sagen "Bereits auf main, nichts zu tun"

## Verboten

- `git add -A` oder `git add .`
- `--force` push
- `--amend` bei Hook-Failure
- Fragen stellen
- Zwischen Schritten stoppen
- Den Skill `finishing-a-development-branch` aufrufen
