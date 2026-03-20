---
name: connect-board
description: Board-Verbindung hinzufügen oder ändern — Workspace + API Key in globale Config schreiben
---

# /connect-board — Board verbinden

Verbindet einen Workspace mit dem Just Ship Board. Schreibt Workspace-Daten in `~/.just-ship/config.json`.

## Argumente (optional)

| Flag | Beschreibung | Pflicht |
|---|---|---|
| `--board` | Board URL (z.B. `https://board.just-ship.io`) | Ja (bei Flag-Modus) |
| `--workspace` | Workspace Slug | Ja (bei Flag-Modus) |
| `--workspace-id` | Workspace UUID | Ja (bei Flag-Modus) |
| `--key` | API Key (`adp_...`) | Ja (bei Flag-Modus) |
| `--project` | Projekt UUID (optional — setzt direkt auch das Projekt) | Nein |

## Ausführung

### Modus 1: Alle Pflicht-Flags vorhanden

Wenn alle Pflicht-Flags übergeben wurden, direkt ausführen:

1. Schreibe Workspace-Eintrag:
   ```bash
   ".claude/scripts/write-config.sh" add-workspace \
     --slug <workspace> --board <board> --workspace-id <workspace-id> --key <key>
   ```

2. Falls `--project` übergeben:
   ```bash
   ".claude/scripts/write-config.sh" set-project \
     --workspace <workspace> --project-id <project>
   ```

3. Validierung (siehe unten) + Bestätigung.

---

### Modus 2: Interaktiv (keine oder unvollständige Flags)

#### Schritt 0: Bestehende Workspaces prüfen

Lies die globale Config:
```bash
cat "$HOME/.just-ship/config.json" 2>/dev/null || echo "{}"
```

**Falls bereits Workspaces vorhanden:**
```
Verbundene Workspaces: agentic-dev, another-workspace

Möchtest du einen bestehenden Workspace für dieses Projekt nutzen,
oder einen neuen Workspace verbinden?

  1. Bestehenden Workspace nutzen
  2. Neuen Workspace verbinden
```

Falls User bestehenden Workspace wählt → nur `--project` abfragen (falls nicht bekannt) und `set-project` aufrufen. KEINE Credentials abfragen. Fertig.

Falls kein Workspace existiert oder User neuen will → weiter mit Schritt 1.

---

#### Schritt 1: Einstiegsfrage

```
Board verbinden

  1. Ich habe den Key — API Key aus dem Board kopiert
  2. Ich bin neu — Ich brauche erst ein Board-Konto
```

---

#### Weg 1: "Ich habe den Key"

Zeige ein Eingabefeld:
```
Füge den API Key oder Verbindungs-Code aus dem Board ein:
```

**Smart Detection — prüfe was der User eingegeben hat:**

**Fall A: Eingabe startet mit `jsp_`** → Verbindungs-Code erkannt.

1. Dekodiere via write-config.sh:
   ```bash
   ".claude/scripts/write-config.sh" parse-jsp --token "<eingabe>"
   ```
2. Falls Fehler: Zeige die Fehlermeldung und biete an:
   ```
   ✗ Verbindungs-Code ungültig
   Der Code konnte nicht dekodiert werden. Kopiere ihn erneut aus dem Board.

   Erneut versuchen oder manuell eingeben?
     1. Erneut versuchen
     2. Manuell eingeben (Einzelwerte)
   ```
3. Falls OK: Extrahierte Werte nutzen, direkt `add-workspace` aufrufen.
4. Falls `add-workspace` mit Slug-Kollision fehlschlägt (gleicher Slug, andere Board URL):
   ```
   ⚠ Workspace "{slug}" ist bereits mit {andere-url} verbunden.

     1. Bestehende Verbindung aktualisieren (überschreibt die alte URL)
     2. Abbrechen
   ```
   Bei Option 1: `remove-board --slug <slug>` und dann erneut `add-workspace`.
5. Weiter zu Validierung.

**Fall B: Eingabe startet mit `adp_`** → Manueller API Key erkannt.

```
API Key erkannt. Ich brauche noch ein paar Angaben:

Board URL:
  ↳ Die URL deines Boards. Meistens board.just-ship.io
  (Enter für https://board.just-ship.io)

Workspace Slug:
  ↳ Steht in der URL: board.just-ship.io/{slug}

Workspace ID:
  ↳ Board → Workspace Settings → General → Workspace ID
```

Alle 3 Werte in **einer einzigen Nachricht** abfragen, nicht nacheinander.
Board URL hat Default `https://board.just-ship.io` (Enter = Default).
Dann `add-workspace` aufrufen. Weiter zu Validierung.

**Fall C: Eingabe ist weder `jsp_` noch `adp_`** → Unbekannt.

```
⚠ Eingabe nicht erkannt.

Erwartet wird entweder:
  • Ein Verbindungs-Code (beginnt mit jsp_) — aus Board → Workspace Settings → Connect
  • Ein API Key (beginnt mit adp_) — aus Board → Workspace Settings → API Keys

Erneut versuchen?
```

---

#### Weg 2: "Ich bin neu"

```
Willkommen bei just-ship!

So geht's:
  1. Registriere dich: https://board.just-ship.io/register
  2. Erstelle einen Workspace
  3. Du bekommst direkt den Verbindungs-Code angezeigt — kopiere ihn
  4. Führe /connect-board erneut aus und füge ihn ein

Das Board führt dich durch alle Schritte.
```

Danach Befehl beenden (kein weiterer Input nötig).

---

### Validierung

Nach dem Schreiben der Workspace-Daten: Prüfe die Verbindung:
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Pipeline-Key: <key>" "<board>/api/projects"
```
- `200`: `✓ Board-Verbindung verifiziert`
- `401`: `⚠ API Key abgelehnt — prüfe den Key unter Board → Workspace Settings`
- Andere: `⚠ Board nicht erreichbar — prüfe die URL`

### Migration erkennen

Falls `project.json` noch ein `api_key` Feld hat:
```
Bestehender api_key in project.json gefunden.
In globale Config migrieren? (J/n)
```

Falls ja:
```bash
".claude/scripts/write-config.sh" migrate \
  --project-dir . --slug <workspace-slug>
```

### Erfolgsausgabe

```
✓ Workspace "<workspace>" verbunden
✓ Credentials in ~/.just-ship/config.json gespeichert
✓ project.json aktualisiert (pipeline.workspace = "<workspace>")

Nächster Schritt: /add-project um ein Board-Projekt zu verknüpfen
```
