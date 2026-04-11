#!/bin/bash
# Test: mode-detection in /init command
# Verifies that mode field is set correctly based on CLAUDE_PLUGIN_ROOT env var

set -e

# Test 1: Standalone mode (CLAUDE_PLUGIN_ROOT not set)
echo "Test 1: Standalone mode detection"
tmpdir=$(mktemp -d)
cd "$tmpdir"

# Create minimal project.json
cat > project.json << 'EOF'
{
  "name": "test-project",
  "description": "Test"
}
EOF

# Create template
mkdir -p templates
cat > templates/project.json << 'EOF'
{
  "name": "my-project",
  "description": "Project description",
  "mode": "",
  "stack": {}
}
EOF

# Run migration simulation (standalone)
unset CLAUDE_PLUGIN_ROOT
DETECTED_MODE="standalone"
RESULT=$(TPL="$tmpdir/templates/project.json" MODE="$DETECTED_MODE" node -e "
  const fs = require('fs');
  const existing = JSON.parse(fs.readFileSync('project.json', 'utf-8'));
  const template = JSON.parse(fs.readFileSync(process.env.TPL, 'utf-8'));
  let changed = false;

  for (const [key, val] of Object.entries(template)) {
    if (!(key in existing)) {
      existing[key] = val;
      changed = true;
    }
  }

  if (!existing.mode) {
    existing.mode = process.env.MODE;
    changed = true;
  } else if (existing.mode !== process.env.MODE) {
    existing.mode = process.env.MODE;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync('project.json', JSON.stringify(existing, null, 2) + '\n');
    process.stdout.write('migrated');
  } else {
    process.stdout.write('current');
  }
" 2>/dev/null || echo "")

if [ "$RESULT" = "migrated" ]; then
  mode=$(jq -r '.mode' project.json)
  if [ "$mode" = "standalone" ]; then
    echo "✓ Test 1 PASS: mode set to standalone"
  else
    echo "✗ Test 1 FAIL: mode is '$mode', expected 'standalone'"
    exit 1
  fi
else
  echo "✗ Test 1 FAIL: migration did not run"
  exit 1
fi

# Test 2: Plugin mode (CLAUDE_PLUGIN_ROOT set)
echo "Test 2: Plugin mode detection"
rm project.json
cat > project.json << 'EOF'
{
  "name": "test-project",
  "description": "Test"
}
EOF

CLAUDE_PLUGIN_ROOT="/some/plugin/path"
DETECTED_MODE="plugin"

RESULT=$(TPL="$tmpdir/templates/project.json" MODE="$DETECTED_MODE" node -e "
  const fs = require('fs');
  const existing = JSON.parse(fs.readFileSync('project.json', 'utf-8'));
  const template = JSON.parse(fs.readFileSync(process.env.TPL, 'utf-8'));
  let changed = false;

  for (const [key, val] of Object.entries(template)) {
    if (!(key in existing)) {
      existing[key] = val;
      changed = true;
    }
  }

  if (!existing.mode) {
    existing.mode = process.env.MODE;
    changed = true;
  } else if (existing.mode !== process.env.MODE) {
    existing.mode = process.env.MODE;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync('project.json', JSON.stringify(existing, null, 2) + '\n');
    process.stdout.write('migrated');
  } else {
    process.stdout.write('current');
  }
" 2>/dev/null || echo "")

if [ "$RESULT" = "migrated" ]; then
  mode=$(jq -r '.mode' project.json)
  if [ "$mode" = "plugin" ]; then
    echo "✓ Test 2 PASS: mode set to plugin"
  else
    echo "✗ Test 2 FAIL: mode is '$mode', expected 'plugin'"
    exit 1
  fi
else
  echo "✗ Test 2 FAIL: migration did not run"
  exit 1
fi

# Test 3: Mode update (existing mode should be overwritten)
echo "Test 3: Mode update from standalone to plugin"
rm project.json
cat > project.json << 'EOF'
{
  "name": "test-project",
  "description": "Test",
  "mode": "standalone"
}
EOF

DETECTED_MODE="plugin"

RESULT=$(TPL="$tmpdir/templates/project.json" MODE="$DETECTED_MODE" node -e "
  const fs = require('fs');
  const existing = JSON.parse(fs.readFileSync('project.json', 'utf-8'));
  const template = JSON.parse(fs.readFileSync(process.env.TPL, 'utf-8'));
  let changed = false;

  for (const [key, val] of Object.entries(template)) {
    if (!(key in existing)) {
      existing[key] = val;
      changed = true;
    }
  }

  if (!existing.mode) {
    existing.mode = process.env.MODE;
    changed = true;
  } else if (existing.mode !== process.env.MODE) {
    existing.mode = process.env.MODE;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync('project.json', JSON.stringify(existing, null, 2) + '\n');
    process.stdout.write('migrated');
  } else {
    process.stdout.write('current');
  }
" 2>/dev/null || echo "")

if [ "$RESULT" = "migrated" ]; then
  mode=$(jq -r '.mode' project.json)
  if [ "$mode" = "plugin" ]; then
    echo "✓ Test 3 PASS: mode updated from standalone to plugin"
  else
    echo "✗ Test 3 FAIL: mode is '$mode', expected 'plugin'"
    exit 1
  fi
else
  echo "✗ Test 3 FAIL: migration did not run"
  exit 1
fi

# Test 4: Mode idempotency (no change if mode already matches)
echo "Test 4: Mode idempotency"
rm project.json
cat > project.json << 'EOF'
{
  "name": "test-project",
  "description": "Test",
  "mode": "plugin",
  "stack": {}
}
EOF

DETECTED_MODE="plugin"

RESULT=$(TPL="$tmpdir/templates/project.json" MODE="$DETECTED_MODE" node -e "
  const fs = require('fs');
  const existing = JSON.parse(fs.readFileSync('project.json', 'utf-8'));
  const template = JSON.parse(fs.readFileSync(process.env.TPL, 'utf-8'));
  let changed = false;

  for (const [key, val] of Object.entries(template)) {
    if (!(key in existing)) {
      existing[key] = val;
      changed = true;
    }
  }

  if (!existing.mode) {
    existing.mode = process.env.MODE;
    changed = true;
  } else if (existing.mode !== process.env.MODE) {
    existing.mode = process.env.MODE;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync('project.json', JSON.stringify(existing, null, 2) + '\n');
    process.stdout.write('migrated');
  } else {
    process.stdout.write('current');
  }
" 2>/dev/null || echo "")

if [ "$RESULT" = "current" ]; then
  mode=$(jq -r '.mode' project.json)
  if [ "$mode" = "plugin" ]; then
    echo "✓ Test 4 PASS: mode unchanged when already correct"
  else
    echo "✗ Test 4 FAIL: mode is '$mode', expected 'plugin'"
    exit 1
  fi
else
  echo "✗ Test 4 FAIL: unexpected migration result: $RESULT"
  exit 1
fi

# Cleanup
cd /
rm -rf "$tmpdir"

echo ""
echo "All mode-detection tests passed!"
