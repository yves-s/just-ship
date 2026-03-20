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

**WICHTIG: Secrets niemals in den Chat eingeben lassen.** Der Verbindungs-Code enthält den API Key und darf nicht in der Conversation History landen.

Zeige dem User den Terminal-Befehl zum Kopieren:

```
Kopiere den Verbindungs-Code aus dem Board (Settings → Connect) und führe
diesen Befehl in deinem Terminal aus — NICHT hier im Chat einfügen:

  just-ship connect "DEIN_CODE_HIER"

Das Board hat einen Copy-Button der den kompletten Befehl kopiert.
Sag mir Bescheid wenn du es ausgeführt hast.
```

Warte bis der User bestätigt. Prüfe dann ob die Verbindung geschrieben wurde:

```bash
cat "$HOME/.just-ship/config.json" 2>/dev/null | node -e "const c=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); const ws=Object.keys(c.workspaces||{}); console.log(ws.length ? 'Connected: ' + ws.join(', ') : 'NOT_CONNECTED')"
```

Falls `NOT_CONNECTED`: Frage ob der Befehl einen Fehler ausgegeben hat und hilf bei der Fehlersuche.

Falls `Connected`: Prüfe ob `project.json` aktualisiert wurde (pipeline.workspace gesetzt). Falls nicht, setze es:
```bash
node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync('$HOME/.just-ship/config.json','utf-8')); console.log(c.default_workspace || Object.keys(c.workspaces)[0])"
```
Dann mit dem Workspace-Slug:
```bash
".claude/scripts/write-config.sh" set-project --workspace <slug> --project-id <project-id>
```

Falls der User stattdessen den Code direkt in den Chat schreibt: **Akzeptieren** und den Befehl für ihn ausführen:
```bash
".claude/scripts/write-config.sh" connect --token "<eingabe>"
```
Aber darauf hinweisen dass Secrets im Terminal sicherer sind als im Chat.
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
