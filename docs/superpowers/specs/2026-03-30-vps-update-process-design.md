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
│  1. git fetch + checkout {sha}       │
│  2. docker build (new image)         │
│     Old container still running      │
│  3. Report: build_complete           │
│  4. Drain pipeline-server            │
│     (block new runs, wait for        │
│      running ones to finish)         │
│  5. docker compose up (new image)    │
│  6. Health-check (3x, 10s interval)  │
│  7a. Healthy:                        │
│      setup.sh --update per project   │
│      Report: success                 │
│  7b. Unhealthy:                      │
│      Rollback to old image           │
│      Report: failed                  │
│  8. Self-update if updater changed   │
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
| `is_canary` | boolean | Updated first in rollouts |
| `last_health_check` | timestamptz | |
| `created_at` | timestamptz | |

### Table: `rollouts`

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `target_version` | text | Git SHA |
| `trigger` | enum | `webhook`, `manual` |
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
| `project_results` | jsonb | `[{slug, status, error?}]` per project |
| `previous_version` | text | For rollback |
| `error` | text | Failure reason |
| `started_at` | timestamptz | |
| `completed_at` | timestamptz | |

All three tables live in the **Pipeline-DB (`wsmnutkobalfrceavpxs`)**.

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

The pipeline server runs *inside* Docker and cannot replace its own container. Solution: the `/api/update` endpoint writes a trigger file to a shared volume:

```json
// /home/claude-dev/.just-ship/update-trigger.json
{
  "version": "abc1234",
  "rollout_id": "uuid",
  "callback_url": "https://board.just-ship.io/api/rollouts/{id}/results",
  "triggered_at": "2026-03-30T..."
}
```

The Update-Agent watches this file (5s poll loop) and starts the update process.

### Update Sequence

```bash
# 1. Lock — only one update at a time
flock /tmp/just-ship-update.lock

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

# 7. Health-check (3 attempts, 10s apart)
for i in 1 2 3; do
  curl -sf http://localhost:3001/health && break
  sleep 10
done

# 8a. Healthy → update projects
if healthy; then
  for project_dir in /home/claude-dev/projects/*/; do
    bash /home/claude-dev/just-ship/setup.sh --update --project "$project_dir"
    # Collect per-project result
  done
  # Callback to Board: success + project_results

# 8b. Unhealthy → rollback
else
  git -C /home/claude-dev/just-ship checkout $CURRENT_SHA
  docker compose -f vps/docker-compose.yml up -d pipeline-server
  # Callback to Board: failed + reason
fi

# 9. Self-update: reload updater if changed
if [ "$(md5sum /usr/local/bin/just-ship-updater.sh)" != \
     "$(md5sum /home/claude-dev/just-ship/vps/just-ship-updater.sh)" ]; then
  cp /home/claude-dev/just-ship/vps/just-ship-updater.sh /usr/local/bin/
  systemctl restart just-ship-updater
fi
```

### Systemd Unit: `just-ship-updater.service`

- `Type=simple`, `Restart=always`
- Runs as `claude-dev` user (needs docker group membership)
- Installed automatically by `setup-vps.sh`

## 7. Drain Mechanism

### New Pipeline-Server Endpoint: `POST /api/drain`

Server state machine:

```
normal → draining → drained
```

**In `draining` mode:**
- `POST /api/launch` and `/api/events` respond `503 Service Unavailable` + `Retry-After: 60`
- Running pipeline runs continue to completion — they are NOT interrupted
- `GET /health` responds `200` with `{"status": "draining", "running": 2}`

**Drain flow:**
1. Update-Agent calls `POST /api/drain`
2. Server sets state to `draining`, responds `202 Accepted`
3. Update-Agent polls `GET /health` every 10s
4. When `running: 0` → server reports `drained: true`
5. Update-Agent stops the container

**Timeout handling:**
- Default: 30 minutes
- After timeout: server marks running runs as `failed` in Board with reason `"interrupted_by_update"` so they can be re-queued automatically
- Then force-drain: `drained: true` regardless of run status

**Edge cases:**
- **Race condition on drain**: A run starts just as drain is set → mutex/lock around state transition ensures atomicity
- **Paused runs (human-in-the-loop)**: Paused runs do NOT count as running — their session state lives in the Board and can be resumed after the update
- **No running runs**: Drain is immediately `drained`, no waiting

**After update:**
- New container starts in `normal` mode
- Board can dispatch new runs immediately
- Runs interrupted by force-drain are re-queued by the Board automatically

## 8. Manual Trigger & CLI

### Board UI

Button in VPS dashboard: "Start Update"
- Creates rollout with `trigger: manual`
- Same canary → rest logic as webhook
- User can select target version (default: latest `main`)

### CLI

Extension of existing `just-ship-vps` skill:

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
| `setup.sh --update` fails for one project | VPS reports `success` with `project_results: [{slug, status: "failed", error}]` — VPS is healthy, single project has an issue |
| VPS doesn't respond to `/api/update` | Board timeout (5min), marks VPS as `unhealthy`, rollout continues for other VPS |
| Canary fails | Rollout stays at `failed`, remaining VPS are NOT touched |
| Update-Agent crashes mid-update | systemd restarts it, lock file present → detect interrupted update → rollback to old image, report `failed` |
| Second push to `main` during rollout | Board rejects new rollout (`409 Conflict`) |

### No Single Point of Failure

- **Board down** → VPS instances continue running current version, no update, no damage
- **One VPS down** → Rollout marks it as `unhealthy`, other VPS are still updated
- **GitHub down** → Manual trigger via Board UI or CLI still works

## 11. Installation & Setup

The Update-Agent is installed automatically during `setup-vps.sh`. The user does not interact with it directly.

**What `setup-vps.sh` adds:**
1. Copies `vps/just-ship-updater.sh` to `/usr/local/bin/`
2. Installs `just-ship-updater.service` systemd unit
3. Enables and starts the service
4. Generates `update_secret` and stores it in `server-config.json`

**What `connect-project.sh` adds:**
- Registers the VPS in the Board (`POST /api/vps`) if not already registered
- Sends `update_secret` and `endpoint_url` to the Board

## 12. Affected Files

### New files (just-ship repo)
- `vps/just-ship-updater.sh` — Update-Agent script
- `vps/just-ship-updater.service` — systemd unit
- `pipeline/lib/drain.ts` — Drain state machine for pipeline-server

### Modified files (just-ship repo)
- `pipeline/server.ts` — Add `/api/update` (trigger file writer), `/api/drain`, extend `/health` with drain status
- `vps/setup-vps.sh` — Install Update-Agent
- `vps/connect-project.sh` — Register VPS in Board on connect
- `vps/docker-compose.yml` — Mount trigger file volume

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
