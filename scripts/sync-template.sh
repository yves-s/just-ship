#!/usr/bin/env bash
# sync-template.sh — Generate templates/CLAUDE.md from CLAUDE.md
#
# CLAUDE.md is the Single Source of Truth for framework instructions.
# This script generates templates/CLAUDE.md by replacing project-specific
# sections with placeholders. Run automatically via quality-gate hook
# whenever CLAUDE.md is edited.
#
# Usage: bash scripts/sync-template.sh [repo-root]

set -euo pipefail

REPO_ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
SOURCE="$REPO_ROOT/CLAUDE.md"
TARGET="$REPO_ROOT/templates/CLAUDE.md"

if [ ! -f "$SOURCE" ]; then
  echo "ERROR: $SOURCE not found" >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/templates"

# Generate template from CLAUDE.md using node for reliable multi-line replacements
export SOURCE TARGET
node -e "
const fs = require('fs');
let content = fs.readFileSync(process.env.SOURCE, 'utf-8');

// 1. Title: replace project name
content = content.replace(
  /^# CLAUDE\.md – .+ Project Instructions$/m,
  '# CLAUDE.md – {{PROJECT_NAME}} Project Instructions'
);

// 2. Projekt section: replace content between '## Projekt' and next '---'
content = content.replace(
  /^## Projekt$\n[\s\S]*?\n(?=^---$)/m,
  '## Projekt\n\n**{{PROJECT_NAME}}** – TODO: Kurze Projektbeschreibung hier einfügen.\n\n'
);

// 3. Code conventions: replace content between '### Code' and next '###' or '---'
content = content.replace(
  /^### Code$\n[\s\S]*?\n(?=^###|^---)/m,
  '### Code\n- TODO: Code-Konventionen hier einfügen (Sprache, Framework, Imports, etc.)\n\n'
);

// 4. Architektur: replace content between '## Architektur' and next '---'
content = content.replace(
  /^## Architektur$\n[\s\S]*?\n(?=^---$)/m,
  '## Architektur\n\nTODO: Projektstruktur hier einfügen.\n\n\`\`\`\nsrc/\n├── ...\n\`\`\`\n\n'
);

// 5. Remove Definition of Done section (just-ship specific)
content = content.replace(
  /^### Definition of Done — Pipeline-Tickets$\n[\s\S]*?\n(?=^## )/m,
  ''
);

// 6. Remove Ecosystem subsection (just-ship specific)
content = content.replace(
  /^### Ecosystem$\n[\s\S]*?\n(?=^---$)/m,
  ''
);

// Clean up any double blank lines left by removals
content = content.replace(/\n{3,}/g, '\n\n');

fs.writeFileSync(process.env.TARGET, content);

// Report
const sourceLines = fs.readFileSync(process.env.SOURCE, 'utf-8').split('\n').length;
const targetLines = content.split('\n').length;
console.log('✓ templates/CLAUDE.md generated (' + targetLines + ' lines from ' + sourceLines + ' source lines)');
"
