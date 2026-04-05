#!/usr/bin/env bash
# install-updater.sh — Install the Just Ship Update Agent on a VPS host
# This runs on the HOST (not inside Docker) during initial VPS setup.
# Called by the /just-ship-vps skill or manually via SSH.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JUST_SHIP_DIR="$(dirname "$SCRIPT_DIR")"

log() {
  echo "[install-updater] $*"
}

# Check we're running as root (or with sudo)
if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: This script must be run as root or with sudo" >&2
  exit 1
fi

# Check that claude-dev user exists
if ! id -u claude-dev &>/dev/null; then
  echo "ERROR: claude-dev user does not exist — run full VPS setup first" >&2
  exit 1
fi

# Check dependencies
for cmd in docker jq curl; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd is required but not installed" >&2
    exit 1
  fi
done

# Check that claude-dev is in docker group
if ! groups claude-dev | grep -q docker; then
  log "Adding claude-dev to docker group..."
  usermod -aG docker claude-dev
fi

# 1. Copy updater script
log "Installing updater script..."
cp "$SCRIPT_DIR/just-ship-updater.sh" /usr/local/bin/just-ship-updater.sh
chmod +x /usr/local/bin/just-ship-updater.sh

# 2. Install systemd service
log "Installing systemd service..."
cp "$SCRIPT_DIR/just-ship-updater.service" /etc/systemd/system/just-ship-updater.service
systemctl daemon-reload

# 3. Create trigger directory
log "Creating trigger directory..."
mkdir -p /home/claude-dev/.just-ship/triggers
chown claude-dev:claude-dev /home/claude-dev/.just-ship/triggers

# 4. Generate Bugsink secrets if missing from .env
ENV_FILE="/home/claude-dev/.env"
if [ -f "$ENV_FILE" ]; then
  if ! grep -q "^BUGSINK_SECRET_KEY=" "$ENV_FILE"; then
    BUGSINK_SECRET_KEY=$(openssl rand -base64 50)
    echo "" >> "$ENV_FILE"
    echo "# Bugsink (auto-generated)" >> "$ENV_FILE"
    echo "BUGSINK_SECRET_KEY=${BUGSINK_SECRET_KEY}" >> "$ENV_FILE"
    log "BUGSINK_SECRET_KEY generated and added to .env"
  fi
  if ! grep -q "^BUGSINK_ADMIN_PASSWORD=" "$ENV_FILE"; then
    BUGSINK_ADMIN_PASSWORD=$(openssl rand -base64 32)
    echo "BUGSINK_ADMIN_PASSWORD=${BUGSINK_ADMIN_PASSWORD}" >> "$ENV_FILE"
    log "BUGSINK_ADMIN_PASSWORD generated and added to .env"
    echo ""
    echo "  ┌─────────────────────────────────────────────────────────────┐"
    echo "  │ Bugsink Admin Password (save this, shown only once):       │"
    echo "  │   ${BUGSINK_ADMIN_PASSWORD}  │"
    echo "  └─────────────────────────────────────────────────────────────┘"
    echo ""
  fi
  if ! grep -q "^BUGSINK_ADMIN_EMAIL=" "$ENV_FILE"; then
    echo "BUGSINK_ADMIN_EMAIL=admin@localhost" >> "$ENV_FILE"
  fi
else
  log "WARNING: .env not found at $ENV_FILE — Bugsink secrets will need to be configured manually"
fi

# 5. Generate update_secret if not already in server-config.json
CONFIG_FILE="/home/claude-dev/.just-ship/server-config.json"
if [ -f "$CONFIG_FILE" ]; then
  existing_secret=$(jq -r '.server.update_secret // ""' "$CONFIG_FILE")
  if [ -z "$existing_secret" ]; then
    log "Generating update_secret..."
    UPDATE_SECRET=$(openssl rand -hex 32)
    # Add update_secret to server config
    tmp=$(mktemp)
    jq --arg s "$UPDATE_SECRET" '.server.update_secret = $s' "$CONFIG_FILE" > "$tmp"
    mv "$tmp" "$CONFIG_FILE"
    chown claude-dev:claude-dev "$CONFIG_FILE"
    log "update_secret added to server-config.json"
  else
    log "update_secret already exists in server-config.json"
  fi
else
  log "WARNING: server-config.json not found at $CONFIG_FILE"
  log "  update_secret will need to be configured manually"
fi

# 6. Enable and start the service
log "Enabling and starting just-ship-updater service..."
systemctl enable just-ship-updater
systemctl start just-ship-updater

# 7. Verify
sleep 2
if systemctl is-active --quiet just-ship-updater; then
  log "✓ Update Agent installed and running"
else
  log "WARNING: Service installed but not running — check: journalctl -u just-ship-updater"
fi

log "Done."
