#!/bin/bash
# =============================================================================
# scan-plugin-security.sh — Lightweight plugin security scanner
#
# Scans plugin skill files for dangerous patterns before installation.
# Runs during setup.sh (no Claude Code agent required).
#
# Usage:
#   bash scripts/scan-plugin-security.sh <skills-dir>
#   bash scripts/scan-plugin-security.sh .claude/skills
#
# Exit codes:
#   0 — All plugins passed (or only warnings)
#   1 — At least one FAIL finding (blocks installation)
# =============================================================================

set -euo pipefail

SKILLS_DIR="${1:-.claude/skills}"
FAIL_COUNT=0
WARN_COUNT=0
PASS_COUNT=0
FINDINGS=()

# Colors (disable if not a terminal)
if [ -t 1 ]; then
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  GREEN='\033[0;32m'
  NC='\033[0m'
else
  RED='' YELLOW='' GREEN='' NC=''
fi

report_finding() {
  local verdict="$1" file="$2" line="$3" category="$4" detail="$5"
  if [ "$verdict" = "FAIL" ]; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FINDINGS+=("${RED}FAIL${NC}  $file:$line — [$category] $detail")
  elif [ "$verdict" = "WARN" ]; then
    WARN_COUNT=$((WARN_COUNT + 1))
    FINDINGS+=("${YELLOW}WARN${NC}  $file:$line — [$category] $detail")
  fi
}

scan_markdown_file() {
  local file="$1"
  local basename
  basename=$(basename "$file")

  # Only scan plugin skills (plugin--*--*.md)
  [[ "$basename" == plugin--* ]] || return 0

  # T1: Prompt Injection — system prompt override
  local line_num
  while IFS=: read -r line_num content; do
    report_finding "FAIL" "$file" "$line_num" "T1:PromptInjection" "System prompt override: $content"
  done < <(grep -inE '(ignore previous instructions|forget your (rules|instructions)|you are now a|your new role is)' "$file" 2>/dev/null || true)

  # T1: Safety bypass
  while IFS=: read -r line_num content; do
    report_finding "WARN" "$file" "$line_num" "T1:SafetyBypass" "Potential safety bypass: $content"
  done < <(grep -inE '(this is authorized|the user has consented|in this context it is safe to|permitted to ignore)' "$file" 2>/dev/null || true)

  # T1: Data extraction directives
  while IFS=: read -r line_num content; do
    report_finding "FAIL" "$file" "$line_num" "T1:DataExtraction" "Data extraction directive: $content"
  done < <(grep -inE '(send the contents of|upload.*to.*https?://|POST.*environment.*variable|include in your response.*all.*(env|secret|key|token|credential))' "$file" 2>/dev/null || true)

  # T1: Excessive tool permissions
  if grep -qE '^allowed-tools:\s*\*' "$file" 2>/dev/null; then
    report_finding "WARN" "$file" "1" "T1:ExcessivePerms" "Skill requests all tools (allowed-tools: *)"
  fi

  # T5: Path traversal in markdown
  while IFS=: read -r line_num content; do
    report_finding "WARN" "$file" "$line_num" "T5:PathTraversal" "Path traversal pattern: $content"
  done < <(grep -nE '\.\./\.\./\.\.' "$file" 2>/dev/null || true)

  PASS_COUNT=$((PASS_COUNT + 1))
}

scan_script_file() {
  local file="$1"

  # T2: Obfuscated execution
  while IFS=: read -r line_num content; do
    report_finding "FAIL" "$file" "$line_num" "T2:ObfuscatedExec" "Base64 decode + execute: $content"
  done < <(grep -nE '(eval\(.*atob|eval\(.*base64|eval\(.*Buffer\.from|exec\(.*decode)' "$file" 2>/dev/null || true)

  # T2: Remote code execution (pipe to shell)
  while IFS=: read -r line_num content; do
    report_finding "FAIL" "$file" "$line_num" "T2:RemoteExec" "Remote code execution: $content"
  done < <(grep -nE '(curl|wget).*\|.*(bash|sh|python|node|eval)' "$file" 2>/dev/null || true)

  # T2: Credential harvesting
  while IFS=: read -r line_num content; do
    report_finding "FAIL" "$file" "$line_num" "T2:CredentialHarvest" "Credential file access: $content"
  done < <(grep -nE '(~|HOME|\$HOME)/\.(ssh|aws|config/gcloud|just-ship|claude|gnupg)' "$file" 2>/dev/null || true)

  # T2: Runtime package install
  while IFS=: read -r line_num content; do
    report_finding "WARN" "$file" "$line_num" "T4:RuntimeInstall" "Runtime package installation: $content"
  done < <(grep -nE '(pip install|npm install|gem install|cargo install)' "$file" 2>/dev/null || true)

  # T3: Shell config modification
  while IFS=: read -r line_num content; do
    report_finding "FAIL" "$file" "$line_num" "T3:Persistence" "Shell config modification: $content"
  done < <(grep -nE '(>>|>)\s*.*(\.bashrc|\.zshrc|\.profile|\.bash_profile)' "$file" 2>/dev/null || true)

  # T3: Cron/scheduled execution
  while IFS=: read -r line_num content; do
    report_finding "FAIL" "$file" "$line_num" "T3:Persistence" "Scheduled execution: $content"
  done < <(grep -nE '(crontab|launchctl\s+load|systemctl\s+enable)' "$file" 2>/dev/null || true)

  # T3: SSH key operations
  while IFS=: read -r line_num content; do
    report_finding "FAIL" "$file" "$line_num" "T3:Backdoor" "SSH key operation: $content"
  done < <(grep -nE 'authorized_keys' "$file" 2>/dev/null || true)

  # T3: SUID/privilege escalation
  while IFS=: read -r line_num content; do
    report_finding "FAIL" "$file" "$line_num" "T3:PrivEsc" "Privilege escalation: $content"
  done < <(grep -nE '(chmod\s+[24][0-7]{3}|chmod\s+\+s|sudo\s+)' "$file" 2>/dev/null || true)

  # T3: Git hook injection
  while IFS=: read -r line_num content; do
    report_finding "FAIL" "$file" "$line_num" "T3:GitHook" "Git hook injection: $content"
  done < <(grep -nE '\.git/hooks/' "$file" 2>/dev/null || true)

  # T5: Symlink creation outside project
  while IFS=: read -r line_num content; do
    report_finding "WARN" "$file" "$line_num" "T5:Symlink" "Symlink creation: $content"
  done < <(grep -nE 'ln\s+-s.*/etc/|ln\s+-s.*/usr/' "$file" 2>/dev/null || true)
}

# --- Main ---

if [ ! -d "$SKILLS_DIR" ]; then
  echo "Skills directory not found: $SKILLS_DIR"
  exit 0
fi

# Scan plugin markdown files
for md_file in "$SKILLS_DIR"/plugin--*.md; do
  [ -f "$md_file" ] || continue
  scan_markdown_file "$md_file"
done

# Scan any script files in plugin directories
# Plugin scripts live in the cache, but we check what's referenced
for script_dir in "$SKILLS_DIR"/../*/scripts/; do
  [ -d "$script_dir" ] || continue
  for script_file in "$script_dir"/*.{sh,py,js,ts}; do
    [ -f "$script_file" ] || continue
    scan_script_file "$script_file"
  done
done

# --- Report ---

total=$((FAIL_COUNT + WARN_COUNT + PASS_COUNT))

if [ ${#FINDINGS[@]} -eq 0 ]; then
  echo "  ✓ Plugin security scan: $total plugins checked, no issues found"
  exit 0
fi

echo ""
echo "  Plugin Security Gate — $total plugins scanned"
echo ""
for finding in "${FINDINGS[@]}"; do
  echo -e "    $finding"
done
echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo -e "  ${RED}BLOCKED${NC}: $FAIL_COUNT critical issue(s) found. Plugin installation halted."
  echo "  Review the findings above and remove or replace the affected plugins."
  exit 1
else
  echo -e "  ${YELLOW}$WARN_COUNT warning(s)${NC} — plugins installed with caution."
  exit 0
fi
