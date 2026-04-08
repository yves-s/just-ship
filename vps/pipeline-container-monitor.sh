#!/bin/bash
# ============================================================
# pipeline-container-monitor.sh — Health monitoring for pipeline containers
#
# Runs via cron every 60 seconds on the Pipeline-VPS.
# Pattern: same as uptime-monitor.sh on Hosting-VPS, but for Docker containers.
#
# Config:    /root/pipeline-containers.json
# State:     /tmp/pipeline-container-monitor.json
# Log:       /var/log/pipeline-container-monitor.log
#
# Required env vars (in /root/.env or system environment):
#   TELEGRAM_BOT_TOKEN
#   TELEGRAM_OPERATOR_CHAT_ID
# ============================================================

set -euo pipefail

CONFIG_FILE="/root/pipeline-containers.json"
STATE_FILE="/tmp/pipeline-container-monitor.json"
LOG_FILE="/var/log/pipeline-container-monitor.log"
MAX_FAILURES=3
MAX_RESTART_ATTEMPTS=3
RESTART_BACKOFF_1=30   # seconds before 2nd restart attempt
RESTART_BACKOFF_2=60   # seconds before 3rd and subsequent restart attempts
HEALTH_TIMEOUT=5

# ============================================================
# LOGGING
# ============================================================

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >&2
}

# ============================================================
# TELEGRAM
# ============================================================

send_telegram() {
  local message="$1"

  if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]] || [[ -z "${TELEGRAM_OPERATOR_CHAT_ID:-}" ]]; then
    log "WARN: TELEGRAM_BOT_TOKEN or TELEGRAM_OPERATOR_CHAT_ID not set — skipping alert"
    return 0
  fi

  local response
  response=$(curl -s --max-time 10 \
    -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_OPERATOR_CHAT_ID}" \
    -d "parse_mode=HTML" \
    --data-urlencode "text=${message}" \
    2>&1) || true

  if echo "$response" | grep -q '"ok":true'; then
    log "Telegram alert sent"
  else
    log "WARN: Telegram API error: $response"
  fi
}

# ============================================================
# CONFIG LOADING
# ============================================================

load_config() {
  # Returns a JSON array of container objects
  # Falls back to docker ps label discovery if config is missing or empty

  if [[ -f "$CONFIG_FILE" ]]; then
    local count
    count=$(jq 'length' "$CONFIG_FILE" 2>/dev/null || echo 0)
    if [[ "$count" -gt 0 ]]; then
      jq -c '.[]' "$CONFIG_FILE"
      return 0
    fi
    log "Config file empty or invalid — falling back to docker label discovery"
  else
    log "Config file not found at $CONFIG_FILE — falling back to docker label discovery"
  fi

  # Discover containers with label pipeline=true
  docker ps --filter "label=pipeline=true" --format '{"name":"{{.Names}}","domain":"unknown","health_url":""}' 2>/dev/null \
    | while IFS= read -r container_json; do
        local name
        name=$(echo "$container_json" | jq -r '.name')
        # Try to derive health_url from container port 3001 binding
        local port
        port=$(docker inspect "$name" --format '{{range $p, $conf := .NetworkSettings.Ports}}{{if eq $p "3001/tcp"}}{{(index $conf 0).HostPort}}{{end}}{{end}}' 2>/dev/null || echo "")
        if [[ -n "$port" ]]; then
          echo "$container_json" | jq -c --arg url "http://localhost:${port}/health" '.health_url = $url'
        else
          echo "$container_json"
        fi
      done
}

# ============================================================
# STATE MANAGEMENT
# ============================================================

load_state() {
  if [[ -f "$STATE_FILE" ]]; then
    cat "$STATE_FILE"
  else
    echo '{}'
  fi
}

get_container_state() {
  local state="$1"
  local name="$2"
  echo "$state" | jq -c --arg n "$name" '.[$n] // {
    "consecutive_failures": 0,
    "last_alert_time": 0,
    "is_down": false,
    "first_failure_time": 0,
    "last_status": 0,
    "restart_attempts": 0,
    "last_restart_time": 0
  }'
}

update_state() {
  local state="$1"
  local name="$2"
  local container_state="$3"
  echo "$state" | jq -c --arg n "$name" --argjson s "$container_state" '.[$n] = $s'
}

save_state() {
  local state="$1"
  # Atomic write: write to temp file first, then mv to avoid partial reads
  # if a second cron instance runs concurrently
  local tmp_file
  tmp_file="${STATE_FILE}.tmp.$$"
  echo "$state" > "$tmp_file"
  mv "$tmp_file" "$STATE_FILE"
}

# ============================================================
# DOCKER RESTART
# ============================================================

restart_container() {
  local name="$1"
  log "Attempting docker restart for container: $name"

  if docker restart "$name" >/dev/null 2>&1; then
    log "docker restart succeeded for: $name"
    return 0
  else
    log "docker restart failed for: $name"
    return 1
  fi
}

# ============================================================
# DURATION FORMATTING
# ============================================================

format_duration() {
  local seconds="$1"
  if [[ $seconds -lt 60 ]]; then
    echo "${seconds}s"
  elif [[ $seconds -lt 3600 ]]; then
    echo "$((seconds / 60))m $((seconds % 60))s"
  else
    echo "$((seconds / 3600))h $(( (seconds % 3600) / 60 ))m"
  fi
}

# ============================================================
# CONTAINER CHECK
# ============================================================

check_container() {
  local container_json="$1"
  local global_state="$2"
  local now
  now=$(date +%s)

  local name domain health_url
  name=$(echo "$container_json" | jq -r '.name')
  domain=$(echo "$container_json" | jq -r '.domain')
  health_url=$(echo "$container_json" | jq -r '.health_url')

  local cstate
  cstate=$(get_container_state "$global_state" "$name")

  local consecutive_failures last_alert_time is_down first_failure_time last_status restart_attempts last_restart_time
  consecutive_failures=$(echo "$cstate" | jq -r '.consecutive_failures')
  last_alert_time=$(echo "$cstate" | jq -r '.last_alert_time')
  is_down=$(echo "$cstate" | jq -r '.is_down')
  first_failure_time=$(echo "$cstate" | jq -r '.first_failure_time')
  last_status=$(echo "$cstate" | jq -r '.last_status')
  restart_attempts=$(echo "$cstate" | jq -r '.restart_attempts')
  last_restart_time=$(echo "$cstate" | jq -r '.last_restart_time')

  # Perform HTTP health check
  local http_status=0
  if [[ -n "$health_url" ]]; then
    http_status=$(curl -o /dev/null -s -w "%{http_code}" \
      --max-time "$HEALTH_TIMEOUT" \
      --connect-timeout "$HEALTH_TIMEOUT" \
      "$health_url" 2>/dev/null || echo 0)
  else
    # No health URL: check if container is running via docker inspect
    local container_status
    container_status=$(docker inspect --format='{{.State.Status}}' "$name" 2>/dev/null || echo "missing")
    if [[ "$container_status" == "running" ]]; then
      http_status=200
    else
      http_status=0
      log "Container $name is $container_status (no health_url configured)"
    fi
  fi

  local is_healthy=false
  if [[ "$http_status" -ge 200 ]] && [[ "$http_status" -lt 400 ]]; then
    is_healthy=true
  fi

  if [[ "$is_healthy" == "true" ]]; then
    # --- HEALTHY ---
    if [[ "$is_down" == "true" ]]; then
      # Recovery: was down, now healthy
      local down_duration=0
      if [[ "$first_failure_time" -gt 0 ]]; then
        down_duration=$((now - first_failure_time))
      fi
      local duration_str
      duration_str=$(format_duration "$down_duration")

      log "RECOVERED: $name (was down for $duration_str)"
      send_telegram "$(printf '🟢 Pipeline Container RECOVERED\n\nContainer: %s\nDomain: %s\nWas down for: %s\nStatus: Healthy' \
        "$name" "$domain" "$duration_str")"
    fi

    # Reset state
    cstate=$(echo "$cstate" | jq -c '
      .consecutive_failures = 0 |
      .is_down = false |
      .first_failure_time = 0 |
      .restart_attempts = 0 |
      .last_restart_time = 0 |
      .last_status = 200
    ')
  else
    # --- UNHEALTHY ---
    consecutive_failures=$((consecutive_failures + 1))
    log "FAIL: $name — HTTP $http_status (consecutive: $consecutive_failures)"

    if [[ "$first_failure_time" -eq 0 ]]; then
      first_failure_time=$now
    fi

    cstate=$(echo "$cstate" | jq -c \
      --argjson cf "$consecutive_failures" \
      --argjson ft "$first_failure_time" \
      --argjson hs "$http_status" \
      '.consecutive_failures = $cf | .first_failure_time = $ft | .last_status = $hs')

    if [[ "$consecutive_failures" -ge "$MAX_FAILURES" ]]; then
      local down_since
      down_since=$(date -d "@${first_failure_time}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null \
        || date -r "$first_failure_time" '+%Y-%m-%d %H:%M:%S' 2>/dev/null \
        || echo "unknown")

      # Send alert only once per incident (when first crossing the threshold)
      if [[ "$is_down" != "true" ]]; then
        log "ALERT: $name is DOWN since $down_since — sending Telegram alert"
        send_telegram "$(printf '🔴 Pipeline Container DOWN\n\nContainer: %s\nDomain: %s\nDown since: %s\nLast status: HTTP %s\nAction: Auto-restart initiated' \
          "$name" "$domain" "$down_since" "$http_status")"

        cstate=$(echo "$cstate" | jq -c --argjson t "$now" '.is_down = true | .last_alert_time = $t')
        is_down=true
      fi

      # Attempt restart with backoff (max MAX_RESTART_ATTEMPTS)
      local time_since_last_restart=$(( now - last_restart_time ))
      local can_restart=false

      if [[ "$restart_attempts" -lt "$MAX_RESTART_ATTEMPTS" ]]; then
        if [[ "$last_restart_time" -eq 0 ]]; then
          can_restart=true
        elif [[ "$restart_attempts" -eq 1 ]] && [[ "$time_since_last_restart" -ge "$RESTART_BACKOFF_1" ]]; then
          can_restart=true
        elif [[ "$restart_attempts" -ge 2 ]] && [[ "$time_since_last_restart" -ge "$RESTART_BACKOFF_2" ]]; then
          can_restart=true
        fi
      fi

      if [[ "$can_restart" == "true" ]]; then
        restart_attempts=$((restart_attempts + 1))
        log "Restart attempt $restart_attempts/$MAX_RESTART_ATTEMPTS for $name"
        if restart_container "$name"; then
          log "Restart $restart_attempts succeeded for $name — will verify on next check"
        else
          log "Restart $restart_attempts failed for $name"
        fi
        cstate=$(echo "$cstate" | jq -c \
          --argjson ra "$restart_attempts" \
          --argjson rt "$now" \
          '.restart_attempts = $ra | .last_restart_time = $rt')
      elif [[ "$restart_attempts" -ge "$MAX_RESTART_ATTEMPTS" ]]; then
        log "Max restart attempts ($MAX_RESTART_ATTEMPTS) reached for $name — no further restarts"
      fi
    fi
  fi

  # Return updated global state
  update_state "$global_state" "$name" "$cstate"
}

# ============================================================
# MAIN
# ============================================================

main() {
  # Load env vars from /root/.env if not already set
  if [[ -f "/root/.env" ]]; then
    # shellcheck disable=SC1091
    set -a
    source /root/.env
    set +a
  fi

  log "=== Pipeline Container Monitor start ==="

  local global_state
  global_state=$(load_state)

  local container_count=0
  local error_count=0

  while IFS= read -r container_json; do
    if [[ -z "$container_json" ]]; then
      continue
    fi

    container_count=$((container_count + 1))
    local name
    name=$(echo "$container_json" | jq -r '.name' 2>/dev/null || echo "unknown")

    # Each container check is isolated — errors don't block others
    # check_container returns updated state JSON on stdout, logs go to stderr
    if new_state=$(check_container "$container_json" "$global_state"); then
      global_state="$new_state"
    else
      error_count=$((error_count + 1))
      log "ERROR: check_container failed for $name — skipping state update for this container"
    fi

  done < <(load_config)

  save_state "$global_state"

  if [[ "$container_count" -eq 0 ]]; then
    log "No containers configured or discovered — nothing to monitor"
  else
    log "Checked $container_count container(s), $error_count error(s)"
  fi

  log "=== Pipeline Container Monitor done ==="
}

main "$@"
