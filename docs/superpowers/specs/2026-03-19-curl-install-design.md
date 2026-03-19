# Design: curl one-liner Installation für just-ship

**Date:** 2026-03-19
**Status:** Approved
**Scope:** Einfache Remote-Installation via curl, verbessertes Onboarding

---

## Problem

Die aktuelle Installation erfordert zwei manuelle Schritte:

```bash
git clone https://github.com/yves-s/just-ship.git ~/.just-ship
echo 'export PATH="$HOME/.just-ship/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

Das ist unnötig komplex für ein Tool, das Developer sofort einsetzen wollen. Außerdem ist nach der Installation nicht klar, was als nächstes zu tun ist — insbesondere der optionale Board-Connect-Schritt ist versteckt.

---

## Lösung

### 1. `install.sh` — curl one-liner

Neues Script im Repo-Root. Einzige Dependency: `git` (auf macOS standardmäßig vorhanden).

```bash
curl -fsSL https://raw.githubusercontent.com/yves-s/just-ship/main/install.sh | bash
```

**Was das Script tut** (nutzt `set -euo pipefail`, exit 1 bei Fehler):

1. Prüft ob `git` installiert ist — bricht mit klarer Fehlermeldung ab (`exit 1`)
2. Prüft ob `~/.just-ship/` bereits existiert:
   - Existiert: `git pull --ff-only` (Self-Update-Modus, kein Neuklonen). Falls `--ff-only` fehlschlägt (lokale Änderungen o.ä.), wird eine klare Fehlermeldung ausgegeben: "Could not update ~/.just-ship — local changes detected. Run `git pull` manually."
   - Existiert nicht: `git clone https://github.com/yves-s/just-ship.git ~/.just-ship`
3. Shell-Detection via `$SHELL`:
   - zsh → schreibt in `~/.zshrc`
   - bash → schreibt in `~/.bash_profile`
   - andere → schreibt in `~/.profile`
   - Prüft ob `~/.just-ship/bin` bereits im PATH ist (via `echo "$PATH" | grep -q ".just-ship/bin"`). Nur wenn nicht vorhanden: `export PATH="$HOME/.just-ship/bin:$PATH"` in die RC-Datei eintragen.
4. Gibt "Next Steps" aus (kein Platzhalter-Pfad):

```
✓ just-ship installed → ~/.just-ship

Restart your terminal, then run in any project directory:

  just-ship setup

The setup wizard guides you through project configuration
and optionally connects to the Just Ship Board (board.just-ship.io).
```

**GitHub URL:** `https://github.com/yves-s/just-ship.git` — das ist das korrekte Repo unter dem `yves-s` Account. `install.sh` ist das erste Script, das die Remote-URL hardcoded. Die URL muss bei einem Org-Transfer aktualisiert werden.

**Executable bit:** `install.sh` muss nicht `+x` sein, da es via `curl | bash` ausgeführt wird (bash interpretiert es direkt). Kein `chmod`-Schritt nötig.

### 2. Verbessertes Onboarding in `just-ship setup`

In `setup.sh`, Zeilen 521–525 (der `echo`/`read`-Block vor dem SETUP_MODE-Read), ersetzen:

```bash
# Vorher:
echo "How do you want to work?"
echo "  1) CLI-only — just agents & pipeline, no board"
echo "  2) Connect to a board"
echo ""
read -p "  Choice (1/2): " SETUP_MODE

# Nachher:
echo "How do you want to work?"
echo "  1) CLI-only — agents & pipeline, no board"
echo "  2) Connect to Just Ship Board (board.just-ship.io)"
echo "     → track tickets visually, run the pipeline 24/7 on a VPS"
echo ""
read -p "  Choice (1/2): " SETUP_MODE
```

### 3. README Quick Start ersetzen

Der bisherige 2-Zeilen-Quick-Start wird durch den One-Liner ersetzt:

```bash
curl -fsSL https://raw.githubusercontent.com/yves-s/just-ship/main/install.sh | bash
```

---

## Self-Update

`just-ship self-update` funktioniert unverändert (ruft intern `git pull` auf `~/.just-ship` auf). Der Installer selbst erkennt eine Neuinstallation vs. Re-Ausführung und verhält sich entsprechend.

---

## Was sich NICHT ändert

- `setup.sh` — keine inhaltlichen Änderungen, nur der Board-Dialog bekommt mehr Text
- `bin/just-ship` — unverändert
- Alle Framework-Dateien (agents, commands, skills, pipeline) — unverändert
- Bestehende Projekte — kein Update-Bedarf

---

## Out of Scope

- Homebrew Tap (separates Ticket T-375 für lokales Board, Homebrew für später)
- npm Distribution
- Windows / Linux Support (macOS first)
- Automatisches Browser-Öffnen beim Board-Connect
- Lokales Board starten (`just-ship board`) — T-375

---

## Dateien, die erstellt/geändert werden

| Datei | Aktion |
|-------|--------|
| `install.sh` | Neu erstellen |
| `README.md` | Quick Start ersetzen |
| `setup.sh` | Board-Dialog-Text erweitern (2 Zeilen) |
