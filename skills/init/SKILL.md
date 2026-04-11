---
name: init
description: Projekt-Setup \u2014 project.json erstellen, Stack erkennen, CLAUDE.md generieren
---

# /init \u2014 Projekt initialisieren

Initialisiert ein Projekt f\u00fcr Just Ship: erstellt `project.json` mit auto-detected Stack, generiert `CLAUDE.md` aus Template. Nicht-interaktiv, keine R\u00fcckfragen.

Board-Verbindung erfolgt separat via `/connect-board`.

## Schutzregeln

- **Bestehende `project.json` wird NICHT \u00fcberschrieben.** Falls vorhanden: `\u2713 project.json existiert bereits \u2014 \u00fcbersprungen` und weiter zu Schritt 3 (CLAUDE.md).
- **Bestehende `CLAUDE.md` wird NICHT \u00fcberschrieben.** Falls vorhanden: `\u2713 CLAUDE.md existiert bereits \u2014 \u00fcbersprungen`.
- Falls BEIDE bereits existieren UND `project.json` bereits Stack-Felder hat (`stack.language` oder `stack.framework` non-empty): Ausgabe `\u2713 Projekt bereits initialisiert` und beenden.

## Ausf\u00fchrung

### 1. Stack erkennen

Lies die vorhandenen Dateien im Projekt-Root um den Stack zu erkennen. Keine R\u00fcckfragen \u2014 nur Dateisystem-Analyse.

**1a) Shopify-Erkennung (h\u00f6chste Priorit\u00e4t):**

Shopify-Projekte haben spezifische Dateimuster. Pr\u00fcfe in dieser Reihenfolge (erster Treffer gewinnt):

| Signal | Variante | Store-Quelle |
|---|---|---|
| `shopify.app.toml` existiert | `shopify-app` (Remix) | `shopify.app.toml` |
| `hydrogen.config.ts` existiert ODER `@shopify/hydrogen` in `package.json` | `shopify-hydrogen` | `.env` / `.env.local` (`PUBLIC_STORE_DOMAIN` oder `SHOPIFY_STORE_DOMAIN`) |
| `sections/` dir UND `layout/theme.liquid` existieren | `shopify-theme` (Liquid) | `shopify.theme.toml` |

Falls Shopify erkannt:
```json
{
  "stack": {
    "language": "<liquid f\u00fcr shopify-theme, typescript f\u00fcr shopify-app und shopify-hydrogen>",
    "framework": "shopify",
    "platform": "shopify",
    "variant": "<shopify-theme|shopify-app|shopify-hydrogen>"
  }
}
```

Sprache je Variante: `shopify-theme` \u2192 `liquid`, `shopify-app` \u2192 `typescript`, `shopify-hydrogen` \u2192 `typescript`.

Build-Commands je Variante:

| Variante | `build.dev` | `build.web` | `build.install` |
|---|---|---|---|
| `shopify-theme` | `shopify theme dev` | `shopify theme check --fail-level error` | \u2014 |
| `shopify-app` | `shopify app dev` | `npm run build` | `npm install` |
| `shopify-hydrogen` | `npm run dev` | `npm run build` | `npm install` |

**1b) Allgemeine Stack-Erkennung (falls kein Shopify):**

**Package Manager (aus Lock-Datei):**
- `pnpm-lock.yaml` \u2192 `pnpm`
- `yarn.lock` \u2192 `yarn`
- `bun.lockb` oder `bun.lock` \u2192 `bun`
- `package-lock.json` \u2192 `npm`
- Falls keine Lock-Datei aber `package.json` existiert \u2192 `npm`

**Sprache:**
- `tsconfig.json` existiert \u2192 `TypeScript`
- `package.json` existiert (ohne tsconfig) \u2192 `JavaScript`
- `pyproject.toml` / `requirements.txt` / `Pipfile` \u2192 `Python`
- `go.mod` \u2192 `Go`
- `Cargo.toml` \u2192 `Rust`

**Framework (aus `package.json` Dependencies oder Dateistruktur):**
- `next` in dependencies \u2192 `Next.js` (pr\u00fcfe `src/app/` f\u00fcr App Router vs `src/pages/` f\u00fcr Pages Router)
- `nuxt` \u2192 `Nuxt`
- `@angular/core` \u2192 `Angular`
- `svelte` / `@sveltejs/kit` \u2192 `SvelteKit`
- `react` (ohne next/remix) \u2192 `React`
- `vue` (ohne nuxt) \u2192 `Vue`
- `express` / `fastify` / `hono` \u2192 Node Backend (jeweiliges Framework)
- `django` / `flask` / `fastapi` \u2192 Python Backend

**Backend:**
- `@supabase/supabase-js` oder `supabase/` dir \u2192 `Supabase`
- `prisma/` dir \u2192 `Prisma`
- `drizzle.config.*` \u2192 `Drizzle`

**Build-Commands aus `package.json` scripts ableiten:**
- `build` Script vorhanden \u2192 `{pkg_manager} run build`
- `dev` Script vorhanden \u2192 `{pkg_manager} run dev`
- `test` Script vorhanden \u2192 `{pkg_manager} run test`

**Pfade (nur setzen wenn Verzeichnis tatsächlich existiert):**
- `src/app/`, `app/` \u2192 `paths.src`
- `src/components/`, `components/` \u2192 `paths.components`
- `src/lib/`, `lib/` \u2192 `paths.lib`
- `tests/`, `test/`, `__tests__/` \u2192 `paths.tests`

### 2. project.json erstellen

Falls `project.json` NICHT existiert:

Lies `templates/project.json` als Referenz f\u00fcr die Struktur. Falls die Datei nicht existiert, nutze die untenstehende JSON-Struktur direkt.

Erstelle `project.json` basierend auf der Template-Struktur und f\u00fclle die erkannten Werte ein:

```json
{
  "name": "<aus package.json name, oder Verzeichnisname kebab-case>",
  "description": "<aus package.json description, oder leer>",
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
- Nur Felder setzen die sicher erkannt wurden \u2014 nichts raten
- Leere Strings f\u00fcr nicht erkannte Felder (nicht weglassen)
- JSON mit 2-Space Indentation schreiben

Ausgabe: `\u2713 project.json erstellt ({erkannter Stack Zusammenfassung})`

Falls kein Stack erkannt: `\u2713 project.json erstellt (Stack nicht erkannt \u2014 manuell erg\u00e4nzen oder /setup-just-ship ausf\u00fchren)`

### 3. CLAUDE.md generieren

Falls `CLAUDE.md` NICHT existiert:

Lies `templates/CLAUDE.md` und ersetze Platzhalter:

- `{{PROJECT_NAME}}` \u2192 Projektname aus `project.json` `name` Feld
- `TODO: Kurze Projektbeschreibung hier einf\u00fcgen.` \u2192 `project.json` `description` (falls non-empty), sonst Platzhalter belassen
- `TODO: Code-Konventionen hier einf\u00fcgen` \u2192 Erkannte Konventionen basierend auf Stack (z.B. `TypeScript, Next.js, Tailwind CSS, pnpm`). Falls nichts erkannt: Platzhalter belassen
- `TODO: Projektstruktur hier einf\u00fcgen.` \u2192 Top-Level-Verzeichnisstruktur (2-3 Ebenen). Nur tats\u00e4chlich vorhandene Verzeichnisse. Falls leer: Platzhalter belassen

Schreibe die Datei als `CLAUDE.md` im Projekt-Root.

Ausgabe: `\u2713 CLAUDE.md generiert`

### 4. Zusammenfassung

```
\u2713 Projekt initialisiert

  Name          : {name}
  Stack         : {framework} + {language}        \u2190 nur wenn erkannt
  Package Mgr   : {package_manager}               \u2190 nur wenn erkannt
  Build         : {build.web}                      \u2190 nur wenn erkannt
  Test          : {build.test}                     \u2190 nur wenn erkannt

N\u00e4chster Schritt:
  Board verbinden \u2192 /connect-board
  Erstes Ticket  \u2192 /ticket
```

Falls weder Stack noch Framework erkannt:
```
\u2713 Projekt initialisiert (Basis-Konfiguration)

  Stack noch nicht erkannt \u2014 wird automatisch bef\u00fcllt sobald
  du Abh\u00e4ngigkeiten installierst und /init erneut ausf\u00fchrst.

N\u00e4chster Schritt:
  Board verbinden \u2192 /connect-board
  Erstes Ticket  \u2192 /ticket
```

## Wichtig

- **Nicht-interaktiv:** Keine Fragen, keine Men\u00fcs, keine Optionen. Dateisystem analysieren und Ergebnis schreiben.
- **Idempotent:** Erneutes Ausf\u00fchren \u00fcberschreibt nichts. Existierende Dateien werden \u00fcbersprungen.
- **Board-Verbindung ist NICHT Teil dieses Commands.** Daf\u00fcr `/connect-board` verwenden.
- **VPS-Setup ist NICHT Teil dieses Commands.** Daf\u00fcr `/just-ship-vps` verwenden.
- **Framework-Dateien (agents, skills, scripts) werden NICHT kopiert.** Das macht `setup.sh` oder das Plugin-System.
