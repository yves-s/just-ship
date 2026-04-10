---
name: ship
description: Alles abschliessen — commit, push, PR, merge, zurück auf main. Vollständig autonom, NULL Rückfragen. Unterstützt /ship T-{N} für direkten Branch-Zugriff.
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

1. **Board API** (bevorzugt): Falls `pipeline.workspace_id` gesetzt → `board-api.sh` verwenden:
   ```bash
   bash .claude/scripts/board-api.sh patch "tickets/{N}" '{"status": "done"}'
   ```
   Credentials werden intern aufgelöst. `pipeline.project_id` aus `project.json`.
2. **Legacy Supabase MCP**: Falls nur `project_id` gesetzt (ohne `workspace_id`), und `project_id` hat keine Bindestriche → `execute_sql` verwenden, Warnung ausgeben: "Kein Board API konfiguriert. Nutze Legacy Supabase MCP. Fuehre /setup-just-ship aus um zu upgraden."
3. **Standalone**: Falls weder `workspace_id` noch `project_id` konfiguriert → Pipeline-Schritte überspringen

**project_id Format-Check:** Falls `pipeline.project_id` gesetzt ist und KEINE Bindestriche enthält (kurzer alphanumerischer String wie `wsmnutkobalfrceavpxs`), ist es eine alte Supabase-Projekt-ID. Warnung ausgeben: "pipeline.project_id sieht nach einer alten Supabase-ID aus. Fuehre /setup-just-ship aus um auf Board-UUID zu migrieren."

## Trigger

- `/ship`
- "passt", "done", "sieht gut aus", "klappt", "fertig", "ship it", "mach zu"

## Ablauf — ALLE Schritte ohne Pause durchführen

### 0. Branch auflösen (falls Argument übergeben)

Falls `/ship` mit Argument aufgerufen wird (z.B. `/ship T-385`):

1. Ticket-Nummer aus Argument extrahieren (Pattern: `T-{N}` oder `{N}`)
2. Zugehörigen Branch finden:
   ```bash
   git branch --list "*T-${N}*" "*/${N}-*" | head -1 | xargs
   ```
3. Branch auschecken:
   ```bash
   git checkout {branch}
   ```
4. Weiter mit Schritt 1

Falls kein Branch gefunden: Fehlermeldung "Kein Branch für T-{N} gefunden."

Falls `/ship` ohne Argument: wie bisher den aktuellen Branch verwenden. Fehler wenn auf `main`.

SOFORT WEITER ZU SCHRITT 1.

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
  bash .claude/scripts/board-api.sh patch "tickets/{N}" '{"review_url": "'"$REVIEW_URL"'"}'
fi
```

**Legacy Supabase MCP (Fallback):**
```bash
if [ -n "$REVIEW_URL" ]; then
  mcp__claude_ai_Supabase__execute_sql "UPDATE public.tickets SET review_url = '$REVIEW_URL' WHERE number = {N} AND workspace_id = '{pipeline.workspace_id}' RETURNING number, review_url;"
fi
```

SOFORT WEITER ZU SCHRITT 3b.

### 3b. Preview URL (Vercel)

**Nur ausführen wenn `hosting.provider` gesetzt ist.** Das Script prüft selbst ob Vercel als Hosting-Provider konfiguriert ist und exitet graceful wenn nicht. Bei nicht gesetztem `hosting`-Feld wird dieser gesamte Schritt übersprungen — kein API-Call, kein Warten.

**WICHTIG:** Die Preview-URL MUSS eine Vercel-Deployment-URL sein (z.B. `https://<project>-<hash>.vercel.app`). NIEMALS einen GitHub-Link, PR-URL oder Repository-URL als `preview_url` setzen. Das `preview_url`-Feld ist ausschließlich für die live deployete Vorschau.

```bash
# get-preview-url.sh checks hosting.provider internally and exits if not "vercel"
PREVIEW_URL=$(bash .claude/scripts/get-preview-url.sh 30)
```

Falls eine URL gefunden wurde (`$PREVIEW_URL` nicht leer):

**Board API:**
```bash
if [ -n "$PREVIEW_URL" ]; then
  bash .claude/scripts/board-api.sh patch "tickets/{N}" '{"preview_url": "'"$PREVIEW_URL"'"}'
fi
```

**Legacy Supabase MCP (Fallback):**
```bash
if [ -n "$PREVIEW_URL" ]; then
  mcp__claude_ai_Supabase__execute_sql "UPDATE public.tickets SET preview_url = '$PREVIEW_URL' WHERE number = {N} AND workspace_id = '{pipeline.workspace_id}' RETURNING number, preview_url;"
fi
```

Falls keine URL gefunden: still überspringen, kein Fehler. Das Script exits immer mit Code 0.

SOFORT WEITER ZU SCHRITT 3c.

### 3c. Dev-Server stoppen (falls laufend)

**PID-Tracking:** `/just-ship-review` speichert die Dev-Server-PID in `.claude/.dev-server-pid`.

```bash
if [ -f ".claude/.dev-server-pid" ]; then
  PID=$(cat .claude/.dev-server-pid)
  kill $PID 2>/dev/null || true
  rm -f .claude/.dev-server-pid
fi
```

Falls PID-Datei nicht existiert aber `build.dev_port` in `project.json` konfiguriert:
```bash
DEV_PORT=$(node -e "process.stdout.write(String(require('./project.json').build?.dev_port || ''))")
if [ -n "$DEV_PORT" ]; then
  lsof -ti :$DEV_PORT | xargs kill 2>/dev/null || true
fi
```

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

```bash
# Lokalen Branch aufräumen (Remote wird von --delete-branch gelöscht)
git branch -d {branch} 2>/dev/null || true
```

SOFORT WEITER ZU SCHRITT 5a.

### 5a. Shopify Post-Merge (falls Shopify-Projekt)

Bestimme Shopify-Variant und führe den passenden Post-Merge-Step aus:

```bash
PLATFORM=$(node -e "process.stdout.write(require('./project.json').stack?.platform || '')" 2>/dev/null || echo "")
VARIANT=$(node -e "process.stdout.write(require('./project.json').stack?.variant || '')" 2>/dev/null || echo "")
```

**App-Variant (`variant: "remix"`):** Extensions und App-Config deployen:
```bash
if [ "$PLATFORM" = "shopify" ] && [ "$VARIANT" = "remix" ]; then
  bash .claude/scripts/shopify-app-deploy.sh
fi
```

Das Script:
- Führt `shopify app deploy --force` aus
- Retry 1x bei Exit-Code 1 (transient), sofort abbrechen bei Exit-Code >1 (auth/validation)
- Gibt Warnung aus bei Fehler — blockiert NICHT den Merge
- Auth via `SHOPIFY_CLI_PARTNERS_TOKEN` (VPS) oder CLI-Session (lokal)

Ausgabe:
- `✓ shopify — Extensions und App-Config deployed` (bei Erfolg)
- `⚠ shopify — App Deploy fehlgeschlagen, manuell deployen` (bei Fehler)

**Theme-Variant (default):** Unpublished Preview-Theme löschen:
```bash
if [ "$PLATFORM" = "shopify" ] && [ "$VARIANT" != "remix" ]; then
  THEME_ID_FILE=".worktrees/T-${N}/.claude/.shopify-theme-id"
  [ ! -f "$THEME_ID_FILE" ] && THEME_ID_FILE=".claude/.shopify-theme-id"
  SHOPIFY_THEME_ID_FILE="$THEME_ID_FILE" bash .claude/scripts/shopify-preview.sh cleanup
fi
```

Ausgabe:
- `✓ shopify — Theme gelöscht` (falls Theme-ID vorhanden)
- Still überspringen falls kein Shopify-Projekt

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

SOFORT WEITER ZU SCHRITT 5c.

**Hinweis:** Schritt 3b (Vercel Preview URL) bleibt unverändert. Für Shopify-Projekte returned das Vercel-Script leer, und die Preview-URL wurde bereits während `/develop` Schritt 9f ins Ticket geschrieben.

### 5c. Token-Tracking (nur wenn Pipeline konfiguriert)

Berechne die **Ticket-spezifischen** Kosten als Delta zwischen dem Snapshot (geschrieben bei `/develop` Start) und dem aktuellen Stand. Das isoliert die Kosten pro Ticket, auch wenn mehrere Tickets in einer Session bearbeitet werden.

```bash
SAFE_CWD=$(echo "$PWD" | sed 's|^/||' | sed 's|/|-|g')
SESSION_DIR="$HOME/.claude/projects/-${SAFE_CWD}"
SESSION_FILE=$(ls -t "$SESSION_DIR"/*.jsonl 2>/dev/null | head -1)

if [ -n "$SESSION_FILE" ]; then
  END_JSON=$(bash .claude/scripts/calculate-session-cost.sh "$(basename "$SESSION_FILE" .jsonl)" "$PWD" 2>/dev/null || echo "")

  if [ -n "$END_JSON" ]; then
    # Read start snapshot (written by /develop step 3e)
    SNAPSHOT_FILE=".claude/.token-snapshot-T-{N}.json"
    START_TOKENS=0
    START_COST=0
    if [ -f "$SNAPSHOT_FILE" ]; then
      START_TOKENS=$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$SNAPSHOT_FILE','utf-8')).total_tokens || 0))" 2>/dev/null || echo "0")
      START_COST=$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$SNAPSHOT_FILE','utf-8')).estimated_cost_usd || 0))" 2>/dev/null || echo "0")
    fi

    END_TOKENS=$(echo "$END_JSON" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).total_tokens || 0))" 2>/dev/null || echo "0")
    END_COST=$(echo "$END_JSON" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).estimated_cost_usd || 0))" 2>/dev/null || echo "0")

    # Delta = end - start (ticket-specific cost)
    DELTA_TOKENS=$(node -e "process.stdout.write(String(Math.max(0, Number('$END_TOKENS') - Number('$START_TOKENS'))))")
    DELTA_COST=$(node -e "process.stdout.write(String(parseFloat(Math.max(0, Number('$END_COST') - Number('$START_COST')).toFixed(4))))")

    if [ "$DELTA_TOKENS" != "0" ]; then
      bash .claude/scripts/board-api.sh patch "tickets/{N}" "{\"total_tokens\": $DELTA_TOKENS, \"estimated_cost\": $DELTA_COST}" >/dev/null 2>&1 || true
    fi

    # Clean up snapshot
    rm -f "$SNAPSHOT_FILE" 2>/dev/null || true
  fi
fi
```

Ausgabe:
- `✓ tokens — {DELTA_TOKENS} tokens, ${DELTA_COST}` (falls Kosten berechnet)
- Still überspringen falls keine Session-Daten oder kein Pipeline

**Fallback:** Falls kein Snapshot existiert (z.B. `/ship` ohne vorheriges `/develop`), ist `START_TOKENS=0` und das Delta = Gesamtkosten der Session.

SOFORT WEITER ZU SCHRITT 6.

### 6. Pipeline-Status auf "done" (nur wenn konfiguriert)

**Board API (bevorzugt):** Via Bash curl mit Retry bei Fehler:
```bash
SHIP_STATUS_OK=false
for ATTEMPT in 1 2 3; do
  if bash .claude/scripts/board-api.sh patch "tickets/{N}" '{"status": "done", "summary": "{pr_summary}"}'; then
    SHIP_STATUS_OK=true
    break
  fi
  echo "Board-Status-Update fehlgeschlagen (Versuch $ATTEMPT/3), retry in ${ATTEMPT}s..."
  sleep $ATTEMPT
done
if [ "$SHIP_STATUS_OK" != "true" ]; then
  echo "⚠ Board-Status-Update auf 'done' fehlgeschlagen nach 3 Versuchen. Manuell prüfen: T-{N}"
fi
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

Prüfe ob andere Branches aufgeräumt werden sollten:
```bash
git fetch --prune
STALE=$(git branch -v | grep '\[gone\]' | awk '{print $1}')
BEHIND=$(git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads | grep -v 'main' | while read branch track; do
  COUNT=$(git rev-list --count "$branch..main" 2>/dev/null || echo 0)
  if [ "$COUNT" -gt 50 ]; then
    echo "$branch — $COUNT Commits hinter main"
  fi
done)
```

Falls stale oder weit hinter main (>50 Commits):
```
Hinweis: Folgende Branches könnten aufgeräumt werden:
  {branch-name} — Remote gelöscht
  {branch-name} — 73 Commits hinter main
```

Nur als Hinweis — nicht automatisch löschen.

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
