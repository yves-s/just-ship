# Onboarding Flow Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all onboarding gaps between Board and CLI so every user path (CLI-first, Board-first, later-connect, team-member) is fully guided.

**Architecture:** Two-sided fix. CLI side: rewrite `/connect-board` as 2-way flow with `jsp_` smart detection, update `/setup-just-ship` for existing-config detection, extend `write-config.sh` with `jsp_` parsing. Board side: add onboarding stepper, settings connect page, and project getting-started badge. A `jsp_` Base64 connection string (format version 1) bridges both sides.

**Tech Stack:** Bash (write-config.sh), Markdown (Claude Code commands), Next.js/React (Board UI — separate repo `just-ship-board`)

**Spec:** `docs/superpowers/specs/2026-03-20-onboarding-flow-fix-design.md`

---

## CLI-Side Changes (just-ship repo)

### Task 1: Add `parse-jsp` command to write-config.sh

Adds a new subcommand that decodes a `jsp_` string and outputs the extracted values as JSON. This is the foundation for smart detection in `/connect-board`.

**Files:**
- Modify: `scripts/write-config.sh`

- [ ] **Step 1: Add `parse-jsp` command to write-config.sh**

Add to the usage text, then add the command implementation after `cmd_migrate`. The command:
1. Strips `jsp_` prefix
2. Base64 decodes
3. Parses JSON
4. Validates all required fields (`v`, `b`, `w`, `i`, `k`)
5. Validates `k` starts with `adp_` and `i` is a UUID
6. Outputs clean JSON to stdout

```bash
# ---------------------------------------------------------------------------
# Command: parse-jsp
# ---------------------------------------------------------------------------

cmd_parse_jsp() {
  local token=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --token) token="$2"; shift 2 ;;
      *) echo "Error: Unknown option '$1' for parse-jsp"; exit 1 ;;
    esac
  done

  if [ -z "$token" ]; then
    echo "Error: parse-jsp requires --token"
    exit 1
  fi

  JS_TOKEN="$token" \
  node -e "
    const token = process.env.JS_TOKEN;

    // Strip jsp_ prefix
    if (!token.startsWith('jsp_')) {
      console.error('Error: Token must start with jsp_');
      process.exit(1);
    }
    const b64 = token.slice(4);

    // Decode Base64
    let json;
    try {
      json = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
    } catch (e) {
      console.error('Error: Could not decode token — invalid Base64 or JSON');
      process.exit(1);
    }

    // Validate version
    if (!json.v || typeof json.v !== 'number') {
      console.error('Error: Missing or invalid version field (v)');
      process.exit(1);
    }

    // Validate required fields
    const required = { b: 'Board URL', w: 'Workspace Slug', i: 'Workspace ID', k: 'API Key' };
    for (const [key, label] of Object.entries(required)) {
      if (!json[key] || typeof json[key] !== 'string') {
        console.error('Error: Missing or invalid field: ' + label + ' (' + key + ')');
        process.exit(1);
      }
    }

    // Validate API key prefix
    if (!json.k.startsWith('adp_')) {
      console.error('Error: API Key must start with adp_');
      process.exit(1);
    }

    // Validate UUID format for workspace ID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(json.i)) {
      console.error('Error: Workspace ID is not a valid UUID');
      process.exit(1);
    }

    // Output clean JSON
    console.log(JSON.stringify({
      board_url: json.b,
      workspace: json.w,
      workspace_id: json.i,
      api_key: json.k,
      version: json.v
    }, null, 2));
  "
}
```

Update the main dispatch at the bottom:

```bash
case "$COMMAND" in
  add-workspace)  cmd_add_workspace "$@" ;;
  set-project)    cmd_set_project "$@" ;;
  read-workspace) cmd_read_workspace "$@" ;;
  remove-board)   cmd_remove_board "$@" ;;
  migrate)        cmd_migrate "$@" ;;
  parse-jsp)      cmd_parse_jsp "$@" ;;
  --help|-h)      usage ;;
```

Also add to usage:

```
  parse-jsp       Decode and validate a jsp_ connection string
    --token         The jsp_ token string (required)
```

- [ ] **Step 2: Test parse-jsp with valid token**

Generate a test token and verify parsing:

```bash
# Generate a test jsp_ token
TEST_TOKEN="jsp_$(echo '{"v":1,"b":"https://board.just-ship.io","w":"test-ws","i":"12345678-1234-1234-1234-123456789012","k":"adp_testkey123"}' | base64)"

# Parse it
./scripts/write-config.sh parse-jsp --token "$TEST_TOKEN"
```

Expected output:
```json
{
  "board_url": "https://board.just-ship.io",
  "workspace": "test-ws",
  "workspace_id": "12345678-1234-1234-1234-123456789012",
  "api_key": "adp_testkey123",
  "version": 1
}
```

- [ ] **Step 3: Test parse-jsp error cases**

```bash
# Missing prefix
./scripts/write-config.sh parse-jsp --token "notavalidtoken"
# Expected: Error: Token must start with jsp_

# Invalid base64
./scripts/write-config.sh parse-jsp --token "jsp_notbase64!!!"
# Expected: Error: Could not decode token

# Missing field
INCOMPLETE="jsp_$(echo '{"v":1,"b":"https://board.just-ship.io","w":"test"}' | base64)"
./scripts/write-config.sh parse-jsp --token "$INCOMPLETE"
# Expected: Error: Missing or invalid field: Workspace ID (i)

# Invalid API key prefix
BADKEY="jsp_$(echo '{"v":1,"b":"https://board.just-ship.io","w":"test","i":"12345678-1234-1234-1234-123456789012","k":"wrong_key"}' | base64)"
./scripts/write-config.sh parse-jsp --token "$BADKEY"
# Expected: Error: API Key must start with adp_
```

- [ ] **Step 4: Commit**

```bash
git add scripts/write-config.sh
git commit -m "feat: add parse-jsp command to write-config.sh for connection string decoding"
```

---

### Task 2: Rewrite /connect-board command

Replaces the current connect-board.md with the new 2-way flow: "Ich habe den Key" (smart detection for `jsp_` vs `adp_`) and "Ich bin neu" (registration guide).

**Files:**
- Modify: `commands/connect-board.md`

- [ ] **Step 1: Read current connect-board.md for reference**

Read `commands/connect-board.md` to understand what to preserve (validation, write-config.sh calls, migration detection).

- [ ] **Step 2: Rewrite connect-board.md**

Replace the entire command with the new flow. Keep the same frontmatter. Preserve: flag support (Modus 1), validation via curl, migration detection. Add: 2-way entry, smart detection, field hints, "Ich bin neu" path.

```markdown
---
name: connect-board
description: Board-Verbindung hinzufügen oder ändern — Workspace + API Key in globale Config schreiben
---

# /connect-board — Board verbinden

Verbindet einen Workspace mit dem Just Ship Board. Schreibt Workspace-Daten in `~/.just-ship/config.json`.

## Argumente (optional)

| Flag | Beschreibung | Pflicht |
|---|---|---|
| `--board` | Board URL (z.B. `https://board.just-ship.io`) | Ja (bei Flag-Modus) |
| `--workspace` | Workspace Slug | Ja (bei Flag-Modus) |
| `--workspace-id` | Workspace UUID | Ja (bei Flag-Modus) |
| `--key` | API Key (`adp_...`) | Ja (bei Flag-Modus) |
| `--project` | Projekt UUID (optional — setzt direkt auch das Projekt) | Nein |

## Ausführung

### Modus 1: Alle Pflicht-Flags vorhanden

Wenn alle Pflicht-Flags übergeben wurden, direkt ausführen:

1. Schreibe Workspace-Eintrag:
   ```bash
   ".claude/scripts/write-config.sh" add-workspace \
     --slug <workspace> --board <board> --workspace-id <workspace-id> --key <key>
   ```

2. Falls `--project` übergeben:
   ```bash
   ".claude/scripts/write-config.sh" set-project \
     --workspace <workspace> --project-id <project>
   ```

3. Validierung (siehe unten) + Bestätigung.

---

### Modus 2: Interaktiv (keine oder unvollständige Flags)

#### Schritt 0: Bestehende Workspaces prüfen

Lies die globale Config:
```bash
cat "$HOME/.just-ship/config.json" 2>/dev/null || echo "{}"
```

**Falls bereits Workspaces vorhanden:**
```
Verbundene Workspaces: agentic-dev, another-workspace

Möchtest du einen bestehenden Workspace für dieses Projekt nutzen,
oder einen neuen Workspace verbinden?

  1. Bestehenden Workspace nutzen
  2. Neuen Workspace verbinden
```

Falls User bestehenden Workspace wählt → nur `--project` abfragen (falls nicht bekannt) und `set-project` aufrufen. KEINE Credentials abfragen. Fertig.

Falls kein Workspace existiert oder User neuen will → weiter mit Schritt 1.

---

#### Schritt 1: Einstiegsfrage

```
Board verbinden

  1. Ich habe den Key — API Key aus dem Board kopiert
  2. Ich bin neu — Ich brauche erst ein Board-Konto
```

---

#### Weg 1: "Ich habe den Key"

Zeige ein Eingabefeld:
```
Füge den API Key oder Verbindungs-Code aus dem Board ein:
```

**Smart Detection — prüfe was der User eingegeben hat:**

**Fall A: Eingabe startet mit `jsp_`** → Verbindungs-Code erkannt.

1. Dekodiere via write-config.sh:
   ```bash
   ".claude/scripts/write-config.sh" parse-jsp --token "<eingabe>"
   ```
2. Falls Fehler: Zeige die Fehlermeldung und biete an:
   ```
   ✗ Verbindungs-Code ungültig
   Der Code konnte nicht dekodiert werden. Kopiere ihn erneut aus dem Board.

   Erneut versuchen oder manuell eingeben?
     1. Erneut versuchen
     2. Manuell eingeben (Einzelwerte)
   ```
3. Falls OK: Extrahierte Werte nutzen, direkt `add-workspace` aufrufen.
4. Falls `add-workspace` mit Slug-Kollision fehlschlägt (gleicher Slug, andere Board URL):
   ```
   ⚠ Workspace "{slug}" ist bereits mit {andere-url} verbunden.

     1. Bestehende Verbindung aktualisieren (überschreibt die alte URL)
     2. Abbrechen
   ```
   Bei Option 1: `remove-board --slug <slug>` und dann erneut `add-workspace`.
5. Weiter zu Validierung.

**Fall B: Eingabe startet mit `adp_`** → Manueller API Key erkannt.

```
API Key erkannt. Ich brauche noch ein paar Angaben:

Board URL:
  ↳ Die URL deines Boards. Meistens board.just-ship.io
  (Enter für https://board.just-ship.io)

Workspace Slug:
  ↳ Steht in der URL: board.just-ship.io/{slug}

Workspace ID:
  ↳ Board → Workspace Settings → General → Workspace ID
```

Alle 3 Werte in **einer einzigen Nachricht** abfragen, nicht nacheinander.
Board URL hat Default `https://board.just-ship.io` (Enter = Default).
Dann `add-workspace` aufrufen. Weiter zu Validierung.

**Fall C: Eingabe ist weder `jsp_` noch `adp_`** → Unbekannt.

```
⚠ Eingabe nicht erkannt.

Erwartet wird entweder:
  • Ein Verbindungs-Code (beginnt mit jsp_) — aus Board → Workspace Settings → Connect
  • Ein API Key (beginnt mit adp_) — aus Board → Workspace Settings → API Keys

Erneut versuchen?
```

---

#### Weg 2: "Ich bin neu"

```
Willkommen bei just-ship!

So geht's:
  1. Registriere dich: https://board.just-ship.io/register
  2. Erstelle einen Workspace
  3. Du bekommst direkt den Verbindungs-Code angezeigt — kopiere ihn
  4. Führe /connect-board erneut aus und füge ihn ein

Das Board führt dich durch alle Schritte.
```

Danach Befehl beenden (kein weiterer Input nötig).

---

### Validierung

Nach dem Schreiben der Workspace-Daten: Prüfe die Verbindung:
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Pipeline-Key: <key>" "<board>/api/projects"
```
- `200`: `✓ Board-Verbindung verifiziert`
- `401`: `⚠ API Key abgelehnt — prüfe den Key unter Board → Workspace Settings`
- Andere: `⚠ Board nicht erreichbar — prüfe die URL`

### Migration erkennen

Falls `project.json` noch ein `api_key` Feld hat:
```
Bestehender api_key in project.json gefunden.
In globale Config migrieren? (J/n)
```

Falls ja:
```bash
".claude/scripts/write-config.sh" migrate \
  --project-dir . --slug <workspace-slug>
```

### Erfolgsausgabe

```
✓ Workspace "<workspace>" verbunden
✓ Credentials in ~/.just-ship/config.json gespeichert
✓ project.json aktualisiert (pipeline.workspace = "<workspace>")

Nächster Schritt: /add-project um ein Board-Projekt zu verknüpfen
```
```

- [ ] **Step 3: Verify the command file is valid**

```bash
# Check frontmatter is intact
head -5 commands/connect-board.md
# Expected: ---\nname: connect-board\ndescription: ...\n---
```

- [ ] **Step 4: Commit**

```bash
git add commands/connect-board.md
git commit -m "feat: rewrite /connect-board with 2-way flow and jsp_ smart detection"
```

---

### Task 3: Update /setup-just-ship for existing config detection

Adds detection of existing `project.json` with missing board connection. When a project is already set up (e.g. cloned repo from team member), skip full setup and offer board connection directly.

**Files:**
- Modify: `commands/setup-just-ship.md`

- [ ] **Step 1: Read current setup-just-ship.md**

Read `commands/setup-just-ship.md` to understand where to insert the new detection logic.

- [ ] **Step 2: Add existing-config detection between Step 0 and Step 1**

Insert a new section **"0c) Bestehendes Setup erkennen"** after the `0b) Im Projekt installiert?` check. This runs AFTER the framework is installed (0a + 0b) but BEFORE the stack analysis (Step 1).

Add this section after `0b`:

```markdown
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

  1. Board verbinden → startet /connect-board
  2. Nein, CLI-only nutzen
  3. Setup komplett neu ausführen → Stack-Erkennung + Config überschreiben
```

- **Option 1:** Führe `/connect-board` inline aus (Modus 2: interaktiv) und beende danach.
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
```

- [ ] **Step 3: Verify the command file is valid**

```bash
head -5 commands/setup-just-ship.md
```

- [ ] **Step 4: Commit**

```bash
git add commands/setup-just-ship.md
git commit -m "feat: add existing-config detection to /setup-just-ship for team-member flow"
```

---

### Task 4: Update project.json template to new format

Removes old `api_key`, `api_url`, `workspace_id` fields from the template and uses the new `workspace`-only format.

**Files:**
- Modify: `templates/project.json`

- [ ] **Step 1: Update the pipeline section in project.json template**

Change the `pipeline` section from:

```json
"pipeline": {
  "project_id": "",
  "project_name": null,
  "workspace_id": "",
  "api_url": "",
  "api_key": ""
}
```

To:

```json
"pipeline": {
  "workspace": "",
  "project_id": "",
  "project_name": null
}
```

- [ ] **Step 2: Update CLAUDE.md template pipeline references**

In `templates/CLAUDE.md`, find the Ticket-Workflow section that references `pipeline.api_key` and `pipeline.api_url`. Update these references to use the new format:
- Replace `pipeline.api_url` → `pipeline.workspace` (resolved from global config)
- Remove any references to `pipeline.api_key` (now in `~/.just-ship/config.json`)
- Update the SQL example to use `pipeline.workspace_id` (resolved at runtime from global config via workspace slug)

- [ ] **Step 3: Verify templates are valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('templates/project.json','utf-8')); console.log('project.json: Valid JSON')"
# Verify CLAUDE.md has no broken references
grep -n "api_key\|api_url" templates/CLAUDE.md && echo "WARNING: old references remain" || echo "CLAUDE.md: clean"
```

- [ ] **Step 4: Commit**

```bash
git add templates/project.json templates/CLAUDE.md
git commit -m "chore: update templates to new pipeline format (workspace only, no secrets)"
```

---

## Board-Side Changes (just-ship-board repo)

> These tasks are in a separate repo: `~/Developer/just-ship-board`
> Refer to spec section 2 for full design details.

### Task 5: Add jsp_ token generation utility

A shared utility function that generates `jsp_` connection strings from workspace data.

**Files:**
- Create: `src/lib/jsp-token.ts` (in just-ship-board)

- [ ] **Step 1: Write the token generation utility**

```typescript
// src/lib/jsp-token.ts

interface JspPayload {
  boardUrl: string;
  workspace: string;
  workspaceId: string;
  apiKey: string;
}

export function generateJspToken(payload: JspPayload): string {
  const json = JSON.stringify({
    v: 1,
    b: payload.boardUrl,
    w: payload.workspace,
    i: payload.workspaceId,
    k: payload.apiKey,
  });
  const b64 = Buffer.from(json).toString("base64");
  return `jsp_${b64}`;
}

export function parseJspToken(token: string): JspPayload | null {
  if (!token.startsWith("jsp_")) return null;
  try {
    const json = JSON.parse(Buffer.from(token.slice(4), "base64").toString("utf-8"));
    if (!json.v || !json.b || !json.w || !json.i || !json.k) return null;
    return {
      boardUrl: json.b,
      workspace: json.w,
      workspaceId: json.i,
      apiKey: json.k,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/jsp-token.ts
git commit -m "feat: add jsp_ token generation and parsing utility"
```

---

### Task 6: Build Workspace Settings → Connect page

The permanent reference page where users can always find their connection string and individual values.

**Files (in just-ship-board):**
- Create: `src/app/[slug]/settings/connect/page.tsx` — Route page (server component)
- Create: `src/components/settings/connect-settings-view.tsx` — Client component with UI
- Modify: `src/components/settings/settings-nav.tsx` — Add "Connect" to TABS array

- [ ] **Step 1: Add "Connect" to settings nav TABS array**

In `src/components/settings/settings-nav.tsx`, add to the TABS array:

```typescript
{ label: "Connect", href: (slug: string) => `/${slug}/settings/connect` },
```

Insert it after "API Keys" (since Connect depends on having an API key).

- [ ] **Step 2: Create the route page**

Create `src/app/[slug]/settings/connect/page.tsx`. Follow the pattern of other settings pages (e.g. `api-keys/page.tsx`):
- Server component that fetches workspace data
- Fetches the active (non-revoked) API key via Supabase server client:
  ```typescript
  const { data: keys } = await supabase
    .from("api_keys")
    .select("*")
    .eq("workspace_id", workspace.id)
    .is("revoked_at", null)
    .limit(1);
  ```
- Passes workspace + API key to the client component

- [ ] **Step 3: Create the Connect settings view component**

Create `src/components/settings/connect-settings-view.tsx` as a client component. It needs:

1. **Connection String section** (prominent, top):
   - Generate `jsp_` token using `generateJspToken()` from `src/lib/jsp-token.ts`
   - The API key plaintext is needed — if only the hash/prefix is available from DB, show a "Generate new key" flow (similar to `api-keys/page.tsx`)
   - Copy button using navigator.clipboard
   - Warning text: "Dieser Code enthält deinen API Key. Nicht teilen."

2. **Individual Values section** (below, as fallback):
   - Board URL (from `window.location.origin` or env var)
   - Workspace Slug (from workspace context)
   - Workspace ID (from workspace context)
   - API Key (show/hide toggle, initially hidden)

3. **Instructions section** (bottom):
   ```
   1. Öffne Claude Code in deinem Projekt
   2. Führe /connect-board aus
   3. Füge den Verbindungs-Code ein
   4. Fertig — dein Projekt ist verbunden!
   ```

Use existing UI components: `Card`, `Button`, `Input` from `src/components/ui/`.

- [ ] **Step 4: Handle API key plaintext challenge**

The `api_keys` table only stores `key_hash` and `key_prefix`, not the plaintext. The plaintext is only returned at creation time. Options:
- Show the `jsp_` token only immediately after key generation (prompt user to generate if no key exists)
- Or: generate a fresh key specifically for the connect string

Follow the pattern in `src/components/board/project-setup-dialog.tsx` which already handles this:
```typescript
// It fetches/creates API key and stores plaintext in component state
const [apiKey, setApiKey] = useState<ApiKey | null>(null);
```

- [ ] **Step 5: Verify it renders**

Run dev server, navigate to `/{slug}/settings/connect`. Verify:
- Connection string displays with copy button
- Individual values show correctly
- API key show/hide works
- Tab is active in settings nav

- [ ] **Step 6: Commit**

```bash
git add src/app/[slug]/settings/connect/ src/components/settings/connect-settings-view.tsx src/components/settings/settings-nav.tsx
git commit -m "feat: add Workspace Settings → Connect page with jsp_ connection string"
```

---

### Task 7: Build Post-Registration Onboarding Stepper

Persistent progress tracker shown after workspace creation until all onboarding steps are completed (mindestens ein Projekt connected + ein Ticket erstellt).

**Files (in just-ship-board):**
- Create: `src/components/shared/onboarding-stepper.tsx` — Stepper component
- Modify: `src/app/[slug]/layout.tsx` — Render stepper in workspace layout
- Possibly modify: `src/app/[slug]/board/page.tsx` — Replace or integrate with existing empty-state welcome message

- [ ] **Step 1: Define stepper completion state**

The stepper tracks 4 steps using derived state (no new DB fields):
1. **Registered** ✓ — always complete (user is logged in)
2. **Workspace erstellt** ✓ — always complete (on workspace page)
3. **Projekt verbinden** — complete when: at least one `task_event` exists for any project in this workspace. Query:
   ```sql
   SELECT EXISTS(
     SELECT 1 FROM task_events te
     JOIN tickets t ON te.ticket_id = t.id
     WHERE t.workspace_id = '{workspace_id}'
   ) as has_pipeline_events
   ```
4. **Erstes Ticket** — complete when: at least one ticket exists. Query:
   ```sql
   SELECT EXISTS(
     SELECT 1 FROM tickets WHERE workspace_id = '{workspace_id}'
   ) as has_tickets
   ```

Fetch these in the workspace layout (server component) or via a dedicated hook.

- [ ] **Step 2: Create the stepper component**

Create `src/components/shared/onboarding-stepper.tsx` as a client component.

Props:
```typescript
interface OnboardingStepperProps {
  workspace: Workspace;
  hasPipelineEvents: boolean;
  hasTickets: boolean;
  apiKeyPlaintext?: string; // For jsp_ token generation (optional)
}
```

4-step horizontal progress bar:
- Steps 1-2: always green/checked
- Step 3 "Projekt verbinden":
  - If open: shows curl install command (`curl -fsSL https://just-ship.io/install | bash`) + `jsp_` token with copy button (if API key plaintext available) + `/connect-board` instruction
  - If complete: green check
- Step 4 "Erstes Ticket":
  - If open: shows "Erstelle dein erstes Ticket mit `/ticket` in Claude Code"
  - If complete: green check

**Completion behavior:** When all 4 steps complete (`hasPipelineEvents && hasTickets`), the stepper hides entirely.

Use Tailwind for styling. Follow existing UI patterns (Card, rounded corners, muted backgrounds).

- [ ] **Step 3: Integrate stepper into workspace layout**

In `src/app/[slug]/layout.tsx`:
- Fetch `hasPipelineEvents` and `hasTickets` (server-side queries)
- Render `<OnboardingStepper>` above the main content area, inside the layout but before `{children}`
- Only render when `!hasPipelineEvents || !hasTickets` (skip entirely for completed workspaces)

Note: The existing empty-state welcome in `src/app/[slug]/board/page.tsx` ("Welcome to your workspace! Create a project...") should be kept as-is — it handles the zero-projects state. The stepper is complementary and shows above the board.

- [ ] **Step 4: Verify stepper renders and tracks state**

Test scenarios:
- New workspace (no projects, no tickets) → steps 3+4 open, stepper visible
- Workspace with connected project (has task_events) → step 3 checked, step 4 open
- Workspace with project + ticket → stepper completely hidden
- Page navigation within workspace → stepper persists (it's in the layout)

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/onboarding-stepper.tsx src/app/[slug]/layout.tsx
git commit -m "feat: add post-registration onboarding stepper to workspace layout"
```

---

### Task 8: Add "Not Connected" badge to project view

Shows a badge and connection instructions when a project hasn't received pipeline events.

**Files (in just-ship-board):**
- Modify: `src/components/board/project-setup-dialog.tsx` — Enhance existing setup dialog with `jsp_` token
- Modify: `src/components/settings/settings-overview.tsx` — Add connection status badge to project cards
- Modify: `src/components/settings/projects-settings-view.tsx` — Add badge in projects settings list (if exists)

- [ ] **Step 1: Add connection status to project data**

Determine per-project connection status. A project is "connected" if it has received at least one `task_event`. The query joins through tickets:

```sql
SELECT p.id, p.name,
  EXISTS(
    SELECT 1 FROM task_events te
    JOIN tickets t ON te.ticket_id = t.id
    WHERE t.project_id = p.id
  ) as is_connected
FROM projects p
WHERE p.workspace_id = '{workspace_id}'
```

Add this to wherever projects are fetched (e.g. the settings overview or board component).

- [ ] **Step 2: Enhance project-setup-dialog with jsp_ token**

The existing `src/components/board/project-setup-dialog.tsx` already shows setup instructions and handles API key creation. Enhance it:
- Replace or supplement the existing setup instructions with the `jsp_` connection string (using `generateJspToken` from `src/lib/jsp-token.ts`)
- The dialog already has `apiKey` in state — use it to generate the `jsp_` token
- Keep the existing step-by-step instructions but frame around the connection code

- [ ] **Step 3: Add "Not Connected" badge to project cards**

In `src/components/settings/settings-overview.tsx`, the projects are displayed as cards with icon + name + ticket count. Add:
- Amber badge next to project name when `!is_connected`:
  ```tsx
  <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 border-amber-200">
    Not Connected
  </span>
  ```
- When clicked, open the project-setup-dialog for that project

When connected: no badge shown.

- [ ] **Step 4: Verify badge and dialog work**

Test:
- New project (no task_events) → amber "Not Connected" badge visible
- Click badge → setup dialog opens with `jsp_` token
- Project with task_events → no badge

- [ ] **Step 5: Commit**

```bash
git add src/components/board/project-setup-dialog.tsx src/components/settings/settings-overview.tsx src/lib/jsp-token.ts
git commit -m "feat: add 'Not Connected' badge and jsp_ token to project setup"
```

---

## Final

### Task 9: Sync framework files to installed projects

After CLI changes (Tasks 1-4), the updated command files need to be available in projects that already have just-ship installed.

**Files:**
- Modify: `setup.sh` (if sync logic needs updating for new files)

- [ ] **Step 1: Verify setup.sh syncs command files correctly**

```bash
# Check that setup.sh copies commands/ to .claude/commands/
grep -n "commands" setup.sh | head -10
```

Ensure `connect-board.md` and `setup-just-ship.md` are in the sync list.

- [ ] **Step 2: Test a dry-run update**

```bash
# In a test project that has just-ship installed:
just-ship setup --auto
# Verify updated connect-board.md is copied
diff commands/connect-board.md /path/to/test-project/.claude/commands/connect-board.md
```

- [ ] **Step 3: Commit any setup.sh changes (if needed)**

```bash
git add setup.sh
git commit -m "chore: ensure updated command files sync on framework update"
```
