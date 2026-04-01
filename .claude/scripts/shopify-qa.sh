#!/bin/bash
# shopify-qa.sh — Static analysis for Shopify Liquid/Theme consistency
# Usage:
#   bash .claude/scripts/shopify-qa.sh
#
# Analyzes files changed in the current branch (vs main) for common Shopify
# theme issues: hardcoded colors, incomplete propagation, schema mismatches,
# missing responsive breakpoints, and OS 2.0 compliance.
#
# Output: JSON to stdout with findings array and summary counts.
# Exit code: 1 if any "error" severity findings, else 0.

set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_ROOT"

# ---------------------------------------------------------------------------
# Tooling detection — prefer jq, fall back to node for JSON serialization
# ---------------------------------------------------------------------------
if command -v jq &>/dev/null; then
  JSON_TOOL="jq"
else
  JSON_TOOL="node"
fi

# ---------------------------------------------------------------------------
# Helper: JSON-escape a string
# ---------------------------------------------------------------------------
json_escape() {
  local s="$1"
  if [ "$JSON_TOOL" = "jq" ]; then
    printf '%s' "$s" | jq -Rs .
  else
    node -e "process.stdout.write(JSON.stringify(process.argv[1]))" "$s"
  fi
}

# ---------------------------------------------------------------------------
# Collect findings in a temp file (one JSON object per line)
# ---------------------------------------------------------------------------
FINDINGS_FILE=$(mktemp)
trap 'rm -f "$FINDINGS_FILE"' EXIT

add_finding() {
  local severity="$1" check="$2" file="$3" line="$4" message="$5"
  local sev_j check_j file_j msg_j
  sev_j=$(json_escape "$severity")
  check_j=$(json_escape "$check")
  file_j=$(json_escape "$file")
  msg_j=$(json_escape "$message")
  echo "{\"severity\":${sev_j},\"check\":${check_j},\"file\":${file_j},\"line\":${line},\"message\":${msg_j}}" >> "$FINDINGS_FILE"
}

# ---------------------------------------------------------------------------
# Get changed files relative to main
# ---------------------------------------------------------------------------
CHANGED_FILES=$(git diff --name-only main..HEAD 2>/dev/null || echo "")

if [ -z "$CHANGED_FILES" ]; then
  echo '{"findings":[],"summary":{"errors":0,"warnings":0,"info":0}}'
  exit 0
fi

# Filter to relevant extensions
LIQUID_FILES=()
CSS_FILES=()
JS_FILES=()
JSON_FILES=()
ALL_RELEVANT=()

while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *.liquid) LIQUID_FILES+=("$f"); ALL_RELEVANT+=("$f") ;;
    *.css)    CSS_FILES+=("$f");    ALL_RELEVANT+=("$f") ;;
    *.js)     JS_FILES+=("$f");     ALL_RELEVANT+=("$f") ;;
    *.json)   JSON_FILES+=("$f");   ALL_RELEVANT+=("$f") ;;
  esac
done <<< "$CHANGED_FILES"

if [ ${#ALL_RELEVANT[@]} -eq 0 ]; then
  echo '{"findings":[],"summary":{"errors":0,"warnings":0,"info":0}}'
  exit 0
fi

# ---------------------------------------------------------------------------
# Load ignore patterns from .shopify-qa-ignore
# ---------------------------------------------------------------------------
IGNORE_PATTERNS=()
if [ -f "$PROJECT_ROOT/.shopify-qa-ignore" ]; then
  while IFS= read -r pat; do
    # Skip empty lines and comments
    [[ -z "$pat" || "$pat" =~ ^# ]] && continue
    IGNORE_PATTERNS+=("$pat")
  done < "$PROJECT_ROOT/.shopify-qa-ignore"
fi

# Check if a file matches any ignore pattern
is_ignored() {
  local file="$1"
  for pat in "${IGNORE_PATTERNS[@]+"${IGNORE_PATTERNS[@]}"}"; do
    # Use bash fnmatch via case
    # shellcheck disable=SC2254
    case "$file" in
      $pat) return 0 ;;
    esac
    # Also check basename
    local base
    base=$(basename "$file")
    # shellcheck disable=SC2254
    case "$base" in
      $pat) return 0 ;;
    esac
  done
  return 1
}

# ---------------------------------------------------------------------------
# Check 1: hardcoded_values — hex colors, rgb(), rgba() in .liquid and .css
# ---------------------------------------------------------------------------
for f in "${LIQUID_FILES[@]+"${LIQUID_FILES[@]}"}" "${CSS_FILES[@]+"${CSS_FILES[@]}"}"; do
  [ -z "$f" ] && continue
  [ ! -f "$f" ] && continue
  is_ignored "$f" && continue

  local_line=0
  prev_line=""
  while IFS= read -r line; do
    local_line=$((local_line + 1))

    # Skip lines preceded by the inline ignore comment
    if [[ "$prev_line" =~ /\*[[:space:]]*shopify-qa-ignore[[:space:]]*\*/ ]]; then
      prev_line="$line"
      continue
    fi

    # Check for hex colors (#xxx, #xxxxxx, #xxxxxxxx)
    if [[ "$line" =~ \#[0-9a-fA-F]{3,8} ]]; then
      matched="${BASH_REMATCH[0]}"
      # Validate it is exactly a 3, 4, 6, or 8 digit hex color
      hex_part="${matched:1}"
      hex_len=${#hex_part}
      if [[ "$hex_len" -eq 3 || "$hex_len" -eq 4 || "$hex_len" -eq 6 || "$hex_len" -eq 8 ]]; then
        add_finding "warning" "hardcoded_values" "$f" "$local_line" "Hardcoded color ${matched} — consider using CSS custom property"
      fi
    fi

    # Check for rgb( and rgba(
    if [[ "$line" =~ rgba?\( ]]; then
      matched="${BASH_REMATCH[0]}"
      add_finding "warning" "hardcoded_values" "$f" "$local_line" "Hardcoded color ${matched}...) — consider using CSS custom property"
    fi

    prev_line="$line"
  done < "$f"
done

# ---------------------------------------------------------------------------
# Check 2: incomplete_propagation — modified CSS class names in other files
# ---------------------------------------------------------------------------
DIFF_CONTENT=$(git diff main..HEAD -- "${ALL_RELEVANT[@]}" 2>/dev/null || echo "")
if [ -n "$DIFF_CONTENT" ]; then
  # Find class names in added/removed lines (lines starting with + or -)
  CHANGED_CLASSES=$(echo "$DIFF_CONTENT" | grep -E '^\+|^-' | grep -oE '\.[a-zA-Z_][a-zA-Z0-9_-]+' | sort -u | sed 's/^\.//' || true)

  if [ -n "$CHANGED_CLASSES" ]; then
    # Build a set of changed files for quick lookup
    declare -A CHANGED_SET
    for f in "${ALL_RELEVANT[@]}"; do
      CHANGED_SET["$f"]=1
    done

    while IFS= read -r classname; do
      [ -z "$classname" ] && continue
      # Skip very short class names to reduce noise
      [ ${#classname} -lt 3 ] && continue

      # Search for this class in all liquid and css files (not in the changed set)
      matching_files=$(grep -rlE "(\\.|class=\"[^\"]*|class='[^']*)\b${classname}\b" --include='*.liquid' --include='*.css' . 2>/dev/null | sed 's|^\./||' || true)

      while IFS= read -r mf; do
        [ -z "$mf" ] && continue
        # Only report files NOT in the changed set
        if [ -z "${CHANGED_SET[$mf]+x}" ]; then
          add_finding "warning" "incomplete_propagation" "$mf" 0 "Class .${classname} also exists in ${mf} which was not modified"
        fi
      done <<< "$matching_files"
    done <<< "$CHANGED_CLASSES"
  fi
fi

# ---------------------------------------------------------------------------
# Check 3: section_schema — unused/undefined settings in liquid sections
# ---------------------------------------------------------------------------
for f in "${LIQUID_FILES[@]+"${LIQUID_FILES[@]}"}"; do
  [ -z "$f" ] && continue
  [ ! -f "$f" ] && continue

  file_content=$(cat "$f")

  # Check if file contains a schema block
  if ! echo "$file_content" | grep -q '{% schema %}'; then
    continue
  fi

  # Extract content BEFORE schema block (the template part)
  template_part=$(echo "$file_content" | sed -n '1,/{% schema %}/p' | head -n -1)

  # Extract schema JSON
  schema_json=$(echo "$file_content" | sed -n '/{% schema %}/,/{% endschema %}/p' | sed '1d;$d')

  if [ -z "$schema_json" ]; then
    continue
  fi

  # Extract setting IDs from schema JSON
  if [ "$JSON_TOOL" = "jq" ]; then
    schema_ids=$(echo "$schema_json" | jq -r '.settings[]?.id // empty' 2>/dev/null || true)
    block_ids=$(echo "$schema_json" | jq -r '.blocks[]?.settings[]?.id // empty' 2>/dev/null || true)
  else
    schema_ids=$(echo "$schema_json" | node -e "
      const fs = require('fs');
      try {
        const s = JSON.parse(fs.readFileSync('/dev/stdin','utf-8'));
        (s.settings||[]).forEach(x => x.id && console.log(x.id));
      } catch(e) {}
    " 2>/dev/null || true)
    block_ids=$(echo "$schema_json" | node -e "
      const fs = require('fs');
      try {
        const s = JSON.parse(fs.readFileSync('/dev/stdin','utf-8'));
        (s.blocks||[]).forEach(b => (b.settings||[]).forEach(x => x.id && console.log(x.id)));
      } catch(e) {}
    " 2>/dev/null || true)
  fi

  all_schema_ids=$(printf '%s\n%s' "$schema_ids" "$block_ids" | grep -v '^$' | sort -u)

  # Extract referenced settings from the template (section.settings.KEY and block.settings.KEY)
  used_settings=$(echo "$template_part" | grep -oE '(section|block)\.settings\.[a-zA-Z0-9_]+' | sed 's/.*\.settings\.//' | sort -u || true)

  # Check for settings defined but never used
  while IFS= read -r sid; do
    [ -z "$sid" ] && continue

    # Determine setting type — skip header/paragraph (display-only, not referenceable)
    setting_type=""
    if [ "$JSON_TOOL" = "jq" ]; then
      setting_type=$(echo "$schema_json" | jq -r --arg id "$sid" '
        ((.settings // [])[] | select(.id == $id) | .type) //
        ((.blocks // [])[] | (.settings // [])[] | select(.id == $id) | .type) //
        ""
      ' 2>/dev/null | head -1 || true)
    else
      setting_type=$(echo "$schema_json" | node -e "
        const fs = require('fs');
        try {
          const s = JSON.parse(fs.readFileSync('/dev/stdin','utf-8'));
          const all = [...(s.settings||[]), ...(s.blocks||[]).flatMap(b=>b.settings||[])];
          const found = all.find(x=>x.id===process.argv[1]);
          process.stdout.write(found ? found.type : '');
        } catch(e) {}
      " "$sid" 2>/dev/null || true)
    fi

    if [[ "$setting_type" == "header" || "$setting_type" == "paragraph" ]]; then
      continue
    fi

    if ! echo "$used_settings" | grep -qx "$sid"; then
      add_finding "warning" "section_schema" "$f" 0 "Setting '${sid}' defined but not used"
    fi
  done <<< "$all_schema_ids"

  # Check for settings used but not defined
  while IFS= read -r usid; do
    [ -z "$usid" ] && continue
    if ! echo "$all_schema_ids" | grep -qx "$usid"; then
      add_finding "warning" "section_schema" "$f" 0 "Setting '${usid}' used but not defined in schema"
    fi
  done <<< "$used_settings"
done

# ---------------------------------------------------------------------------
# Check 4: breakpoint_coverage — layout CSS changes without media queries
# ---------------------------------------------------------------------------
for f in "${CSS_FILES[@]+"${CSS_FILES[@]}"}"; do
  [ -z "$f" ] && continue
  [ ! -f "$f" ] && continue

  # Get the diff for this specific file
  file_diff=$(git diff main..HEAD -- "$f" 2>/dev/null || echo "")
  if [ -z "$file_diff" ]; then
    continue
  fi

  # Check if added lines contain layout/sizing properties
  has_layout=$(echo "$file_diff" | grep '^+' | grep -E '(width|height|padding|margin|flex|grid|display|font-size)' || true)

  if [ -n "$has_layout" ]; then
    # Check if added lines contain any @media queries
    has_media=$(echo "$file_diff" | grep '^+' | grep '@media' || true)
    if [ -z "$has_media" ]; then
      add_finding "info" "breakpoint_coverage" "$f" 0 "CSS changes include layout properties but no responsive breakpoints"
    fi
  fi
done

# ---------------------------------------------------------------------------
# Check 5: os2_compliance — .liquid files in templates/ should be .json
# ---------------------------------------------------------------------------
for f in "${LIQUID_FILES[@]+"${LIQUID_FILES[@]}"}"; do
  [ -z "$f" ] && continue
  if [[ "$f" == templates/*.liquid ]]; then
    add_finding "warning" "os2_compliance" "$f" 0 "Template ${f} uses .liquid instead of .json (Online Store 2.0)"
  fi
done

# ---------------------------------------------------------------------------
# Build JSON output
# ---------------------------------------------------------------------------
ERROR_COUNT=0
WARNING_COUNT=0
INFO_COUNT=0

FINDINGS_JSON="["
FIRST=true

if [ -s "$FINDINGS_FILE" ]; then
  while IFS= read -r finding_line; do
    [ -z "$finding_line" ] && continue
    if [ "$FIRST" = true ]; then
      FIRST=false
    else
      FINDINGS_JSON+=","
    fi
    FINDINGS_JSON+="$finding_line"

    # Count severities
    if [[ "$finding_line" == *'"severity":"error"'* ]]; then
      ERROR_COUNT=$((ERROR_COUNT + 1))
    elif [[ "$finding_line" == *'"severity":"warning"'* ]]; then
      WARNING_COUNT=$((WARNING_COUNT + 1))
    elif [[ "$finding_line" == *'"severity":"info"'* ]]; then
      INFO_COUNT=$((INFO_COUNT + 1))
    fi
  done < "$FINDINGS_FILE"
fi

FINDINGS_JSON+="]"

# Assemble final output
OUTPUT="{\"findings\":${FINDINGS_JSON},\"summary\":{\"errors\":${ERROR_COUNT},\"warnings\":${WARNING_COUNT},\"info\":${INFO_COUNT}}}"

# Pretty-print if jq is available
if [ "$JSON_TOOL" = "jq" ]; then
  echo "$OUTPUT" | jq .
else
  echo "$OUTPUT" | node -e "
    const fs = require('fs');
    const input = fs.readFileSync('/dev/stdin','utf-8');
    process.stdout.write(JSON.stringify(JSON.parse(input), null, 2) + '\n');
  "
fi

# Exit code: 1 if errors > 0
if [ "$ERROR_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
