---
name: init
description: Projekt-Setup — Stack erkennen, project.json erstellen
---

# /init — Projekt initialisieren

Erkennt den Tech-Stack eines Projekts und erstellt/aktualisiert `project.json`. CLAUDE.md und Framework-Dateien werden von `setup.sh` verwaltet — /init fasst sie nicht an.

Board-Verbindung erfolgt separat via `/connect-board`.

## Schutzregeln

- **Bestehende `project.json` Werte werden NICHT überschrieben.** Fehlende Felder werden aus dem Template ergänzt (Migration).
- **CLAUDE.md wird NICHT von /init verwaltet.** Das ist Aufgabe von `setup.sh` (Generierung, Migration, Template-Hash-Tracking).
- Falls `project.json` bereits existiert UND bereits Stack-Felder hat: Ausgabe `✓ Projekt bereits initialisiert` und beenden.

## Ausführung

### 1. Stack erkennen

Lies die vorhandenen Dateien im Projekt-Root um den Stack zu erkennen. Keine Rückfragen — nur Dateisystem-Analyse.

**1a) Shopify-Erkennung (höchste Priorität):**

Shopify-Projekte haben spezifische Dateimuster. Prüfe in dieser Reihenfolge (erster Treffer gewinnt):

| Signal | Variante | Store-Quelle |
|---|---|---|
| `shopify.app.toml` existiert | `shopify-app` (Remix) | `shopify.app.toml` |
| `hydrogen.config.ts` existiert ODER `@shopify/hydrogen` in `package.json` | `shopify-hydrogen` | `.env` / `.env.local` (`PUBLIC_STORE_DOMAIN` oder `SHOPIFY_STORE_DOMAIN`) |
| `sections/` dir UND `layout/theme.liquid` existieren | `shopify-theme` (Liquid) | `shopify.theme.toml` |

Falls Shopify erkannt:
```json
{
  "stack": {
    "language": "<liquid für shopify-theme, typescript für shopify-app und shopify-hydrogen>",
    "framework": "shopify",
    "platform": "shopify",
    "variant": "<shopify-theme|shopify-app|shopify-hydrogen>"
  }
}
```

Sprache je Variante: `shopify-theme` → `liquid`, `shopify-app` → `typescript`, `shopify-hydrogen` → `typescript`.

Build-Commands je Variante:

| Variante | `build.dev` | `build.web` | `build.install` |
|---|---|---|---|
| `shopify-theme` | `shopify theme dev` | `shopify theme check --fail-level error` | — |
| `shopify-app` | `shopify app dev` | `npm run build` | `npm install` |
| `shopify-hydrogen` | `npm run dev` | `npm run build` | `npm install` |

**1b) Allgemeine Stack-Erkennung (falls kein Shopify):**

**Package Manager (aus Lock-Datei):**
- `pnpm-lock.yaml` → `pnpm`
- `yarn.lock` → `yarn`
- `bun.lockb` oder `bun.lock` → `bun`
- `package-lock.json` → `npm`
- Falls keine Lock-Datei aber `package.json` existiert → `npm`

**Sprache:**
- `tsconfig.json` existiert → `TypeScript`
- `package.json` existiert (ohne tsconfig) → `JavaScript`
- `pyproject.toml` / `requirements.txt` / `Pipfile` → `Python`
- `go.mod` → `Go`
- `Cargo.toml` → `Rust`

**Framework (aus `package.json` Dependencies oder Dateistruktur):**
- `next` in dependencies → `Next.js` (prüfe `src/app/` für App Router vs `src/pages/` für Pages Router)
- `nuxt` → `Nuxt`
- `@angular/core` → `Angular`
- `svelte` / `@sveltejs/kit` → `SvelteKit`
- `react` (ohne next/remix) → `React`
- `vue` (ohne nuxt) → `Vue`
- `express` / `fastify` / `hono` → Node Backend (jeweiliges Framework)
- `django` / `flask` / `fastapi` → Python Backend

**Backend:**
- `@supabase/supabase-js` oder `supabase/` dir → `Supabase`
- `prisma/` dir → `Prisma`
- `drizzle.config.*` → `Drizzle`

**Build-Commands aus `package.json` scripts ableiten:**
- `build` Script vorhanden → `{pkg_manager} run build`
- `dev` Script vorhanden → `{pkg_manager} run dev`
- `test` Script vorhanden → `{pkg_manager} run test`

**Pfade (nur setzen wenn Verzeichnis tatsächlich existiert):**
- `src/app/`, `app/` → `paths.src`
- `src/components/`, `components/` → `paths.components`
- `src/lib/`, `lib/` → `paths.lib`
- `tests/`, `test/`, `__tests__/` → `paths.tests`

### 2. project.json erstellen

Falls `project.json` NICHT existiert:

Lies `templates/project.json` als Referenz für die Struktur. Falls die Datei nicht existiert, nutze die untenstehende JSON-Struktur direkt.

Erstelle `project.json` basierend auf der Template-Struktur und fülle die erkannten Werte ein:

```json
{
  "name": "<aus package.json name, oder Verzeichnisname kebab-case>",
  "description": "<aus package.json description, oder leer>",
  "mode": "",
  "stack": {
    "language": "<erkannte Sprache>",
    "framework": "<erkanntes Framework>",
    "backend": "<erkanntes Backend>",
    "package_manager": "<erkannter Package Manager>",
    "platform": "<shopify falls Shopify, sonst leer>",
    "variant": "<Shopify-Variante falls Shopify, sonst leer>"
  },
  "build": {
    "web": "<erkannter Build-Command>",
    "test": "<erkannter Test-Command>",
    "dev": "<erkannter Dev-Command>",
    "dev_port": null,
    "install": "<erkannter Install-Command>",
    "verify": ""
  },
  "hosting": {
    "provider": "",
    "project_id": "",
    "team_id": "",
    "coolify_url": "",
    "coolify_app_uuid": ""
  },
  "shopify": {
    "store": "<erkannter Store falls Shopify, sonst leer>"
  },
  "skills": {
    "domain": [],
    "custom": []
  },
  "paths": {
    "src": "<erkannter Pfad>",
    "tests": "<erkannter Pfad>"
  },
  "supabase": {
    "project_id": ""
  },
  "pipeline": {
    "workspace_id": "",
    "project_id": "",
    "project_name": null,
    "skip_agents": [],
    "timeouts": {}
  },
  "conventions": {
    "commit_format": "conventional",
    "language": "de"
  }
}
```

**Regeln:**
- Nur Felder setzen die sicher erkannt wurden — nichts raten
- Leere Strings für nicht erkannte Felder (nicht weglassen)
- JSON mit 2-Space Indentation schreiben

Ausgabe: `✓ project.json erstellt ({erkannter Stack Zusammenfassung})`

Falls kein Stack erkannt: `✓ project.json erstellt (Stack nicht erkannt — manuell ergänzen oder setup.sh ausführen)`

Falls `project.json` bereits existiert, führe eine Migration durch — fehlende Felder aus dem Template ergänzen ohne bestehende Werte zu überschreiben:

```bash
FRAMEWORK_DIR="${CLAUDE_PLUGIN_ROOT:-}"
TEMPLATE_PJ=""
if [ -n "$FRAMEWORK_DIR" ] && [ -f "$FRAMEWORK_DIR/templates/project.json" ]; then
  TEMPLATE_PJ="$FRAMEWORK_DIR/templates/project.json"
elif [ -f "templates/project.json" ]; then
  TEMPLATE_PJ="templates/project.json"
fi

if [ -f "project.json" ] && [ -n "$TEMPLATE_PJ" ]; then
  RESULT=$(TPL="$TEMPLATE_PJ" node -e "
    const fs = require('fs');
    const existing = JSON.parse(fs.readFileSync('project.json', 'utf-8'));
    const template = JSON.parse(fs.readFileSync(process.env.TPL, 'utf-8'));
    let changed = false;

    for (const [key, val] of Object.entries(template)) {
      if (!(key in existing)) {
        existing[key] = val;
        changed = true;
      } else if (typeof val === 'object' && val !== null && !Array.isArray(val) && typeof existing[key] === 'object') {
        for (const [subKey, subVal] of Object.entries(val)) {
          if (!(subKey in existing[key])) {
            existing[key][subKey] = subVal;
            changed = true;
          }
        }
      }
    }

    if (changed) {
      fs.writeFileSync('project.json', JSON.stringify(existing, null, 2) + '\n');
      process.stdout.write('migrated');
    } else {
      process.stdout.write('current');
    }
  " 2>/dev/null || echo "skipped")

  if [ "$RESULT" = "migrated" ]; then
    echo "✓ project.json migriert (fehlende Felder ergänzt)"
  elif [ "$RESULT" = "skipped" ]; then
    echo "⚠ project.json Migration übersprungen (node nicht verfügbar oder ungültiges JSON)"
  else
    echo "✓ project.json aktuell"
  fi
fi
```

### 2.5 Mode erkennen

Erkenne ob just-ship als Plugin oder Standalone installiert ist und setze das `mode`-Feld in `project.json`:

```bash
FRAMEWORK_DIR="${CLAUDE_PLUGIN_ROOT:-}"
CURRENT_MODE=$(node -e "process.stdout.write(require('./project.json').mode || '')" 2>/dev/null || echo "")

if [ -z "$CURRENT_MODE" ]; then
  if [ -n "$FRAMEWORK_DIR" ]; then
    NEW_MODE="plugin"
  else
    NEW_MODE="standalone"
  fi
  
  JS_MODE="$NEW_MODE" node -e "
    const fs = require('fs');
    const pj = JSON.parse(fs.readFileSync('project.json', 'utf-8'));
    pj.mode = process.env.JS_MODE;
    fs.writeFileSync('project.json', JSON.stringify(pj, null, 2) + '\n');
  " 2>/dev/null || true
  
  echo "✓ Mode: $NEW_MODE"
fi
```

Ausgabe: `✓ Mode: {plugin|standalone}` (nur wenn neu gesetzt, nicht bei bestehendem Wert)

### 3. Zusammenfassung

Zeige eine gebrandete, informative Zusammenfassung. Nutze Box-Drawing-Characters fuer visuelle Struktur.

**Immer zuerst den Banner:**

```
 ┌─────────────────────────────────────────────┐
 │                                             │
 │      _ _   _ ____ _____   ____ _   _ ___ ____  │
 │     | | | | / ___|_   _| / ___| | | |_ _|  _ \ │
 │  _  | | | | \___ \ | |   \___ \ |_| || || |_) |│
 │ | |_| | |_| |___) || |    ___) |  _  || ||  __/ │
 │  \___/ \___/|____/ |_|   |____/|_| |_|___|_|    │
 │                                             │
 │      Your dev team. Always shipping.        │
 │                                             │
 └─────────────────────────────────────────────┘
```

**Dann die Projekt-Info:**

Falls Stack erkannt:
```
 ┌─ {name}
 │
 │  Stack         {framework} + {language}
 │  Package Mgr   {package_manager}
 │  Build         {build.web}
 │  Test          {build.test}
 │
 │  ✓ project.json erstellt
 │
 ├─ Naechster Schritt
 │
 │  Framework installieren:
 │    {$CLAUDE_PLUGIN_ROOT/setup.sh falls gesetzt, sonst: setup.sh}
 │
 │  Oder Board verbinden:
 │    /connect-board
 │
 └─────────────────────────────────────────────
```

Falls weder Stack noch Framework erkannt:
```
 ┌─ {name}
 │
 │  ✓ project.json erstellt
 │
 │  Stack noch nicht erkannt — kein Problem.
 │  Installiere deine Dependencies und
 │  lauf /init nochmal — der Stack wird
 │  automatisch erkannt.
 │
 ├─ Naechster Schritt
 │
 │  Framework installieren:
 │    {$CLAUDE_PLUGIN_ROOT/setup.sh falls gesetzt, sonst: setup.sh}
 │
 │  Oder Board verbinden:
 │    /connect-board
 │
 └─────────────────────────────────────────────
```

**Regeln fuer die Zusammenfassung:**
- Nur Felder anzeigen die einen Wert haben (leere Felder weglassen)
- Box-Drawing-Characters fuer konsistenten Look mit Session-Summary
- Keine ANSI-Escape-Codes — Claude Code rendert das als Markdown

## Wichtig

- **Nicht-interaktiv:** Keine Fragen, keine Menüs, keine Optionen. Dateisystem analysieren und Ergebnis schreiben.
- **Idempotent:** Erneutes Ausführen überschreibt nichts. Existierende Dateien werden übersprungen.
- **Board-Verbindung ist NICHT Teil dieses Commands.** Dafür `/connect-board` verwenden.
- **VPS-Setup ist NICHT Teil dieses Commands.** Dafür `/just-ship-vps` verwenden.
- **CLAUDE.md wird NICHT von /init verwaltet.** Generierung, Migration und Template-Tracking sind Aufgabe von `setup.sh`.
- **Framework-Dateien (agents, skills, scripts) werden NICHT von /init installiert.** Das macht `setup.sh`.
