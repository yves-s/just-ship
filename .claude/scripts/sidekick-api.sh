#!/bin/bash
# sidekick-api.sh — Secure wrapper for Sidekick API calls
#
# Built for T-926 (Terminal Sidekick Chat-Mode). Bridges Claude Code in the
# terminal to the Engine's /api/sidekick/* endpoints (chat SSE, threads,
# attachments) so the Terminal has parity with the Browser widget.
#
# SECURITY: Hides API credentials from Claude Code terminal output.
# Credentials are resolved internally; only the API response body lands on
# stdout. This mirrors board-api.sh's approach — we never let PIPELINE_KEY
# appear in ps output, curl flags, or the terminal buffer.
#
# Usage:
#   # Stream a chat turn. Writes SSE frames to stdout as they arrive; exits 0
#   # when the server closes the stream. Use --raw for unparsed SSE, omit for
#   # text-only deltas (easier to pipe into a prompt).
#   sidekick-api.sh chat --project-id <uuid> [--thread-id <uuid>] [--user-id <uuid>] \
#       [--attach <url> --attach <url>] [--raw] --text "..."
#
#   # Thread operations
#   sidekick-api.sh thread-list --project-id <uuid> [--status draft,in_progress] [--limit 20]
#   sidekick-api.sh thread-get <thread-uuid>
#   sidekick-api.sh thread-messages <thread-uuid> [--limit 50] [--offset 0]
#   sidekick-api.sh thread-patch <thread-uuid> '{"status": "delivered"}'
#
#   # Image upload: one or more local files; prints JSON { files: [{ url, ... }] }
#   sidekick-api.sh attach /path/to/screenshot.png [more.png ...]
#
# Credential resolution (mirrors board-api.sh, plus ENGINE_API_URL):
#   Tier 1: PIPELINE_KEY + ENGINE_API_URL from env
#   Tier 2: PIPELINE_KEY + BOARD_API_URL from env (Board proxies sidekick routes)
#   Tier 3: .env.local (JSP_BOARD_API_KEY / JSP_BOARD_API_URL / JSP_ENGINE_API_URL)
#   Tier 4: project.json → pipeline.engine_url OR pipeline.board_url
#
# Exit codes:
#   0 — Success
#   1 — Configuration error (missing credentials / bad args)
#   2 — API error (HTTP non-2xx or network failure)

set -euo pipefail

# Save original stderr for error surfacing; silence credential resolution
exec 3>&2
exec 2>/dev/null

CMD="${1:-}"
if [ -z "$CMD" ]; then
  exec 2>&3
  cat >&2 <<'USAGE'
Usage:
  sidekick-api.sh chat --project-id <uuid> [--thread-id <uuid>] [--user-id <uuid>] \
      [--attach <url> ...] [--raw] --text "<message>"
  sidekick-api.sh thread-list --project-id <uuid> [--user-id <uuid>] [--status s1,s2] [--limit N]
  sidekick-api.sh thread-get <thread-uuid>
  sidekick-api.sh thread-messages <thread-uuid> [--limit N] [--offset N]
  sidekick-api.sh thread-patch <thread-uuid> '<json body>'
  sidekick-api.sh attach <file> [<file> ...]
USAGE
  exit 1
fi
shift

# --- Resolve credentials (silent) ---
: "${PIPELINE_KEY:=${CLAUDE_USER_CONFIG_BOARD_API_KEY:-}}"
: "${BOARD_API_URL:=${CLAUDE_USER_CONFIG_BOARD_API_URL:-}}"
: "${ENGINE_API_URL:=${CLAUDE_USER_CONFIG_ENGINE_API_URL:-}}"

# Tier 2 / 3 / 4 — only touch disk if env did not supply everything
if [ -z "${PIPELINE_KEY:-}" ] || { [ -z "${ENGINE_API_URL:-}" ] && [ -z "${BOARD_API_URL:-}" ]; }; then
  if [ -f ".env.local" ]; then
    local_key=$(grep '^JSP_BOARD_API_KEY=' .env.local 2>/dev/null | cut -d= -f2- || true)
    local_board=$(grep '^JSP_BOARD_API_URL=' .env.local 2>/dev/null | cut -d= -f2- || true)
    local_engine=$(grep '^JSP_ENGINE_API_URL=' .env.local 2>/dev/null | cut -d= -f2- || true)
    : "${PIPELINE_KEY:=${local_key:-}}"
    : "${BOARD_API_URL:=${local_board:-}}"
    : "${ENGINE_API_URL:=${local_engine:-}}"
  fi

  # Fall back to project.json
  if [ -f "project.json" ] && { [ -z "${ENGINE_API_URL:-}" ] || [ -z "${BOARD_API_URL:-}" ]; }; then
    ENGINE_FROM_JSON=$(node -e "
      try { const p = require('./project.json'); process.stdout.write(p.pipeline?.engine_url || ''); }
      catch(e) { process.stdout.write(''); }
    " 2>/dev/null) || ENGINE_FROM_JSON=""
    BOARD_FROM_JSON=$(node -e "
      try { const p = require('./project.json'); process.stdout.write(p.pipeline?.board_url || ''); }
      catch(e) { process.stdout.write(''); }
    " 2>/dev/null) || BOARD_FROM_JSON=""
    : "${ENGINE_API_URL:=${ENGINE_FROM_JSON:-}}"
    : "${BOARD_API_URL:=${BOARD_FROM_JSON:-}}"
  fi
fi

# Prefer the Engine URL; fall back to the Board URL (which proxies sidekick
# routes in Just Ship's production deployment).
API_URL="${ENGINE_API_URL:-${BOARD_API_URL:-}}"

if [ -z "${PIPELINE_KEY:-}" ] || [ -z "${API_URL:-}" ]; then
  exec 2>&3
  echo '{"error": "incomplete_credentials", "message": "Set PIPELINE_KEY and ENGINE_API_URL (or BOARD_API_URL) — in env, .env.local, or project.json pipeline.*"}' >&2
  exit 1
fi

# Strip trailing slash so we can concatenate paths cleanly without doubles.
API_URL="${API_URL%/}"

exec 2>&3

# ---------------------------------------------------------------------------
# Helper: JSON POST/GET/PATCH with error handling. Writes response to stdout
# on success (2xx) and to stderr on failure, returning non-zero.
# ---------------------------------------------------------------------------
json_request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  local curl_args=(
    -s
    --max-time 30
    -X "$method"
    -H "X-Pipeline-Key: $PIPELINE_KEY"
    -H "Content-Type: application/json"
  )
  if [ -n "$body" ]; then
    curl_args+=(-d "$body")
  fi

  local tmp
  tmp=$(mktemp)
  local http_code
  http_code=$(curl "${curl_args[@]}" -o "$tmp" -w "%{http_code}" "${API_URL}${path}" 2>/dev/null) || http_code="000"

  local response
  response=$(cat "$tmp")
  rm -f "$tmp"

  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
    printf '%s' "$response"
    return 0
  fi
  if [ "$http_code" = "000" ]; then
    echo '{"error": "connection_failed", "message": "Could not connect to Sidekick API"}' >&2
    return 2
  fi
  printf '%s' "$response" >&2
  return 2
}

# Build a JSON object from a variable list of key/value pairs. Filters out
# empty values so the final payload stays compact. Uses node for safety —
# manual JSON assembly in bash is a timebomb for inputs containing quotes.
#
# Args: alternating keys and values, then optional --array:<key>:<json-array>
build_json() {
  node - "$@" <<'NODE'
const out = {};
for (let i = 0; i < process.argv.length - 2; i += 2) {
  const k = process.argv[2 + i];
  const v = process.argv[2 + i + 1];
  if (!k || v === undefined || v === "") continue;
  if (k.startsWith("array:")) {
    const realKey = k.slice("array:".length);
    try { out[realKey] = JSON.parse(v); } catch { /* skip malformed */ }
    continue;
  }
  if (k.startsWith("object:")) {
    const realKey = k.slice("object:".length);
    try { out[realKey] = JSON.parse(v); } catch { /* skip */ }
    continue;
  }
  out[k] = v;
}
process.stdout.write(JSON.stringify(out));
NODE
}

# ---------------------------------------------------------------------------
# chat — SSE streaming. Reads line-by-line and prints either the raw SSE
# frames (--raw) or just the concatenated `delta` text + line-delimited
# status frames for tool/message/error events. Terminates when the server
# closes the stream.
# ---------------------------------------------------------------------------
cmd_chat() {
  local project_id="" thread_id="" user_id="" text="" raw=""
  local attachments=()

  while [ $# -gt 0 ]; do
    case "$1" in
      --project-id) project_id="$2"; shift 2;;
      --thread-id)  thread_id="$2"; shift 2;;
      --user-id)    user_id="$2"; shift 2;;
      --attach)     attachments+=("$2"); shift 2;;
      --raw)        raw="1"; shift;;
      --text)       text="$2"; shift 2;;
      *) echo "chat: unknown arg: $1" >&2; return 1;;
    esac
  done

  if [ -z "$project_id" ] || [ -z "$text" ]; then
    echo "chat: --project-id and --text are required" >&2
    return 1
  fi

  local attach_json="[]"
  if [ "${#attachments[@]}" -gt 0 ]; then
    # Build [{"url": "..."}, ...] as JSON using node for safe escaping.
    attach_json=$(node -e "
      const urls = process.argv.slice(1);
      process.stdout.write(JSON.stringify(urls.map(u => ({ url: u }))));
    " "${attachments[@]}")
  fi

  local payload
  payload=$(build_json \
    project_id "$project_id" \
    user_text "$text" \
    thread_id "$thread_id" \
    user_id "$user_id" \
    "array:attachments" "$attach_json")

  # Stream SSE. `curl --no-buffer` flushes as bytes arrive. We then parse
  # `event: <type>` / `data: <json>` pairs and either re-emit them verbatim
  # (--raw) or reduce them to user-facing output (delta text inline, control
  # events as bracketed status lines).
  #
  # Error handling: we capture HTTP status via a header-dump file so a 4xx/5xx
  # response (which the server sends as JSON, not SSE) is surfaced as an
  # `[error: …]` line on stderr instead of silently eaten by the SSE parser.
  local headers_file
  headers_file=$(mktemp)
  local curl_args=(
    -sN
    --no-buffer
    --max-time 300
    -D "$headers_file"
    -X POST
    -H "X-Pipeline-Key: $PIPELINE_KEY"
    -H "Content-Type: application/json"
    -H "Accept: text/event-stream"
    -d "$payload"
    "${API_URL}/api/sidekick/chat"
  )

  if [ -n "$raw" ]; then
    set +e
    curl "${curl_args[@]}"
    local rc=$?
    set -e
    rm -f "$headers_file"
    return $rc
  fi

  # Reduce SSE to text deltas (on stdout) + status lines (on stderr so they
  # don't contaminate a piped prompt). Node reads stdin line-by-line;
  # preserves backpressure so long streams don't buffer.
  #
  # SSE spec compliance: multiple `data:` lines inside one frame are joined
  # with '\n' before JSON-parsing, per W3C EventSource semantics. The current
  # server keeps payloads single-line, but the parser shouldn't corrupt data
  # if that ever changes. Script runs with `set -o pipefail` (top of file) so
  # the exit code below reflects curl's status, not node's.
  # Temporarily suppress errexit around the pipe so we can inspect failures
  # ourselves and return a structured error code instead of crashing out.
  set +e
  curl "${curl_args[@]}" | node -e "
    let event = '';
    let dataLines = [];
    process.stdin.setEncoding('utf8');
    const emitFrame = () => {
      if (!event || dataLines.length === 0) { event=''; dataLines=[]; return; }
      const raw = dataLines.join('\n');
      let parsed;
      try { parsed = JSON.parse(raw); } catch { event=''; dataLines=[]; return; }
      if (event === 'delta' && typeof parsed.text === 'string') {
        process.stdout.write(parsed.text);
      } else if (event === 'message') {
        process.stdout.write('\n');
        if (parsed.thread_id) process.stderr.write('[thread_id=' + parsed.thread_id + ']\n');
      } else if (event === 'tool_call') {
        process.stderr.write('[tool_call name=' + (parsed.name || '?') + ']\n');
      } else if (event === 'tool_result') {
        process.stderr.write('[tool_result' + (parsed.is_error ? ' error' : '') + ']\n');
      } else if (event === 'error') {
        process.stderr.write('[error: ' + (parsed.message || 'unknown') + ']\n');
      }
      event = ''; dataLines = [];
    };
    let buffer = '';
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r\$/, '');
        buffer = buffer.slice(idx + 1);
        if (line === '') { emitFrame(); continue; }
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    });
    process.stdin.on('end', emitFrame);
  "
  local pipe_rc=$?
  set -e

  # Inspect the HTTP status. If the server rejected the request (4xx/5xx),
  # curl will have written the JSON error body to stdout above; the node
  # parser silently drops it because it isn't an SSE frame. Surface a single
  # error line on stderr so the caller sees what happened.
  local http_status=""
  if [ -s "$headers_file" ]; then
    http_status=$(awk 'tolower($1) ~ /^http/ { print $2 }' "$headers_file" | tail -1)
  fi
  rm -f "$headers_file"

  if [ -n "$http_status" ] && { [ "$http_status" -lt 200 ] || [ "$http_status" -ge 300 ]; }; then
    echo "[error: HTTP $http_status from /api/sidekick/chat]" >&2
    return 2
  fi
  if [ "$pipe_rc" -ne 0 ]; then
    echo "[error: chat stream ended with exit code $pipe_rc]" >&2
    return 2
  fi
  return 0
}

# ---------------------------------------------------------------------------
# thread-list — GET /api/sidekick/threads?project_id=&status=&...
# ---------------------------------------------------------------------------
cmd_thread_list() {
  local project_id="" user_id="" workspace_id="" status="" limit="" offset=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --project-id)   project_id="$2"; shift 2;;
      --user-id)      user_id="$2"; shift 2;;
      --workspace-id) workspace_id="$2"; shift 2;;
      --status)       status="$2"; shift 2;;
      --limit)        limit="$2"; shift 2;;
      --offset)       offset="$2"; shift 2;;
      *) echo "thread-list: unknown arg: $1" >&2; return 1;;
    esac
  done

  local qs=""
  [ -n "$project_id" ]   && qs="${qs}&project_id=$(printf %s "$project_id" | node -e 'process.stdout.write(encodeURIComponent(require("fs").readFileSync(0,"utf-8")))')"
  [ -n "$user_id" ]      && qs="${qs}&user_id=$(printf %s "$user_id" | node -e 'process.stdout.write(encodeURIComponent(require("fs").readFileSync(0,"utf-8")))')"
  [ -n "$workspace_id" ] && qs="${qs}&workspace_id=$(printf %s "$workspace_id" | node -e 'process.stdout.write(encodeURIComponent(require("fs").readFileSync(0,"utf-8")))')"
  [ -n "$status" ]       && qs="${qs}&status=$(printf %s "$status" | node -e 'process.stdout.write(encodeURIComponent(require("fs").readFileSync(0,"utf-8")))')"
  [ -n "$limit" ]        && qs="${qs}&limit=${limit}"
  [ -n "$offset" ]       && qs="${qs}&offset=${offset}"
  qs="${qs#&}"

  json_request GET "/api/sidekick/threads${qs:+?$qs}"
}

cmd_thread_get() {
  local id="${1:-}"
  if [ -z "$id" ]; then echo "thread-get: <id> required" >&2; return 1; fi
  json_request GET "/api/sidekick/threads/${id}"
}

cmd_thread_messages() {
  local id="${1:-}"
  shift || true
  if [ -z "$id" ]; then echo "thread-messages: <id> required" >&2; return 1; fi
  local limit="" offset=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --limit)  limit="$2"; shift 2;;
      --offset) offset="$2"; shift 2;;
      *) echo "thread-messages: unknown arg: $1" >&2; return 1;;
    esac
  done
  local qs=""
  [ -n "$limit" ]  && qs="${qs}&limit=${limit}"
  [ -n "$offset" ] && qs="${qs}&offset=${offset}"
  qs="${qs#&}"
  json_request GET "/api/sidekick/threads/${id}/messages${qs:+?$qs}"
}

cmd_thread_patch() {
  local id="${1:-}"
  local body="${2:-}"
  if [ -z "$id" ] || [ -z "$body" ]; then
    echo "thread-patch: <id> and JSON body required" >&2; return 1
  fi
  json_request PATCH "/api/sidekick/threads/${id}" "$body"
}

# ---------------------------------------------------------------------------
# attach — multipart upload of one or more image files. Returns the same
# JSON shape as Board's own /api/sidekick/upload: { data: { files: [...] } }.
# ---------------------------------------------------------------------------
cmd_attach() {
  if [ $# -lt 1 ]; then
    echo "attach: at least one file path required" >&2; return 1
  fi

  local curl_args=(
    -s
    --max-time 60
    -X POST
    -H "X-Pipeline-Key: $PIPELINE_KEY"
    # curl sets multipart Content-Type automatically when -F is used
  )
  local file
  for file in "$@"; do
    if [ ! -f "$file" ]; then
      echo "attach: file not found: $file" >&2; return 1
    fi
    curl_args+=(-F "files=@${file}")
  done

  local tmp
  tmp=$(mktemp)
  local http_code
  http_code=$(curl "${curl_args[@]}" -o "$tmp" -w "%{http_code}" "${API_URL}/api/sidekick/attach" 2>/dev/null) || http_code="000"
  local response
  response=$(cat "$tmp"); rm -f "$tmp"

  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
    printf '%s' "$response"
    return 0
  fi
  if [ "$http_code" = "000" ]; then
    echo '{"error": "connection_failed", "message": "Could not connect to Sidekick API"}' >&2
    return 2
  fi
  printf '%s' "$response" >&2
  return 2
}

case "$CMD" in
  chat)            cmd_chat "$@";;
  thread-list)     cmd_thread_list "$@";;
  thread-get)      cmd_thread_get "$@";;
  thread-messages) cmd_thread_messages "$@";;
  thread-patch)    cmd_thread_patch "$@";;
  attach)          cmd_attach "$@";;
  *)
    echo "Unknown command: $CMD" >&2
    exit 1
    ;;
esac
