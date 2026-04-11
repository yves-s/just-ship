#!/bin/bash
# ============================================================
# install-monitor.sh — Install pipeline container monitor on VPS
#
# Runs LOCALLY, provisions via SSH. Copies the monitoring script
# to the Pipeline-VPS and installs a cron entry.
#
# Usage:
#   bash vps/install-monitor.sh --vps 187.124.9.221
#
# Optional:
#   --ssh-key <path>   SSH key path (default: ~/.ssh/id_rsa)
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
VPS=""
SSH_KEY="${HOME}/.ssh/id_rsa"

while [[ $# -gt 0 ]]; do
  case $1 in
    --vps)     VPS="$2";     shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

[[ -z "$VPS" ]] && fail "Missing --vps <IP>"

# --- Resolve script directory ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONITOR_SCRIPT="${SCRIPT_DIR}/pipeline-container-monitor.sh"
EXAMPLE_CONFIG="${SCRIPT_DIR}/pipeline-containers.example.json"

[[ -f "$MONITOR_SCRIPT" ]]  || fail "Monitor script not found at: $MONITOR_SCRIPT"
[[ -f "$EXAMPLE_CONFIG" ]] || fail "Example config not found at: $EXAMPLE_CONFIG"

# --- SSH helper ---
# Use array to correctly handle SSH key paths that contain spaces
SSH_OPTS=(-o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o BatchMode=yes)
if [[ -f "$SSH_KEY" ]]; then
  SSH_OPTS+=(-i "$SSH_KEY")
fi
ssh_run()  { ssh "${SSH_OPTS[@]}" "root@$VPS" "$@"; }
scp_copy() { scp "${SSH_OPTS[@]}" "$1" "root@$VPS:$2"; }

# ============================================================
# HEADER
# ============================================================

echo ""
echo "================================================"
echo "  Just Ship — Install Pipeline Container Monitor"
echo "  VPS: $VPS"
echo "================================================"

# ============================================================
# PRE-FLIGHT CHECKS
# ============================================================

h "Pre-Flight Checks"

ssh_run "echo ok" >/dev/null 2>&1 \
  || fail "SSH to root@${VPS} failed. Run: ssh-copy-id -i ${SSH_KEY} root@${VPS}"
ok "SSH reachable"

ssh_run "command -v jq" >/dev/null 2>&1 \
  || fail "jq not installed on VPS. Run: apt-get install -y jq"
ok "jq available"

ssh_run "command -v docker" >/dev/null 2>&1 \
  || fail "docker not installed on VPS"
ok "docker available"

ssh_run "command -v curl" >/dev/null 2>&1 \
  || fail "curl not installed on VPS"
ok "curl available"

# Check Telegram env vars are set on the VPS
TELEGRAM_CHECK=$(ssh_run "bash -c '
  source /root/.env 2>/dev/null || true
  if [[ -n \"\${TELEGRAM_BOT_TOKEN:-}\" ]] && [[ -n \"\${TELEGRAM_OPERATOR_CHAT_ID:-}\" ]]; then
    echo ok
  else
    echo missing
  fi
'" 2>/dev/null || echo missing)

if [[ "$TELEGRAM_CHECK" == "ok" ]]; then
  ok "Telegram env vars found in /root/.env"
else
  warn "TELEGRAM_BOT_TOKEN or TELEGRAM_OPERATOR_CHAT_ID not found in /root/.env"
  warn "Monitor will run but cannot send alerts. Add to /root/.env:"
  warn "  TELEGRAM_BOT_TOKEN=your-bot-token"
  warn "  TELEGRAM_OPERATOR_CHAT_ID=your-chat-id"
fi

# ============================================================
# COPY MONITOR SCRIPT
# ============================================================

h "Installing Monitor Script"

scp_copy "$MONITOR_SCRIPT" "/root/pipeline-container-monitor.sh"
ok "Copied to /root/pipeline-container-monitor.sh"

ssh_run "chmod +x /root/pipeline-container-monitor.sh"
ok "Made executable"

# ============================================================
# CREATE LOG FILE
# ============================================================

h "Setting Up Log File"

ssh_run "touch /var/log/pipeline-container-monitor.log && chmod 644 /var/log/pipeline-container-monitor.log"
ok "Log file: /var/log/pipeline-container-monitor.log"

# Install logrotate config to prevent unbounded log growth
ssh_run "cat > /etc/logrotate.d/pipeline-container-monitor << 'EOF'
/var/log/pipeline-container-monitor.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 644 root root
}
EOF"
ok "Logrotate configured (daily, 7 days retention)"

# ============================================================
# CREATE CONFIG FILE IF MISSING
# ============================================================

h "Container Config"

CONFIG_EXISTS=$(ssh_run "test -f /root/pipeline-containers.json && echo yes || echo no")
if [[ "$CONFIG_EXISTS" == "yes" ]]; then
  ok "Config already exists at /root/pipeline-containers.json — not overwriting"
else
  ssh_run "echo '[]' > /root/pipeline-containers.json"
  ok "Created empty config: /root/pipeline-containers.json"
  info "Edit /root/pipeline-containers.json on the VPS to add container entries."
  info "See pipeline-containers.example.json for format."
fi

# ============================================================
# INSTALL CRON ENTRY
# ============================================================

h "Installing Cron Entry"

CRON_ENTRY="* * * * * /root/pipeline-container-monitor.sh >> /var/log/pipeline-container-monitor.log 2>&1"

# Check if entry already exists
CRON_EXISTS=$(ssh_run "crontab -l 2>/dev/null | grep -qF 'pipeline-container-monitor.sh' && echo yes || echo no")

if [[ "$CRON_EXISTS" == "yes" ]]; then
  ok "Cron entry already installed — not duplicating"
else
  # Append to existing crontab (or create new one)
  ssh_run "( crontab -l 2>/dev/null; echo '${CRON_ENTRY}' ) | crontab -"
  ok "Cron entry installed (runs every minute)"
fi

info "Cron: $CRON_ENTRY"

# ============================================================
# VERIFY SCRIPT RUNS WITHOUT ERRORS
# ============================================================

h "Verifying Script Execution"

info "Running monitor script once to verify no syntax errors..."
RUN_OUTPUT=$(ssh_run "bash -c 'source /root/.env 2>/dev/null || true; /root/pipeline-container-monitor.sh 2>&1'" || true)

if echo "$RUN_OUTPUT" | grep -q "Pipeline Container Monitor done"; then
  ok "Script executed successfully"
else
  warn "Script run output (check for errors):"
  echo "$RUN_OUTPUT" | sed 's/^/    /'
fi

# ============================================================
# SUCCESS
# ============================================================

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  Monitor installed successfully!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "  Script:  /root/pipeline-container-monitor.sh"
echo "  Config:  /root/pipeline-containers.json"
echo "  Log:     /var/log/pipeline-container-monitor.log"
echo "  Cron:    every minute"
echo ""
echo "  Next steps:"
echo "    1. Edit /root/pipeline-containers.json on the VPS"
echo "    2. Add entries for each pipeline container"
echo "    3. Verify alerts: tail -f /var/log/pipeline-container-monitor.log"
echo ""
