#!/bin/bash
# scripts/write-config.sh — Shared config I/O for Just Ship
#
# Manages ~/.just-ship/config.json (workspace-level secrets) and
# project.json (project-level, secret-free, committable).
#
# Commands:
#   add-workspace   Add/update a workspace in global config
#   set-project     Write workspace + project_id to project.json
#   read-workspace  Read workspace config, output JSON to stdout
#   remove-board    Remove board_url and api_key from a workspace
#   migrate         Migrate old project.json format to global config
#
# SECURITY: All node -e invocations pass values via environment variables
# to prevent shell injection. No bash variables are interpolated into JS.
set -euo pipefail

CONFIG_DIR="${HOME}/.just-ship"
CONFIG_FILE="${CONFIG_DIR}/config.json"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ensure_config_dir() {
  if [ ! -d "$CONFIG_DIR" ]; then
    mkdir -p "$CONFIG_DIR"
    chmod 700 "$CONFIG_DIR"
  fi
}

ensure_config_file() {
  ensure_config_dir
  if [ ! -f "$CONFIG_FILE" ]; then
    echo '{"workspaces":{},"default_workspace":null}' > "$CONFIG_FILE"
    chmod 600 "$CONFIG_FILE"
  fi
}

usage() {
  cat <<'USAGE'
Usage: write-config.sh <command> [options]

Commands:
  add-workspace   Add/update a workspace in ~/.just-ship/config.json
    --slug          Workspace slug (required)
    --board         Board URL, e.g. https://board.just-ship.io (required)
    --workspace-id  Supabase workspace UUID (required)
    --key           API key for the board (required)

  set-project     Write workspace + project_id to project.json
    --workspace     Workspace slug (required)
    --project-id    Project UUID (required)
    --project-name  Human-readable project name (optional)
    --project-dir   Directory containing project.json (default: ".")

  read-workspace  Read workspace config, output JSON to stdout
    --slug          Workspace slug (required)

  remove-board    Remove board_url and api_key from a workspace
    --slug          Workspace slug (required)

  migrate         Migrate old project.json to global config
    --project-dir   Directory containing project.json (default: ".")
    --slug          Workspace slug to use (optional, derived from project_name)

  parse-jsp       Decode and validate a jsp_ connection string
    --token         The jsp_ token string (required)

  connect         Connect workspace using a jsp_ token (parse + save + verify)
    --token         The jsp_ token string (required)
    --project-dir   Directory containing project.json (default: ".")

USAGE
  exit 1
}

# ---------------------------------------------------------------------------
# Command: add-workspace
# ---------------------------------------------------------------------------

cmd_add_workspace() {
  local slug="" board="" workspace_id="" key=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --slug)        slug="$2"; shift 2 ;;
      --board)       board="$2"; shift 2 ;;
      --workspace-id) workspace_id="$2"; shift 2 ;;
      --key)         key="$2"; shift 2 ;;
      *) echo "Error: Unknown option '$1' for add-workspace"; exit 1 ;;
    esac
  done

  if [ -z "$slug" ] || [ -z "$board" ] || [ -z "$workspace_id" ] || [ -z "$key" ]; then
    echo "Error: add-workspace requires --slug, --board, --workspace-id, and --key"
    exit 1
  fi

  ensure_config_file

  # Check for slug collision (same slug, different board URL) and write atomically
  JS_CONFIG_FILE="$CONFIG_FILE" \
  JS_SLUG="$slug" \
  JS_BOARD="$board" \
  JS_WORKSPACE_ID="$workspace_id" \
  JS_KEY="$key" \
  node -e "
    const fs = require('fs');
    const configFile = process.env.JS_CONFIG_FILE;
    const slug = process.env.JS_SLUG;
    const board = process.env.JS_BOARD;
    const workspaceId = process.env.JS_WORKSPACE_ID;
    const key = process.env.JS_KEY;

    const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));

    // Check for slug collision: same slug exists with a different board URL
    const existing = config.workspaces[slug];
    if (existing && existing.board_url && existing.board_url !== board) {
      console.error('Error: Workspace slug \"' + slug + '\" already exists with a different board URL.');
      console.error('  Existing: ' + existing.board_url);
      console.error('  Provided: ' + board);
      console.error('');
      console.error('Suggestion: Use a different --slug, or update the existing workspace:');
      console.error('  write-config.sh remove-board --slug ' + slug);
      console.error('  write-config.sh add-workspace --slug ' + slug + ' --board ' + board + ' ...');
      process.exit(1);
    }

    // Add/update workspace entry
    config.workspaces[slug] = {
      board_url: board,
      workspace_id: workspaceId,
      api_key: key
    };

    // Auto-set default_workspace if this is the first workspace
    const wsCount = Object.keys(config.workspaces).length;
    if (wsCount === 1 || !config.default_workspace) {
      config.default_workspace = slug;
    }

    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  "

  chmod 600 "$CONFIG_FILE"
  echo "Workspace '${slug}' saved to ${CONFIG_FILE}"
}

# ---------------------------------------------------------------------------
# Command: set-project
# ---------------------------------------------------------------------------

cmd_set_project() {
  local workspace="" project_id="" project_name="" project_dir="."

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --workspace)    workspace="$2"; shift 2 ;;
      --project-id)   project_id="$2"; shift 2 ;;
      --project-name) project_name="$2"; shift 2 ;;
      --project-dir)  project_dir="$2"; shift 2 ;;
      *) echo "Error: Unknown option '$1' for set-project"; exit 1 ;;
    esac
  done

  if [ -z "$workspace" ] || [ -z "$project_id" ]; then
    echo "Error: set-project requires --workspace and --project-id"
    exit 1
  fi

  local pjson="${project_dir}/project.json"
  if [ ! -f "$pjson" ]; then
    echo "Error: project.json not found at ${pjson}"
    exit 1
  fi

  JS_PJSON="$pjson" \
  JS_WORKSPACE="$workspace" \
  JS_PROJECT_ID="$project_id" \
  JS_PROJECT_NAME="${project_name:-}" \
  node -e "
    const fs = require('fs');
    const pjsonPath = process.env.JS_PJSON;
    const workspace = process.env.JS_WORKSPACE;
    const projectId = process.env.JS_PROJECT_ID;
    const projectName = process.env.JS_PROJECT_NAME || null;

    const pj = JSON.parse(fs.readFileSync(pjsonPath, 'utf-8'));

    // Remove old fields that contained secrets
    if (pj.pipeline) {
      delete pj.pipeline.api_key;
      delete pj.pipeline.api_url;
      delete pj.pipeline.workspace_id;
    }

    // Ensure pipeline section exists
    if (!pj.pipeline) {
      pj.pipeline = {};
    }

    // Write new format
    pj.pipeline.workspace = workspace;
    pj.pipeline.project_id = projectId;
    if (projectName) {
      pj.pipeline.project_name = projectName;
    }

    fs.writeFileSync(pjsonPath, JSON.stringify(pj, null, 2) + '\n');
  "

  echo "project.json updated: workspace='${workspace}', project_id='${project_id}'"
}

# ---------------------------------------------------------------------------
# Command: read-workspace
# ---------------------------------------------------------------------------

cmd_read_workspace() {
  local slug=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --slug) slug="$2"; shift 2 ;;
      *) echo "Error: Unknown option '$1' for read-workspace"; exit 1 ;;
    esac
  done

  if [ -z "$slug" ]; then
    echo "Error: read-workspace requires --slug"
    exit 1
  fi

  if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: Config file not found at ${CONFIG_FILE}"
    echo "Run add-workspace first."
    exit 1
  fi

  JS_CONFIG_FILE="$CONFIG_FILE" \
  JS_SLUG="$slug" \
  node -e "
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync(process.env.JS_CONFIG_FILE, 'utf-8'));
    const slug = process.env.JS_SLUG;
    const ws = config.workspaces[slug];
    if (!ws) {
      console.error('Error: Workspace \"' + slug + '\" not found in config.');
      console.error('Available workspaces: ' + Object.keys(config.workspaces).join(', '));
      process.exit(1);
    }
    // Output as JSON to stdout
    console.log(JSON.stringify({ slug: slug, ...ws }, null, 2));
  "
}

# ---------------------------------------------------------------------------
# Command: remove-board
# ---------------------------------------------------------------------------

cmd_remove_board() {
  local slug=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --slug) slug="$2"; shift 2 ;;
      *) echo "Error: Unknown option '$1' for remove-board"; exit 1 ;;
    esac
  done

  if [ -z "$slug" ]; then
    echo "Error: remove-board requires --slug"
    exit 1
  fi

  if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: Config file not found at ${CONFIG_FILE}"
    exit 1
  fi

  JS_CONFIG_FILE="$CONFIG_FILE" \
  JS_SLUG="$slug" \
  node -e "
    const fs = require('fs');
    const configFile = process.env.JS_CONFIG_FILE;
    const slug = process.env.JS_SLUG;
    const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));

    if (!config.workspaces[slug]) {
      console.error('Error: Workspace \"' + slug + '\" not found in config.');
      process.exit(1);
    }

    delete config.workspaces[slug].board_url;
    delete config.workspaces[slug].api_key;

    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  "

  chmod 600 "$CONFIG_FILE"
  echo "Removed board_url and api_key from workspace '${slug}'"
}

# ---------------------------------------------------------------------------
# Command: migrate
# ---------------------------------------------------------------------------

cmd_migrate() {
  local project_dir="." slug=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project-dir) project_dir="$2"; shift 2 ;;
      --slug)        slug="$2"; shift 2 ;;
      *) echo "Error: Unknown option '$1' for migrate"; exit 1 ;;
    esac
  done

  local pjson="${project_dir}/project.json"
  if [ ! -f "$pjson" ]; then
    echo "Error: project.json not found at ${pjson}"
    exit 1
  fi

  # If --slug not provided, derive from pipeline.project_name in project.json
  if [ -z "$slug" ]; then
    slug=$(
      JS_PJSON="$pjson" \
      node -e "
        const fs = require('fs');
        const pj = JSON.parse(fs.readFileSync(process.env.JS_PJSON, 'utf-8'));
        const name = (pj.pipeline && pj.pipeline.project_name) || '';
        if (!name) {
          console.log('workspace');
        } else {
          const slug = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
          console.log(slug || 'workspace');
        }
      "
    )
    echo "Suggested workspace slug: ${slug}"
  fi

  ensure_config_file

  # Step 1: Extract old values from project.json and write to global config
  JS_PJSON="$pjson" \
  JS_SLUG="$slug" \
  JS_CONFIG_FILE="$CONFIG_FILE" \
  node -e "
    const fs = require('fs');
    const pjsonPath = process.env.JS_PJSON;
    const slug = process.env.JS_SLUG;
    const configFile = process.env.JS_CONFIG_FILE;

    const pj = JSON.parse(fs.readFileSync(pjsonPath, 'utf-8'));
    const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));

    const pipeline = pj.pipeline || {};

    // Extract old values
    const boardUrl = pipeline.api_url || '';
    const apiKey = pipeline.api_key || '';
    const workspaceId = pipeline.workspace_id || '';
    const projectId = pipeline.project_id || '';
    const projectName = pipeline.project_name || null;

    if (!boardUrl && !apiKey && !workspaceId) {
      console.error('Warning: No old-format fields found in project.json (api_url, api_key, workspace_id).');
      console.error('project.json may already be in the new format.');
      process.exit(1);
    }

    // Write workspace to global config
    config.workspaces[slug] = {
      board_url: boardUrl,
      workspace_id: workspaceId,
      api_key: apiKey
    };

    // Auto-set default if first
    if (Object.keys(config.workspaces).length === 1 || !config.default_workspace) {
      config.default_workspace = slug;
    }

    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');

    // Step 2: Update project.json to new format
    delete pipeline.api_url;
    delete pipeline.api_key;
    delete pipeline.workspace_id;

    pipeline.workspace = slug;
    if (projectId) pipeline.project_id = projectId;
    if (projectName) pipeline.project_name = projectName;

    pj.pipeline = pipeline;
    fs.writeFileSync(pjsonPath, JSON.stringify(pj, null, 2) + '\n');

    console.log('Migration complete:');
    console.log('  Global config: ' + configFile + ' (workspace \"' + slug + '\")');
    console.log('  project.json: removed api_key, api_url, workspace_id; added workspace=\"' + slug + '\"');
  "

  chmod 600 "$CONFIG_FILE"
}

# ---------------------------------------------------------------------------
# Command: parse-jsp
# ---------------------------------------------------------------------------

cmd_parse_jsp() {
  local token=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --token) token="$2"; shift 2 ;;
      *) echo "Error: Unknown option '$1' for parse-jsp"; exit 1 ;;
    esac
  done

  if [ -z "$token" ]; then
    echo "Error: parse-jsp requires --token"
    exit 1
  fi

  JS_TOKEN="$token" \
  node -e "
    const token = process.env.JS_TOKEN;

    // Strip jsp_ prefix
    if (!token.startsWith('jsp_')) {
      console.error('Error: Token must start with jsp_');
      process.exit(1);
    }
    const b64 = token.slice(4);

    // Decode Base64
    let json;
    try {
      json = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
    } catch (e) {
      console.error('Error: Could not decode token — invalid Base64 or JSON');
      process.exit(1);
    }

    // Validate version
    if (!json.v || typeof json.v !== 'number') {
      console.error('Error: Missing or invalid version field (v)');
      process.exit(1);
    }

    // Validate required fields
    const required = { b: 'Board URL', w: 'Workspace Slug', i: 'Workspace ID', k: 'API Key' };
    for (const [key, label] of Object.entries(required)) {
      if (!json[key] || typeof json[key] !== 'string') {
        console.error('Error: Missing or invalid field: ' + label + ' (' + key + ')');
        process.exit(1);
      }
    }

    // Validate API key prefix
    if (!json.k.startsWith('adp_')) {
      console.error('Error: API Key must start with adp_');
      process.exit(1);
    }

    // Validate UUID format for workspace ID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(json.i)) {
      console.error('Error: Workspace ID is not a valid UUID');
      process.exit(1);
    }

    // Output clean JSON
    console.log(JSON.stringify({
      board_url: json.b,
      workspace: json.w,
      workspace_id: json.i,
      api_key: json.k,
      version: json.v
    }, null, 2));
  "
}

# ---------------------------------------------------------------------------
# Command: connect
# ---------------------------------------------------------------------------

cmd_connect() {
  local token="" project_dir="."

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --token) token="$2"; shift 2 ;;
      --project-dir) project_dir="$2"; shift 2 ;;
      *) echo "Error: Unknown option '$1' for connect"; exit 1 ;;
    esac
  done

  if [ -z "$token" ]; then
    echo "Error: connect requires --token"
    echo ""
    echo "Usage: write-config.sh connect --token \"jsp_...\""
    echo ""
    echo "Get your connection code from the Board: Settings → Connect"
    exit 1
  fi

  # Step 1: Parse the jsp_ token
  local parsed
  parsed=$(JS_TOKEN="$token" node -e "
    const token = process.env.JS_TOKEN;
    if (!token.startsWith('jsp_')) {
      console.error('Error: Token must start with jsp_');
      process.exit(1);
    }
    let json;
    try {
      json = JSON.parse(Buffer.from(token.slice(4), 'base64').toString('utf-8'));
    } catch (e) {
      console.error('Error: Could not decode token — invalid Base64 or JSON');
      process.exit(1);
    }
    const required = { v: 'number', b: 'string', w: 'string', i: 'string', k: 'string' };
    for (const [key, type] of Object.entries(required)) {
      if (typeof json[key] !== type) {
        console.error('Error: Invalid token — missing or wrong type for field: ' + key);
        process.exit(1);
      }
    }
    if (!json.k.startsWith('adp_')) {
      console.error('Error: Invalid API Key in token (must start with adp_)');
      process.exit(1);
    }
    console.log(JSON.stringify({ b: json.b, w: json.w, i: json.i, k: json.k }));
  ") || exit 1

  local board workspace workspace_id key
  board=$(echo "$parsed" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).b)")
  workspace=$(echo "$parsed" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).w)")
  workspace_id=$(echo "$parsed" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).i)")
  key=$(echo "$parsed" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).k)")

  # Step 2: Write workspace to global config
  cmd_add_workspace --slug "$workspace" --board "$board" --workspace-id "$workspace_id" --key "$key" >/dev/null

  # Step 3: Update project.json if it exists
  local pjson="${project_dir}/project.json"
  if [ -f "$pjson" ]; then
    JS_PJSON="$pjson" \
    JS_WORKSPACE="$workspace" \
    node -e "
      const fs = require('fs');
      const pj = JSON.parse(fs.readFileSync(process.env.JS_PJSON, 'utf-8'));
      if (!pj.pipeline) pj.pipeline = {};
      pj.pipeline.workspace = process.env.JS_WORKSPACE;
      // Remove old format fields if present
      delete pj.pipeline.api_key;
      delete pj.pipeline.api_url;
      delete pj.pipeline.workspace_id;
      fs.writeFileSync(process.env.JS_PJSON, JSON.stringify(pj, null, 2) + '\n');
    "
  fi

  # Step 4: Validate connection and auto-link project
  local http_code response_body
  response_body=$(mktemp)
  trap "rm -f '$response_body'" EXIT
  http_code=$(curl -s -o "$response_body" -w "%{http_code}" \
    -H "X-Pipeline-Key: ${key}" "${board}/api/projects" 2>/dev/null || echo "000")

  if [ "$http_code" = "200" ]; then
    if [ ! -f "$pjson" ]; then
      # No project.json in this directory
      echo ""
      echo "✓ Workspace '${workspace}' verbunden"
      echo ""
      echo "Workspace verbunden. Führe 'just-ship connect' in deinem"
      echo "Projektverzeichnis erneut aus um ein Projekt zu verknüpfen."
      rm -f "$response_body"
      return 0
    fi

    # Parse project list from API response
    local project_count selected_id selected_name
    project_count=$(JS_BODY="$(cat "$response_body")" node -e "
      try {
        const data = JSON.parse(process.env.JS_BODY);
        const projects = data.data && data.data.projects ? data.data.projects : [];
        process.stdout.write(String(projects.length));
      } catch (e) {
        process.stdout.write('0');
      }
    ") || project_count="0"

    if [ "$project_count" = "0" ]; then
      echo ""
      echo "✓ Workspace '${workspace}' verbunden"
      echo ""
      echo "⚠ Kein Projekt im Board gefunden."
      echo "  Erstelle ein Projekt im Board unter Settings → Projects,"
      echo "  dann führe 'just-ship connect' erneut aus."
    elif [ "$project_count" = "1" ]; then
      # Auto-link the single project
      selected_id=$(JS_BODY="$(cat "$response_body")" node -e "
        const data = JSON.parse(process.env.JS_BODY);
        process.stdout.write(data.data.projects[0].id);
      ")
      selected_name=$(JS_BODY="$(cat "$response_body")" node -e "
        const data = JSON.parse(process.env.JS_BODY);
        process.stdout.write(data.data.projects[0].name);
      ")
      cmd_set_project --workspace "$workspace" --project-id "$selected_id" --project-name "$selected_name" --project-dir "$project_dir" > /dev/null
      echo ""
      echo "✓ Workspace '${workspace}' verbunden"
      echo "✓ Projekt '${selected_name}' verknüpft"
      echo "✓ Board-Verbindung verifiziert"
      echo ""
      echo "Erstelle dein erstes Ticket mit /ticket in Claude Code."
    else
      # Multiple projects — show numbered list
      echo ""
      echo "✓ Workspace '${workspace}' verbunden"
      echo ""
      echo "Mehrere Projekte gefunden:"
      echo ""
      JS_BODY="$(cat "$response_body")" node -e "
        const data = JSON.parse(process.env.JS_BODY);
        data.data.projects.forEach((p, i) => {
          console.log('  ' + (i + 1) + ') ' + p.name);
        });
      "
      echo ""
      local choice
      read -p "Projekt auswählen (Nummer): " choice

      # Validate choice
      local valid_choice
      valid_choice=$(JS_BODY="$(cat "$response_body")" JS_CHOICE="$choice" node -e "
        const data = JSON.parse(process.env.JS_BODY);
        const idx = parseInt(process.env.JS_CHOICE, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= data.data.projects.length) {
          process.stdout.write('invalid');
        } else {
          process.stdout.write('valid');
        }
      ")

      if [ "$valid_choice" != "valid" ]; then
        echo ""
        echo "⚠ Ungültige Auswahl. Führe 'just-ship connect' erneut aus."
        rm -f "$response_body"
        return 1
      fi

      selected_id=$(JS_BODY="$(cat "$response_body")" JS_CHOICE="$choice" node -e "
        const data = JSON.parse(process.env.JS_BODY);
        const idx = parseInt(process.env.JS_CHOICE, 10) - 1;
        process.stdout.write(data.data.projects[idx].id);
      ")
      selected_name=$(JS_BODY="$(cat "$response_body")" JS_CHOICE="$choice" node -e "
        const data = JSON.parse(process.env.JS_BODY);
        const idx = parseInt(process.env.JS_CHOICE, 10) - 1;
        process.stdout.write(data.data.projects[idx].name);
      ")
      cmd_set_project --workspace "$workspace" --project-id "$selected_id" --project-name "$selected_name" --project-dir "$project_dir" > /dev/null
      echo ""
      echo "✓ Workspace '${workspace}' verbunden"
      echo "✓ Projekt '${selected_name}' verknüpft"
      echo "✓ Board-Verbindung verifiziert"
      echo ""
      echo "Erstelle dein erstes Ticket mit /ticket in Claude Code."
    fi

    rm -f "$response_body"
  elif [ "$http_code" = "401" ]; then
    rm -f "$response_body"
    echo ""
    echo "⚠ Workspace gespeichert, aber API-Key wurde abgelehnt (HTTP 401)"
    echo "  Prüfe deinen API-Key im Board unter Settings → API Keys"
  else
    rm -f "$response_body"
    echo ""
    echo "✓ Workspace '${workspace}' gespeichert (offline — Verbindung konnte nicht verifiziert werden)"
  fi
}

# ---------------------------------------------------------------------------
# Main dispatch
# ---------------------------------------------------------------------------

if [ $# -lt 1 ]; then
  usage
fi

COMMAND="$1"
shift

case "$COMMAND" in
  add-workspace)  cmd_add_workspace "$@" ;;
  set-project)    cmd_set_project "$@" ;;
  read-workspace) cmd_read_workspace "$@" ;;
  remove-board)   cmd_remove_board "$@" ;;
  migrate)        cmd_migrate "$@" ;;
  parse-jsp)      cmd_parse_jsp "$@" ;;
  connect)        cmd_connect "$@" ;;
  --help|-h)      usage ;;
  *)
    echo "Error: Unknown command '${COMMAND}'"
    echo ""
    usage
    ;;
esac
