#!/bin/bash
# ============================================================
# provision-pipeline.sh — New pipeline instance on VPS
#
# Runs LOCALLY, provisions via SSH. Each customer gets their
# own isolated pipeline-server + bugsink + dozzle stack.
# Shares the single Caddy instance already on the VPS.
#
# Usage:
#   bash scripts/provision-pipeline.sh \
#     --name kunde-xyz \
#     --domain kunde-xyz.pipeline.just-ship.io \
#     --vps 187.124.9.221
#
# Optional:
#   --ssh-key <path>     SSH key path (default: ~/.ssh/id_rsa)
#   --image-tag <tag>    Docker image tag (default: latest)
# ============================================================

set -euo pipefail

# --- Colors ---
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YELLOW}  ~${NC} $*"; }
fail() { echo -e "${RED}  ✗${NC} $*" >&2; exit 1; }
h()    { echo -e "\n${YELLOW}▶ $*${NC}"; }
info() { echo -e "${BLUE}  →${NC} $*"; }

# --- Parse arguments ---
NAME=""
DOMAIN=""
VPS=""
SSH_KEY="${HOME}/.ssh/id_rsa"
IMAGE_TAG="latest"

while [[ $# -gt 0 ]]; do
  case $1 in
    --name)      NAME="$2";      shift 2 ;;
    --domain)    DOMAIN="$2";    shift 2 ;;
    --vps)       VPS="$2";       shift 2 ;;
    --ssh-key)   SSH_KEY="$2";   shift 2 ;;
    --image-tag) IMAGE_TAG="$2"; shift 2 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

# --- Required parameter checks ---
[[ -z "$NAME" ]]   && fail "Missing --name"
[[ -z "$DOMAIN" ]] && fail "Missing --domain"
[[ -z "$VPS" ]]    && fail "Missing --vps"

# --- Validate name format ---
if ! [[ "$NAME" =~ ^[a-z0-9-]+$ ]]; then
  fail "--name must match [a-z0-9-]+ (got: $NAME)"
fi

# --- SSH helper ---
SSH_OPTS="-o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
if [[ -f "$SSH_KEY" ]]; then
  SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
fi
ssh_run() { ssh $SSH_OPTS "root@$VPS" "$@"; }

# --- Paths ---
INSTANCE_DIR="/home/claude-dev/pipelines/${NAME}"
CADDY_FILE="/home/claude-dev/just-ship/vps/Caddyfile"
CADDY_BACKUP="/home/claude-dev/just-ship/vps/Caddyfile.bak.$$"

# --- Rollback state tracking ---
CADDY_MODIFIED=0
INSTANCE_CREATED=0
CONTAINERS_STARTED=0

# ============================================================
# TRAP-BASED ROLLBACK
# ============================================================

rollback() {
  local exit_code=$?
  if [[ $exit_code -eq 0 ]]; then return; fi

  echo ""
  echo -e "${RED}  ! Provisioning failed — rolling back...${NC}"

  if [[ $CONTAINERS_STARTED -eq 1 ]]; then
    warn "Stopping containers for ${NAME}..."
    ssh_run "cd ${INSTANCE_DIR} && docker compose down --remove-orphans 2>/dev/null || true" 2>/dev/null || true
    ok "Containers stopped"
  fi

  if [[ $CADDY_MODIFIED -eq 1 ]]; then
    warn "Restoring Caddyfile from backup..."
    ssh_run "cp ${CADDY_BACKUP} ${CADDY_FILE} && docker exec \$(docker ps -q --filter name=caddy --filter status=running) caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || true" 2>/dev/null || true
    ok "Caddyfile restored"
  fi

  if [[ $INSTANCE_CREATED -eq 1 ]]; then
    warn "Removing instance directory ${INSTANCE_DIR}..."
    ssh_run "rm -rf ${INSTANCE_DIR}" 2>/dev/null || true
    ok "Instance directory removed"
  fi

  echo -e "${RED}  Rollback complete. No resources were left behind.${NC}"
}

trap rollback EXIT

# ============================================================
# HEADER
# ============================================================

echo ""
echo "================================================"
echo "  Just Ship — Provision Pipeline Instance"
echo "  VPS:    $VPS"
echo "  Name:   $NAME"
echo "  Domain: $DOMAIN"
echo "  Tag:    $IMAGE_TAG"
echo "================================================"

# ============================================================
# PRE-FLIGHT CHECKS
# ============================================================

h "Pre-Flight Checks"

# SSH reachable?
ssh_run "echo ok" >/dev/null 2>&1 \
  || fail "SSH to root@${VPS} failed. Run: ssh-copy-id -i ${SSH_KEY} root@${VPS}"
ok "SSH reachable"

# Docker installed?
ssh_run "docker --version" >/dev/null 2>&1 \
  || fail "Docker not installed on VPS"
ok "Docker: $(ssh_run 'docker --version' 2>/dev/null | awk '{print $3}' | tr -d ',')"

# Caddy running?
ssh_run "docker ps --filter name=caddy --filter status=running -q | grep -q ." >/dev/null 2>&1 \
  || fail "Caddy is not running on the VPS. Start the base stack first."
ok "Caddy running"

# Global .env present with required keys?
ssh_run "test -f /home/claude-dev/.env" \
  || fail "Global /home/claude-dev/.env not found on VPS"
ssh_run "grep -q '^ANTHROPIC_API_KEY=.\+' /home/claude-dev/.env" \
  || fail "ANTHROPIC_API_KEY missing or empty in /home/claude-dev/.env"
ssh_run "grep -q '^GH_TOKEN=.\+' /home/claude-dev/.env" \
  || fail "GH_TOKEN missing or empty in /home/claude-dev/.env"
ok "Global .env has required keys"

# Name not already in use?
if ssh_run "test -d ${INSTANCE_DIR}" 2>/dev/null; then
  fail "Instance '${NAME}' already exists at ${INSTANCE_DIR}. Use a different name or remove it first."
fi
ok "Name '${NAME}' is available"

# Domain not already in Caddyfile?
if ssh_run "grep -q '${DOMAIN}' ${CADDY_FILE}" 2>/dev/null; then
  fail "Domain '${DOMAIN}' already exists in Caddyfile. Remove it first or use a different domain."
fi
ok "Domain '${DOMAIN}' is available"

# Resource check: at least 2GB free RAM
FREE_RAM_KB=$(ssh_run "awk '/MemAvailable/ {print \$2}' /proc/meminfo")
FREE_RAM_MB=$((FREE_RAM_KB / 1024))
if [[ $FREE_RAM_MB -lt 2048 ]]; then
  fail "Insufficient free RAM: ${FREE_RAM_MB}MB available, 2048MB required"
fi
ok "Free RAM: ${FREE_RAM_MB}MB"

# Resource check: at least 5GB free disk
FREE_DISK_KB=$(ssh_run "df /home/claude-dev --output=avail | tail -1 | tr -d ' '")
FREE_DISK_MB=$((FREE_DISK_KB / 1024))
if [[ $FREE_DISK_MB -lt 5120 ]]; then
  fail "Insufficient free disk: ${FREE_DISK_MB}MB available, 5120MB required"
fi
ok "Free disk: ${FREE_DISK_MB}MB"

# ============================================================
# PORT ALLOCATION
# ============================================================

h "Port Allocation"

# Find all host ports already bound by Docker containers
# Server ports start at 4000 and increment by 10
USED_PORTS=$(ssh_run "docker ps --format '{{.Ports}}' | grep -oE '0\.0\.0\.0:[0-9]+' | awk -F: '{print \$2}' | sort -n" 2>/dev/null || echo "")

SERVER_PORT=4000
while true; do
  DOZZLE_PORT=$((SERVER_PORT + 1))
  BUGSINK_PORT=$((SERVER_PORT + 2))

  # Check all three ports in the range are free
  PORT_CONFLICT=0
  for PORT in $SERVER_PORT $DOZZLE_PORT $BUGSINK_PORT; do
    if echo "$USED_PORTS" | grep -qx "$PORT"; then
      PORT_CONFLICT=1
      break
    fi
    # Also check if port is actually listening (catches non-Docker processes)
    if ssh_run "ss -tlnp | grep -q ':${PORT} '" 2>/dev/null; then
      PORT_CONFLICT=1
      break
    fi
  done

  if [[ $PORT_CONFLICT -eq 0 ]]; then
    break
  fi
  SERVER_PORT=$((SERVER_PORT + 10))

  if [[ $SERVER_PORT -gt 9990 ]]; then
    fail "No available port range found between 4000-9990"
  fi
done

ok "Server port:  ${SERVER_PORT}"
ok "Dozzle port:  ${DOZZLE_PORT}"
ok "Bugsink port: ${BUGSINK_PORT}"

# ============================================================
# GENERATE SECRETS
# ============================================================

h "Generating Secrets"

PIPELINE_KEY=$(openssl rand -hex 32)
BUGSINK_SECRET_KEY=$(openssl rand -base64 50 | tr -d '\n')
BUGSINK_ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -d '\n/+=' | head -c 32)
BUGSINK_ADMIN_EMAIL="admin@${NAME}.local"

ok "Pipeline key generated"
ok "Bugsink secrets generated"

# Read monitoring credentials from global .env (shared across all instances)
MONITORING_USER=$(ssh_run "grep '^MONITORING_USER=' /home/claude-dev/.env | cut -d= -f2" 2>/dev/null || echo "admin")
MONITORING_HASH=$(ssh_run "grep '^MONITORING_HASH=' /home/claude-dev/.env | cut -d= -f2" 2>/dev/null || echo "")

if [[ -z "$MONITORING_HASH" ]]; then
  warn "MONITORING_HASH not found in global .env — /errors/ and /logs/ will use empty hash"
  warn "Run: docker run --rm caddy:2 caddy hash-password --plaintext '<password>' and add to /home/claude-dev/.env"
fi
ok "Monitoring credentials read from global .env"

# ============================================================
# CREATE INSTANCE DIRECTORY
# ============================================================

h "Creating Instance Directory"

ssh_run "mkdir -p ${INSTANCE_DIR}/projects ${INSTANCE_DIR}/.just-ship/triggers && chown -R claude-dev:claude-dev /home/claude-dev/pipelines"
INSTANCE_CREATED=1
ok "Directory: ${INSTANCE_DIR}"

# ============================================================
# WRITE .env (composed server-side to avoid leaking secrets locally)
# ============================================================

h "Writing .env"

ssh_run "bash -c '
ANTHROPIC_API_KEY=\$(grep \"^ANTHROPIC_API_KEY=\" /home/claude-dev/.env | cut -d= -f2-)
GH_TOKEN=\$(grep \"^GH_TOKEN=\" /home/claude-dev/.env | cut -d= -f2-)

cat > ${INSTANCE_DIR}/.env <<INNER_EOF
# Just Ship Pipeline — ${NAME}
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)

# --- Global credentials (copied from /home/claude-dev/.env) ---
ANTHROPIC_API_KEY=\${ANTHROPIC_API_KEY}
GH_TOKEN=\${GH_TOKEN}

# --- Bugsink ---
BUGSINK_SECRET_KEY=${BUGSINK_SECRET_KEY}
BUGSINK_ADMIN_EMAIL=${BUGSINK_ADMIN_EMAIL}
BUGSINK_ADMIN_PASSWORD=${BUGSINK_ADMIN_PASSWORD}

# --- Caddy ---
CADDY_DOMAIN=${DOMAIN}

# --- Pipeline ---
PIPELINE_IMAGE_TAG=${IMAGE_TAG}
INNER_EOF

chmod 600 ${INSTANCE_DIR}/.env
chown claude-dev:claude-dev ${INSTANCE_DIR}/.env
'"
ok ".env written (chmod 600, secrets composed server-side)"

# ============================================================
# WRITE server-config.json
# ============================================================

h "Writing server-config.json"

ssh_run "cat > ${INSTANCE_DIR}/.just-ship/server-config.json" <<CFGEOF
{
  "server": {
    "port": 3001,
    "pipeline_key": "${PIPELINE_KEY}"
  },
  "workspace": {},
  "projects": {}
}
CFGEOF

ssh_run "chown -R claude-dev:claude-dev ${INSTANCE_DIR}/.just-ship"
ok "server-config.json written"

# ============================================================
# WRITE docker-compose.yml
# ============================================================

h "Writing docker-compose.yml"

ssh_run "cat > ${INSTANCE_DIR}/docker-compose.yml" <<COMPOSEEOF
# Just Ship Pipeline Instance: ${NAME}
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Ports: server=${SERVER_PORT}, dozzle=${DOZZLE_PORT}, bugsink=${BUGSINK_PORT}

services:
  pipeline-server:
    container_name: pipeline-${NAME}
    image: ghcr.io/yves-s/just-ship/pipeline:\${PIPELINE_IMAGE_TAG:-latest}
    restart: unless-stopped
    user: "\${CLAUDE_UID:-1001}:\${CLAUDE_GID:-1001}"
    ports:
      - "${SERVER_PORT}:3001"
    volumes:
      - ${INSTANCE_DIR}/projects:/home/claude-dev/projects
      - ${INSTANCE_DIR}/.just-ship:/home/claude-dev/.just-ship
    env_file:
      - .env
    environment:
      - SERVER_CONFIG_PATH=/home/claude-dev/.just-ship/server-config.json
      - BUGSINK_DSN=http://bugsink-${NAME}:8000/sentry/1/

  bugsink:
    container_name: bugsink-${NAME}
    image: bugsink/bugsink:latest
    restart: unless-stopped
    ports:
      - "${BUGSINK_PORT}:8000"
    volumes:
      - bugsink_data:/data
    env_file:
      - .env
    environment:
      - BUGSINK_DB_DIR=/data

  dozzle:
    container_name: dozzle-${NAME}
    image: amir20/dozzle:latest
    restart: unless-stopped
    ports:
      - "${DOZZLE_PORT}:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - DOZZLE_BASE=/logs
      - DOZZLE_FILTER=name=pipeline-${NAME}|bugsink-${NAME}

volumes:
  bugsink_data:
COMPOSEEOF

ssh_run "chown claude-dev:claude-dev ${INSTANCE_DIR}/docker-compose.yml"
ok "docker-compose.yml written"

# ============================================================
# UPDATE CADDYFILE
# ============================================================

h "Updating Caddyfile"

# Backup before modifying
ssh_run "cp ${CADDY_FILE} ${CADDY_BACKUP}"
ok "Caddyfile backed up to ${CADDY_BACKUP}"

# Append the new site block
ssh_run "cat >> ${CADDY_FILE}" <<CADDYEOF

# Pipeline: ${NAME}
${DOMAIN} {
    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        -Server
    }

    handle_path /errors/* {
        basic_auth {
            {\$MONITORING_USER:admin} {\$MONITORING_HASH}
        }
        reverse_proxy localhost:${BUGSINK_PORT}
    }

    handle_path /logs/* {
        basic_auth {
            {\$MONITORING_USER:admin} {\$MONITORING_HASH}
        }
        reverse_proxy localhost:${DOZZLE_PORT}
    }

    handle {
        reverse_proxy localhost:${SERVER_PORT}
    }
}
CADDYEOF

CADDY_MODIFIED=1
ok "Caddyfile updated"

# Validate and reload Caddy (both inside the container, caddy CLI is not on the host)
CADDY_CONTAINER=$(ssh_run "docker ps -q --filter name=caddy --filter status=running")
[[ -z "$CADDY_CONTAINER" ]] && fail "Caddy container not found"

ssh_run "docker exec ${CADDY_CONTAINER} caddy validate --config /etc/caddy/Caddyfile 2>&1" >/dev/null \
  || fail "Caddyfile validation failed — check syntax"
ok "Caddyfile syntax valid"

ssh_run "docker exec ${CADDY_CONTAINER} caddy reload --config /etc/caddy/Caddyfile 2>&1" >/dev/null \
  || fail "Caddy reload failed"
ok "Caddy reloaded"

# ============================================================
# PULL IMAGE AND START CONTAINERS
# ============================================================

h "Starting Containers"

CLAUDE_UID=$(ssh_run "id -u claude-dev 2>/dev/null || echo 1001")
CLAUDE_GID=$(ssh_run "id -g claude-dev 2>/dev/null || echo 1001")

info "Pulling images (this may take a moment)..."
ssh_run "cd ${INSTANCE_DIR} && CLAUDE_UID=${CLAUDE_UID} CLAUDE_GID=${CLAUDE_GID} docker compose pull --quiet 2>&1" \
  | grep -E '(Pulled|Already|Error)' || true

ssh_run "cd ${INSTANCE_DIR} && CLAUDE_UID=${CLAUDE_UID} CLAUDE_GID=${CLAUDE_GID} docker compose up -d" 2>&1 \
  | grep -E '(Started|Created|Running|Error)' || true

CONTAINERS_STARTED=1
ok "Containers started"

# ============================================================
# HEALTH CHECK
# ============================================================

h "Health Check"

info "Waiting for pipeline-server to become healthy (up to 60s)..."
HEALTHY=0
for i in $(seq 1 12); do
  sleep 5
  printf "  Attempt %d/12..." "$i"
  HEALTH_RESPONSE=$(ssh_run "curl -sf http://localhost:${SERVER_PORT}/health --max-time 5 2>/dev/null || echo FAIL")
  if echo "$HEALTH_RESPONSE" | grep -q '"ok"'; then
    echo " OK"
    HEALTHY=1
    break
  fi
  echo " waiting"
done

if [[ $HEALTHY -eq 0 ]]; then
  fail "Health check failed after 60s. Container logs: $(ssh_run "docker logs pipeline-${NAME} 2>&1 | tail -20" 2>/dev/null || echo 'unavailable')"
fi

ok "Health check passed"

# ============================================================
# VERIFY CONTAINERS RUNNING
# ============================================================

h "Verifying Containers"
FAILED=0

for CONTAINER in "pipeline-${NAME}" "bugsink-${NAME}" "dozzle-${NAME}"; do
  STATUS=$(ssh_run "docker inspect --format='{{.State.Status}}' ${CONTAINER} 2>/dev/null || echo missing")
  if [[ "$STATUS" == "running" ]]; then
    ok "${CONTAINER}: running"
  else
    echo -e "${RED}  ✗${NC} ${CONTAINER}: ${STATUS}"
    FAILED=1
  fi
done

if [[ $FAILED -eq 1 ]]; then
  fail "One or more containers are not running"
fi

# ============================================================
# SUCCESS — REMOVE TRAP AND PRINT SUMMARY
# ============================================================

# Disable rollback trap — everything succeeded
trap - EXIT

# Clean up backup (no longer needed)
ssh_run "rm -f ${CADDY_BACKUP}" 2>/dev/null || true

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  Pipeline '${NAME}' provisioned successfully!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "  Domain:         https://${DOMAIN}"
echo "  Container:      pipeline-${NAME}"
echo "  Server port:    ${SERVER_PORT}"
echo "  Pipeline key:   ${PIPELINE_KEY}"
echo ""
echo "  Monitoring:"
echo "    Errors:       https://${DOMAIN}/errors/"
echo "    Logs:         https://${DOMAIN}/logs/"
echo ""
echo "  Instance dir:   ${INSTANCE_DIR}"
echo ""
echo "  Connect a project:"
echo "    bash vps/connect-project.sh \\"
echo "      --host ${VPS} \\"
echo "      --project-path <local-project-path> \\"
echo "      --repo <owner/repo> \\"
echo "      --slug <project-slug>"
echo ""
echo -e "${YELLOW}  SAVE THIS PIPELINE KEY — it is not stored anywhere else:${NC}"
echo "  ${PIPELINE_KEY}"
echo ""
