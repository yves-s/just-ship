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

**Was das Script tut:**

1. Prüft ob `git` installiert ist — bricht mit klarer Fehlermeldung ab, falls nicht
2. Prüft ob `~/.just-ship/` bereits existiert:
   - Existiert: `git pull` (Self-Update-Modus, kein Neuklonen)
   - Existiert nicht: `git clone https://github.com/yves-s/just-ship.git ~/.just-ship`
3. Prüft ob `~/.just-ship/bin` bereits im PATH ist:
   - Falls nicht: `export PATH="$HOME/.just-ship/bin:$PATH"` in `~/.zshrc` eintragen
4. Gibt "Next Steps" aus:

```
✓ just-ship installed (~/.just-ship)

Open a new terminal, then:

  cd /your-project
  just-ship setup

The setup wizard will guide you through project configuration
and optionally connect to the Just Ship Board (board.just-ship.io).
```

### 2. Verbessertes Onboarding in `just-ship setup`

Der bestehende 1/2-Dialog in `setup.sh` bekommt mehr Kontext:

```
How do you want to work?
  1) CLI-only — agents & pipeline, no board
  2) Connect to Just Ship Board (board.just-ship.io)
     → track tickets visually, run the pipeline 24/7 on a VPS
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
