# VPS Update Process — Design Spec

> **Date:** 2026-03-30
> **Status:** Draft
> **Scope:** Engine update, project update, zero-downtime, canary rollout, multi-VPS

---

## 1. Problem

There is no formalized process to update just-ship on VPS instances. The current approach is a manual three-liner (`git pull` → `docker build` → `docker up`) documented in `vps/README.md`. This is fragile, has no rollback, no visibility, and doesn't scale to multiple VPS instances.

## 2. Goals

- **Zero-downtime updates** — running pipeline runs must not be interrupted
- **Auto-triggered** — push to `main` triggers the update automatically
- **Manually triggerable** — CLI and Board UI as fallback
- **Canary rollout** — one VPS first, health-check, then the rest
- **Auto-rollback** — failed health-check reverts to previous version
- **Multi-VPS** — scales to many VPS instances (one per customer/workspace)
- **Full visibility** — Board shows rollout progress, per-VPS and per-project status

## 3. Architecture Overview

```
GitHub (push to main)
    │
    ▼ Webhook (HMAC-SHA256)
Board API (/api/webhooks/github)
    │
    │ Creates rollout, selects canary
    │
    ▼ POST /api/update {version, rollout_id}
┌──────────────────────────────────────┐
│  VPS: Update-Agent (systemd)         │
│  Runs on HOST, outside Docker        │
│                                      │
│  1. Lock (reject if already updating)│
│  2. Tag old image for rollback       │
│  3. git fetch + checkout {sha}       │
│  4. docker build (new image)         │
│     Old container still running      │
│  5. Drain pipeline-server            │
│     (block new runs, wait for        │
│      running ones to finish)         │
│  6. docker compose up (new image)    │
│  7. Health-check (5x, backoff)       │
│  8a. Healthy:                        │
│      setup.sh --update per project   │
│      Report: success                 │
│  8b. Unhealthy:                      │
│      Rollback to old image           │
│      Report: failed                  │
│  9. Self-update if updater changed   │
└──────────────────────────────────────┘
    │
    ▼
Board: Canary healthy?
    ├─ Yes → Phase 2: remaining VPS in parallel
    └─ No  → Rollout stopped, alert
```

### Three New Components

1. **Board: VPS Registry + Rollout Orchestrator** — `vps_instances` table, rollout logic (canary → rest), status dashboard
2. **VPS: Update-Agent** — systemd service with file-based trigger, manages Docker from outside
3. **Pipeline-Server: Drain endpoint** — `/api/drain` blocks new runs, waits for running ones

### Key Principles

- **Exact version** — Git SHA, not "latest". Board always knows which version runs where.
- **Build-before-stop** — New image is built while old container still serves traffic.
- **Auto-rollback** — Health-check failure reverts to previous image automatically.
- **Granular reporting** — VPS-level status + per-project status reported to Board.
- **Drain with timeout** — No infinite waits on stuck runs.

## 4. Data Model

### Table: `vps_instances`

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid FK → workspaces | Each VPS belongs to a workspace |
| `hostname` | text | e.g. `vps-01.just-ship.io` |
| `endpoint_url` | text | e.g. `https://vps-01.just-ship.io` |
| `update_secret` | text | Shared secret for `/api/update` auth |
| `current_version` | text | Git SHA of currently running version |
| `status` | enum | `healthy`, `updating`, `unhealthy`, `draining` |
| `update_phase` | text | Current phase when `status=updating`: `building`, `draining`, `switching`, `health_check`, `updating_projects` |
| `is_canary` | boolean | Updated first in rollouts |
| `last_health_check` | timestamptz | |
| `created_at` | timestamptz | |

### Table: `rollouts`

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `target_version` | text | Git SHA |
| `trigger` | enum | `webhook`, `manual` |
| `triggered_by` | text | User ID or `github-webhook` for audit trail |
| `status` | enum | `canary`, `rolling`, `completed`, `failed`, `aborted` |
| `canary_vps_id` | uuid FK | Which VPS was canary |
| `started_at` | timestamptz | |
| `completed_at` | timestamptz | |

### Table: `rollout_results`

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `rollout_id` | uuid FK → rollouts | |
| `vps_id` | uuid FK → vps_instances | |
| `status` | enum | `pending`, `updating`, `success`, `failed`, `rolled_back` |
| `project_results` | jsonb | Array of `ProjectResult` (see below) |
| `previous_version` | text | For rollback |
| `error` | text | Failure reason |
| `started_at` | timestamptz | |
| `completed_at` | timestamptz | |

All three tables live in the **Pipeline-DB (`wsmnutkobalfrceavpxs`)**.

### Type: `ProjectResult` (JSONB schema)

```typescript
interface ProjectResult {
  slug: string;          // Project directory name
  status: "success" | "failed" | "skipped";
  error?: string;        // Only present when status=failed
  duration_ms?: number;
}
```

## 5. Board API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/webhooks/github` | POST | GitHub push webhook → create rollout |
| `/api/vps` | GET | List all VPS for workspace |
| `/api/vps` | POST | Register a new VPS |
| `/api/vps/:id` | PATCH | Update status/version |
| `/api/rollouts` | POST | Manually trigger rollout |
| `/api/rollouts/:id` | GET | Rollout status + results |
| `/api/rollouts/:id/results` | POST | VPS reports result back |

### Rollout Orchestration Logic (Board)

1. GitHub webhook or manual trigger → create rollout record
2. Select canary VPS (`is_canary = true`), send `POST /api/update`
3. Wait for callback from canary (`POST /api/rollouts/:id/results`)
4. On success: update remaining VPS in parallel
5. On failure: stop rollout, alert user
6. Reject new rollout if one is already active (`409 Conflict`)

## 6. VPS Update-Agent

### Communication: Pipeline-Server → Update-Agent

The pipeline server runs *inside* Docker and cannot replace its own container. Solution: the `/api/update` endpoint writes a trigger file to a **separate writable volume** mounted at `/home/claude-dev/.just-ship/triggers/`:

```json
// /home/claude-dev/.just-ship/triggers/update-trigger.json
{
  "schema_version": 1,
  "version": "abc1234",
  "rollout_id": "uuid",
  "triggered_at": "2026-03-30T..."
}
```

**Important:** The existing `.just-ship` volume remains read-only (`:ro`) since it contains `server-config.json` with API keys. The trigger directory is a separate bind mount:

```yaml
# docker-compose.yml addition
volumes:
  - /home/claude-dev/.just-ship:/home/claude-dev/.just-ship:ro       # existing, stays RO
  - /home/claude-dev/.just-ship/triggers:/home/claude-dev/.just-ship/triggers:rw  # new, writable
```

The Update-Agent reads `board_url` from `server-config.json` (single source of truth) and only uses `rollout_id` from the trigger file to construct the callback URL.

The Update-Agent watches the trigger directory (5s poll loop) and starts the update process.

### Update Sequence

```bash
# 1. Lock — reject (not queue) if already updating
flock --nonblock /tmp/just-ship-update.lock || {
  # Report to Board: already updating, reject this request
  callback_reject "VPS is already processing an update"
  exit 1
}

# 2. Tag old image for rollback
CURRENT_SHA=$(git -C /home/claude-dev/just-ship rev-parse --short HEAD)
docker tag just-ship-pipeline:latest just-ship-pipeline:$CURRENT_SHA

# 3. Fetch target version (exact SHA)
git -C /home/claude-dev/just-ship fetch origin
git -C /home/claude-dev/just-ship checkout $TARGET_SHA

# 4. Build new image (old container still running)
docker compose -f vps/docker-compose.yml build pipeline-server
# On build failure: report failed immediately, restore old checkout

# 5. Drain: block new runs, wait for running ones
curl -s -X POST http://localhost:3001/api/drain
# Poll /health every 10s until drained=true (timeout: 30min)

# 6. Switch: start container with new image
docker compose -f vps/docker-compose.yml up -d pipeline-server

# 7. Health-check (5 attempts with backoff: 5s, 10s, 15s, 20s, 30s)
#    Initial 5s delay gives Node.js time to start up
sleep 5
for delay in 5 10 15 20 30; do
  curl -sf http://localhost:3001/health && break
  sleep $delay
done

# 8a. Healthy → update projects
if healthy; then
  for project_dir in /home/claude-dev/projects/*/; do
    bash /home/claude-dev/just-ship/setup.sh --update --project "$project_dir"
    # Collect per-project result
  done
  # Callback to Board: success + project_results
  # IMPORTANT: Wait for confirmed callback before self-update

# 8b. Unhealthy → rollback
else
  git -C /home/claude-dev/just-ship checkout $CURRENT_SHA
  docker compose -f vps/docker-compose.yml up -d pipeline-server
  # Callback to Board: failed + reason
fi

# 9. Self-update: reload updater if changed
# Runs ONLY after Board callback is confirmed (step 8a/8b).
# If callback failed, skip self-update — report that separately.
if callback_confirmed && [ "$(md5sum /usr/local/bin/just-ship-updater.sh)" != \
     "$(md5sum /home/claude-dev/just-ship/vps/just-ship-updater.sh)" ]; then
  cp /home/claude-dev/just-ship/vps/just-ship-updater.sh /usr/local/bin/
  systemctl restart just-ship-updater
  # systemctl restart sends SIGTERM — the script exits here.
  # The new updater process picks up from a clean state.
fi
```

### Systemd Unit: `just-ship-updater.service`

- `Type=simple`, `Restart=always`
- Runs as `claude-dev` user (needs docker group membership)
- Installed automatically by `setup-vps.sh`

## 7. Drain Mechanism

### New Pipeline-Server Endpoints

**`POST /api/drain`** — Authenticated with `X-Pipeline-Key` (same as other mutating endpoints).

Server state machine:

```
normal → draining → drained
```

**In `draining` mode:**
- `POST /api/launch` and `/api/events` respond `503 Service Unavailable` + `Retry-After: 60`
- Running pipeline runs continue to completion — they are NOT interrupted

**Health endpoint contract change (`GET /health`):**

The existing `/health` response is extended with drain-related fields. Existing fields remain for backward compatibility:

```typescript
// Normal mode (backward-compatible with existing shape)
{ status: "ok", running: { ticket_number, project, started_at } | null, drain: { state: "normal" } }

// Draining mode
{ status: "ok", running: { ... } | null, drain: { state: "draining", running_count: 2 } }

// Drained mode
{ status: "ok", running: null, drain: { state: "drained", running_count: 0 } }
```

The `drain` field is additive — existing consumers that don't check it continue to work. The Update-Agent checks `drain.state === "drained"`. The `connect-project.sh` verification checks `status === "ok"` which remains unchanged.

**Drain flow:**
1. Update-Agent calls `POST /api/drain` (with `X-Pipeline-Key` auth)
2. Server sets state to `draining`, responds `202 Accepted`
3. Update-Agent polls `GET /health` every 10s, checks `drain.state`
4. When `drain.state === "drained"` → proceed
5. Update-Agent stops the container

**Timeout handling:**
- Default drain timeout: 30 minutes (independent of individual pipeline run timeouts)
- If a run started just before drain began, the drain waits for it to complete naturally or hit its own run timeout — whichever comes first
- After drain timeout: Update-Agent sends `POST /api/force-drain`. Server marks remaining running runs as `failed` with reason `"interrupted_by_update"` so they can be re-queued automatically
- Then force-drain: `drained: true` regardless of run status

**Edge cases:**
- **Race condition on drain**: A run starts just as drain is set → mutex/lock around state transition ensures atomicity
- **Paused runs (human-in-the-loop)**: Paused runs do NOT count as running — their session state lives in the Board and can be resumed after the update
- **No running runs**: Drain is immediately `drained`, no waiting

**After update:**
- New container starts in `normal` mode (drain state is in-memory, so a fresh process always starts as `normal`)
- Board can dispatch new runs immediately
- Runs interrupted by force-drain are re-queued by the Board automatically

**Caddy downtime window:**
Between container stop and new container ready, Caddy returns 502 for a few seconds. Mitigations:
- The Board must NOT dispatch new runs to a VPS with `status=updating` — check `vps_instances.status` before calling `/api/launch`
- Caddy is configured with `fail_duration 10s` and `lb_try_duration 5s` to absorb brief unavailability for health-check probes
- The Update-Agent waits for a successful health-check (step 7) before reporting back to the Board, so the Board only resumes dispatching after the VPS is confirmed healthy

## 8. Manual Trigger & CLI

### Board UI

Button in VPS dashboard: "Start Update"
- Creates rollout with `trigger: manual`
- Same canary → rest logic as webhook
- User can select target version (default: latest `main`)

### CLI

Extension of existing `just-ship-vps` Claude Code skill (slash command, not a standalone CLI binary):

```bash
just-ship update-vps                    # All VPS to latest main
just-ship update-vps --version abc1234  # Specific SHA
just-ship update-vps --vps vps-01       # Only a specific VPS
just-ship update-vps --skip-canary      # All at once (for hotfixes)
```

Internally calls `POST /api/rollouts` on the Board — identical flow.

### Rollback

For cases where auto-rollback didn't trigger (e.g. health-check passed but app behaves incorrectly):

```bash
just-ship rollback-vps                  # All VPS to previous version
just-ship rollback-vps --vps vps-01     # Only a specific one
```

Creates a rollout targeting the `previous_version` from `rollout_results`.

## 9. Security

### Authentication

| Connection | Auth Method |
|---|---|
| GitHub → Board | GitHub Webhook Secret (HMAC-SHA256 signature verification) |
| Board → VPS (`/api/update`) | `X-Update-Secret` header — per-VPS secret stored in `vps_instances.update_secret` |
| VPS → Board (callback) | `X-Pipeline-Key` header — existing workspace API key |

### Secrets Storage

- `update_secret` per VPS is generated during VPS registration and stored in both `vps_instances` table and `server-config.json` on the VPS
- No secrets in code or git — all secrets in Supabase or on-disk config files

## 10. Error Scenarios

| Scenario | Reaction |
|---|---|
| `git fetch` fails (network) | Report `failed` immediately, no state change |
| `docker build` fails | Report `failed`, old code stays, container keeps running |
| Health-check fails after switch | Auto-rollback to old image + old git SHA |
| Drain timeout (30min) | Mark running runs as `interrupted_by_update`, force-drain, continue update |
| `setup.sh --update` fails for one project | VPS reports `success` with `project_results: [{slug, status: "failed", error}]` — VPS is healthy, single project has an issue. Project updates are forward-only (no per-project rollback). Failed projects are flagged in the Board for manual resolution or re-queue. |
| VPS doesn't respond to `/api/update` | Board timeout (5min), marks VPS as `unhealthy`, rollout continues for other VPS |
| Canary fails | Rollout stays at `failed`, remaining VPS are NOT touched |
| Update-Agent crashes mid-update | systemd restarts it, lock file present → detect interrupted update → rollback to old image, report `failed` |
| Second push to `main` during rollout | Board rejects new rollout (`409 Conflict`) |

### No Single Point of Failure

- **Board down** → VPS instances continue running current version, no update, no damage
- **One VPS down** → Rollout marks it as `unhealthy`, other VPS are still updated
- **GitHub down** → Manual trigger via Board UI or CLI still works

## 11. Installation & Setup

The Update-Agent is installed automatically during VPS setup. The user does not interact with it directly.

**Note:** `setup-vps.sh` is currently marked as deprecated in favor of Docker-based setup. This spec requires reviving `setup-vps.sh` (or creating a new `vps/install-updater.sh`) to handle the host-level systemd agent that must live *outside* Docker. The `/just-ship-vps` skill will call this script during initial VPS provisioning.

**What the VPS setup script adds:**
1. Copies `vps/just-ship-updater.sh` to `/usr/local/bin/`
2. Installs `just-ship-updater.service` systemd unit
3. Enables and starts the service
4. Generates `update_secret` and stores it in `server-config.json`

**What `connect-project.sh` adds:**
- Registers the VPS in the Board (`POST /api/vps`) if not already registered
- Sends `update_secret` and `endpoint_url` to the Board
- Requires `--board-url` and `--board-api-key` flags (become mandatory with this spec, previously optional)

## 12. Affected Files

### New files (just-ship repo)
- `vps/just-ship-updater.sh` — Update-Agent script
- `vps/just-ship-updater.service` — systemd unit
- `pipeline/lib/drain.ts` — Drain state machine for pipeline-server

### New files (just-ship repo, continued)
- `vps/install-updater.sh` — Host-level Update-Agent installer (extracted from deprecated `setup-vps.sh`)

### Modified files (just-ship repo)
- `pipeline/server.ts` — Add `/api/update` (trigger file writer), `/api/drain`, `/api/force-drain`, extend `/health` with drain status
- `vps/connect-project.sh` — Register VPS in Board on connect (Board flags become mandatory)
- `vps/docker-compose.yml` — Add writable trigger volume mount

### New files (just-ship-board repo)
- `src/app/api/webhooks/github/route.ts` — GitHub webhook handler
- `src/app/api/vps/route.ts` — VPS CRUD
- `src/app/api/vps/[id]/route.ts` — VPS update
- `src/app/api/rollouts/route.ts` — Rollout creation
- `src/app/api/rollouts/[id]/route.ts` — Rollout status
- `src/app/api/rollouts/[id]/results/route.ts` — VPS result callback
- Supabase migration for `vps_instances`, `rollouts`, `rollout_results` tables

### Modified files (just-ship-board repo)
- VPS dashboard UI (existing settings area) — rollout status, VPS list
