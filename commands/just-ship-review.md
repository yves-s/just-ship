---
name: just-ship-review
description: /just-ship-review — Branch lokal auschecken, builden, Dev-Server starten und testen
---

# /review — Branch lokal auschecken, builden und testen

Den fehlenden Schritt zwischen Board und `/ship` — Branch lokal auschecken, builden, Dev-Server starten, testen, dann shippen oder fixen.

## Konfiguration

Lies `project.json` fuer Konventionen, Build-Commands und Pipeline-Config.

**Pipeline (optional):** Falls `pipeline.workspace_id` gesetzt → `board-api.sh` verwenden:
```bash
bash .claude/scripts/board-api.sh get "tickets/{N}"
```
Credentials werden intern aufgelöst.

Falls keine Pipeline konfiguriert: Pipeline-Schritte (Board-Status, Ticket-Info) ueberspringen.

## Zwei Modi

### Modus A: `/review` (ohne Argument) — Branch-Auswahl

Sammle alle Feature/Fix/Chore-Branches und praesentiere sie als Auswahl.

#### 1. Branches sammeln

```bash
git fetch --prune origin
git branch -r --no-merged origin/main | grep -E 'origin/(feature|fix|chore|docs)/' | sed 's|origin/||' | sed 's/^[[:space:]]*//'
```

#### 2. Kontext pro Branch anreichern

Fuer jeden Branch:
- **PR-Status:** `gh pr view {branch} --json state -q .state 2>/dev/null || echo "kein PR"`
- **Board-Status (optional):** Falls Pipeline konfiguriert, Ticket-Nummer aus Branch-Name extrahieren (Pattern `T-{N}` oder `/{N}-`), dann:
  ```bash
  bash .claude/scripts/board-api.sh get "tickets/{N}" | node -e "
    const t = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
    process.stdout.write(t.data?.status || t.status || 'unbekannt');
  "
  ```

#### 3. Auswahl praesentieren

```
Welchen Branch willst du reviewen?

a) fix/T-385-members-unknown-display (in_review, PR vorhanden)
b) feature/T-287-universal-event-streaming (kein PR)
c) fix/worktree-stale-cleanup (remote gone)
```

Der User waehlt eine Option, dann weiter mit dem Review-Flow (ab Schritt 1 unten).

Falls keine Branches vorhanden: `Keine offenen Branches zum Reviewen.` — fertig.

### Modus B: `/review T-{N}` (mit Ticket-Nummer) — Direkteinstieg

`$ARGUMENTS` enthaelt die Ticket-Nummer (z.B. `T-385` oder `385`).

Nummer extrahieren und zugehoerigen Branch finden:

```bash
git fetch --prune origin
# Pattern 1: T-{N} im Branch-Namen
BRANCH=$(git branch -r | grep -E "T-{N}-" | head -1 | sed 's|origin/||' | sed 's/^[[:space:]]*//')
# Pattern 2: /{N}- im Branch-Namen (ohne T- Prefix)
if [ -z "$BRANCH" ]; then
  BRANCH=$(git branch -r | grep -E "/{N}-" | head -1 | sed 's|origin/||' | sed 's/^[[:space:]]*//')
fi
```

Falls kein Branch gefunden: `Kein Branch fuer T-{N} gefunden. Nutze /review ohne Argument fuer eine Uebersicht.` — fertig.

Falls Branch gefunden: weiter mit dem Review-Flow.

## Review-Flow

### 1. Laufenden Dev-Server stoppen

Falls `.claude/.dev-server-pid` existiert:
```bash
if [ -f .claude/.dev-server-pid ]; then
  OLD_PID=$(cat .claude/.dev-server-pid)
  kill $OLD_PID 2>/dev/null || true
  rm -f .claude/.dev-server-pid
fi
```

### 2. Branch auschecken

#### Worktree pruefen

Falls ein Worktree fuer den Branch existiert (`.worktrees/T-{N}` oder anderes Verzeichnis mit passendem Branch):
```bash
# Pruefen ob Worktree existiert
if [ -d ".worktrees/T-{N}" ]; then
  WORK_DIR=".worktrees/T-{N}"
fi
```

Falls Worktree vorhanden: **Alle weiteren Schritte im Worktree-Verzeichnis ausfuehren.**

#### Kein Worktree — normaler Checkout

```bash
# Uncommitted Changes pruefen
if [ -n "$(git status --porcelain)" ]; then
  echo "WARNUNG: Uncommitted Changes vorhanden. Bitte erst committen oder stashen."
  exit 1
fi

git checkout {branch}
git pull origin {branch}
```

Falls Checkout fehlschlaegt (uncommitted Changes): **Abbrechen** mit Warnung. Das ist der einzige Grund zum Stoppen.

Ausgabe: `Branch {branch} ausgecheckt`

### 3. Dependencies installieren

Falls `build.install` in `project.json` gesetzt:
```bash
{build.install}
```

Falls nicht gesetzt, auto-detect:
- `package-lock.json` existiert → `npm ci`
- `yarn.lock` existiert → `yarn install --frozen-lockfile`
- `pnpm-lock.yaml` existiert → `pnpm install --frozen-lockfile`
- Sonst: ueberspringen

Ausgabe: `Dependencies installiert`

### 4. Build

Lies Build-Command aus `project.json` (`build.web`):
```bash
{build.web}
```

Falls Build fehlschlaegt: Output anzeigen. Frage ob Dev-Server trotzdem gestartet werden soll.

Ausgabe:
- `Build erfolgreich` (bei Erfolg)
- `Build fehlgeschlagen — siehe Output oben` (bei Fehler)

### 5. Dev-Server starten

Falls `build.dev` in `project.json` gesetzt:
```bash
{build.dev}
```

Starte im Background (Bash `run_in_background`). Die PID des Background-Prozesses in `.claude/.dev-server-pid` speichern:
```bash
echo $PID > .claude/.dev-server-pid
```
Hinweis: `run_in_background` gibt die PID zurueck. Diese sofort in die Datei schreiben.

Falls `build.dev` NICHT konfiguriert: Dev-Server ueberspringen, nur Build-Ergebnis melden.

**Port:** Aus `project.json` Feld `build.dev_port` lesen, oder aus dem Dev-Server-Output parsen.

Ausgabe: `Dev-Server laeuft auf localhost:{port}`

### 6. Meldung an User

```
Review bereit fuer {branch}:
- Dev-Server laeuft auf localhost:{port}
- Schau's dir an und sag "passt" zum Shippen oder beschreib was gefixt werden soll.
```

Falls kein Dev-Server (weil `build.dev` fehlt):
```
Review bereit fuer {branch}:
- Build war erfolgreich.
- Sag "passt" zum Shippen oder beschreib was gefixt werden soll.
```

### 7. Warten

User testet im Browser. Claude wartet auf Antwort.

### 8. User-Feedback verarbeiten

#### 8a. "passt" (oder andere Ship-Trigger)

Trigger-Woerter: "passt", "done", "sieht gut aus", "klappt", "fertig", "ship it", "mach zu"

→ `/ship` autonom ausfuehren. Keine Rueckfragen.

#### 8b. Fix beschrieben

Der User beschreibt was gefixt werden soll. Dann:

1. **Fix implementieren** — direkt in der aktuellen Session, kein Sub-Agent
2. **Dependencies** — NUR neu installieren falls `package.json`, `package-lock.json` o.ae. geaendert wurde
3. **Build neu ausfuehren:**
   ```bash
   {build.web}
   ```
4. **Dev-Server neu starten:**
   ```bash
   # Alten Prozess stoppen
   if [ -f .claude/.dev-server-pid ]; then
     OLD_PID=$(cat .claude/.dev-server-pid)
     kill $OLD_PID 2>/dev/null || true
     rm -f .claude/.dev-server-pid
   fi
   # Neuen Dev-Server starten (run_in_background)
   {build.dev}
   ```
   Neue PID in `.claude/.dev-server-pid` speichern.

5. **Meldung:**
   ```
   Fix angewendet, Dev-Server laeuft. Nochmal testen?
   ```

6. Zurueck zu Schritt 7 — User testet erneut.

**Kein Iterations-Limit.** Der User entscheidet wann "passt".

**Falls der Fix den Build bricht:** Build-Output anzeigen, Claude versucht den Build-Fehler automatisch zu beheben. Danach nochmal Build + Dev-Server starten.

## Fehlerbehandlung

- **Build-Fehler:** Output anzeigen, fragen ob Dev-Server trotzdem gestartet werden soll
- **Checkout-Fehler (uncommitted Changes):** Warnung, abbrechen — einziger Grund zum Stoppen
- **Kein Branch gefunden:** Fehlermeldung mit Hinweis auf `/review` ohne Argument
- **Laufender Dev-Server bei neuem Review:** Alten Dev-Server stoppen (PID aus `.claude/.dev-server-pid`), dann neuen Branch auschecken
- **Dev-Server startet nicht:** Fehlermeldung anzeigen, Review trotzdem fortsetzen (User kann manuell starten)

## Verboten

- NICHT den Skill `finishing-a-development-branch` aufrufen
- NICHT `git add -A` oder `git add .`
- NICHT `--force` push
- NICHT mergen ohne "passt" — das macht `/ship`
- NICHT `cat ~/.just-ship/config.json` — IMMER `board-api.sh` verwenden
