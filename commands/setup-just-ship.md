---
name: setup-just-ship
description: Just Ship installieren und Projekt konfigurieren — Stack erkennen, project.json befüllen, Board verbinden
disable-model-invocation: true
---

# /setup-just-ship — Projekt einrichten

Installiert Just Ship im aktuellen Projekt (falls noch nicht geschehen), erkennt den Tech-Stack automatisch, befüllt `project.json` und `CLAUDE.md`, und verbindet optional das Just Ship Board.

## Ausführung

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

**Framework-Erkennung (aus Dependencies):**
- `next` → Next.js (prüfe `next.config.*` für App Router vs Pages Router)
- `nuxt` → Nuxt
- `@angular/core` → Angular
- `svelte` / `@sveltejs/kit` → Svelte/SvelteKit
- `react` (ohne next) → React (Vite/CRA)
- `vue` (ohne nuxt) → Vue
- `express` / `fastify` / `hono` → Node Backend
- `django` / `flask` / `fastapi` → Python Backend

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

Falls `pipeline.workspace` in `project.json` noch nicht gesetzt ist, frage:

```
Möchtest du das Just Ship Board verbinden? (j/n)
```

**Falls nein:** Abschließen mit:
```
Fertig! Erstelle dein erstes Ticket mit /ticket.
```

**Falls ja:** Frage weiter:
```
Hast du bereits einen Account auf board.just-ship.io? (j/n)
```

- **Falls nein:**
  ```
  Erstelle zuerst einen Account:

    → board.just-ship.io

  Lege dort einen Workspace und ein Projekt an.
  Beim Projekt findest du einen Connect-Command — komm dann zurück
  und führe /connect-board aus.
  ```

- **Falls ja:** Führe `/connect-board` inline aus (Modus 2: interaktiv — stelle alle fehlenden Werte in einer einzigen Nachricht ab, nie einzeln nacheinander).
