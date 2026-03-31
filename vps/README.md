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
| 3 | GitHub Token | https://github.com/settings/tokens/new → scopes: `repo` + `workflow` |

### Connecting Projects

After VPS setup, connect individual projects. The command copies local env vars, clones the repo, and registers the project in the server config.

## Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Docker image: Node.js 20, git, gh, Claude Code, pipeline SDK, framework files |
| `entrypoint.sh` | Container startup: configures git identity and gh auth |
| `docker-compose.yml` | Caddy (HTTPS) + pipeline-server (GHCR image) + Bugsink + Dozzle containers |
| `just-ship-updater.sh` | Update-Agent: watches for triggers, orchestrates zero-downtime updates |
| `just-ship-updater.service` | systemd unit for Update-Agent (runs on host, outside Docker) |
| `install-updater.sh` | Installs Update-Agent on a VPS host |
| `setup-vps.sh` | **DEPRECATED** — legacy bare-metal setup script |
| `just-ship-pipeline@.service` | **DEPRECATED** — legacy systemd unit for polling worker |
| `just-ship-server@.service` | **DEPRECATED** — legacy systemd unit for HTTP server |
| `just-ship-bot.service` | Telegram bot systemd unit (separate service) |

## Server Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/launch` | Yes | Trigger pipeline for a ticket |
| `POST` | `/api/events` | Yes | Board event handler (filters to "launch") |
| `POST` | `/api/answer` | Yes | Resume paused pipeline with human answer |
| `POST` | `/api/ship` | Yes | Merge PR for a ticket |
| `POST` | `/api/update` | `X-Update-Secret` | Receive update trigger from Board |
| `POST` | `/api/drain` | Yes | Start graceful drain for updates |
| `POST` | `/api/force-drain` | Yes | Force immediate drain |
| `GET` | `/health` | No | Server status (includes `drain` field) |
| `GET` | `/api/status/:ticket` | No | Pipeline status for a ticket |

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
| `BUGSINK_SECRET_KEY` | `changeme-generate-a-real-key` | Django secret key for Bugsink |
| `BUGSINK_ADMIN_EMAIL` | `admin@localhost` | Bugsink admin email |
| `BUGSINK_ADMIN_PASSWORD` | `admin` | Bugsink admin password (change on first login) |
| `MONITORING_USER` | `admin` | Caddy basicauth username for `/errors/` and `/logs/` |
| `MONITORING_HASH` | — | Caddy basicauth password hash (generate with `caddy hash-password`) |

## HTTPS einrichten (optional)

Der VPS laeuft standardmaessig ohne HTTPS auf `http://IP:3001`. Das funktioniert, weil die Kommunikation Server-to-Server ist (Board-Backend → VPS) — kein Browser involviert.

**Wann HTTPS sinnvoll ist:**

- Wenn der API Key (`X-Pipeline-Key`) nicht im Klartext ueber das Internet gesendet werden soll
- Wenn der VPS auch von Browsern direkt erreichbar sein soll
- In Umgebungen mit hoeheren Sicherheitsanforderungen

**Wie:**

1. Subdomain anlegen: `just-ship.deinedomain.de` → DNS A-Record auf VPS-IP
2. Caddyfile erstellen:
   ```
   just-ship.deinedomain.de {
       reverse_proxy pipeline-server:3001
   }
   ```
3. `docker-compose.yml` nutzt bereits einen Caddy-Service — nur den Caddy-Container aktivieren und das Caddyfile ablegen
4. Caddy holt sich automatisch ein Let's Encrypt Zertifikat

**Ohne HTTPS** ist das Risiko gering: Jemand muesste gezielt den Netzwerkpfad zwischen dem Board-Server und dem VPS abhoeren, um den 64-Zeichen API Key abzufangen. Fuer ein persoenliches Dev-Setup ist das vertretbar.

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
