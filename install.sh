#!/usr/bin/env bash
set -euo pipefail

# Check if git is installed
if ! command -v git &>/dev/null; then
  echo "Error: git is required but not installed."
  echo "Install it with: xcode-select --install"
  exit 1
fi

# Clone or update ~/.just-ship
if [ -d "$HOME/.just-ship" ]; then
  if [ ! -d "$HOME/.just-ship/.git" ]; then
    # Directory exists but is not a git repo (e.g. config-only dir from just-ship connect)
    # Backup config.json if present, then do a fresh clone
    if [ -f "$HOME/.just-ship/config.json" ]; then
      cp "$HOME/.just-ship/config.json" "/tmp/.just-ship-config-backup.json"
    fi
    rm -rf "$HOME/.just-ship"
    git clone https://github.com/yves-s/just-ship.git "$HOME/.just-ship"
    if [ -f "/tmp/.just-ship-config-backup.json" ]; then
      cp "/tmp/.just-ship-config-backup.json" "$HOME/.just-ship/config.json"
      chmod 600 "$HOME/.just-ship/config.json"
      rm -f "/tmp/.just-ship-config-backup.json"
    fi
  elif ! git -C "$HOME/.just-ship" pull --ff-only; then
    echo "Could not update ~/.just-ship — run: cd ~/.just-ship && git pull"
    exit 1
  fi
else
  git clone https://github.com/yves-s/just-ship.git "$HOME/.just-ship"
fi

chmod +x "$HOME/.just-ship/bin/"*

# Install global Claude command so /setup-just-ship works before project setup
mkdir -p "$HOME/.claude/commands"
cp "$HOME/.just-ship/commands/setup-just-ship.md" "$HOME/.claude/commands/setup-just-ship.md"

# Shell detection and PATH setup
PATH_ADDED=false

SHELL="${SHELL:-}"

case "$SHELL" in
  *zsh*)  RC_FILE="$HOME/.zshrc" ;;
  *bash*) RC_FILE="$HOME/.bash_profile" ;;
  *)      RC_FILE="$HOME/.profile" ;;
esac

if ! echo "$PATH" | grep -qF "$HOME/.just-ship/bin"; then
  echo 'export PATH="$HOME/.just-ship/bin:$PATH"' >> "$RC_FILE"
  PATH_ADDED=true
fi

# Print success output
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
