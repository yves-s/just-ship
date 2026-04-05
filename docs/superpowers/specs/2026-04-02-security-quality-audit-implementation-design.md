# Security & Quality Audit Implementation Plan

> Consolidated implementation plan for all findings from the full audit of just-ship (Engine) and just-ship-board (Board).

**Date:** 2026-04-02
**Scope:** 21 tickets across 2 repos, 4 phases

---

## Phase 1 — Critical Security (sofort)

### Repo: just-ship-board

**T-539: Production Secrets aus Git History entfernen + Keys rotieren**
- Manual: SUPABASE_SERVICE_ROLE_KEY rotieren (Supabase Dashboard)
- Manual: RESEND_API_KEY rotieren (Resend Dashboard)
- `git filter-repo --path .env.local --invert-paths` to scrub history
- Update keys in Vercel environment
- Commit .gitignore fix + untracked .env.local

**T-540: Open Redirect in Login Flow**
- Create `src/lib/utils/safe-redirect.ts`:
  ```ts
  export function safeRedirect(url: string | null, fallback = "/"): string {
    if (!url || !url.startsWith("/") || url.startsWith("//")) return fallback;
    return url;
  }
  ```
- Apply in login/page.tsx, auth/callback/route.ts, middleware.ts

**T-541: Unguarded request.json()**
- Create `src/lib/api/safe-parse-json.ts`:
  ```ts
  export async function safeParseJson(request: Request) {
    try { return { data: await request.json(), error: null }; }
    catch { return { data: null, error: "INVALID_JSON" }; }
  }
  ```
- Replace bare `request.json()` in all 8 affected routes

### Repo: just-ship

**T-525: Shell Injection in send-event.sh**
- Replace string interpolation with `node -e` + env vars for JSON construction
- Pattern: `JS_AT="$AGENT_TYPE" node -e "process.stdout.write(JSON.stringify({...}))"`

**T-526: Command Injection via Branch Name**
- Add `sanitizeBranchName()` in `pipeline/lib/utils.ts`:
  ```ts
  export function sanitizeBranchName(name: string): string {
    if (!/^[a-zA-Z0-9\/_.-]+$/.test(name)) {
      throw new Error(`Invalid branch name: ${name}`);
    }
    return name;
  }
  ```
- Apply in run.ts (executePipeline, resumePipeline), worktree-manager.ts
- Consistent quoting in all `_git()` calls

**T-527: Shell Injection via Comment Body**
- Pass commentBody via `env: { COMMENT_BODY: commentBody }` to execSync
- Update post-comment.sh to read from `$COMMENT_BODY` when positional arg is empty

---

## Phase 2 — High Security + Bugs

### Repo: just-ship-board

**T-542: JSP Token Encryption**
- Replace base64 encoding with AES-256-GCM encryption
- Server-side secret from env (`JSP_ENCRYPTION_KEY`)
- Update generateJspToken/parseJspToken
- Add optional TTL field

**T-543: Intake Rate Limiting**
- Add `expires_at` column to intake_links table (migration)
- Rate limit tracking: Supabase table or Vercel KV
- Limits: 5 analyze calls, 20 file uploads per token
- 429 response when exceeded

### Repo: just-ship

**T-516: Body Size Limit**
- Add `maxBytes` parameter to `readBody()` in server.ts (default 1MB)
- Return 413 Payload Too Large when exceeded

**T-515: process.exit in config.ts**
- Replace `process.exit(1)` with `throw new Error()` in `parseCliArgs`
- CLI caller handles exit

**T-517: unhandledRejection Handler**
- Add `process.on("unhandledRejection")` in worker.ts and server.ts
- Log + Sentry.captureException

---

## Phase 3 — Performance + Quality

### Repo: just-ship-board

**T-544: N+1 Members + Costs Aggregation**
- Members: batch lookup via `service.auth.admin.listUsers()` or profiles table join
- Costs: Supabase RPC function `workspace_monthly_costs(ws_id, month_start)`

**T-545: Auth Code Dedup**
- Extract `validateApiKey(key)` from pipeline-auth.ts / pipeline-key-auth.ts
- Extract `getTicketByNumber()` to `src/lib/queries/tickets.ts`
- Move board colors to shared constants
- Dashboard: import `calculateTokenCost` from token-rates.ts

### Repo: just-ship

**T-518: Pipeline Code Dedup**
- Extract shared utilities: `toBranchName()`, `makeSpawn()`, `sleep()`, `log()`
- Extract pipeline context: `setupPipelineContext()`, `handlePipelineMessages()`, `finalizePipeline()`
- Unify `runPipelineBackground()` in server.ts

**T-519: Timing-safe Auth**
- `secureCompare()` utility with `crypto.timingSafeEqual`
- Apply to all auth checks in server.ts
- Split `/health` into unauthenticated status + authenticated `/api/status`

---

## Phase 4 — Hardening + DX

### Repo: just-ship-board

**T-546: Timing-safe, CSP, RLS Hardening**
- timingSafeEqual for Telegram bot secret
- CSP header in middleware for non-sidekick routes
- Tighten RLS delete policy: require owner/admin role
- Generic error messages to client

**T-547: check-slug Auth, Rate Limiting, Tests**
- Require auth on check-slug endpoint
- Replace in-memory rate limit with persistent (Vercel KV or DB)
- Set up Vitest, write tests for: ticket CRUD, pipeline auth, invite flow

### Repo: just-ship

**T-520: Docker/VPS Hardening**
- Replace `safe.directory '*'` with per-project directories
- Remove deprecated setup-vps.sh sudo group or add specific sudoers
- Env allowlist for agent subprocesses

**T-522: RLS Policies in Migrations**
- Add `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` to migration
- Define project_id-based policies
- Document service key usage

**T-523: CI TypeCheck + Import Consistency**
- Add `"typecheck": "tsc --noEmit"` to pipeline/package.json
- Add typecheck step to GitHub Actions
- Standardize import extensions

**T-521: Catch Blocks + Handler Split**
- Review all 54 bare catch blocks: log or comment
- Extract route handlers from monolithic handleRequest

---

## Execution Strategy

- **Phase 1** can run fully parallel across both repos (6 tickets, all independent)
- **Phase 2** can run parallel after Phase 1 (5 tickets)
- **Phase 3+4** can be mixed based on availability
- Each ticket = 1 branch, 1 PR
- Board fixes deploy via Vercel preview, Engine fixes deploy via Docker build

## Ticket Overview

### just-ship (Engine)
| Ticket | Phase | Priority | Title |
|--------|-------|----------|-------|
| T-525 | 1 | high | Shell Injection send-event.sh |
| T-526 | 1 | high | Command Injection Branch Name |
| T-527 | 1 | high | Shell Injection Comment Body |
| T-515 | 2 | high | process.exit in config.ts |
| T-516 | 2 | high | Body Size Limit |
| T-517 | 2 | high | unhandledRejection Handler |
| T-518 | 3 | medium | Pipeline Code Dedup |
| T-519 | 3 | medium | Timing-safe Auth |
| T-520 | 4 | medium | Docker/VPS Hardening |
| T-521 | 4 | low | Catch Blocks + Handler Split |
| T-522 | 4 | medium | RLS Policies |
| T-523 | 4 | low | CI TypeCheck |

### just-ship-board (Board)
| Ticket | Phase | Priority | Title |
|--------|-------|----------|-------|
| T-539 | 1 | high | Secrets rotieren + Git History |
| T-540 | 1 | high | Open Redirect |
| T-541 | 1 | high | request.json() Guards |
| T-542 | 2 | high | JSP Token Encryption |
| T-543 | 2 | high | Intake Rate Limiting |
| T-544 | 3 | medium | N+1 + Costs Aggregation |
| T-545 | 3 | medium | Auth Code Dedup |
| T-546 | 4 | medium | Timing-safe, CSP, RLS |
| T-547 | 4 | low | check-slug, Rate Limit, Tests |
