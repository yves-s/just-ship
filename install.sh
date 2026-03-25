#!/usr/bin/env bash
set -euo pipefail

# --- Error handling and cleanup ---
cleanup() {
  rm -f "/tmp/.just-ship-config-backup.json"
}
trap cleanup EXIT

error() {
  echo "Error: $1" >&2
  exit 1
}

# --- Check prerequisites ---
if ! command -v git &>/dev/null; then
  echo "Error: git is required but not installed."
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "Install it with: xcode-select --install"
  else
    echo "Install it with your package manager, e.g.: sudo apt install git"
  fi
  exit 1
fi

# --- Clone or update ~/.just-ship ---
JUST_SHIP_DIR="$HOME/.just-ship"

if [ -d "$JUST_SHIP_DIR" ]; then
  if [ ! -d "$JUST_SHIP_DIR/.git" ]; then
    # Directory exists but is not a git repo (e.g. config-only dir from just-ship connect)
    # Backup config.json if present, then do a fresh clone
    if [ -f "$JUST_SHIP_DIR/config.json" ]; then
      cp "$JUST_SHIP_DIR/config.json" "/tmp/.just-ship-config-backup.json"
    fi
    rm -rf "$JUST_SHIP_DIR"
    git clone https://github.com/yves-s/just-ship.git "$JUST_SHIP_DIR" || error "Failed to clone repository"
    if [ -f "/tmp/.just-ship-config-backup.json" ]; then
      cp "/tmp/.just-ship-config-backup.json" "$JUST_SHIP_DIR/config.json"
      chmod 600 "$JUST_SHIP_DIR/config.json"
    fi
  else
    # Try fast-forward update, fall back to reset if local changes exist
    if ! git -C "$JUST_SHIP_DIR" pull --ff-only 2>/dev/null; then
      echo "Local changes detected in ~/.just-ship — resetting to latest..."
      git -C "$JUST_SHIP_DIR" fetch origin main 2>/dev/null || error "Failed to fetch updates"
      git -C "$JUST_SHIP_DIR" reset --hard origin/main 2>/dev/null || error "Failed to reset to latest version"
    fi
  fi
else
  git clone https://github.com/yves-s/just-ship.git "$JUST_SHIP_DIR" || error "Failed to clone repository"
fi

chmod +x "$JUST_SHIP_DIR/bin/"* 2>/dev/null || true

# --- Install global Claude command so /setup-just-ship works before project setup ---
mkdir -p "$HOME/.claude/commands"
if [ -f "$JUST_SHIP_DIR/commands/setup-just-ship.md" ]; then
  cp "$JUST_SHIP_DIR/commands/setup-just-ship.md" "$HOME/.claude/commands/setup-just-ship.md"
else
  echo "Warning: setup-just-ship.md not found in repository" >&2
fi

# --- Shell detection and PATH setup ---
PATH_ADDED=false

USER_SHELL="${SHELL:-/bin/bash}"

case "$USER_SHELL" in
  *zsh*)  RC_FILE="$HOME/.zshrc" ;;
  *bash*) RC_FILE="$HOME/.bash_profile" ;;
  *)      RC_FILE="$HOME/.profile" ;;
esac

# Check both the RC file and current PATH to avoid duplicate entries
if ! grep -qF '/.just-ship/bin' "$RC_FILE" 2>/dev/null && \
   ! echo "$PATH" | grep -qF "$HOME/.just-ship/bin"; then
  echo 'export PATH="$HOME/.just-ship/bin:$PATH"' >> "$RC_FILE"
  PATH_ADDED=true
fi

# --- Success output ---
echo ""
echo "✓ just-ship installed → ~/.just-ship"
echo "✓ /setup-just-ship command available in Claude Code"

if [ "$PATH_ADDED" = true ]; then
  echo "✓ Added ~/.just-ship/bin to PATH in $RC_FILE"
  echo ""
  echo "Restart your terminal, then:"
else
  echo ""
  echo "Next step:"
fi

echo ""
echo "  Open your project in Claude Code and run:"
echo ""
echo "  /setup-just-ship"
echo ""
