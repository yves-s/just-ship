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
Docker: pipeline-server (Node.js)
    │
    │  Auth → project lookup → git pull → pipeline
    │
    ▼
GitHub PR → ticket status "in_review"
```

## Setup

Use the `/just-ship-vps` command in Claude Code. It handles everything:

1. Installs Docker on the VPS
2. Creates the `claude-dev` user
3. Clones just-ship and builds the Docker image
4. Configures Caddy for HTTPS
5. Starts the pipeline server

### Prerequisites

| # | What | How |
|---|------|-----|
| 1 | VPS IP | Hostinger Dashboard → VPS → copy IP |
| 2 | SSH key auth | `ssh-copy-id root@<IP>` |
| 3 | GitHub Token | github.com → Settings → Developer Settings → PAT (classic) → scopes: `repo` + `workflow` |
| 4 | Subdomain + A-Record | DNS A-Record pointing to VPS IP |

### Connecting Projects

After VPS setup, connect individual projects. The command copies local env vars, clones the repo, and registers the project in the server config.

## Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Docker image: Node.js 20, git, gh, Claude Code, pipeline SDK |
| `entrypoint.sh` | Container startup: configures git identity and gh auth |
| `docker-compose.yml` | Caddy (HTTPS) + pipeline-server containers |
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
| `GET` | `/health` | No | Server status |
| `GET` | `/api/status/:ticket` | No | Pipeline status for a ticket |

Auth = `X-Pipeline-Key` header matching `server.pipeline_key` in server-config.json.

## Server Config

Located at `/home/claude-dev/.just-ship/server-config.json`:

```json
{
  "server": { "port": 3001, "pipeline_key": "<secret>" },
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
      "env_file": "/home/claude-dev/.env.my-project"
    }
  }
}
```

## Update

```bash
ssh root@<IP> "cd /home/claude-dev/just-ship && git pull && docker compose -f vps/docker-compose.yml build --no-cache && docker compose -f vps/docker-compose.yml up -d"
```
