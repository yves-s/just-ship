# Shopify Agency Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend just-ship with Triage Enrichment (Board comments), zero-friction Shopify dev environment, and Shopify-specific QA — based on agency feedback.

**Architecture:** Extend existing Triage, QA, and Preview systems. New scripts for env-check, hybrid dev/push, static QA analysis. Board Comment API as shared prerequisite. All changes follow existing patterns (graceful exit 0, credential resolution via write-config.sh).

**Tech Stack:** Bash (scripts), TypeScript (pipeline SDK), Markdown (agent prompts, skills), Supabase (Board DB), Next.js API Routes (Board)

**Spec:** `docs/superpowers/specs/2026-04-01-shopify-agency-workflow-design.md`

---

## File Structure

### New Files (Engine Repo)

| File | Responsibility |
|---|---|
| `.claude/scripts/post-comment.sh` | Board Comment API helper — non-blocking, always exit 0 |
| `agents/triage-enrichment.md` | Phase 2 enrichment prompt (Sonnet, Grep/Glob/Read) |
| `.claude/scripts/shopify-env-check.sh` | Shopify CLI/Node/Git/Auth validation with caching |
| `.claude/scripts/shopify-dev.sh` | Hybrid theme dev (local) / theme push (VPS) |
| `.claude/scripts/shopify-qa.sh` | Static Liquid/Theme consistency analysis |
| `skills/shopify-app-scaffold.md` | App cleanup rules after `shopify app create` |

### Modified Files (Engine Repo)

| File | Change |
|---|---|
| `agents/triage.md` | Add `scaffold_type` to JSON output schema |
| `agents/qa.md` | Add Shopify-specific review instructions |
| `pipeline/run.ts` | Enrichment step after triage, QaContext enrichment data, env-check |
| `pipeline/lib/qa-runner.ts` | Add `shopify-qa.sh` step, extend QaContext interface |
| `pipeline/lib/qa-fix-loop.ts` | Register shopify-qa errors as fixable check type |
| `pipeline/lib/config.ts` | Extend QaConfig with Shopify fields |
| `commands/develop.md` | Replace shopify-preview.sh with shopify-dev.sh, add env-check |
| `.claude/scripts/shopify-preview.sh` | Thin wrapper delegating to shopify-dev.sh |

### New Files (Board Repo — `just-ship-board`)

| File | Responsibility |
|---|---|
| DB Migration: `ticket_comments` | Comments table with dedup index |
| `src/app/api/tickets/[id]/comments/route.ts` | POST endpoint (upsert by type) |
| `src/components/board/ticket-comments.tsx` | Comment list UI under ticket detail |

---

## Task 0: Board Comment API (Prerequisite)

> This task is in the **Board repo** (`just-ship-board`). All other tasks are in the Engine repo.

**Files:**
- Create: `supabase/migrations/YYYYMMDD_add_ticket_comments.sql`
- Create: `src/app/api/tickets/[id]/comments/route.ts`
- Create: `src/components/board/ticket-comments.tsx`
- Modify: `src/components/board/ticket-detail.tsx` (add comments section)

- [ ] **Step 1: Write DB migration**

```sql
CREATE TABLE ticket_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'pipeline',
  type TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ticket_comments_ticket_id ON ticket_comments(ticket_id);
CREATE UNIQUE INDEX idx_ticket_comments_dedup ON ticket_comments(ticket_id, type) WHERE type IS NOT NULL;
```

- [ ] **Step 2: Apply migration**

Run: `npx supabase db push` or apply via Supabase MCP `apply_migration`
Expected: Table created successfully

- [ ] **Step 3: Create API route**

Create `src/app/api/tickets/[id]/comments/route.ts`:
- POST handler: validate `X-Pipeline-Key`, parse body `{ body, author, type? }`
- If `type` provided: upsert (`INSERT ... ON CONFLICT (ticket_id, type) DO UPDATE`)
- If no `type`: plain insert
- Return `{ id, created_at }`
- GET handler: return all comments for ticket, ordered by `created_at ASC`

- [ ] **Step 4: Create comment list UI component**

Create `src/components/board/ticket-comments.tsx`:
- Fetch comments via GET endpoint
- Render markdown body per comment
- Show author badge ("pipeline") and timestamp
- Type badge if present (Triage/Preview/QA)

- [ ] **Step 5: Integrate into ticket detail**

Modify `src/components/board/ticket-detail.tsx`:
- Add `<TicketComments ticketId={ticket.id} />` below ticket body

- [ ] **Step 6: Test manually**

```bash
curl -X POST http://localhost:3000/api/tickets/{ID}/comments \
  -H "Content-Type: application/json" \
  -H "X-Pipeline-Key: {key}" \
  -d '{"body": "Test comment", "author": "pipeline", "type": "triage"}'
```
Expected: 201 with `{ id, created_at }`

- [ ] **Step 7: Test upsert dedup**

Run same curl again with different body.
Expected: Same comment ID, updated body.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add ticket comments API with dedup support"
```

---

## Task 1: post-comment.sh Helper Script

**Files:**
- Create: `.claude/scripts/post-comment.sh`
- Reference: `.claude/scripts/send-event.sh` (line 15-39, credential resolution pattern)

- [ ] **Step 1: Create the script**

Create `.claude/scripts/post-comment.sh`:

```bash
#!/usr/bin/env bash
# Post a comment to a Board ticket. Always exits 0 (non-blocking).
# Usage: post-comment.sh TICKET_NUMBER "body" [type]
# Types: triage, preview, qa (enables dedup on re-runs)
set -euo pipefail

TICKET_NUMBER="${1:-}"
BODY="${2:-}"
TYPE="${3:-}"

if [ -z "$TICKET_NUMBER" ] || [ -z "$BODY" ]; then
  echo "Usage: post-comment.sh TICKET_NUMBER \"body\" [type]" >&2
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Resolve workspace credentials (same pattern as send-event.sh)
WS_ID=$(node -e "process.stdout.write(require('$SCRIPT_DIR/../../project.json').pipeline?.workspace_id || '')" 2>/dev/null || true)
if [ -z "$WS_ID" ]; then exit 0; fi

WS_JSON=$("$SCRIPT_DIR/write-config.sh" read-workspace --id "$WS_ID" 2>/dev/null || true)
if [ -z "$WS_JSON" ]; then exit 0; fi

BOARD_URL=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).board_url || '')")
API_KEY=$(echo "$WS_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).api_key || '')")

if [ -z "$BOARD_URL" ] || [ -z "$API_KEY" ]; then exit 0; fi

# Build JSON payload (use env vars to avoid shell injection into JS)
PAYLOAD=$(COMMENT_BODY="$BODY" COMMENT_TYPE="$TYPE" node -e "
  const obj = { body: process.env.COMMENT_BODY, author: 'pipeline' };
  if (process.env.COMMENT_TYPE) obj.type = process.env.COMMENT_TYPE;
  process.stdout.write(JSON.stringify(obj));
" 2>/dev/null || true)

# Post comment (non-blocking, 3s timeout)
curl -s --max-time 3 -X POST "${BOARD_URL}/api/tickets/${TICKET_NUMBER}/comments" \
  -H "Content-Type: application/json" \
  -H "X-Pipeline-Key: ${API_KEY}" \
  -d "$PAYLOAD" >/dev/null 2>&1 || true

exit 0
```

**Note:** The BODY is passed via env var `COMMENT_BODY` to avoid shell injection into Node.js. For multiline markdown, pipe via stdin instead:

```bash
# Alternative for very large bodies (>ARG_MAX):
PAYLOAD=$(COMMENT_TYPE="$TYPE" node -e "
  const body = require('fs').readFileSync('/dev/stdin','utf-8');
  const obj = { body, author: 'pipeline' };
  if (process.env.COMMENT_TYPE) obj.type = process.env.COMMENT_TYPE;
  process.stdout.write(JSON.stringify(obj));
" <<< "$BODY" 2>/dev/null || true)
```

- [ ] **Step 2: Make executable**

```bash
chmod +x .claude/scripts/post-comment.sh
```

- [ ] **Step 3: Test with mock**

```bash
bash .claude/scripts/post-comment.sh 999 "Test comment" "triage"
echo "Exit code: $?"
```
Expected: Exit 0 (even if board unreachable — non-blocking)

- [ ] **Step 4: Commit**

```bash
git add .claude/scripts/post-comment.sh
git commit -m "feat: add post-comment.sh for Board ticket comments"
```

---

## Task 2: Triage Enrichment Agent

**Files:**
- Create: `agents/triage-enrichment.md`
- Modify: `agents/triage.md` (add `scaffold_type` output field)
- Modify: `pipeline/run.ts` (lines 251-273: add Phase 2 after Phase 1)

- [ ] **Step 1: Add scaffold_type to triage.md**

In `agents/triage.md`, extend the JSON output schema (around line 44-63) to include:

```json
"scaffold_type": "shopify-app | null"
```

Add to the evaluation instructions: "If the ticket describes creating a new Shopify app (tags: `app-scaffold`, keywords: 'neue App erstellen', 'create app', 'app scaffolding'), set `scaffold_type` to `shopify-app`. Otherwise null."

- [ ] **Step 2: Create triage-enrichment.md**

Create `agents/triage-enrichment.md`:

```markdown
---
model: sonnet
allowedTools: ["Grep", "Glob", "Read"]
---

# Triage Enrichment Agent

Du bist die zweite Phase der Ticket-Triage. Phase 1 hat das Ticket bereits analysiert. Deine Aufgabe: das Ticket mit Codebase-Kontext anreichern.

## Input

Du erhältst:
- Ticket-Titel und -Body
- Phase-1-Ergebnis (verdict, qa_tier, analysis)
- Die Plattform (stack.platform) und Variante (stack.variant) aus project.json

## Aufgaben

1. **Betroffene Dateien identifizieren** — Grep/Glob nach relevanten Keywords aus dem Ticket. Liste alle Dateien auf die geändert werden müssen.

2. **Fehlende Acceptance Criteria generieren** — Ergänze was Phase 1 nicht sehen konnte:
   - Mobile/Tablet/Desktop Breakpoints bei UI-Änderungen
   - Hover/Active/Focus States bei interaktiven Elementen
   - Dark Mode falls das Projekt es unterstützt

3. **Scope konkretisieren** — Übersetze vage Beschreibungen in konkrete Implementierungsanweisungen mit Dateiliste.

4. **Shopify-spezifische Checks** (wenn platform === "shopify"):
   - Wird die Änderung über Section Settings gesteuert oder hardcoded?
   - Muss settings_schema.json angepasst werden?
   - Online Store 2.0 Patterns (JSON Templates, Section Settings)?
   - Betrifft die Änderung mehrere Sections/Snippets? Alle auflisten.

## Output

Antworte als JSON:

```json
{
  "enriched_description": "Vollständige, angereicherte Ticket-Beschreibung mit konkreten Dateilisten und ergänzten ACs",
  "affected_files": ["path/to/file1", "path/to/file2"],
  "added_acceptance_criteria": [
    "Farbe konsistent auf Mobile/Tablet/Desktop",
    "Hover-State angepasst"
  ],
  "shopify_findings": ["settings_schema.json muss angepasst werden", "3 Sections betroffen"]
}
```

## Regeln

- **Timeout:** Du hast maximal 60 Sekunden. Sei effizient.
- **Konservativ:** Nur ergänzen was fehlt, nicht den Scope erweitern.
- **Konkret:** Dateinamen und Zeilennummern wenn möglich.
```

- [ ] **Step 3: Extend TriageResult in pipeline/run.ts**

In `pipeline/run.ts`, extend the `TriageResult` interface (line 51-58). Add 4 new optional fields:

```typescript
interface TriageResult {
  description: string;
  verdict: string;
  analysis: string;
  qaTier: "full" | "light" | "skip";
  qaPages: string[];
  qaFlows: string[];
  scaffoldType?: string;          // NEW — "shopify-app" or undefined
  enrichedDescription?: string;   // NEW — from Phase 2
  affectedFiles?: string[];       // NEW — from Phase 2
  addedACs?: string[];            // NEW — from Phase 2
}
```

Also parse `scaffold_type` in the existing JSON parsing block (line 117-133). After `result.qaFlows =` add:

```typescript
result.scaffoldType = parsed.scaffold_type || undefined;
```

- [ ] **Step 4: Add loadEnrichmentPrompt to load-agents.ts**

In `pipeline/lib/load-agents.ts`, add a function to load the enrichment agent prompt (same pattern as `loadTriagePrompt`):

```typescript
export function loadEnrichmentPrompt(workDir: string): string | null {
  const agentPath = resolve(workDir, "agents/triage-enrichment.md");
  try {
    const content = readFileSync(agentPath, "utf-8");
    const { body } = parseFrontmatter(content);
    return body;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Add Phase 2 enrichment call in pipeline/run.ts**

After line 258 (after `ticketDescription = triageResult.description;`) and BEFORE line 261 (the checkpoint block), insert the enrichment phase. Use the exact same `query()` pattern from `runTriage()` (lines 92-115):

```typescript
  // --- Phase 2: Enrichment (Sonnet with tools) ---
  const needsEnrichment =
    triageResult?.verdict !== "sufficient" ||
    config.stack?.platform === "shopify";

  if (needsEnrichment && triageResult) {
    try {
      const enrichmentPrompt = loadEnrichmentPrompt(workDir);
      if (enrichmentPrompt) {
        const enrichmentInput = JSON.stringify({
          title: ticket.title,
          body: ticketDescription,
          phase1: { verdict: triageResult.verdict, qa_tier: triageResult.qaTier, analysis: triageResult.analysis },
          platform: config.stack?.platform || "",
          variant: config.stack?.variant || "",
        });

        let enrichmentText = "";
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);

        try {
          for await (const message of query({
            prompt: `${enrichmentPrompt}\n\n## Ticket\n\n${enrichmentInput}`,
            options: {
              cwd: workDir,
              model: "sonnet",
              permissionMode: "bypassPermissions",
              allowDangerouslySkipPermissions: true,
              allowedTools: ["Grep", "Glob", "Read"],
              maxTurns: 3,
              env: { ...process.env, ...(opts.env ?? {}) },
              spawnClaudeCodeProcess: makeSpawn("[Enrichment]"),
              signal: controller.signal,
            },
          })) {
            if (message.type === "assistant") {
              const msg = message as SDKMessage & { content?: Array<{ type: string; text?: string }> };
              if (Array.isArray(msg.content)) {
                for (const block of msg.content) {
                  if (block.type === "text" && block.text) {
                    enrichmentText += block.text;
                  }
                }
              }
            }
          }
        } finally {
          clearTimeout(timeout);
        }

        // Parse enrichment JSON (same regex pattern as Phase 1)
        const jsonMatch = enrichmentText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const enriched = JSON.parse(jsonMatch[0]);
          triageResult.enrichedDescription = enriched.enriched_description;
          triageResult.affectedFiles = enriched.affected_files;
          triageResult.addedACs = enriched.added_acceptance_criteria;
          if (enriched.enriched_description) {
            ticketDescription = enriched.enriched_description;
          }
          console.error(`[Enrichment] Done — ${triageResult.affectedFiles?.length ?? 0} files, ${triageResult.addedACs?.length ?? 0} ACs added`);
        }

        // Post enrichment as Board comment (non-blocking)
        if (hasPipeline && triageResult.enrichedDescription) {
          const commentBody = formatEnrichmentComment(triageResult);
          try {
            execSync(
              `bash "${workDir}/.claude/scripts/post-comment.sh" "${ticket.ticketId}" "${commentBody.replace(/"/g, '\\"')}" "triage"`,
              { timeout: 5_000, stdio: "ignore" }
            );
          } catch { /* non-blocking */ }
        }
      }
    } catch (e) {
      // Phase 2 failure is non-blocking — continue with original ticket
      console.error(`[Enrichment] Skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
```

Add `loadEnrichmentPrompt` to the import at line 7:

```typescript
import { loadAgents, loadOrchestratorPrompt, loadTriagePrompt, loadEnrichmentPrompt } from "./lib/load-agents.ts";
```

Add helper function `formatEnrichmentComment` (above `executePipeline`):

```typescript
function formatEnrichmentComment(triage: TriageResult): string {
  const lines = ["**Triage Enrichment**\n"];
  if (triage.affectedFiles?.length) {
    lines.push("**Betroffene Dateien:**");
    triage.affectedFiles.forEach(f => lines.push(`- ${f}`));
    lines.push("");
  }
  if (triage.addedACs?.length) {
    lines.push("**Ergaenzte Acceptance Criteria:**");
    triage.addedACs.forEach(ac => lines.push(`- [ ] ${ac}`));
    lines.push("");
  }
  lines.push(`**QA-Tier:** ${triage.qaTier}`);
  return lines.join("\n");
}
```

- [ ] **Step 6: Test triage enrichment locally**

Create a test ticket with vague description, run pipeline with `JUST_SHIP_MODE=local`:
- Verify Phase 1 returns verdict
- Verify Phase 2 runs and produces enriched description
- Verify comment is posted (or gracefully skipped if Board unreachable)

- [ ] **Step 7: Commit**

```bash
git add agents/triage-enrichment.md agents/triage.md pipeline/run.ts
git commit -m "feat: add triage enrichment phase 2 with Board comments"
```

---

## Task 3: Shopify Environment Check

**Files:**
- Create: `.claude/scripts/shopify-env-check.sh`

- [ ] **Step 1: Create shopify-env-check.sh**

```bash
#!/usr/bin/env bash
# Validates Shopify development environment. Exit 1 if critical check fails.
# Caches result in .claude/.env-check-passed for 24h.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CACHE_FILE="$PROJECT_ROOT/.claude/.env-check-passed"
ERRORS=0
WARNINGS=0

# Check cache (skip if < 24h old)
if [ -f "$CACHE_FILE" ]; then
  CACHE_AGE=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0) ))
  if [ "$CACHE_AGE" -lt 86400 ]; then
    exit 0
  fi
fi

# Kill stale dev server if PID file exists
PID_FILE="$PROJECT_ROOT/.claude/.shopify-dev-pid"
if [ -f "$PID_FILE" ]; then
  STALE_PID=$(cat "$PID_FILE")
  if kill -0 "$STALE_PID" 2>/dev/null; then
    echo "Killing stale Shopify dev server (PID $STALE_PID)..." >&2
    kill "$STALE_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

check_required() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: $1 not found. $2" >&2
    ERRORS=$((ERRORS + 1))
    return 1
  fi
  echo "OK: $1 $(command $1 --version 2>/dev/null | head -1 || echo 'found')"
  return 0
}

check_optional() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "WARNING: $1 not found. $2" >&2
    WARNINGS=$((WARNINGS + 1))
    return 1
  fi
  echo "OK: $1 found"
  return 0
}

echo "=== Shopify Environment Check ==="

# Required tools
check_required "node" "Install: https://nodejs.org/"
check_required "git" "Install: https://git-scm.com/"
check_required "shopify" "Install: npm install -g @shopify/cli @shopify/theme"

# Optional tools
check_optional "gh" "Install: https://cli.github.com/ (needed for PRs)"

# Shopify Auth
echo "--- Auth Check ---"
if [ -n "${SHOPIFY_CLI_THEME_TOKEN:-}" ]; then
  echo "OK: SHOPIFY_CLI_THEME_TOKEN set (token-based auth)"
else
  # Try interactive auth check
  STORE=$(node -e "process.stdout.write(require('$PROJECT_ROOT/project.json').shopify?.store || '')" 2>/dev/null || true)
  if [ -n "$STORE" ]; then
    if shopify theme list --store="$STORE" >/dev/null 2>&1; then
      echo "OK: Shopify auth valid for $STORE"
    else
      echo "ERROR: Shopify auth invalid. Run: shopify auth login" >&2
      ERRORS=$((ERRORS + 1))
    fi
  else
    echo "ERROR: shopify.store not set in project.json" >&2
    ERRORS=$((ERRORS + 1))
  fi
fi

# project.json shopify.store
echo "--- Config Check ---"
STORE=$(node -e "process.stdout.write(require('$PROJECT_ROOT/project.json').shopify?.store || '')" 2>/dev/null || true)
if [ -z "$STORE" ]; then
  echo "ERROR: shopify.store missing in project.json" >&2
  ERRORS=$((ERRORS + 1))
elif [[ "$STORE" != *".myshopify.com"* ]]; then
  echo "WARNING: shopify.store '$STORE' doesn't look like a .myshopify.com URL" >&2
  WARNINGS=$((WARNINGS + 1))
else
  echo "OK: shopify.store = $STORE"
fi

echo "=== Result: $ERRORS errors, $WARNINGS warnings ==="

if [ "$ERRORS" -gt 0 ]; then
  exit 1
fi

# Cache success
date +%s > "$CACHE_FILE"
exit 0
```

- [ ] **Step 2: Make executable**

```bash
chmod +x .claude/scripts/shopify-env-check.sh
```

- [ ] **Step 3: Test on a machine with Shopify CLI**

```bash
bash .claude/scripts/shopify-env-check.sh
echo "Exit: $?"
```
Expected: Exit 0 with all checks passing, cache file created.

- [ ] **Step 4: Test cache (run again immediately)**

```bash
bash .claude/scripts/shopify-env-check.sh
```
Expected: Instant exit 0 (cache hit).

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/shopify-env-check.sh
git commit -m "feat: add shopify-env-check.sh for environment validation"
```

---

## Task 4: Shopify Dev Script (Hybrid dev/push)

**Files:**
- Create: `.claude/scripts/shopify-dev.sh`
- Modify: `.claude/scripts/shopify-preview.sh` (make wrapper)
- Reference: `.claude/scripts/shopify-preview.sh` (existing push logic, lines 61-135)

- [ ] **Step 1: Create shopify-dev.sh**

Create `.claude/scripts/shopify-dev.sh` with three subcommands: `start`, `stop`, `url`.

The script should:
- Detect mode: `--mode=dev|push` flag > `JUST_SHIP_MODE=pipeline` env > TTY detection
- `start TICKET TITLE`: Start dev server (local) or push unpublished theme (remote)
- `stop`: Kill dev server or delete unpublished theme
- `url`: Return current preview URL from `.claude/.dev-preview-url`
- Port management: Try 9292, 9293, 9294 if occupied
- PID tracking: `.claude/.shopify-dev-pid`
- URL tracking: `.claude/.dev-preview-url`
- Credential resolution: Same pattern as `shopify-preview.sh` (SHOPIFY_CLI_THEME_TOKEN > config.json > CLI)
- Store resolution: `project.json` → `shopify.store`
- Post preview URL as Board comment (`post-comment.sh TICKET url "preview"`)
- Always exit 0 on errors (non-blocking, errors to stderr)

**For the push mode:** Port the existing logic from `shopify-preview.sh` lines 61-135 (theme push --unpublished, theme ID tracking, URL generation).

**For the dev mode:** Start `shopify theme dev --store={store} --port={port}` in background, parse stdout for preview URL.

- [ ] **Step 2: Make executable**

```bash
chmod +x .claude/scripts/shopify-dev.sh
```

- [ ] **Step 3: Update shopify-preview.sh as wrapper**

Replace `.claude/scripts/shopify-preview.sh` content with a thin wrapper:

```bash
#!/usr/bin/env bash
# Legacy wrapper — delegates to shopify-dev.sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CMD="${1:-}"
shift || true
case "$CMD" in
  push)    exec bash "$SCRIPT_DIR/shopify-dev.sh" start --mode=push "$@" ;;
  cleanup) exec bash "$SCRIPT_DIR/shopify-dev.sh" stop "$@" ;;
  *)       exec bash "$SCRIPT_DIR/shopify-dev.sh" "$CMD" "$@" ;;
esac
```

- [ ] **Step 4: Test push mode**

```bash
JUST_SHIP_MODE=pipeline bash .claude/scripts/shopify-dev.sh start "T-999" "Test theme"
echo "Exit: $?"
bash .claude/scripts/shopify-dev.sh url
bash .claude/scripts/shopify-dev.sh stop
```
Expected: Theme pushed, URL returned, theme deleted.

- [ ] **Step 5: Test dev mode (local only)**

```bash
bash .claude/scripts/shopify-dev.sh start "T-999" "Test dev"
# Wait for URL
bash .claude/scripts/shopify-dev.sh url
bash .claude/scripts/shopify-dev.sh stop
```
Expected: Dev server started, PID file created, URL extracted, server killed on stop.

- [ ] **Step 6: Test legacy wrapper**

```bash
bash .claude/scripts/shopify-preview.sh push "T-999" "Legacy test"
bash .claude/scripts/shopify-preview.sh cleanup
```
Expected: Same behavior as before (backwards compatible).

- [ ] **Step 7: Commit**

```bash
git add .claude/scripts/shopify-dev.sh .claude/scripts/shopify-preview.sh
git commit -m "feat: add shopify-dev.sh with hybrid dev/push modes"
```

---

## Task 5: Integrate Env Check + Dev Script into Pipeline

**Files:**
- Modify: `commands/develop.md` (lines ~162, ~426-485)
- Modify: `pipeline/run.ts` (lines ~150-186, before orchestrator)

- [ ] **Step 1: Update develop.md — add env-check**

In `commands/develop.md`, after Step 2 (ticket selection) and before Step 3 (branch creation), add:

```markdown
### Step 2.5: Environment Check (Shopify only)

If `stack.platform === "shopify"` in project.json:

\`\`\`bash
bash .claude/scripts/shopify-env-check.sh
\`\`\`

If exit code 1: STOP and inform user of missing requirements. Do not proceed.
```

- [ ] **Step 2: Update develop.md — replace preview.sh with dev.sh**

In `commands/develop.md`, find the section where `shopify-preview.sh push` is called (around line 426-460). Replace:

```bash
# Old:
PREVIEW_URL=$(bash .claude/scripts/shopify-preview.sh push "T-${N}" "${TITLE}")

# New:
PREVIEW_URL=$(bash .claude/scripts/shopify-dev.sh start "T-${N}" "${TITLE}")
```

Also update the cleanup in the error/completion handlers to use `shopify-dev.sh stop`.

- [ ] **Step 3: Update pipeline/run.ts — add env-check for VPS path**

In `pipeline/run.ts`, after triage (line 258) and before the prompt building phase (line 275 `// --- Build prompt ---`), add:

```typescript
// Shopify env check (VPS path — develop.md handles local path)
if (config.stack?.platform === "shopify") {
  try {
    execSync(`bash "${workDir}/.claude/scripts/shopify-env-check.sh"`, {
      timeout: 30_000,
      stdio: "pipe",
    });
    console.error("[Shopify] Environment check passed");
  } catch (e) {
    console.error(`[Shopify] Environment check failed: ${e instanceof Error ? e.message : String(e)}`);
    // Non-blocking on VPS — pipeline continues but logs warning
  }
}
```

Note: Uses `execSync` (already imported at line 3), not `execAsync` which doesn't exist in the codebase.

- [ ] **Step 4: Commit**

```bash
git add commands/develop.md pipeline/run.ts
git commit -m "feat: integrate shopify env-check and shopify-dev.sh into pipeline"
```

---

## Task 6: Shopify App Scaffold Skill

**Files:**
- Create: `skills/shopify-app-scaffold.md`

- [ ] **Step 1: Create the skill**

Create `skills/shopify-app-scaffold.md`:

```markdown
# Shopify App Scaffold Cleanup

After `shopify app create --template=remix`, clean up the generated demo code and leave a minimal, production-ready starter.

## When to Use

This skill is loaded by the Orchestrator when `scaffold_type === "shopify-app"` in the Triage result (triggered by ticket tag `app-scaffold` or keywords like "neue App erstellen", "create app").

## Cleanup Rules

### Remove
- All example routes except `app/routes/app._index.tsx`
- Demo components (QR Code Generator, placeholder UI)
- Placeholder data and mock API calls
- Example webhook handlers (unless the ticket requires webhooks)
- Unnecessary README content

### Keep (DO NOT DELETE)
- `app/root.tsx` — App Shell with Polaris AppProvider
- `app/entry.server.tsx` — SSR setup
- `app/shopify.server.ts` — Auth configuration (critical)
- `shopify.app.toml` — App config
- `package.json`, `tsconfig.json`
- `.env` handling and `shopify.web.toml`
- Prisma/DB setup (if present) — schema.prisma, migrations/
- `app/routes/auth.*.tsx` — Auth routes (critical)
- `app/routes/webhooks.tsx` — Webhook handler (keep minimal)

### Create
- **`app/routes/app._index.tsx`** — Minimal Polaris page:
  ```tsx
  import { Page, Layout, Text } from "@shopify/polaris";
  export default function Index() {
    return (
      <Page title="App">
        <Layout>
          <Layout.Section>
            <Text as="p">App ready.</Text>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }
  ```
- **`.env.example`** — Document all required env vars
- **`README.md`** — Project name, setup instructions (`npm install`, `shopify app dev`)

### Update project.json

After scaffold, ensure project.json contains:
```json
{
  "stack": {
    "platform": "shopify",
    "variant": "remix",
    "framework": "remix",
    "language": "typescript"
  },
  "build": {
    "dev": "shopify app dev",
    "install": "npm install"
  }
}
```

## Verification

After cleanup, run:
```bash
npm install && npm run build
```
The app should build without errors.
```

- [ ] **Step 2: Register skill in pipeline skill loader**

In `pipeline/lib/load-skills.ts`, add to `SKILL_AGENT_MAP` (line 22-31) using the existing format (`Record<string, AgentRole[]>`):

```typescript
"shopify-app-scaffold": ["orchestrator", "frontend"],
```

Note: Platform filtering happens via `VARIANT_DEFAULTS` (line 34-37), not via `SKILL_AGENT_MAP`. The skill is loaded explicitly when `scaffold_type === "shopify-app"`, so it doesn't need variant defaults.

- [ ] **Step 3: Commit**

```bash
git add skills/shopify-app-scaffold.md pipeline/lib/load-skills.ts
git commit -m "feat: add shopify-app-scaffold skill for clean app setup"
```

---

## Task 7: Shopify QA Static Analysis Script

**Files:**
- Create: `.claude/scripts/shopify-qa.sh`

- [ ] **Step 1: Create shopify-qa.sh**

Create `.claude/scripts/shopify-qa.sh`:

The script should:
- Accept no arguments (operates on current git diff)
- Only check files changed in current branch (`git diff --name-only HEAD~1..HEAD` or `git diff --name-only main..HEAD`)
- Run 5 check categories against changed Liquid/CSS/JS files:
  1. `hardcoded_values`: grep for `#[0-9a-fA-F]{3,8}`, `rgb(`, `rgba(` in changed `.liquid` and `.css` files (excluding lines with `/* shopify-qa-ignore */` on preceding line)
  2. `incomplete_propagation`: if a CSS class or Liquid variable was changed, check if it exists in other files that weren't changed
  3. `section_schema`: parse `{% schema %}` blocks, check settings defined vs used
  4. `breakpoint_coverage`: if CSS was changed, check for corresponding media queries
  5. `os2_compliance`: check for `.liquid` template files (should be `.json`)
- Respect `.shopify-qa-ignore` file (glob patterns to skip)
- Output JSON to stdout matching the spec schema:

```json
{
  "findings": [{ "severity": "...", "check": "...", "file": "...", "line": 0, "message": "..." }],
  "summary": { "errors": 0, "warnings": 0, "info": 0 }
}
```

- Exit code: 1 if `errors > 0`, else 0

- [ ] **Step 2: Make executable**

```bash
chmod +x .claude/scripts/shopify-qa.sh
```

- [ ] **Step 3: Test with a sample Shopify theme change**

```bash
# In a Shopify theme project with a staged change:
bash .claude/scripts/shopify-qa.sh | jq .
```
Expected: JSON output with findings array and summary.

- [ ] **Step 4: Commit**

```bash
git add .claude/scripts/shopify-qa.sh
git commit -m "feat: add shopify-qa.sh static analysis for Liquid/Theme consistency"
```

---

## Task 8: Integrate Shopify QA into Pipeline

**Files:**
- Modify: `pipeline/lib/qa-runner.ts` (lines 21-35: QaContext, lines 493-571: runQa)
- Modify: `pipeline/lib/qa-fix-loop.ts` (lines 116-188: fix loop)
- Modify: `pipeline/lib/config.ts` (QaConfig interface, lines 12-20)

- [ ] **Step 1: Extend QaContext in qa-runner.ts**

Add to the `QaContext` interface (line 21-35):

```typescript
export interface QaContext {
  // ... existing fields ...
  enrichedACs?: string;
  triageFindings?: string[];
  shopifyQaReport?: ShopifyQaReport;
}

export interface ShopifyQaFinding {
  severity: "error" | "warning" | "info";
  check: string;
  file: string;
  line: number;
  message: string;
}

export interface ShopifyQaReport {
  findings: ShopifyQaFinding[];
  summary: { errors: number; warnings: number; info: number };
}
```

- [ ] **Step 2: Add Shopify QA step to runQa**

In `runQa()` (around line 505, after build check), add:

```typescript
// Shopify static analysis (runs for all Shopify projects, all tiers except skip)
if (context.qaConfig.shopifyEnabled && context.qaTier !== "skip") {
  const qaScriptPath = path.join(context.workDir, ".claude/scripts/shopify-qa.sh");
  if (fs.existsSync(qaScriptPath)) {
    const shopifyResult = await execAsync(`bash "${qaScriptPath}"`, {
      cwd: context.workDir,
      timeout: 60_000,
    }).catch(e => ({ stdout: "{}", stderr: e.message, exitCode: 1 }));

    try {
      const report: ShopifyQaReport = JSON.parse(shopifyResult.stdout);
      context.shopifyQaReport = report;

      checks.push({
        name: "shopify-qa",
        passed: report.summary.errors === 0,
        details: report.summary.errors > 0
          ? `${report.summary.errors} errors: ${report.findings.filter(f => f.severity === "error").map(f => f.message).join("; ")}`
          : `${report.summary.warnings} warnings`,
        blocking: report.summary.errors > 0,
      });
    } catch {
      // Parse failure — non-blocking
      checks.push({ name: "shopify-qa", passed: true, details: "Script output not parseable", blocking: false });
    }
  }
}
```

- [ ] **Step 3: Extend QaConfig in config.ts**

Add to `QaConfig` interface (line 12-20):

```typescript
shopifyEnabled?: boolean; // Auto-detected from stack.platform === "shopify"
```

In the `loadProjectConfig()` function where `qa` is constructed from `rawQa`, add after the existing QaConfig assignments:

```typescript
shopifyEnabled: raw.stack?.platform === "shopify",
```

Note: `raw` is the parsed project.json. `raw.stack` lives at the top level, not inside `raw.qa`. This cross-references stack config into the QA config so the QA runner doesn't need to re-read project.json.

- [ ] **Step 4: Register shopify-qa as fixable check in qa-fix-loop.ts**

In the fix prompt building logic (around line 133), ensure `shopify-qa` check failures are included in the fix prompt:

```typescript
// Include shopify-qa failures in fix prompt
const shopifyFailures = report.checks
  .filter(c => c.name === "shopify-qa" && !c.passed)
  .map(c => c.details);
if (shopifyFailures.length) {
  fixPrompt += `\n\nShopify QA Errors:\n${shopifyFailures.join("\n")}`;
  fixPrompt += `\nFix these issues: use CSS custom properties instead of hardcoded values, ensure changes propagate to all affected files.`;
}
```

- [ ] **Step 5: Pass enrichment data to QaContext in run.ts**

In `pipeline/run.ts`, where QaContext is created (lines 489-501, inside the `const qaContext: QaContext = {` block), add after `env: opts.env,` (line 500):

```typescript
enrichedACs: triageResult?.addedACs?.join("\n") || undefined,
triageFindings: triageResult?.affectedFiles || undefined,
```

Note: `ticket.ticketId` (not `ticket.id`) is the correct property — see `TicketArgs` interface in `pipeline/lib/config.ts`.

- [ ] **Step 6: Update QA agent prompt**

In `agents/qa.md`, add a Shopify-specific section:

```markdown
## Shopify-spezifische Prüfung

Wenn das Projekt eine Shopify-Plattform ist (erkennbar an Liquid-Dateien, section schemas, shopify.store in project.json):

1. **Konsistenz-Check:** Wurde die Änderung in ALLEN betroffenen Sections/Snippets durchgeführt? Prüfe die Dateiliste aus der Triage-Enrichment.
2. **Settings vs. Hardcoded:** Werden neue Werte über Section Settings / CSS Custom Properties gesteuert, oder sind sie hardcoded?
3. **Breakpoint-Coverage:** Funktioniert die Änderung auf Mobile (375px), Tablet (768px), Desktop (1440px)?
4. **Online Store 2.0:** Werden JSON Templates statt .liquid Templates verwendet?

Wenn ein Shopify QA Report vorliegt, prüfe die Findings und verifiziere ob die gemeldeten Issues tatsächlich Probleme sind oder False Positives.
```

- [ ] **Step 7: Commit**

```bash
git add pipeline/lib/qa-runner.ts pipeline/lib/qa-fix-loop.ts pipeline/lib/config.ts pipeline/run.ts agents/qa.md
git commit -m "feat: integrate Shopify QA static analysis into pipeline"
```

---

## Task 9: Slack Follow-up Ticket

**Files:** None (Board API call only)

- [ ] **Step 1: Create Slack integration ticket in Board**

Post ticket via Board API or `/ticket` command:

```
Title: Slack Webhook Integration for Agency Notifications
Description: Incoming Webhook in project.json konfigurierbar (notifications.slack_webhook).
Preview-URLs, Status-Updates und Triage-Enrichments an Slack Channel senden.
Kein Bot, nur Outbound-Notifications.

Acceptance Criteria:
- [ ] notifications.slack_webhook field in project.json schema
- [ ] post-comment.sh sends to Slack if webhook configured
- [ ] Preview URLs posted to Slack
- [ ] Triage Enrichment summaries posted to Slack
- [ ] Pipeline status changes posted to Slack
- [ ] Graceful failure if webhook unreachable

Tags: feature, shopify-agency
Priority: medium
```

- [ ] **Step 2: Commit (no code change — ticket only)**

No commit needed. Ticket lives in the Board.

---

## Deferred: Multi-Breakpoint Visual Regression (Spec Stufe 2)

The spec describes Playwright rendering on 3 breakpoints (375px, 768px, 1440px) with hover/focus interaction for Shopify-specific visual regression. This is **deferred** from the initial implementation because:

1. The existing Playwright smoke in `qa-runner.ts` runs at a single viewport (1280x720). Adding multi-breakpoint support is a separate enhancement to the QA runner.
2. Visual regression needs a running preview URL, which depends on Cluster B (shopify-dev.sh) working reliably first.
3. The static analysis (shopify-qa.sh) catches the most critical consistency issues (like Vincent's CTA color problem) without needing a browser.

**Follow-up:** After Tasks 0-8 are complete and validated, create a Task 10 that extends `qa-runner.ts` to run Playwright at 3 breakpoints when `qaTier === "full"` and `platform === "shopify"`.

---

## Summary

| Task | Cluster | Deliverable | Dependencies |
|---|---|---|---|
| 0 | Prereq | Board Comment API + UI | None (Board repo) |
| 1 | Prereq | post-comment.sh | Task 0 |
| 2 | A | Triage Enrichment (Phase 2) | Task 1 |
| 3 | B | shopify-env-check.sh | None |
| 4 | B | shopify-dev.sh (hybrid dev/push) | None |
| 5 | B | Pipeline integration (env-check + dev.sh) | Tasks 3, 4 |
| 6 | B | shopify-app-scaffold.md skill | None |
| 7 | C | shopify-qa.sh (static analysis) | None |
| 8 | C | Pipeline QA integration | Tasks 2, 7 |
| 9 | — | Slack follow-up ticket | None |

**Parallelizable:** Tasks 3, 4, 6, 7 have no dependencies and can run in parallel. Task 0 must complete before Task 1. Task 1 must complete before Task 2. Tasks 3+4 must complete before Task 5. Tasks 2+7 must complete before Task 8.
