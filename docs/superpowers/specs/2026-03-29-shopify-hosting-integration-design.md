# Shopify als First-Class Hosting-Typ in Just Ship

**Datum:** 2026-03-29
**Kontext:** Just Ship wird als Agency OS mit Shopify-Spezialisierung positioniert. Die 3 Shopify-Skills (liquid, theme, metafields) existieren bereits. Was fehlt: der gesamte Deploy/Preview/Cleanup-Flow für Shopify-Projekte innerhalb der bestehenden `/develop` → `/ship` Pipeline.

---

## Ziel

Ein Shopify-Projekt soll sich genauso anfühlen wie ein Web-App-Projekt: `/setup-just-ship` erkennt den Typ, `/develop` implementiert + deployed eine Preview, der Kunde/PM sieht die Preview-URL im Board, `/ship` mergt und räumt auf.

---

## Entscheidungen

| # | Entscheidung | Begründung |
|---|---|---|
| 1 | **Bestehende Commands erweitern, keine eigenen Shopify-Commands** | Ein Framework, viele Projekt-Typen. `/develop` und `/ship` erkennen `hosting: "shopify"` und schalten auf Shopify-spezifische Schritte um. |
| 2 | **`--unpublished` statt `--development` für Ticket-Previews** | Development Themes sind session-gebunden und unsichtbar im Admin. Unpublished Themes haben eine stabile Preview-URL, sind im Admin sichtbar, und können benannt werden (`T-{N}: {title}`). |
| 3 | **Ein Theme pro Ticket** | Isolierte Previews. Kunde/PM sieht genau die Änderungen eines Tickets. Nach Merge wird aufgeräumt. Theme-Slot-Limit (max ~1000 unpublished) ist kein Problem. |
| 4 | **Credentials: CLI-Session lokal, Theme Access Password auf VPS** | Lokal braucht man nichts Extra — die CLI-Session reicht. Auf dem VPS kommt das Theme Access Password (`shptka_...`) zum Einsatz, gespeichert in `~/.just-ship/config.json`. |
| 5 | **`shopify.theme.toml` wird respektiert, nicht generiert** | Kein Config-Dualismus. Wenn der User eine hat, nutzt Just Ship sie. Wenn nicht, nutzt Just Ship `project.json` Werte direkt via CLI-Flags. |
| 6 | **`settings_data.json` Hard Guard auf zwei Ebenen** | Rule verhindert Agent-Edits, Script verhindert Push. Defense in depth — die gefährlichste Datei in einem Shopify-Theme. |
| 7 | **Eigenes Script `shopify-preview.sh` statt `get-preview-url.sh` erweitern** | Shopify-Preview ist aktiv (Push + URL-Extraktion), Vercel-Preview ist passiv (warten auf Deployment). Unterschiedliche Mechanik, eigenes Script. |

---

## 1. project.json — Neue Felder

### Schema-Erweiterung

```json
{
  "name": "client-store-theme",
  "stack": {
    "framework": "shopify",
    "language": "liquid"
  },
  "build": {
    "web": "shopify theme check --fail-level error",
    "test": ""
  },
  "hosting": "shopify",
  "shopify": {
    "store": "client-store.myshopify.com"
  },
  "pipeline": {
    "workspace_id": "...",
    "project_id": "..."
  }
}
```

### Neue Felder

| Feld | Typ | Required | Beschreibung |
|---|---|---|---|
| `hosting` | `"vercel" \| "shopify"` | nein | Hosting-Typ. Fallback: wenn leer und `stack.framework === "shopify"` → wird als `"shopify"` behandelt. |
| `shopify.store` | string | nur bei Shopify | Store-URL (`client-store.myshopify.com`) |

**Hinweis zu `build.web`:** Für Shopify-Projekte wird `build.web` mit `shopify theme check --fail-level error` belegt. Das Feld existiert bereits in `templates/project.json` und wird von `/develop` Schritt 6 gelesen. Kein neues Feld nötig.

**Hinweis zu `shopify.store_password`:** Storefront-Passwörter für passwortgeschützte Stores (für QA/Playwright) werden als **Env-Variable `SHOPIFY_STORE_PASSWORD`** gesetzt, nicht in `project.json` committed. Auf dem VPS wird die Variable im systemd Service gesetzt, lokal kann der User sie in `.env` oder Shell-Profile setzen.

### Credentials (NICHT in project.json)

Theme Access Password für VPS/Pipeline in `~/.just-ship/config.json`:

```json
{
  "workspaces": {
    "{uuid}": {
      "board_url": "...",
      "api_key": "...",
      "shopify_password": "shptka_..."
    }
  }
}
```

Auflösung via `write-config.sh read-workspace --id {uuid}`.

**Erweiterung nötig:** `write-config.sh` muss erweitert werden:
- `add-workspace` bekommt optionalen Flag `--shopify-password`
- `read-workspace` gibt `shopify_password` im JSON-Output mit zurück (falls gesetzt)
- Wird beim VPS-Setup oder manuell via `write-config.sh add-workspace --shopify-password shptka_...` gesetzt

### Backward Compatibility

- Alle neuen Felder optional
- Projekte ohne `hosting` funktionieren wie bisher
- `shopify` Block wird ignoriert bei nicht-Shopify-Projekten

---

## 2. Setup-Flow — Shopify-Erkennung

### Erkennung in `/setup-just-ship`

```bash
if [ -d "sections" ] && [ -f "layout/theme.liquid" ]; then
  FRAMEWORK="shopify"
fi
```

### Automatische Konfiguration

Bei Erkennung setzt `/setup-just-ship`:
- `stack.framework: "shopify"`
- `stack.language: "liquid"`
- `build.web: "shopify theme check --fail-level error"`
- `hosting: "shopify"`

### Store-URL Auflösung (Priorität)

1. `shopify.theme.toml` → Store aus `[environments.default]`
2. Bereits in `project.json` unter `shopify.store`
3. Nicht gefunden → User fragen: "Shopify Store URL? (z.B. `client-store.myshopify.com`)"

### Prerequisite-Check in `setup.sh`

```bash
if [ "$FRAMEWORK" = "shopify" ]; then
  check_prereq "shopify" || MISSING=1
fi
```

### Was NICHT passiert

- Keine `shopify.theme.toml` generieren
- Kein `shopify auth login` triggern
- Kein Theme Access Password abfragen (kommt bei VPS-Setup)

---

## 3. `/develop` — Shopify-spezifische Schritte

### Schritt 6 — Build-Check (keine Änderung nötig)

Build-Command kommt aus `project.json` (`build.web`). Für Shopify: `shopify theme check --fail-level error`. Funktioniert bereits — der Mechanismus ist projekt-agnostisch.

### Schritt 9f — Preview (Hauptänderung)

**Aktuell (Vercel only):**
```bash
PREVIEW_URL=$(bash .claude/scripts/get-preview-url.sh 30)
```

**Neu (Hosting-Weiche mit Fallback-Erkennung):**
```bash
HOSTING=$(node -e "
  const c = require('./project.json');
  const h = c.hosting || (c.stack?.framework === 'shopify' ? 'shopify' : '');
  process.stdout.write(h);
")

if [ "$HOSTING" = "shopify" ]; then
  PREVIEW_URL=$(bash .claude/scripts/shopify-preview.sh push "T-${N}" "${TITLE}")
else
  PREVIEW_URL=$(bash .claude/scripts/get-preview-url.sh 30)
fi
```

**Fallback-Erkennung:** Wenn `hosting` leer ist aber `stack.framework === "shopify"`, wird automatisch `"shopify"` angenommen. Das schützt gegen Projekte die vor diesem Feature eingerichtet wurden.

Output ans Board bleibt identisch — `preview_url` Feld existiert schon:
```bash
if [ -n "$PREVIEW_URL" ]; then
  curl -s -X PATCH -H "X-Pipeline-Key: {api_key}" \
    -H "Content-Type: application/json" \
    -d '{"preview_url": "'"$PREVIEW_URL"'"}' \
    "{board_url}/api/tickets/{N}"
fi
```

---

## 4. `shopify-preview.sh` — Neues Script

### Subcommands

**`push` — Theme erstellen + URL zurückgeben:**

```bash
shopify-preview.sh push "T-{N}" "{title}"
```

Ablauf:
1. Store-URL aus `project.json` lesen (`shopify.store`)
2. Credentials auflösen:
   - Env-Variable `SHOPIFY_CLI_THEME_TOKEN` gesetzt? → verwenden
   - `~/.just-ship/config.json` hat `shopify_password`? → `--password` Flag
   - Weder noch? → CLI-Session (kein Flag nötig)
3. Prüfe ob `.claude/.shopify-theme-id` existiert (Theme wurde schon erstellt)
4. **Erster Push** (keine Theme-ID vorhanden):
   ```bash
   shopify theme push \
     --unpublished \
     --theme "T-{N}: {title}" \
     --store {store} \
     --ignore "config/settings_data.json" \
     --json \
     [--password {pw}]
   ```
5. **Subsequent Push** (Theme-ID vorhanden — z.B. nach Code Review Nachbesserung):
   ```bash
   shopify theme push \
     --theme {THEME_ID} \
     --store {store} \
     --ignore "config/settings_data.json" \
     --json \
     [--password {pw}]
   ```
   Wichtig: `--theme` akzeptiert eine numerische Theme-ID. Beim Update kein `--unpublished` — das würde ein neues Theme erstellen.
6. Theme-ID aus JSON-Output extrahieren:
   ```bash
   # Shopify CLI --json output enthält theme.id
   THEME_ID=$(echo "$OUTPUT" | node -e "
     const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
     process.stdout.write(String(d.theme?.id || ''));
   ")
   ```
   Fallback falls `--json` Format sich ändert: `shopify theme list --store {store} --json` und nach Theme-Name filtern.
7. Preview-URL bauen: `https://{store}/?preview_theme_id={THEME_ID}`
8. Theme-ID + Theme-Name in `.claude/.shopify-theme-id` speichern
9. URL auf stdout ausgeben

**`cleanup` — Theme löschen:**

```bash
shopify-preview.sh cleanup
```

Ablauf:
1. Theme-ID aus `.claude/.shopify-theme-id` lesen
2. Falls vorhanden:
   ```bash
   shopify theme delete \
     --theme {ID} \
     --store {store} \
     --force \
     [--password {pw}]
   ```
3. `.shopify-theme-id` Datei löschen
4. Falls Theme-ID nicht vorhanden oder Delete fehlschlägt → still exit 0

### Fehlerbehandlung

- Script exittet IMMER mit Code 0 (wie `get-preview-url.sh`)
- Bei Fehlern: leerer stdout, kein Blocker für die Pipeline
- Fehler-Details auf stderr für Debugging

### `.shopify-theme-id` Format

```
THEME_ID=123456789
THEME_NAME=T-42: Hero section redesign
```

Datei wird in `.gitignore` aufgenommen.

---

## 5. `/ship` — Theme Cleanup

### Neuer Schritt 5a.5 (nach Merge, VOR Worktree Cleanup)

**Wichtig:** Shopify Cleanup muss VOR dem Worktree Removal laufen, weil `.claude/.shopify-theme-id` im Worktree liegt (`.worktrees/T-{N}/.claude/.shopify-theme-id`). Nach Worktree Removal ist die Datei weg.

Einfügen zwischen Schritt 5 (zurück auf main) und Schritt 5a (Worktree Cleanup):

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

### Ausgabe

- `✓ shopify — Theme "T-{N}: {title}" gelöscht`
- `✓ shopify — kein Theme zum Aufräumen` (falls keine ID gespeichert)

### `/ship` Schritt 3b — Vercel Preview

Schritt 3b (`get-preview-url.sh`) bleibt unverändert. Für Shopify-Projekte returned das Vercel-Script leer (kein Vercel-Deployment), und die Preview-URL wurde bereits während `/develop` Schritt 9f ins Ticket geschrieben. Kein Handlungsbedarf.

### Timing

Cleanup passiert NACH Merge, nicht bei PR-Close. Das Theme bleibt solange der PR offen ist — der Reviewer kann die Preview-URL nutzen. Nachbesserungen nach Code Review pushen auf dasselbe Theme (erneuter `shopify-preview.sh push` mit gespeicherter Theme-ID updated das bestehende Theme).

---

## 6. Guards & Rules

### Neue Rule: `no-settings-data-edit.md`

```markdown
NEVER edit, create, or overwrite `config/settings_data.json`.

This file contains all merchant customizations (colors, fonts, section ordering,
content). Editing it overwrites the customer's work.

- If a ticket asks to change theme settings: modify `config/settings_schema.json`
  (the definition), not `settings_data.json` (the merchant's values)
- If you need default values: set them in section schema `"default"` fields
- The shopify-preview.sh script always passes `--ignore "config/settings_data.json"`

No exceptions. This is a destructive action equivalent to dropping a database table.
```

### Script-Level Guard

`shopify-preview.sh` fügt `--ignore "config/settings_data.json"` bei JEDEM `shopify theme push` hinzu — unabhängig davon was der Agent tut.

### Ergänzung in `shopify-skill-awareness.md`

Ein Satz ergänzen: "Respect `.shopifyignore` — never push files listed there."

---

## 7. QA — Playwright gegen Shopify Preview

### Anpassung in `/develop` Schritt 10b

**Aktuell:** Bedingung `pipeline.hosting === "vercel"`
**Neu:** Bedingung `$PREVIEW_URL` ist nicht leer (hosting-agnostisch)

### Shopify-spezifisch: Passwortgeschützte Stores

Viele Development-Stores haben ein Storefront-Passwort. Playwright muss das umgehen:

```javascript
const storePassword = process.env.SHOPIFY_STORE_PASSWORD || '';
if (storePassword) {
  await page.fill('input[type="password"]', storePassword);
  await page.click('button[type="submit"]');
  await page.waitForNavigation();
}
```

Storefront-Passwort kommt aus der Env-Variable `SHOPIFY_STORE_PASSWORD` (nicht in `project.json` — es ist ein Credential). Optional — wenn nicht gesetzt, wird der Schritt übersprungen.

Alles andere (Screenshots, HTTP-Status-Check, Console-Errors, QA-Report) ist hosting-agnostisch und bleibt unverändert.

---

## 8. Sidekick — Shopify Themes

Sidekick-Injection (Script-Tag in Layout) ist **nicht im Scope** für Shopify Themes. Grund: Shopify-Themes laufen auf der Shopify-Domain, nicht auf einer eigenen Domain. Der Sidekick wird über das Board genutzt (direkte URL), nicht als eingebettetes Widget im Store.

Falls in Zukunft gewünscht: Shopify App Extension als separater Delivery-Mechanismus (P3+).

---

## 9. Änderungsübersicht

| Datei | Aktion | Was |
|---|---|---|
| `commands/develop.md` | Edit | Schritt 9f: Hosting-Weiche Vercel/Shopify |
| `commands/ship.md` | Edit | Schritt 5a.5: Theme Cleanup bei Shopify (vor Worktree Removal) |
| `commands/setup-just-ship.md` | Edit | Shopify-Erkennung, Store-URL, Prereq |
| `.claude/scripts/shopify-preview.sh` | Neu | Push + URL-Extraktion + Cleanup |
| `.claude/scripts/write-config.sh` | Edit | `add-workspace --shopify-password`, `read-workspace` gibt `shopify_password` zurück |
| `.claude/rules/no-settings-data-edit.md` | Neu | Hard Guard für settings_data.json |
| `.claude/rules/shopify-skill-awareness.md` | Edit | `.shopifyignore` Hinweis |
| `templates/project.json` | Edit | `hosting` + `shopify` Felder |
| `setup.sh` | Edit | Shopify CLI Prereq-Check |
| `PRODUCT.md` | Edit | Shopify als Hosting-Typ erwähnen |

### Was sich NICHT ändert

- Skills (shopify-liquid, shopify-theme, shopify-metafields) — fertig
- Agent-Definitionen — keine Änderung
- Board-API — `preview_url` Feld existiert schon
- `get-preview-url.sh` — bleibt für Vercel
- Pipeline SDK — keine Änderung

---

## Nicht im Scope

- **Multi-Store** (ein Repo → mehrere Stores) — P2/P3
- **Shopify GitHub Integration** (native two-way sync) — out of scope, Agenturen bevorzugen CLI-basiertes CI/CD
- **`shopify.theme.toml` Generierung** — User's Sache
- **Hydrogen/Headless** — separates Vertikal (P3)
- **Shopify App Development** — separates Vertikal (P3)
- **Live Theme Push** — nur Preview/Unpublished Themes, nie das Live Theme
