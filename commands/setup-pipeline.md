---
name: setup-pipeline
description: Projekt konfigurieren — Stack erkennen, project.json befüllen, Dev Board verbinden
disable-model-invocation: true
---

# /setup-pipeline — Projekt konfigurieren

Erkennt automatisch den Tech-Stack, befüllt `project.json`, ergänzt `CLAUDE.md` und verbindet optional mit dem Agentic Dev Board. Alles in einem Schritt.

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

Frage: **"Projekt mit dem Agentic Dev Board verbinden? (J/n)"**

Falls nein: Überspringe diesen Schritt.

Falls ja:

#### 4a. Supabase MCP prüfen

Supabase MCP muss verbunden sein. Falls nicht erreichbar: Erkläre wie man es aktiviert (Claude Code Settings → Integrations → Supabase → Connect), dann diesen Schritt überspringen.

#### 4b. Supabase-Projekt wählen

Rufe `mcp__claude_ai_Supabase__list_projects` auf.
- Mehrere Projekte: Liste anzeigen, User wählen lassen
- Nur eines: Automatisch nehmen

#### 4c. Workspace auswählen oder anlegen

```sql
SELECT id, name, slug FROM public.workspaces ORDER BY created_at ASC;
```

**Falls Workspaces vorhanden:** Liste anzeigen + Option "Neuen Workspace anlegen"
**Falls User einen bestehenden wählt:** Diese `workspace_id` verwenden.
**Falls User neuen Workspace anlegt:**
```sql
INSERT INTO public.workspaces (name, slug)
VALUES ('{name}', '{slug}')
RETURNING id, name, slug;
```
Slug = name in lowercase, Leerzeichen → Bindestriche, nur a-z 0-9 -.

#### 4d. Projekt auswählen oder anlegen

```sql
SELECT id, name FROM public.projects
WHERE workspace_id = '{workspace_id}'
ORDER BY name;
```

**Falls Projekte vorhanden:** Liste anzeigen + Option "Neues Projekt anlegen"
**Falls User ein bestehendes wählt:** Diese `project_id` und `project_name` verwenden.
**Falls User neues Projekt anlegt:**
```sql
INSERT INTO public.projects (workspace_id, name)
VALUES ('{workspace_id}', '{name}')
RETURNING id, name;
```

#### 4e. API Key anlegen (optional)

Frage: **"API Key für Agent-Event-Hooks generieren? (empfohlen) (J/n)"**

Falls ja:
```sql
INSERT INTO public.api_keys (workspace_id, name, key_hash, key_prefix, created_by)
VALUES (
  '{workspace_id}',
  '{project_name} Pipeline',
  encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
  'adb_',
  (SELECT id FROM auth.users LIMIT 1)
)
RETURNING id, key_prefix;
```

Hinweis: Der vollständige API Key kann nur im Board-UI unter Settings → API Keys eingesehen werden.

#### 4f. Pipeline-Config in project.json schreiben

```json
"pipeline": {
  "project_id": "{supabase_project_id}",
  "project_name": "{projekt_name}",
  "workspace_id": "{workspace_id}"
}
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
  Supabase      : {project_id}
```

```
Geänderte Dateien:
  ✓ project.json  — Stack, Build, Paths
  ✓ CLAUDE.md     — Beschreibung, Konventionen, Architektur
```

Falls Dev Board nicht verbunden:
```
Tipp: /setup-pipeline erneut ausführen um das Dev Board später zu verbinden.
```
