---
name: setup-just-ship
description: Just Ship installieren und Projekt konfigurieren — Stack erkennen, project.json befüllen, Board verbinden
disable-model-invocation: true
---

# /setup-just-ship — Projekt einrichten

Installiert Just Ship im aktuellen Projekt (falls noch nicht geschehen), erkennt den Tech-Stack automatisch, befüllt `project.json` und `CLAUDE.md`, und verbindet optional das Just Ship Board.

## Argumente (optional — vom Board vorausgefüllt)

| Flag | Beschreibung |
|---|---|
| `--board` | Board URL (z.B. `https://board.just-ship.io`) |
| `--workspace` | Workspace Slug |
| `--workspace-id` | Workspace UUID (für Erstverbindung — kein Secret) |
| `--project` | Projekt UUID |

Falls diese Flags übergeben wurden: Schritte 1–4 normal ausführen, dann **Schritt 5 überspringen** und stattdessen direkt verbinden:

**a) Workspace bereits verbunden?** Prüfe ob der Workspace-Slug in `~/.just-ship/config.json` existiert:

```bash
"$HOME/.just-ship/scripts/write-config.sh" read-workspace --slug <workspace> 2>/dev/null && echo "EXISTS" || echo "NOT_FOUND"
```

- **EXISTS** → direkt `set-project` aufrufen:
  ```bash
  ".claude/scripts/write-config.sh" set-project \
    --workspace <workspace> --project-id <project>
  ```

- **NOT_FOUND** → Workspace muss zuerst verbunden werden:
  - Falls `--workspace-id` bekannt (aus den Flags): nur noch `--key` abfragen (eine Nachricht)
  - Falls `--workspace-id` fehlt: beide Werte (`--workspace-id` und `--key`) in einer Nachricht abfragen
  - Dann `add-workspace` aufrufen, danach `set-project`

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

**0c) Bestehendes Setup erkennen**

Falls `.claude/agents/` bereits existiert UND `project.json` bereits existiert mit gesetzten Stack-Feldern (mindestens `stack.framework` oder `stack.language` sind non-empty):

Prüfe den Status:
- `project.json` → `pipeline.workspace` gesetzt? → Board verbunden
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
  Stack: {framework}, Board: {workspace}

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

Falls CONNECTED: Bestätige mit `✓ Board verbunden (Workspace: {workspace})`
Falls NOT_CONNECTED: Frage ob etwas nicht geklappt hat.

Falls Board-Flags übergeben wurden (`--board`, `--workspace`, `--project`):
- Verhalten bleibt wie bisher (direkt `add-workspace` + `set-project`)
- Das ist der Flow wenn der User vom Board-ProjectSetupDialog kommt
