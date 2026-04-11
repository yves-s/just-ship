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

### 3.5 Framework-Dateien installieren

Erkenne den Framework-Quellpfad und kopiere alle Framework-Dateien in das Projekt:

```bash
# Framework-Quellpfad bestimmen
if [ -n "$CLAUDE_PLUGIN_ROOT" ] && [ -f "$CLAUDE_PLUGIN_ROOT/setup.sh" ]; then
  FRAMEWORK_DIR="$CLAUDE_PLUGIN_ROOT"
elif [ -f "./setup.sh" ] && [ -d "./agents" ]; then
  echo "⚠ Running inside the just-ship framework repo — skipping framework file installation."
  FRAMEWORK_DIR=""
else
  echo "⚠ Framework source not found — install via setup.sh or register the just-ship plugin."
  FRAMEWORK_DIR=""
fi
```

Falls `FRAMEWORK_DIR` leer ist, diesen Schritt überspringen.

Falls `FRAMEWORK_DIR` gesetzt ist, kopiere die folgenden Verzeichnisse (alle idempotent — bereits befüllte Verzeichnisse werden übersprungen):

**agents/**
```bash
PROJECT_DIR="$(pwd)"
agent_count=0
if [ ! -d "$PROJECT_DIR/.claude/agents" ] || [ -z "$(ls -A "$PROJECT_DIR/.claude/agents/" 2>/dev/null)" ]; then
  mkdir -p "$PROJECT_DIR/.claude/agents"
  cp "$FRAMEWORK_DIR/agents/"*.md "$PROJECT_DIR/.claude/agents/" 2>/dev/null || true
  agent_count=$(ls "$PROJECT_DIR/.claude/agents/"*.md 2>/dev/null | wc -l | tr -d ' ')
  echo "✓ $agent_count agents installed"
else
  agent_count=$(ls "$PROJECT_DIR/.claude/agents/"*.md 2>/dev/null | wc -l | tr -d ' ')
  echo "✓ agents/ already exists — skipped"
fi
```

**commands/**
```bash
cmd_count=0
if [ ! -d "$PROJECT_DIR/.claude/commands" ] || [ -z "$(ls -A "$PROJECT_DIR/.claude/commands/" 2>/dev/null)" ]; then
  mkdir -p "$PROJECT_DIR/.claude/commands"
  cp "$FRAMEWORK_DIR/commands/"*.md "$PROJECT_DIR/.claude/commands/" 2>/dev/null || true
  cmd_count=$(ls "$PROJECT_DIR/.claude/commands/"*.md 2>/dev/null | wc -l | tr -d ' ')
  echo "✓ $cmd_count commands installed"
else
  cmd_count=$(ls "$PROJECT_DIR/.claude/commands/"*.md 2>/dev/null | wc -l | tr -d ' ')
  echo "✓ commands/ already exists — skipped"
fi
```

**skills/**
```bash
skill_count=0
if [ ! -d "$PROJECT_DIR/.claude/skills" ] || [ -z "$(ls -A "$PROJECT_DIR/.claude/skills/" 2>/dev/null)" ]; then
  mkdir -p "$PROJECT_DIR/.claude/skills"
  for d in "$FRAMEWORK_DIR/skills/"*/; do
    [ -f "$d/SKILL.md" ] || continue
    dname=$(basename "$d")
    cp "$d/SKILL.md" "$PROJECT_DIR/.claude/skills/$dname.md"
    skill_count=$((skill_count + 1))
  done
  echo "✓ $skill_count skills installed"
else
  skill_count=$(ls "$PROJECT_DIR/.claude/skills/"*.md 2>/dev/null | wc -l | tr -d ' ')
  echo "✓ skills/ already exists — skipped"
fi
```

**scripts/**
```bash
if [ ! -d "$PROJECT_DIR/.claude/scripts" ] || [ -z "$(ls -A "$PROJECT_DIR/.claude/scripts/" 2>/dev/null)" ]; then
  mkdir -p "$PROJECT_DIR/.claude/scripts"
  cp "$FRAMEWORK_DIR/.claude/scripts/"* "$PROJECT_DIR/.claude/scripts/" 2>/dev/null || true
  chmod +x "$PROJECT_DIR/.claude/scripts/"*.sh 2>/dev/null || true
  echo "✓ scripts installed"
else
  echo "✓ scripts/ already exists — skipped"
fi
```

**hooks/**
```bash
if [ ! -d "$PROJECT_DIR/.claude/hooks" ] || [ -z "$(ls -A "$PROJECT_DIR/.claude/hooks/" 2>/dev/null)" ]; then
  mkdir -p "$PROJECT_DIR/.claude/hooks"
  cp "$FRAMEWORK_DIR/.claude/hooks/"*.sh "$PROJECT_DIR/.claude/hooks/" 2>/dev/null || true
  chmod +x "$PROJECT_DIR/.claude/hooks/"*.sh 2>/dev/null || true
  echo "✓ hooks installed"
else
  echo "✓ hooks/ already exists — skipped"
fi
```

**rules/**
```bash
if [ ! -d "$PROJECT_DIR/.claude/rules" ] || [ -z "$(ls -A "$PROJECT_DIR/.claude/rules/" 2>/dev/null)" ]; then
  mkdir -p "$PROJECT_DIR/.claude/rules"
  cp "$FRAMEWORK_DIR/.claude/rules/"*.md "$PROJECT_DIR/.claude/rules/" 2>/dev/null || true
  echo "✓ rules installed"
else
  echo "✓ rules/ already exists — skipped"
fi
```

**settings.json** (nur wenn nicht vorhanden):
```bash
if [ ! -f "$PROJECT_DIR/.claude/settings.json" ]; then
  cp "$FRAMEWORK_DIR/settings.json" "$PROJECT_DIR/.claude/settings.json" 2>/dev/null || true
  echo "✓ settings.json installed"
else
  echo "✓ settings.json already exists — skipped"
fi
```

Merke dir die installierten Zählwerte (`$agent_count`, `$skill_count`, `$cmd_count`) für die Zusammenfassung.

### 4. Zusammenfassung

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
 │  ✓ CLAUDE.md generiert
 │  ✓ Framework installiert ({agent_count} agents, {skill_count} skills, {cmd_count} commands)
 │
 ├─ Bereit
 │
 │  Just Ship gibt dir 10 Agents, 37 Skills und
 │  18 Commands — alles was du brauchst um von
 │  Ticket zu PR autonom zu arbeiten.
 │
 ├─ Naechster Schritt
 │
 │  Das Board ist dein Projekt-Dashboard —
 │  Tickets, Pipeline-Status und KPIs auf einen Blick.
 │
 │  Board verbinden  →  /connect-board
 │  Erstes Ticket    →  /ticket
 │  Loslegen         →  /develop
 │
 └─────────────────────────────────────────────
```

Falls weder Stack noch Framework erkannt:
```
 ┌─ {name}
 │
 │  ✓ project.json erstellt
 │  ✓ CLAUDE.md generiert
 │  ✓ Framework installiert ({agent_count} agents, {skill_count} skills, {cmd_count} commands)
 │
 │  Stack noch nicht erkannt — kein Problem.
 │  Installiere deine Dependencies und
 │  lauf /init nochmal — der Stack wird
 │  automatisch erkannt.
 │
 ├─ Bereit
 │
 │  Just Ship gibt dir 10 Agents, 37 Skills und
 │  18 Commands — alles was du brauchst um von
 │  Ticket zu PR autonom zu arbeiten.
 │
 ├─ Naechster Schritt
 │
 │  Das Board ist dein Projekt-Dashboard —
 │  Tickets, Pipeline-Status und KPIs auf einen Blick.
 │
 │  Board verbinden  →  /connect-board
 │  Erstes Ticket    →  /ticket
 │  Loslegen         →  /develop
 │
 └─────────────────────────────────────────────
```

**Regeln fuer die Zusammenfassung:**
- Nur Felder anzeigen die einen Wert haben (leere Felder weglassen)
- Die Zahlen (10 Agents, 37 Skills, 18 Commands) sind die aktuellen Werte — bei Aenderungen anpassen
- Box-Drawing-Characters fuer konsistenten Look mit Session-Summary
- Keine ANSI-Escape-Codes — Claude Code rendert das als Markdown

## Wichtig

- **Nicht-interaktiv:** Keine Fragen, keine Men\u00fcs, keine Optionen. Dateisystem analysieren und Ergebnis schreiben.
- **Idempotent:** Erneutes Ausf\u00fchren \u00fcberschreibt nichts. Existierende Dateien werden \u00fcbersprungen.
- **Board-Verbindung ist NICHT Teil dieses Commands.** Daf\u00fcr `/connect-board` verwenden.
- **VPS-Setup ist NICHT Teil dieses Commands.** Daf\u00fcr `/just-ship-vps` verwenden.
- **Framework-Dateien (agents, skills, scripts) werden automatisch installiert** wenn `CLAUDE_PLUGIN_ROOT` gesetzt ist (Plugin-Modus). Falls nicht gesetzt, `setup.sh` verwenden.
