---
name: setup-pipeline
description: Projekt konfigurieren — Stack erkennen, project.json befüllen, Dev Board verbinden
disable-model-invocation: true
---

# /setup-pipeline — Projekt konfigurieren

Erkennt automatisch den Tech-Stack, befüllt `project.json`, ergänzt `CLAUDE.md` und verbindet optional mit dem Just Ship Board. Alles in einem Schritt.

## Voraussetzungen

- `project.json` muss existieren (wird von `setup.sh` erstellt)
- `CLAUDE.md` muss existieren (wird von `setup.sh` erstellt)

Falls eine der Dateien fehlt: Hinweis geben, dass zuerst `setup.sh` ausgeführt werden muss.

## Ausführung

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

### 4. Dev Board verbinden (optional)

Parse die Argumente des Commands auf `--board`, `--key` und `--project` Flags.

#### Modus 1: Direct Connect (Flags vorhanden)

Falls `--board` und `--key` übergeben wurden:

1. **Projekte abrufen** via Bash curl:
   ```bash
   curl -s -H "X-Pipeline-Key: {--key}" "{--board}/api/projects"
   ```
   - Bei 401: "Ungültiger API Key. Prüfe den Key im Board unter Settings."
   - Bei Netzwerkfehler: "Board nicht erreichbar unter {--board}. URL prüfen."

2. **Projekt zuordnen:**
   - Falls `--project` übergeben: Finde das Projekt mit passender `id` in der API-Antwort (`data.projects[]`). Falls nicht gefunden: Fehler melden.
   - Falls `--project` NICHT übergeben: Zeige die verfügbaren Projekte und frage den User:
     ```
     Verfügbare Projekte:
       1. {name1}
       2. {name2}
       3. + Neues Projekt erstellen
     ```
   - Falls User ein neues Projekt erstellen will:
     ```bash
     curl -s -X POST -H "X-Pipeline-Key: {--key}" \
       -H "Content-Type: application/json" \
       -d '{"name": "{name}"}' \
       "{--board}/api/projects"
     ```

3. **Workspace-Infos aus API-Antwort:** `workspace_id` und `workspace_name` kommen direkt aus der `GET /api/projects` Response (`data.workspace_id`, `data.workspace_name`).

#### Modus 2: Interaktiv (keine Flags)

1. Frage: **"Projekt mit dem Just Ship Board verbinden? (J/n)"**
2. Falls nein: Überspringe diesen Schritt.
3. Falls ja: Frage nach Board URL und API Key im Gespräch:
   - Board URL (z.B. `https://board.just-ship.io`)
   - API Key (z.B. `adp_...`)
4. Dann weiter wie Modus 1 (curl Aufrufe mit den eingegebenen Werten).

#### Pipeline-Config in project.json schreiben

Schreibe ALLE 5 Felder in die `pipeline` Section von `project.json`:

```json
"pipeline": {
  "project_id": "{Board Projekt-UUID aus API Response projects[].id}",
  "project_name": "{Projektname aus API Response projects[].name}",
  "workspace_id": "{workspace_id aus API Response}",
  "api_url": "{Board URL}",
  "api_key": "{API Key}"
}
```

#### Sicherheitscheck

Prüfe ob `project.json` von git getrackt wird:
```bash
git ls-files project.json
```

Falls die Datei getrackt wird, warne:
```
project.json wird von git getrackt und enthält jetzt einen API Key.
Empfehlung: project.json zu .gitignore hinzufuegen.
```

### 5. Bestätigung

Zeige eine Zusammenfassung:

```
Setup abgeschlossen.

  Stack         : {framework} + {language} + {styling}
  Build         : {build_command}
  Test          : {test_command}
  Package Mgr   : {package_manager}
```

Falls Dev Board verbunden:
```
  Board-Projekt : {project_name}
  Workspace     : {workspace_name}
  Board URL     : {api_url}
```

```
Geänderte Dateien:
  ✓ project.json  — Stack, Build, Paths, Pipeline
  ✓ CLAUDE.md     — Beschreibung, Konventionen, Architektur
```

Falls Dev Board nicht verbunden:
```
Tipp: /setup-pipeline erneut ausführen um das Dev Board später zu verbinden.
```
