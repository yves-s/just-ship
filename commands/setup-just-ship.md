---
name: setup-just-ship
description: Just Ship installieren und Projekt konfigurieren — Stack erkennen, project.json befüllen, Board verbinden
disable-model-invocation: true
---

# /setup-just-ship — Projekt einrichten

Installiert Just Ship im aktuellen Projekt (falls noch nicht geschehen), erkennt den Tech-Stack automatisch, befüllt `project.json` und `CLAUDE.md`, und verbindet optional das Just Ship Board.

## Argumente

| Flag | Beschreibung |
|---|---|
| `--board` | Board URL (z.B. `https://board.just-ship.io`) |
| `--key` | Workspace API Key (z.B. `adp_...`) — vom Board generiert |
| `--project` | Projekt UUID |
| `--workspace-id` | Workspace UUID (alternativ zu `--key`) |

---

## SCHNELLVERBINDUNG (Board-Flags übergeben)

**Prüfe als allererstes:** Sind `--board` UND (`--key` ODER `--workspace-id`) UND `--project` übergeben worden?

**Falls JA → führe NUR die folgenden Schritte aus und beende danach. Kein Stack-Analyse, kein Menü, keine Rückfragen. NICHT nach dem API-Key fragen — er wurde bereits als `--key` übergeben.**

Merke dir die übergebenen Werte:
- `KEY` = der Wert hinter `--key` (z.B. `adp_abc123...`)
- `BOARD` = der Wert hinter `--board` (z.B. `https://board.just-ship.io`)
- `PROJECT` = der Wert hinter `--project` (z.B. `ddab92d9-...`)

### S1. Workspace-ID ermitteln

Falls `--key` übergeben (kein `--workspace-id`): Rufe die Board-API mit dem bereits bekannten `KEY` auf:

```bash
RESPONSE=$(curl -s -H "X-Pipeline-Key: $KEY" "$BOARD/api/projects")
WORKSPACE_ID=$(echo "$RESPONSE" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
  process.stdout.write(d.workspace_id || d.data?.workspace_id || '');
")
```

Falls `WORKSPACE_ID` leer: Ausgabe `⚠ Konnte Workspace-ID nicht ermitteln. Prüfe deinen API-Key.` und abbrechen.

Falls `--workspace-id` direkt übergeben: diesen Wert als `WORKSPACE_ID` verwenden.

### S2. Workspace + Projekt speichern

Führe beide Befehle mit den bereits bekannten Werten aus — ohne Rückfragen, ohne nach dem Key zu fragen:

```bash
"$HOME/.just-ship/scripts/write-config.sh" add-workspace \
  --workspace-id "$WORKSPACE_ID" \
  --key "$KEY" \
  --board "$BOARD"
```

```bash
bash .claude/scripts/write-config.sh set-project \
  --workspace-id "$WORKSPACE_ID" \
  --project-id "$PROJECT"
```

### S3. Sidekick einrichten (optional)

Führe Schritt 6 (Sidekick) aus — nutze dabei `WORKSPACE_ID`, `--key` als `api_key` und `--board` als `board_url`.

### S4. Fertig

Ausgabe:

```
✓ Board verbunden
✓ Projekt verknüpft
✓ project.json aktualisiert

Erstelle dein erstes Ticket mit /ticket.
```

**STOP. Nicht weiter unten lesen.**

---

## NORMALES SETUP (keine Board-Flags)

### 0. Just Ship installiert?

**0a) Global installiert?** Prüfe ob `~/.just-ship` als git-Repo existiert:

```bash
[ -d "$HOME/.just-ship/.git" ] && echo "OK" || echo "NOT_INSTALLED"
```

Falls `NOT_INSTALLED`:

1. Ausgabe: `Just Ship wird installiert...`
2. Führe aus:
   ```bash
   curl -fsSL https://just-ship.io/install | bash
   ```
3. Warte auf Abschluss. Falls Fehler: Ausgabe anzeigen und abbrechen.
4. Ausgabe: `✓ Just Ship installiert`

**0b) Im Projekt installiert?** Prüfe ob `.claude/agents/` existiert:

```bash
ls .claude/agents/ 2>/dev/null | head -1 || echo "NOT_INSTALLED"
```

Falls `NOT_INSTALLED`:

1. Ausgabe: `Framework-Dateien werden kopiert...`
2. Führe aus:
   ```bash
   just-ship setup --auto
   ```
3. Warte auf Abschluss. Falls Fehler: Ausgabe anzeigen und abbrechen.
4. Ausgabe: `✓ Framework eingerichtet`

**0c) Bestehendes Setup erkennen**

Falls `.claude/agents/` bereits existiert UND `project.json` bereits existiert mit gesetzten Stack-Feldern (mindestens `stack.framework` oder `stack.language` sind non-empty):

Prüfe den Status:
- `project.json` → `pipeline.workspace_id` gesetzt? → Board verbunden
- `~/.just-ship/config.json` → Workspace-Einträge vorhanden?

Falls Stack erkannt aber Board NICHT verbunden:

```
✓ project.json gefunden ({stack.framework}, {stack.language})
✓ CLAUDE.md gefunden
✓ .claude/agents/ vorhanden
⚠ Board nicht verbunden

Projekt ist bereits eingerichtet. Was möchtest du tun?

  1. Board verbinden → zeige Anleitung für 'just-ship connect' im Terminal
  2. Nein, CLI-only nutzen
  3. Setup komplett neu ausführen → Stack-Erkennung + Config überschreiben
```

- **Option 1:** Zeige die Board-Verbindungs-Anleitung (wie in Schritt 5) und beende danach.
- **Option 2:** Abschließen mit "Fertig! Erstelle dein erstes Ticket mit /ticket."
- **Option 3:** Weiter mit Schritt 1 (normale Stack-Erkennung).

Falls Stack erkannt UND Board verbunden: Zeige Status und frage ob Re-Setup gewünscht:

```
✓ Projekt vollständig eingerichtet
  Stack: {framework}, Board: verbunden

Setup erneut ausführen? (Überschreibt Stack-Erkennung)
  1. Ja, neu erkennen
  2. Nein, alles gut
```

### 1. Projekt analysieren

Lies die vorhandenen Dateien im Projekt-Root um den Stack zu erkennen:

**Package Manager & Dependencies:**
- `package.json` → Dependencies, Scripts, Name
- `pnpm-lock.yaml` → pnpm
- `yarn.lock` → yarn
- `bun.lockb` / `bun.lock` → bun
- `package-lock.json` → npm
- `requirements.txt` / `pyproject.toml` / `Pipfile` → Python
- `go.mod` → Go
- `Cargo.toml` → Rust

**Framework-Erkennung (aus Dependencies oder Dateistruktur):**
- `next` → Next.js (prüfe `next.config.*` für App Router vs Pages Router)
- `nuxt` → Nuxt
- `@angular/core` → Angular
- `svelte` / `@sveltejs/kit` → Svelte/SvelteKit
- `react` (ohne next) → React (Vite/CRA)
- `vue` (ohne nuxt) → Vue
- `express` / `fastify` / `hono` → Node Backend
- `django` / `flask` / `fastapi` → Python Backend
- `sections/` + `layout/theme.liquid` existieren → Shopify Theme (kein package.json nötig)

**Datenbank:**
- `supabase/` Verzeichnis oder `@supabase/supabase-js` → Supabase
- `prisma/` Verzeichnis → Prisma
- `drizzle.config.*` → Drizzle

**Weitere Config-Dateien:**
- `tsconfig.json` → TypeScript (prüfe `paths` für Import-Aliase wie `@/`)
- `tailwind.config.*` → Tailwind CSS
- `.env.example` / `.env.local` → Env-Variablen-Muster
- `vitest.config.*` / `jest.config.*` → Test-Framework
- `playwright.config.*` → E2E Tests
- `Dockerfile` / `docker-compose.*` → Docker

**Projekt-Struktur:**
- `src/app/` → App Router (Next.js) oder Angular
- `src/pages/` → Pages Router oder Vite
- `app/` → Next.js App Router (ohne src)
- `pages/` → Next.js Pages Router (ohne src)
- `src/components/` / `components/` → Component-Verzeichnis
- `src/lib/` / `lib/` / `utils/` → Utility-Verzeichnis
- `src/server/` / `server/` / `api/` → Backend-Verzeichnis

### 2. project.json befüllen

Lies die aktuelle `project.json`. Befülle/aktualisiere folgende Felder basierend auf der Analyse — **überschreibe keine Werte die bereits sinnvoll gesetzt sind**:

```json
{
  "name": "<aus package.json name oder bestehender Wert>",
  "description": "<aus package.json description oder bestehender Wert>",
  "stack": {
    "framework": "<erkanntes Framework, z.B. 'Next.js 15 (App Router)'>",
    "language": "<z.B. 'TypeScript'>",
    "styling": "<z.B. 'Tailwind CSS'>",
    "database": "<z.B. 'Supabase (PostgreSQL)'>",
    "orm": "<z.B. 'Prisma' oder 'Drizzle' oder null>",
    "testing": "<z.B. 'Vitest' oder 'Jest'>",
    "package_manager": "<pnpm|yarn|bun|npm>"
  },
  "build": {
    "web": "<package_manager> run build",
    "dev": "<package_manager> run dev",
    "test": "<erkannter Test-Runner, z.B. 'npx vitest run'>"
  },
  "paths": {
    "components": "<erkannter Pfad, z.B. 'src/components'>",
    "pages": "<erkannter Pfad, z.B. 'src/app'>",
    "lib": "<erkannter Pfad, z.B. 'src/lib'>",
    "api": "<erkannter Pfad, z.B. 'src/app/api'>"
  }
}
```

**Shopify-Projekte:** Falls als Shopify-Theme erkannt:
- `stack.framework: "shopify"`
- `stack.language: "liquid"`
- `build.web: "shopify theme check --fail-level error"`
- `hosting: "shopify"`
- `shopify.store`: Aus `shopify.theme.toml` ([environments.default].store) lesen, falls vorhanden. Sonst aus bestehendem `project.json`. Falls nicht vorhanden → User fragen: "Shopify Store URL? (z.B. `client-store.myshopify.com`)"

**Regeln:**
- Nur Felder setzen die du sicher erkannt hast — nichts raten
- Bestehende Werte beibehalten wenn sie sinnvoll sind
- `build` Commands aus `package.json` scripts ableiten wenn vorhanden
- `paths` nur setzen wenn das Verzeichnis tatsächlich existiert

### 3. CLAUDE.md ergänzen

Lies die aktuelle `CLAUDE.md`. Falls dort noch TODO-Platzhalter stehen:

**Projekt-Beschreibung** (unter `## Projekt`):
- Ersetze `TODO: Kurze Projektbeschreibung` mit einer Beschreibung basierend auf `package.json` description, README, oder erkanntem Stack

**Code-Konventionen** (unter `### Code`):
- Ersetze `TODO: Code-Konventionen` mit erkannten Konventionen:
  - Sprache (TypeScript/JavaScript/Python/etc.)
  - Import-Stil (z.B. `@/` Alias wenn in tsconfig erkannt)
  - Styling-Ansatz (Tailwind, CSS Modules, etc.)

**Architektur** (unter `## Architektur`):
- Ersetze `TODO: Projektstruktur` mit der tatsächlichen Top-Level-Struktur
- Zeige die relevantesten 2-3 Ebenen, nicht das gesamte Dateisystem

**Regeln:**
- Nur TODO-Platzhalter ersetzen — bestehenden manuell geschriebenen Content NICHT überschreiben
- Kurz und prägnant — keine ausschweifenden Beschreibungen
- Falls kein TODO mehr vorhanden: CLAUDE.md nicht anfassen

### 4. Zusammenfassung

Zeige nur Zeilen für Felder die tatsächlich erkannt wurden (leere Felder weglassen):

```
✓ Just Ship eingerichtet

  Stack         : {framework} + {language} + {styling}   ← nur wenn erkannt
  Build         : {build_command}                         ← nur wenn erkannt
  Test          : {test_command}                          ← nur wenn erkannt
  Package Mgr   : {package_manager}                      ← nur wenn erkannt

Geänderte Dateien:
  ✓ project.json
  ✓ CLAUDE.md
```

Falls gar kein Stack erkannt wurde (leeres Projekt):
```
✓ Just Ship eingerichtet

  Stack noch nicht erkannt — wird automatisch befüllt sobald
  du Abhängigkeiten installierst und /setup-just-ship erneut ausführst.

Geänderte Dateien:
  ✓ project.json
  ✓ CLAUDE.md
```

### 5. Board verbinden?

Falls `pipeline.workspace_id` in `project.json` noch nicht gesetzt ist, frage:

```
Möchtest du das Just Ship Board verbinden? (j/n)
```

**Falls nein:** Abschließen mit:
```
Fertig! Erstelle dein erstes Ticket mit /ticket.
```

**Falls ja:** Ausgabe (NICHT in einem Code-Block, damit der Link klickbar ist):

Öffne https://board.just-ship.io — das Board führt dich durch die Einrichtung. Sag Bescheid wenn du fertig bist.

Keine weiteren Erklärungen. Das Board hat einen Onboarding-Stepper der alles erklärt.

Wenn der User zurückkommt, prüfe ob die Verbindung eingerichtet wurde:
```bash
cat "$HOME/.just-ship/config.json" 2>/dev/null | node -e "
  const c=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
  const ws=Object.keys(c.workspaces||{});
  console.log(ws.length ? 'CONNECTED:' + ws.join(',') : 'NOT_CONNECTED');
"
```

Falls CONNECTED: Bestätige mit `✓ Board verbunden`
Falls NOT_CONNECTED: Frage ob etwas nicht geklappt hat.

### 6. Sidekick einrichten

**Nur ausführen wenn Board verbunden** (`pipeline.workspace_id` und `pipeline.project_id` in `project.json` gesetzt). Falls kein Board verbunden: Schritt überspringen.

Ausgabe: `Sidekick wird eingerichtet...`

**6a) Projekt-Slug ermitteln:**

Workspace-Credentials auflösen (nutze workspace_id aus `project.json` `pipeline.workspace_id`):
```bash
WS_JSON=$(bash .claude/scripts/write-config.sh read-workspace --id <workspace_id>)
board_url=$(echo "$WS_JSON" | node -e "console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).board_url || '')")
api_key=$(echo "$WS_JSON" | node -e "console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).api_key || '')")
```

Projekt-ID aus `project.json` auslesen:
```bash
project_id=$(node -e "console.log(require('./project.json').pipeline?.project_id || '')")
```

Projekt-Slug vom Board holen:
```bash
if [ -n "$board_url" ] && [ -n "$api_key" ] && [ -n "$project_id" ]; then
  SLUG=$(curl -s -H "X-Pipeline-Key: ${api_key}" \
    "${board_url}/api/projects" | \
    node -e "
      try {
        const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
        const p=(d.data?.projects||[]).find(p=>p.id==='${project_id}');
        console.log(p?.slug||'');
      } catch(e) { console.log(''); }
    ")
fi
```

Falls leer oder API-Aufruf fehlgeschlagen, Slug aus dem Projektnamen in `project.json` `name` ableiten (kebab-case):
```bash
project_name=$(node -e "console.log(require('./project.json').name || '')")
if [ -z "$SLUG" ] && [ -n "$project_name" ]; then
  SLUG=$(echo "$project_name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/-\+/-/g' | sed 's/^-\|-$//g')
fi
```

Falls SLUG immer noch leer → Fehlerausgabe und Snippet mit Platzhalter zeigen:
```bash
if [ -z "$SLUG" ]; then
  echo "⚠ Sidekick: Projekt-Slug nicht verfügbar"
  echo ""
  echo "Füge das Snippet manuell in dein HTML ein (ersetze DEIN-SLUG):"
  echo "  <script src=\"https://board.just-ship.io/sidekick.js\" data-project=\"DEIN-SLUG\"></script>"
  echo ""
  echo "Aktivierung: Ctrl+Shift+S oder ?sidekick in der URL"
  return 0
fi
```

Dann zum nächsten Schritt (6b) gehen.

**6b) Layout-Datei erkennen:**

Basierend auf dem erkannten Stack, suche die Haupt-Layout-Datei. Prüfe die Dateien der Reihe nach — die erste existierende wird verwendet:

| Stack | Layout-Dateien (Priorität) |
|---|---|
| Next.js (App Router) | `src/app/layout.tsx`, `app/layout.tsx`, `src/app/layout.jsx`, `app/layout.jsx` |
| Next.js (Pages Router) | `src/pages/_document.tsx`, `pages/_document.tsx`, `src/pages/_document.jsx`, `pages/_document.jsx` |
| Nuxt | `app.vue` |
| SvelteKit | `src/app.html` |
| HTML / Vite / andere | `index.html`, `public/index.html` |

Falls Stack nicht erkannt wurde: alle Kandidaten durchprobieren.

**6c) Snippet einfügen:**

Falls Layout-Datei gefunden — lies die Datei und prüfe ob das Sidekick-Snippet bereits vorhanden ist (`sidekick.js` im Inhalt). Falls ja: `✓ Sidekick bereits installiert` und Schritt beenden.

Falls noch nicht vorhanden — füge das Snippet **framework-gerecht** ein (ersetze `{slug}` mit dem Wert aus `$SLUG`):

**Next.js (App Router / Pages Router) — `.tsx` / `.jsx`:**
- Falls `import Script from 'next/script'` noch nicht vorhanden → folgende Zeile nach anderen Imports hinzufügen:
  ```tsx
  import Script from 'next/script'
  ```
- Vor dem schließenden `</body>` Tag einfügen:
  ```tsx
  <Script src="https://board.just-ship.io/sidekick.js" data-project="{slug}" strategy="afterInteractive" />
  ```

**HTML / Vite / SvelteKit — `.html`:**
- Vor `</body>` einfügen:
  ```html
  <script src="https://board.just-ship.io/sidekick.js" data-project="{slug}"></script>
  ```

**Nuxt — `app.vue`:**
- Im `<script setup>` Block hinzufügen (oder `<script setup>` Block erstellen falls nicht vorhanden):
  ```ts
  useHead({ script: [{ src: 'https://board.just-ship.io/sidekick.js', 'data-project': '{slug}' }] })
  ```

Erfolgreiche Ausgabe: `✓ Sidekick installiert ({layout-datei})`

Falls KEINE Layout-Datei gefunden — Snippet für manuelle Installation anzeigen:
```
⚠ Sidekick: Layout-Datei nicht erkannt

Füge dieses Snippet in dein HTML ein:
  <script src="https://board.just-ship.io/sidekick.js" data-project="{slug}"></script>

Aktivierung: Ctrl+Shift+S oder ?sidekick in der URL
```

**6d) Fehlerbehandlung:**

Falls beim Einfügen ein Fehler auftritt (Datei nicht schreibbar, unerwartetes Format):
```
⚠ Sidekick konnte nicht automatisch installiert werden

Füge dieses Snippet manuell in dein HTML ein:
  <script src="https://board.just-ship.io/sidekick.js" data-project="{slug}"></script>

Aktivierung: Ctrl+Shift+S oder ?sidekick in der URL
```

**Kein Abbruch des Setup-Flows** — Sidekick-Fehler sind nicht kritisch. Setup gilt als erfolgreich auch wenn Sidekick manuell eingebettet werden muss.
