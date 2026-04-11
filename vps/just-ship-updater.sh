#!/usr/bin/env bash
# just-ship-updater — Host-level Update Agent
# Runs as systemd service OUTSIDE Docker. Watches for update triggers
# written by the pipeline-server container, then orchestrates:
# docker pull → drain → switch → health-check → project updates
#
# Trigger file: /home/claude-dev/.just-ship/triggers/update-trigger.json

set -euo pipefail

IMAGE_NAME="ghcr.io/yves-s/just-ship/pipeline"
TRIGGER_DIR="/home/claude-dev/.just-ship/triggers"
TRIGGER_FILE="$TRIGGER_DIR/update-trigger.json"
CONFIG_FILE="/home/claude-dev/.just-ship/server-config.json"
PROJECTS_DIR="/home/claude-dev/projects"
COMPOSE_FILE="/home/claude-dev/just-ship/vps/docker-compose.yml"
LOCK_FILE="/tmp/just-ship-update.lock"
POLL_INTERVAL=5
CONTAINER_NAME="vps-pipeline-server-1"
HEALTH_CHECK_URL="http://localhost:3001"
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

# Run curl inside the pipeline container (port not mapped to host)
container_curl() {
  docker exec "$CONTAINER_NAME" curl -sf "$@" 2>/dev/null
}

# Health check - returns 0 if healthy
health_check() {
  container_curl "${HEALTH_CHECK_URL}/health" > /dev/null 2>&1
}

# Get drain state from health endpoint
get_drain_state() {
  container_curl "${HEALTH_CHECK_URL}/health" | jq -r '.drain.state // "unknown"'
}

# Get current running image tag
get_current_image() {
  docker inspect "$CONTAINER_NAME" --format='{{.Config.Image}}' 2>/dev/null || echo ""
}

# Sync project.json from git remote (prevents config drift)
sync_project_config() {
  local project_dir="$1"
  local slug="$2"

  # Fetch latest from origin (inside container, git is available)
  if docker exec "$CONTAINER_NAME" git -C "$project_dir" fetch origin main --quiet 2>/dev/null; then
    # Extract just project.json from latest main without changing the working tree
    if docker exec "$CONTAINER_NAME" git -C "$project_dir" checkout origin/main -- project.json 2>/dev/null; then
      log "  project.json synced from origin/main for $slug"
    else
      log "  Warning: could not sync project.json for $slug (file may not exist in repo)"
    fi
  else
    log "  Warning: git fetch failed for $slug — project.json not synced"
  fi
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

  # 2. Record previous image for rollback
  local previous_image
  previous_image=$(get_current_image)
  log "Current image: ${previous_image:-none}"

  # 3. Resolve target image tag
  local target_tag
  if [ "$target_version" = "latest" ]; then
    target_tag="latest"
  else
    target_tag="$target_version"
  fi
  local target_image="${IMAGE_NAME}:${target_tag}"

  # 4. Pull new image (old container still running)
  log "Pulling image ${target_image}..."
  if ! docker pull "$target_image"; then
    log_error "docker pull failed"
    callback_result "$rollout_id" "failed" \
      "$(jq -n --arg s "failed" --arg e "docker pull failed" --arg pv "$previous_image" \
        '{status: $s, error: $e, previous_version: $pv}')"
    flock -u 200
    return 1
  fi

  # Extract short SHA from image labels for version reporting
  local new_version
  new_version=$(docker inspect "$target_image" --format='{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null | head -c 7)
  [ -z "$new_version" ] && new_version="$target_tag"
  log "New version: $new_version"

  # 5. Drain: block new runs, wait for running ones
  log "Draining pipeline server..."
  local pipeline_key
  pipeline_key=$(get_pipeline_key)

  local drain_response
  drain_response=$(container_curl -X POST \
    -H "X-Pipeline-Key: $pipeline_key" \
    "${HEALTH_CHECK_URL}/api/drain" || echo "")

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
      container_curl -X POST \
        -H "X-Pipeline-Key: $pipeline_key" \
        "${HEALTH_CHECK_URL}/api/force-drain" || true
      sleep 2
    fi
  fi

  # 6. Switch: start container with new image
  log "Switching to new image..."
  CLAUDE_UID=$(id -u claude-dev 2>/dev/null || echo 1001) \
  CLAUDE_GID=$(id -g claude-dev 2>/dev/null || echo 1001) \
  PIPELINE_IMAGE_TAG="$target_tag" \
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
      # Run setup.sh from inside the new container to update project framework files
      if docker exec "$CONTAINER_NAME" bash -c "cd '$project_dir' && bash /app/setup.sh --update" 2>&1; then
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

      # Sync project.json from git
      sync_project_config "$project_dir" "$slug"
    done

    # Callback to Board: success
    local callback_payload
    callback_payload=$(jq -n \
      --arg s "success" \
      --arg v "$new_version" \
      --arg pv "$previous_image" \
      --argjson pr "$project_results" \
      '{status: $s, current_version: $v, previous_version: $pv, project_results: $pr}')

    callback_result "$rollout_id" "success" "$callback_payload"
    log "Update complete: $previous_image → ${IMAGE_NAME}:${target_tag} ($new_version)"

  # 8b. Unhealthy → rollback to previous image
  else
    log_error "Health checks failed — rolling back to $previous_image"

    if [ -n "$previous_image" ]; then
      CLAUDE_UID=$(id -u claude-dev 2>/dev/null || echo 1001) \
      CLAUDE_GID=$(id -g claude-dev 2>/dev/null || echo 1001) \
      PIPELINE_IMAGE_TAG="${previous_image##*:}" \
      docker compose -f "$COMPOSE_FILE" up -d pipeline-server
    else
      # No previous image — just restart with latest
      CLAUDE_UID=$(id -u claude-dev 2>/dev/null || echo 1001) \
      CLAUDE_GID=$(id -g claude-dev 2>/dev/null || echo 1001) \
      docker compose -f "$COMPOSE_FILE" up -d pipeline-server
    fi

    # Wait for rollback to be healthy
    sleep 10

    callback_result "$rollout_id" "failed" \
      "$(jq -n --arg s "rolled_back" --arg e "Health check failed after switch" \
        --arg pv "$previous_image" \
        '{status: $s, error: $e, previous_version: $pv}')"

    log "Rollback complete"
  fi

  # 9. Self-update: check if updater script changed in new image
  local installed_updater="/usr/local/bin/just-ship-updater.sh"
  local container_updater_hash
  container_updater_hash=$(docker exec "$CONTAINER_NAME" md5sum /app/vps/just-ship-updater.sh 2>/dev/null | cut -d' ' -f1 || echo "")

  if [ -n "$container_updater_hash" ] && [ -f "$installed_updater" ]; then
    local installed_hash
    installed_hash=$(md5sum "$installed_updater" | cut -d' ' -f1)

    if [ "$installed_hash" != "$container_updater_hash" ]; then
      log "Updater script changed — self-updating and restarting service"
      docker cp "$CONTAINER_NAME":/app/vps/just-ship-updater.sh "$installed_updater"
      chmod +x "$installed_updater"
      # systemctl restart sends SIGTERM — script exits here
      systemctl restart just-ship-updater
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
