# Incident Report: Init-Flow liefert nicht-funktionale Projekte

**Datum:** 2026-04-11
**Severity:** High
**Betroffene Tickets:** T-799, T-802, T-805
**Status:** Resolved

## Was ist passiert

Ein User hat `/init` auf einem neuen Projekt (Physio+) ausgeführt und ein nicht-funktionales Projekt erhalten: 12-Zeilen CLAUDE.md statt 265 Zeilen, leere project.json, keine Framework-Dateien (Agents, Skills, Commands). Das Projekt war nach Init nicht arbeitsfähig.

Drei separate Ursachen wurden identifiziert und nacheinander gefixt — jede hätte einzeln verhindert werden müssen.

## Root Causes

### 1. Template-Drift (T-805)

`templates/CLAUDE.md` war 104 Zeilen hinter der produktiven `CLAUDE.md`. Änderungen an der CLAUDE.md (Role Mapping, Sparring-Flow, Routing-Tabellen) wurden nie ins Template zurückgespiegelt. Neue Projekte bekamen eine veraltete Version.

**Warum nicht erkannt:** Kein Mechanismus um Template-Drift zu erkennen. Kein Diff-Check, kein CI-Gate, keine Rule die daran erinnert.

### 2. Keine Migration bei existierenden Dateien (T-802)

Sowohl `setup.sh` als auch `/init` prüften nur `if [ ! -f CLAUDE.md ]`. Sobald eine Datei existierte — egal wie kaputt — wurde sie nie wieder angefasst. Eine kaputte Erstinstallation blieb für immer kaputt.

**Warum nicht erkannt:** "Idempotent" wurde als "nie überschreiben" interpretiert statt als "gewünschten Zustand sicherstellen". Kein Test der verifiziert, dass eine kaputte CLAUDE.md nach erneutem Init korrekt ist.

### 3. Claude interpretiert statt kopiert (T-802 Root Cause)

Der `/init` Command sagte Claude "Lies templates/CLAUDE.md und ersetze Platzhalter." Claude las das 265-Zeilen-Template und schrieb eine 12-Zeilen-Zusammenfassung. Die Instruktion war ambig — "lesen und ersetzen" bedeutet für einen LLM etwas anderes als `sed`.

**Warum nicht erkannt:** Kein Test der nach `/init` die Zeilenzahl der CLAUDE.md prüft. Kein Acceptance Criteria das "mindestens 200 Zeilen" fordert.

### 4. Skills-Copy Glob-Bug (T-799)

`setup.sh` Zeile 783 nutzte `skills/*.md` statt `skills/*/SKILL.md`. Der Glob matchte nichts und scheiterte still. Die korrekte Logik existierte bereits im Update-Modus — wurde nur nicht in den Setup-Modus übernommen.

**Warum nicht erkannt:** Kein Test der nach `setup.sh` die Anzahl der kopierten Skills verifiziert. Die `cp` Fehlermeldung wurde von stderr-Suppression verschluckt.

## Timeline

| Zeit | Aktion | Ergebnis |
|---|---|---|
| 20:21 | User führt `/init` auf Physio+ aus | 12-Zeilen CLAUDE.md, leere project.json |
| 20:36 | T-799 erstellt (Framework-Dateien fehlen) | |
| 20:48 | T-799 gemergt | `/init` kopiert jetzt Framework-Dateien, setup.sh Glob gefixt |
| 21:02 | T-802 erstellt (Migration fehlt) | |
| 21:20 | T-802 gemergt | Migration für kaputte CLAUDE.md und project.json |
| 21:22 | Hotfix: grep Pattern `^## Projekt$` | Verhindert false-positive Match auf `## Projektstruktur` |
| 21:33 | T-805 erstellt (Template veraltet) | |
| 21:35 | T-805 PR erstellt | Template auf aktuellen Stand synchronisiert |

## Fixes

| Ticket | Fix | Status |
|---|---|---|
| T-799 | `/init` kopiert Framework-Dateien, setup.sh Glob-Fix | Merged |
| T-802 | Migration für unvollständige CLAUDE.md + project.json | Merged |
| T-802 hotfix | Exakter grep Pattern für `## Projekt$` | Merged |
| T-805 | Template auf aktuellen Stand synchronisiert | PR open |

## Systemische Probleme

### Problem 1: Kein Template-Sync-Mechanismus

Änderungen an der CLAUDE.md werden manuell gemacht. Es gibt keinen Mechanismus der sicherstellt, dass das Template synchron bleibt. Das wird wieder passieren.

**Empfohlener Fix:** CI-Check der `diff CLAUDE.md templates/CLAUDE.md` gegen eine Allowlist von projektspezifischen Sektionen prüft. Alarmiert wenn Framework-Sektionen divergieren. Alternativ: Template wird aus CLAUDE.md generiert (Single Source of Truth).

### Problem 2: Keine Integration-Tests für Init-Flow

Der gesamte Init-Flow hat keine automatisierten Tests. Wir verlassen uns auf manuelle Verifikation — die bei 3 separaten Bugs alle versagt hat.

**Empfohlener Fix:** Script `scripts/init-smoke-test.sh` das:
1. Temporäres Verzeichnis erstellt
2. `setup.sh` ausführt
3. Verifiziert: CLAUDE.md >200 Zeilen, alle Framework-Sektionen vorhanden, Skills-Count >30, project.json alle Felder hat
4. Erneut ausführt und verifiziert: nichts überschrieben (Idempotenz)
5. Kaputte CLAUDE.md simuliert und verifiziert: Migration funktioniert

### Problem 3: Stille Fehler

`cp` Globs die nichts matchen, `grep` Patterns die falsch matchen, `node` Scripts die crashen — alles wird still verschluckt oder produziert kryptische Fehlermeldungen. Der User sieht "✓ 0 skills" und denkt das ist korrekt.

**Empfohlener Fix:** Assertions nach kritischen Operationen. `setup.sh` prüft am Ende: "Mindestens 30 Skills kopiert? Mindestens 200 Zeilen in CLAUDE.md? Alle Template-Felder in project.json?" Bei Verstoß: klare Fehlermeldung statt stilles "✓".

## Action Items

| # | Aktion | Priorität | Ticket |
|---|---|---|---|
| 1 | CI-Check für Template-Drift (CLAUDE.md vs templates/CLAUDE.md) | High | Noch zu erstellen |
| 2 | Init-Flow Integration-Tests (`scripts/init-smoke-test.sh`) | High | Noch zu erstellen |
| 3 | Post-Install Assertions in setup.sh (Zeilenzahl, Skills-Count, Felder) | Medium | Noch zu erstellen |
| 4 | Single Source of Truth: Template aus CLAUDE.md generieren statt manuell synchronisieren | Medium | Noch zu erstellen |
