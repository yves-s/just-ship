#!/usr/bin/env bash
# just-ship-updater — Host-level Update Agent
# Runs as systemd service OUTSIDE Docker. Watches for update triggers
# written by the pipeline-server container, then orchestrates:
# git pull → docker build → drain → switch → health-check → project updates
#
# Trigger file: /home/claude-dev/.just-ship/triggers/update-trigger.json

set -euo pipefail

JUST_SHIP_DIR="/home/claude-dev/just-ship"
TRIGGER_DIR="/home/claude-dev/.just-ship/triggers"
TRIGGER_FILE="$TRIGGER_DIR/update-trigger.json"
CONFIG_FILE="/home/claude-dev/.just-ship/server-config.json"
PROJECTS_DIR="/home/claude-dev/projects"
COMPOSE_FILE="$JUST_SHIP_DIR/vps/docker-compose.yml"
LOCK_FILE="/tmp/just-ship-update.lock"
POLL_INTERVAL=5
HEALTH_CHECK_PORT=3001
DRAIN_TIMEOUT_SECS=1800  # 30 minutes

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

log_error() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2
}

# Read board_url from server-config.json (single source of truth)
get_board_url() {
  jq -r '.workspace.board_url' "$CONFIG_FILE"
}

# Read api_key from server-config.json
get_api_key() {
  jq -r '.workspace.api_key' "$CONFIG_FILE"
}

# Read pipeline_key from server-config.json
get_pipeline_key() {
  jq -r '.server.pipeline_key' "$CONFIG_FILE"
}

# Callback to Board with rollout result
callback_result() {
  local rollout_id="$1"
  local status="$2"
  local payload="$3"

  local board_url
  board_url=$(get_board_url)
  local api_key
  api_key=$(get_api_key)

  curl -sf -X POST \
    -H "X-Pipeline-Key: $api_key" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "${board_url}/api/rollouts/${rollout_id}/results" || \
    log_error "Failed to send callback to Board"
}

# Reject callback when VPS is already updating
callback_reject() {
  local rollout_id="$1"
  local reason="$2"

  callback_result "$rollout_id" "failed" \
    "$(jq -n --arg s "failed" --arg e "$reason" '{status: $s, error: $e}')"
}

# Health check - returns 0 if healthy
health_check() {
  curl -sf "http://localhost:${HEALTH_CHECK_PORT}/health" > /dev/null 2>&1
}

# Get drain state from health endpoint
get_drain_state() {
  curl -sf "http://localhost:${HEALTH_CHECK_PORT}/health" 2>/dev/null | jq -r '.drain.state // "unknown"'
}

# Process a single update trigger
process_update() {
  local trigger_content="$1"

  local target_version
  target_version=$(echo "$trigger_content" | jq -r '.version')
  local rollout_id
  rollout_id=$(echo "$trigger_content" | jq -r '.rollout_id')

  log "Starting update to version $target_version (rollout: $rollout_id)"

  # 1. Lock — reject (not queue) if already updating
  exec 200>"$LOCK_FILE"
  if ! flock --nonblock 200; then
    log_error "Another update is already in progress"
    callback_reject "$rollout_id" "VPS is already processing an update"
    return 1
  fi

  # 2. Tag old image for rollback
  local current_sha
  current_sha=$(git -C "$JUST_SHIP_DIR" rev-parse --short HEAD)
  log "Current version: $current_sha"
  docker tag just-ship-pipeline:latest "just-ship-pipeline:${current_sha}" 2>/dev/null || true

  # 3. Fetch target version (exact SHA)
  log "Fetching version $target_version..."
  if ! git -C "$JUST_SHIP_DIR" fetch origin; then
    log_error "git fetch failed"
    callback_result "$rollout_id" "failed" \
      "$(jq -n --arg s "failed" --arg e "git fetch failed" --arg pv "$current_sha" \
        '{status: $s, error: $e, previous_version: $pv}')"
    return 1
  fi

  if ! git -C "$JUST_SHIP_DIR" checkout "$target_version"; then
    log_error "git checkout $target_version failed"
    callback_result "$rollout_id" "failed" \
      "$(jq -n --arg s "failed" --arg e "git checkout failed" --arg pv "$current_sha" \
        '{status: $s, error: $e, previous_version: $pv}')"
    return 1
  fi

  # 4. Build new image (old container still running)
  log "Building new image..."
  if ! CLAUDE_UID=$(id -u claude-dev 2>/dev/null || echo 1001) \
       CLAUDE_GID=$(id -g claude-dev 2>/dev/null || echo 1001) \
       docker compose -f "$COMPOSE_FILE" build pipeline-server; then
    log_error "Docker build failed — rolling back checkout"
    git -C "$JUST_SHIP_DIR" checkout "$current_sha"
    callback_result "$rollout_id" "failed" \
      "$(jq -n --arg s "failed" --arg e "docker build failed" --arg pv "$current_sha" \
        '{status: $s, error: $e, previous_version: $pv}')"
    return 1
  fi

  # 5. Drain: block new runs, wait for running ones
  log "Draining pipeline server..."
  local pipeline_key
  pipeline_key=$(get_pipeline_key)

  local drain_response
  drain_response=$(curl -sf -X POST \
    -H "X-Pipeline-Key: $pipeline_key" \
    "http://localhost:${HEALTH_CHECK_PORT}/api/drain" 2>/dev/null || echo "")

  if [ -z "$drain_response" ]; then
    log "Warning: drain request failed — server may be down, proceeding with switch"
  else
    # Poll until drained or timeout
    local drain_start=$SECONDS
    while [ $(( SECONDS - drain_start )) -lt $DRAIN_TIMEOUT_SECS ]; do
      local drain_state
      drain_state=$(get_drain_state)
      if [ "$drain_state" = "drained" ]; then
        log "Server drained successfully"
        break
      fi
      sleep 10
    done

    # Force-drain if timeout reached
    if [ "$(get_drain_state)" != "drained" ]; then
      log "Drain timeout reached — force-draining"
      curl -sf -X POST \
        -H "X-Pipeline-Key: $pipeline_key" \
        "http://localhost:${HEALTH_CHECK_PORT}/api/force-drain" 2>/dev/null || true
      sleep 2
    fi
  fi

  # 6. Switch: start container with new image
  log "Switching to new image..."
  CLAUDE_UID=$(id -u claude-dev 2>/dev/null || echo 1001) \
  CLAUDE_GID=$(id -g claude-dev 2>/dev/null || echo 1001) \
  docker compose -f "$COMPOSE_FILE" up -d pipeline-server

  # 7. Health-check (5 attempts with backoff)
  log "Running health checks..."
  sleep 5  # Initial delay for Node.js startup
  local healthy=false
  for delay in 5 10 15 20 30; do
    if health_check; then
      healthy=true
      log "Health check passed"
      break
    fi
    log "Health check failed, retrying in ${delay}s..."
    sleep "$delay"
  done

  # 8a. Healthy → update projects
  if [ "$healthy" = true ]; then
    log "Updating projects..."
    local project_results="[]"

    for project_dir in "$PROJECTS_DIR"/*/; do
      [ -d "$project_dir" ] || continue
      local slug
      slug=$(basename "$project_dir")
      local proj_start=$SECONDS

      log "Updating project: $slug"
      if bash "$JUST_SHIP_DIR/setup.sh" --update --project "$project_dir" 2>&1; then
        local duration=$(( SECONDS - proj_start ))
        project_results=$(echo "$project_results" | jq \
          --arg s "$slug" --argjson d "$((duration * 1000))" \
          '. + [{"slug": $s, "status": "success", "duration_ms": $d}]')
        log "Project $slug updated successfully"
      else
        local duration=$(( SECONDS - proj_start ))
        project_results=$(echo "$project_results" | jq \
          --arg s "$slug" --arg e "setup.sh --update failed" --argjson d "$((duration * 1000))" \
          '. + [{"slug": $s, "status": "failed", "error": $e, "duration_ms": $d}]')
        log_error "Project $slug update failed"
      fi
    done

    # Callback to Board: success
    local callback_payload
    callback_payload=$(jq -n \
      --arg s "success" \
      --arg v "$target_version" \
      --arg pv "$current_sha" \
      --argjson pr "$project_results" \
      '{status: $s, current_version: $v, previous_version: $pv, project_results: $pr}')

    callback_result "$rollout_id" "success" "$callback_payload"
    log "Update complete: $current_sha → $target_version"

    CALLBACK_CONFIRMED=true

  # 8b. Unhealthy → rollback
  else
    log_error "Health checks failed — rolling back to $current_sha"
    git -C "$JUST_SHIP_DIR" checkout "$current_sha"
    CLAUDE_UID=$(id -u claude-dev 2>/dev/null || echo 1001) \
    CLAUDE_GID=$(id -g claude-dev 2>/dev/null || echo 1001) \
    docker compose -f "$COMPOSE_FILE" up -d pipeline-server

    # Wait for rollback to be healthy
    sleep 10

    callback_result "$rollout_id" "failed" \
      "$(jq -n --arg s "rolled_back" --arg e "Health check failed after switch" \
        --arg pv "$current_sha" \
        '{status: $s, error: $e, previous_version: $pv}')"

    log "Rollback complete"
    CALLBACK_CONFIRMED=true
  fi

  # 9. Self-update: reload updater if changed
  if [ "${CALLBACK_CONFIRMED:-false}" = true ]; then
    local installed_updater="/usr/local/bin/just-ship-updater.sh"
    local new_updater="$JUST_SHIP_DIR/vps/just-ship-updater.sh"

    if [ -f "$new_updater" ] && [ -f "$installed_updater" ]; then
      local installed_hash new_hash
      installed_hash=$(md5sum "$installed_updater" | cut -d' ' -f1)
      new_hash=$(md5sum "$new_updater" | cut -d' ' -f1)

      if [ "$installed_hash" != "$new_hash" ]; then
        log "Updater script changed — self-updating and restarting service"
        cp "$new_updater" "$installed_updater"
        chmod +x "$installed_updater"
        # systemctl restart sends SIGTERM — script exits here
        systemctl restart just-ship-updater
      fi
    fi
  fi

  # Release lock
  flock -u 200
}

# --- Main loop: watch for trigger files ---
log "Just Ship Update Agent started"
log "Watching: $TRIGGER_FILE"

mkdir -p "$TRIGGER_DIR"

while true; do
  if [ -f "$TRIGGER_FILE" ]; then
    trigger_content=$(cat "$TRIGGER_FILE")
    rm -f "$TRIGGER_FILE"

    # Validate trigger file
    schema_version=$(echo "$trigger_content" | jq -r '.schema_version // 0')
    if [ "$schema_version" != "1" ]; then
      log_error "Unknown trigger schema version: $schema_version — skipping"
    else
      process_update "$trigger_content" || log_error "Update failed"
    fi
  fi

  sleep "$POLL_INTERVAL"
done
