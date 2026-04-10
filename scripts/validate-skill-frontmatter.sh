#!/usr/bin/env bash
# validate-skill-frontmatter.sh
# Validates that all skills/*.md files have required YAML frontmatter fields:
#   - name (string)
#   - description (string)
#   - triggers (non-empty array)
# Exits with code 1 if any file is invalid, 0 if all pass.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SKILLS_DIR="${REPO_ROOT}/skills"

errors=0
checked=0

for file in "${SKILLS_DIR}"/*.md; do
  [ -f "$file" ] || continue
  filename="$(basename "$file")"
  checked=$((checked + 1))

  # Check for opening --- delimiter
  if ! head -1 "$file" | grep -q '^---$'; then
    echo "FAIL [$filename]: missing opening '---' frontmatter delimiter"
    errors=$((errors + 1))
    continue
  fi

  # Extract frontmatter block (between first and second ---)
  frontmatter="$(awk '/^---/{count++; if(count==2) exit} count==1 && NR>1{print}' "$file")"

  if [ -z "$frontmatter" ]; then
    echo "FAIL [$filename]: frontmatter block is empty or missing closing '---'"
    errors=$((errors + 1))
    continue
  fi

  # Validate 'name' field
  if ! echo "$frontmatter" | grep -qE '^name:[[:space:]]+\S'; then
    echo "FAIL [$filename]: missing or empty 'name' field"
    errors=$((errors + 1))
  fi

  # Validate 'description' field (inline or block scalar "> ")
  if ! echo "$frontmatter" | grep -qE '^description:'; then
    echo "FAIL [$filename]: missing 'description' field"
    errors=$((errors + 1))
  fi

  # Validate 'triggers' field exists
  if ! echo "$frontmatter" | grep -qE '^triggers:'; then
    echo "FAIL [$filename]: missing 'triggers' field"
    errors=$((errors + 1))
    continue
  fi

  # Validate 'triggers' is a non-empty array
  # Supports both inline `[a, b]` and multi-line `- item` formats
  triggers_line="$(echo "$frontmatter" | grep -E '^triggers:')"
  inline_value="$(echo "$triggers_line" | sed 's/^triggers:[[:space:]]*//')"

  if echo "$inline_value" | grep -qE '^\[.*\]'; then
    # Inline array — check it has at least one item
    inner="$(echo "$inline_value" | sed 's/^\[//;s/\]//')"
    if [ -z "$(echo "$inner" | tr -d '[:space:],')" ]; then
      echo "FAIL [$filename]: 'triggers' array is empty"
      errors=$((errors + 1))
    fi
  else
    # Multi-line format — check there is at least one `- item` after triggers:
    triggers_items="$(echo "$frontmatter" | awk '/^triggers:/{found=1; next} found && /^[[:space:]]*-[[:space:]]/{print} found && /^[^[:space:]-]/{exit}' | grep -cE '^\s*-\s+\S')" || triggers_items=0
    if [ "$triggers_items" -eq 0 ]; then
      echo "FAIL [$filename]: 'triggers' has no items (must be a non-empty array)"
      errors=$((errors + 1))
    fi
  fi
done

if [ "$checked" -eq 0 ]; then
  echo "WARNING: no skill files found in ${SKILLS_DIR}"
  exit 0
fi

if [ "$errors" -gt 0 ]; then
  echo ""
  echo "FAILED: $errors error(s) in $checked skill file(s)"
  exit 1
fi

echo "OK: all $checked skill file(s) have valid frontmatter"
exit 0
