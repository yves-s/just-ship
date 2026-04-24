# VPS Infrastructure

Autonomous development environment on a VPS. The Board triggers pipelines via HTTP, the VPS runs Claude Code pipelines and creates PRs.

## Architecture

```
Board: "Develop" button click
    │
    │  POST https://pipeline.domain.com/api/launch
    │  X-Pipeline-Key: <secret>
    │  { ticket_number: 267, project_id: "uuid" }
    │
    ▼
Caddy (HTTPS, Let's Encrypt)
    │
    ▼
Docker: pipeline-server (Node.js, pre-built GHCR image)
    │
    │  Auth → project lookup → pipeline
    │
    ▼
GitHub PR → ticket status "in_review"
```

## Setup

Use the `/just-ship-vps` command in Claude Code. It handles everything:

1. Installs Docker on the VPS
2. Creates the `claude-dev` user
3. Pulls the pre-built Docker image from GHCR
4. Configures Caddy for HTTPS
5. Starts the pipeline server

### Prerequisites

| # | What | How |
|---|------|-----|
| 1 | VPS IP | Hostinger Dashboard → VPS → copy IP |
| 2 | SSH key auth | `ssh-copy-id root@<IP>` |
| 3 | GitHub Auth | **Option A:** PAT — https://github.com/settings/tokens/new → scopes: `repo` + `workflow`. **Option B:** GitHub App — register app with `contents:write`, `pull_requests:write`, `metadata:read` permissions, set `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY_PATH` env vars |

### Provisioning New Pipeline Instances

Provision an isolated pipeline instance for a customer on an existing VPS:

```bash
bash scripts/provision-pipeline.sh \
  --name kunde-xyz \
  --domain kunde-xyz.pipeline.just-ship.io \
  --vps 187.124.9.221
```

Each instance gets its own Docker Compose stack (pipeline-server + Bugsink + Dozzle), unique port range, and pipeline key. The shared Caddy instance routes the domain to the new stack.

**Prerequisites:** DNS A-record for the domain must point to the VPS IP before running the script. The VPS must have the base stack (Caddy + global `.env`) already running.

**Optional flags:**
- `--ssh-key <path>` — SSH key path (default: `~/.ssh/id_rsa`)
- `--image-tag <tag>` — Docker image tag (default: `latest`)

### Connecting Projects

After VPS setup (or instance provisioning), connect individual projects. The command copies local env vars, clones the repo, and registers the project in the server config.

## Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Docker image: Node.js 20, git, gh, Claude Code, pipeline SDK, framework files |
| `entrypoint.sh` | Container startup: configures git identity, gh auth, validates project configs |
| `Caddyfile` | Caddy reverse proxy config: security headers, basicauth for monitoring, auto-TLS |
| `docker-compose.yml` | Caddy (HTTPS) + pipeline-server (GHCR image) + Bugsink + Dozzle containers |
| `just-ship-updater.sh` | Update-Agent: watches for triggers, orchestrates zero-downtime updates, syncs project.json from git |
| `just-ship-updater.service` | systemd unit for Update-Agent (runs on host, outside Docker) |
| `install-updater.sh` | Installs Update-Agent on a VPS host |
| `logs.sh` | Fetch Docker container logs from VPS via SSH (list containers, tail logs, follow mode) |
| `pipeline-container-monitor.sh` | Health monitoring for pipeline containers: cron-based checks, Telegram alerts, auto-restart |
| `install-monitor.sh` | Install pipeline container monitor on VPS via SSH (copies script, installs cron + logrotate) |
| `pipeline-containers.example.json` | Example config for container monitor (name, domain, health_url per container) |
| `setup-vps.sh` | **DEPRECATED** — legacy bare-metal setup script (Docker is the supported path) |
| `just-ship-server@.service` | **DEPRECATED** — legacy systemd unit for HTTP server (bare-metal installs only) |
| `just-ship-bot.service` | Telegram bot systemd unit (separate service) |

> **Removed:** `just-ship-pipeline@.service` (polling worker) and `pipeline/worker.ts` were deleted in T-993. All autonomous runs are now Board-triggered via `POST /api/launch`. Older VPS installs are cleaned up by `setup-vps.sh` on next run.

## Server Endpoints

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| `POST` | `/api/launch` | Yes | 10/min per project | Trigger pipeline for a ticket |
| `POST` | `/api/events` | Yes | 100/min per project | Board event handler (filters to "launch") |
| `POST` | `/api/answer` | Yes | 30/min per ticket | Resume paused pipeline with human answer |
| `POST` | `/api/ship` | Yes | 10/min per project | Merge PR for a ticket |
| `POST` | `/api/update` | `X-Update-Secret` | — | Receive update trigger from Board |
| `POST` | `/api/drain` | Yes | — | Start graceful drain for updates |
| `POST` | `/api/force-drain` | Yes | — | Force immediate drain |
| `GET` | `/health` | No | — | Server status (includes `drain` field) |
| `GET` | `/api/status/:ticket` | No | — | Pipeline status for a ticket |

Rate limits use in-memory sliding window counters. Exceeded limits return HTTP 429 with `Retry-After` header. State resets on server restart.

Auth = `X-Pipeline-Key` header matching `server.pipeline_key` in server-config.json.
`X-Update-Secret` = per-VPS secret matching `server.update_secret` in server-config.json.

## Server Config

Located at `/home/claude-dev/.just-ship/server-config.json`:

```json
{
  "server": { "port": 3001, "pipeline_key": "<secret>", "update_secret": "<per-vps-secret>" },
  "workspace": {
    "workspace_id": "<uuid>",
    "board_url": "https://board.just-ship.io",
    "api_key": "<workspace-api-key>"
  },
  "projects": {
    "my-project": {
      "project_id": "<uuid>",
      "repo_url": "https://github.com/org/repo.git",
      "project_dir": "/home/claude-dev/projects/my-project",
      "env_file": "/home/claude-dev/.just-ship/env.my-project"
    }
  }
}
```

## Monitoring

Built-in error tracking and live log visibility via two lightweight containers:

| Service | Path | Purpose | RAM |
|---------|------|---------|-----|
| Bugsink | `/errors/` | Error tracking with stack traces (Sentry-compatible) | ~256 MB |
| Dozzle | `/logs/` | Live Docker container log viewer | ~30 MB |

Both UIs are protected by Caddy basicauth. The pipeline-server and worker automatically report errors to Bugsink via the `@sentry/node` SDK (configured through `BUGSINK_DSN` environment variable).

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `BUGSINK_SECRET_KEY` | *(auto-generated)* | Django secret key for Bugsink |
| `BUGSINK_ADMIN_EMAIL` | `admin@localhost` | Bugsink admin email |
| `BUGSINK_ADMIN_PASSWORD` | *(auto-generated)* | Bugsink admin password (see `.env` on VPS) |
| `CADDY_DOMAIN` | `:80` | Domain for Caddy auto-TLS (e.g. `pipeline.example.com`). Without it, Caddy serves HTTP only |
| `MONITORING_USER` | `admin` | Caddy basicauth username for `/errors/` and `/logs/` |
| `MONITORING_HASH` | *(required)* | Caddy basicauth password hash (generate with `caddy hash-password`) |

## HTTPS Setup

The `vps/Caddyfile` is deployed automatically with `docker-compose.yml`. By default, Caddy listens on `:80` (HTTP only). To enable auto-TLS:

1. Create DNS A-Record: `pipeline.yourdomain.com` → VPS IP
2. Set `CADDY_DOMAIN` in `/home/claude-dev/.env`:
   ```bash
   CADDY_DOMAIN=pipeline.yourdomain.com
   ```
3. Restart: `docker compose -f vps/docker-compose.yml up -d caddy`
4. Caddy automatically provisions a Let's Encrypt certificate

### Security Headers

The Caddyfile sets the following headers on all responses:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `Server` header stripped

### Monitoring Access

Dozzle (`/logs/`) and Bugsink (`/errors/`) are protected by basicauth. Generate the password hash and set it in `.env`:

```bash
# Generate hash (run inside the Caddy container or locally)
docker exec -it caddy caddy hash-password --plaintext 'your-password'

# Add to .env
MONITORING_USER=admin
MONITORING_HASH='$2a$14$...'  # output from caddy hash-password
```

## CLI Logs

Fetch container logs from the VPS without opening an SSH session manually:

```bash
# List all running containers
bash vps/logs.sh --host <IP>

# Show last 100 lines of a container
bash vps/logs.sh --host <IP> pipeline

# Show last 50 lines
bash vps/logs.sh --host <IP> pipeline -n 50

# Live tail (follow mode, Ctrl+C to stop)
bash vps/logs.sh --host <IP> pipeline -f
```

Requires SSH key auth to `root@<IP>` (same as all other VPS scripts).

## Container Monitoring

Health monitoring for pipeline containers with Telegram alerts and auto-restart. Install on the Pipeline-VPS:

```bash
bash vps/install-monitor.sh --vps 187.124.9.221
```

This installs a cron job that runs every minute and:
1. Reads container config from `/root/pipeline-containers.json`
2. HTTP health-checks each container's `/health` endpoint (5s timeout)
3. After 3 consecutive failures: sends Telegram alert + attempts `docker restart` (max 3 times with backoff)
4. Sends recovery notification when container comes back online

### Container Config

Edit `/root/pipeline-containers.json` on the VPS:

```json
[
  {
    "name": "pipeline-aime",
    "domain": "aime.pipeline.just-ship.io",
    "health_url": "https://aime.pipeline.just-ship.io/health"
  }
]
```

If the config file is empty or missing, the monitor falls back to discovering Docker containers with the `pipeline=true` label.

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token (same as hosting monitoring) |
| `TELEGRAM_OPERATOR_CHAT_ID` | Yes | Chat ID for alert messages |

Set in `/root/.env` on the VPS. The monitor sources this file automatically.

### Log File

`/var/log/pipeline-container-monitor.log` — rotated daily, 7-day retention (logrotate installed by `install-monitor.sh`).

## Update

Updates are orchestrated by the Board via the Update-Agent (see design spec: `docs/superpowers/specs/2026-03-30-vps-update-process-design.md`).

**Automatic:** Push to `main` → GitHub Actions builds image → pushes to GHCR → Board triggers canary rollout → Update-Agent handles docker pull, drain, switch, health-check, and project updates.

**Manual (emergency):**
```bash
ssh root@<IP> "docker pull ghcr.io/yves-s/just-ship/pipeline:latest && cd /home/claude-dev/just-ship && CLAUDE_UID=\$(id -u claude-dev) CLAUDE_GID=\$(id -g claude-dev) docker compose -f vps/docker-compose.yml up -d pipeline-server"
```

### Update-Agent

The Update-Agent runs as a systemd service on the host (outside Docker). Install via:
```bash
sudo bash vps/install-updater.sh
```

It watches `/home/claude-dev/.just-ship/triggers/update-trigger.json` for update signals from the pipeline-server container and orchestrates: docker pull → drain → switch → health-check → rollback on failure. No git operations needed — images are pre-built in CI.
