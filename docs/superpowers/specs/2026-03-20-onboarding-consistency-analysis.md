# Onboarding Consistency Analysis

> Erstellt: 2026-03-20
> Scope: Board (Web UI) + Terminal (CLI) + Claude Code (Slash-Commands)

---

## A) Flow-Map: IST-Zustand

### Primarer Flow (Neuer User)

```
BOARD                       TERMINAL                    CLAUDE CODE
-----                       --------                    -----------

1. Register + Login
   (board.just-ship.io)

2. Workspace erstellt
   (automatisch)

3. Onboarding-Stepper
   zeigt Step 3:
   "Projekt verbinden"

   Anweisung:
   "1. Installiere Just Ship"
   → zeigt curl-Befehl
                              ──────────────────────>
                              4. curl ... | bash
                                 (install.sh)

                              Output:
                              "Next step:
                               Open your project in
                               Claude Code and run:
                               /setup-just-ship"
                                                        ──────────────────────>
                                                        5. /setup-just-ship
                                                           (Stack erkennen,
                                                            project.json fuellen)

   Stepper sagt:                                        Schritt 5 endet mit:
   "2. Oeffne dein Projekt                              "Board verbinden? (j/n)"
    in Claude Code und                                  ↓
    fuehre /setup-just-ship                             Falls ja:
    aus"                                                "Hast du Account? (j/n)"
                                                        ↓
   "3. Du wirst gefragt ob                             Falls ja:
    du das Board verbinden                              → /connect-board inline
    willst — den Connection
    Code findest du unter
    Settings → Connect"
                              <──────────────────────
                              /connect-board sagt:
                              "Kopiere den Code aus
                               Board Settings → Connect
                               und fuehre aus:
                               just-ship connect CODE"

                              ──────────────────────>
   ←──────────────────────    6. just-ship connect
   User geht zu                  "jsp_..."
   Settings → Connect           (Terminal-Befehl)
   und kopiert Code

                              Output:
                              "Next: Run /add-project
                               in Claude Code to link
                               a board project"
                                                        ──────────────────────>
                                                        7. /add-project
                                                           --project <UUID>
```

**Anzahl Oberflaechenwechsel im Hauptflow: 7 (mindestens 5 bei optimalem Pfad)**

### Alternativer Flow: Project-Setup-Dialog (Board)

```
BOARD                       TERMINAL                    CLAUDE CODE
-----                       --------                    -----------

1. User erstellt Projekt
   im Board

2. Board zeigt
   ProjectSetupDialog:

   "Quick Connect —
    paste this in
    Claude Code:"
    → /connect-board jsp_...
                                                        ──────────────────────>
                                                        3. User pastet
                                                           /connect-board jsp_...

   GLEICHZEITIG zeigt Dialog:
   "Run this in your project
    terminal (inside Claude Code):"
    → /setup-just-ship --board ...
      --workspace ... --project ...

   PLUS collapsible:
   "First time? Install
    the pipeline first"
    → curl ... | bash
    → just-ship setup
```

### Alternativer Flow: Settings → Connect (Board)

```
BOARD                       TERMINAL                    CLAUDE CODE
-----                       --------                    -----------

1. User geht zu
   Settings → Connect

2. Board zeigt:
   "Fuehre diesen Befehl
    in deinem Terminal aus:"
    → just-ship connect "jsp_..."

   Anleitung:
   "1. Generiere API Key
    2. Kopiere Terminal-Befehl
    3. Fuehre ihn aus
    4. Fertig!"
                              ──────────────────────>
                              3. just-ship connect
                                 "jsp_..."

                              Output:
                              "Next: Run /add-project
                               in Claude Code to link
                               a board project"
```

---

## B) Inkonsistenzen

### B1. Onboarding-Stepper vs. Connect-Settings-Page: Unterschiedliche Connect-Methoden

| Stelle | Methode |
|--------|---------|
| **Onboarding-Stepper** (Step 3) | "Fuehre `/setup-just-ship` aus" → fragt dann intern ob Board verbinden → leitet zu `/connect-board` weiter |
| **Settings → Connect Page** | "Fuehre `just-ship connect "jsp_..."` im Terminal aus" (CLI-Befehl, kein Claude Code Command) |
| **ProjectSetupDialog** | Zeigt ZWEI Methoden gleichzeitig: (1) `/connect-board jsp_...` in Claude Code, (2) `/setup-just-ship --board ... --workspace ... --project ...` in Claude Code |

**Problem:** Drei verschiedene Stellen zeigen drei verschiedene Wege, die sich widersprechen:
- Stepper sagt: `/setup-just-ship` → dann Board-Verbindung
- Connect-Page sagt: `just-ship connect` (Terminal-CLI)
- ProjectSetupDialog sagt: `/connect-board` ODER `/setup-just-ship` (Claude Code)

### B2. Onboarding-Stepper verweist auf "Connection Code" — Connect-Page hat "Verbindungs-Code"

| Stelle | Begriff |
|--------|---------|
| Onboarding-Stepper Step 3 | "Connection Code" (implizit, sagt "Settings → Connect") |
| Connect-Settings-Page | "Verbindungs-Code" (deutsch) |
| ProjectSetupDialog | "Quick Connect" / "connect command" (englisch) |
| connect-board.md | "Verbindungs-Code" (deutsch) |
| write-config.sh connect | "connection code" (englisch, in Error-Output) |

**Problem:** Sprachmischung (DE/EN) und verschiedene Begriffe fuer das gleiche Ding.

### B3. ProjectSetupDialog zeigt `/connect-board jsp_...` — aber connect-board.md warnt DAGEGEN

| Stelle | Verhalten |
|--------|-----------|
| **ProjectSetupDialog** | "Quick Connect -- paste this in Claude Code:" → `/connect-board jsp_...` |
| **connect-board.md** Weg 1 | "Secrets niemals in den Chat eingeben lassen." → Soll `just-ship connect` im Terminal nutzen, NICHT im Chat einfuegen |

**Problem:** Das Board fordert den User explizit auf, den Secret-haltigen Token in Claude Code zu pasten. Der `/connect-board` Command warnt genau davor. Der `connect-board.md` hat zwar einen Fallback ("Falls der User stattdessen den Code direkt in den Chat schreibt: Akzeptieren"), aber die primaere Anweisung ist widerspruechlich.

### B4. ProjectSetupDialog: Install-URL weicht von Onboarding-Stepper ab

| Stelle | Install-URL |
|--------|-------------|
| **Onboarding-Stepper** | `curl -fsSL https://just-ship.io/install \| bash` |
| **ProjectSetupDialog** | `curl -fsSL https://raw.githubusercontent.com/yves-s/just-ship/main/install.sh \| bash` |

**Problem:** Zwei verschiedene URLs. Falls `just-ship.io/install` ein Redirect auf die GitHub-URL ist, funktioniert beides — aber es ist verwirrend und fragil.

### B5. `just-ship connect` sagt "Next: /add-project" — aber /setup-just-ship macht set-project bereits

| Stelle | Naechster Schritt nach Connect |
|--------|-------------------------------|
| **`write-config.sh connect`** (Terminal) | "Next: Run /add-project in Claude Code to link a board project" |
| **`/setup-just-ship`** mit Flags | Macht `set-project` selbst (kein `/add-project` noetig) |
| **`/connect-board`** Erfolgsausgabe | "Naechster Schritt: /add-project um ein Board-Projekt zu verknuepfen" |
| **ProjectSetupDialog** | `/setup-just-ship --project <UUID>` (traegt Projekt gleich ein) |

**Problem:** Wenn der User ueber ProjectSetupDialog kommt und `/setup-just-ship --project ...` nutzt, wird das Projekt automatisch verknuepft. `/add-project` ist dann unnoetig. Aber wenn er ueber Settings → Connect kommt und `just-ship connect` nutzt, wird kein Projekt gesetzt — nur der Workspace. Dann braucht er `/add-project`. Die Nachrichten unterscheiden nicht zwischen diesen Pfaden.

### B6. connect-board.md Weg 1 referenziert `jsp_` Token — aber die Logik dafuer fehlt im Command

| Stelle | Problem |
|--------|---------|
| connect-board.md Weg 1 | Sagt: "Kopiere den Verbindungs-Code aus dem Board (Settings → Connect) und fuehre `just-ship connect "DEIN_CODE_HIER"` aus" |
| connect-board.md Weg 1 | Hat danach "Fall B: Eingabe startet mit `adp_`" und "Fall C: Eingabe ist weder `jsp_` noch `adp_`" — aber **kein Fall A fuer `jsp_`** |
| | Der `jsp_` Fall wird nur ueber `just-ship connect` im Terminal behandelt, nicht direkt im `/connect-board` Command |

**Problem:** connect-board.md hat Logik fuer `adp_` Eingabe (Fall B) und unbekannte Eingabe (Fall C), aber der `jsp_` Token wird nur per Terminal-Befehl verarbeitet. Es gibt keinen "Fall A: Eingabe startet mit `jsp_`" der den Token direkt im Claude Code verarbeitet — obwohl der ProjectSetupDialog genau das anbietet (`/connect-board jsp_...`).

### B7. Onboarding-Stepper hat nur 4 Steps — aber der reale Flow hat 6-7 Schritte

| Board-Stepper | Realer Schritt |
|---------------|----------------|
| 1. Registriert | Registrierung |
| 2. Workspace erstellt | Workspace erstellt |
| 3. Projekt verbinden | install.sh + /setup-just-ship + /connect-board + just-ship connect (4 Sub-Schritte!) |
| 4. Erstes Ticket | /ticket |

**Problem:** Step 3 "Projekt verbinden" umfasst mindestens 4 separate Aktionen ueber 3 Oberflaechen. Der Stepper vermittelt den Eindruck eines einfachen Schritts.

### B8. setup.sh "Next steps" widersprechen install.sh "Next step"

| Stelle | Naechster Schritt |
|--------|-------------------|
| **install.sh** | "Open your project in Claude Code and run: `/setup-just-ship`" |
| **setup.sh** (interactive, CLI-only) | "1. Open a new Claude Code session" → "2. Run /setup-just-ship (detects stack, fills project.json)" → "3. Run /connect-board to connect the Just Ship Board (optional)" |
| **setup.sh** (auto mode, aufgerufen von /setup-just-ship) | Kein "Next steps" Output — wird von Claude Code gesteuert |

**Problem:** `install.sh` sagt: geh zu Claude Code und mach `/setup-just-ship`. Wenn der User aber `just-ship setup` im Terminal macht (interaktiv), sagt `setup.sh` DANACH nochmal: "Run `/setup-just-ship`" — obwohl viele Schritte bereits erledigt sind. Der User wuerde dann Stack-Erkennung doppelt ausfuehren.

### B9. setup.sh interaktiver Modus: Board-Verbindung per "paste connect command" — veraltet?

| Stelle | Methode |
|--------|---------|
| **setup.sh** interaktiv (Zeile 664-721) | "Open board.just-ship.io → Board → click the terminal icon next to your project → copy the connect command." |
| **Aktuelle Board-UI** | Es gibt kein "terminal icon next to your project" im Board. Die Connect-Funktion ist unter Settings → Connect. |

**Problem:** Die Anweisung in setup.sh referenziert UI-Elemente die es (vermutlich) nicht mehr gibt. Das Board hat die Connect-Funktion nach Settings → Connect verschoben.

### B10. `just-ship connect` vs. `/connect-board` — verschiedene Tools, aehnlicher Name

| Tool | Beschreibung | Wo |
|------|--------------|-----|
| `just-ship connect` | CLI-Befehl, parsed jsp_ Token, schreibt config | Terminal |
| `/connect-board` | Claude Code Command, interaktiv, mehrere Modi | Claude Code |

**Problem:** Beide machen aehnliches, aber auf verschiedenen Oberflaechen. Der Name ist verwirrend aehnlich, und das Board verweist mal auf den einen, mal auf den anderen.

### B11. Settings → Connect Anleitung fehlt "/add-project" Step

| Stelle | Anleitung |
|--------|-----------|
| **Connect-Settings-View** Instruktionen | "1. Generiere API Key, 2. Kopiere Terminal-Befehl, 3. Fuehre ihn aus, 4. Fertig!" |
| **Realer Flow** | Nach `just-ship connect` muss noch `/add-project` ausgefuehrt werden |
| **`just-ship connect` Output** | "Next: Run /add-project in Claude Code to link a board project" |

**Problem:** Connect-Page sagt "Fertig!" nach Step 4, aber `just-ship connect` sagt danach "Next: /add-project". Der User denkt er ist fertig, ist es aber nicht.

### B12. `just-ship connect` setzt nur Workspace, nicht Projekt

| Komponente | Verhalten |
|------------|-----------|
| `write-config.sh connect` | Parst jsp_ Token, schreibt Workspace in config.json, setzt `pipeline.workspace` in project.json. Setzt NICHT `project_id`. |
| Settings → Connect | Generiert Token auf Workspace-Ebene, ohne Projekt-Bezug |

**Problem:** `just-ship connect` ueber Settings → Connect verbindet nur den Workspace, nicht ein spezifisches Projekt. Danach braucht der User zwingend `/add-project`. Aber ProjectSetupDialog-Weg (`/setup-just-ship --project X`) setzt beides auf einmal.

---

## C) Redundanzen

### C1. Drei Wege zum gleichen Ziel: Workspace verbinden

| Weg | Tool | Quelle |
|-----|------|--------|
| 1 | `just-ship connect "jsp_..."` | Terminal (CLI) |
| 2 | `/connect-board --board ... --workspace ... --key ...` | Claude Code (alle Flags) |
| 3 | `/connect-board` interaktiv → "Ich habe den Key" → Terminal-Verweis | Claude Code → Terminal |
| 4 | `/setup-just-ship --board ... --workspace ... --project ...` | Claude Code (mit Board-Flags) |
| 5 | `setup.sh` interaktiv → "Connect to Board" → paste command | Terminal (interaktiv) |

**5 verschiedene Wege** fuer die gleiche Operation (Workspace in config.json schreiben).

### C2. `/setup-just-ship` macht bei Flags bereits was `/connect-board` + `/add-project` separat machen

| Szenario | Was passiert |
|----------|-------------|
| `/setup-just-ship --board X --workspace Y --project Z` | Prueft ob Workspace existiert → ggf. `add-workspace` → dann `set-project`. Alles in einem Schritt. |
| `/connect-board` + `/add-project` | Zwei separate Commands die zusammen dasselbe tun |

**Redundanz:** `/setup-just-ship` mit Flags macht `/connect-board` + `/add-project` komplett ueberfluessig.

### C3. `just-ship setup` (Terminal) + `/setup-just-ship` (Claude Code) — doppelte Setup-Logik

| Tool | Was es tut |
|------|-----------|
| `just-ship setup` / `setup.sh` | Kopiert Framework-Dateien, generiert project.json/CLAUDE.md, optional Board-Verbindung |
| `/setup-just-ship` | Prueft ob Framework installiert (ruft ggf. `just-ship setup --auto` auf), erkennt Stack, fuellt project.json, optional Board-Verbindung |

**Problem:** Der Terminal-Command und der Claude Code Command ueberlappen sich stark. `/setup-just-ship` ruft intern `just-ship setup --auto` auf, aber `just-ship setup` (interaktiv) macht vieles was `/setup-just-ship` danach nochmal macht (project.json generieren, Board-Verbindung anbieten).

### C4. Settings → Connect und Settings → API Keys — ueberlappende API Key Verwaltung

| Seite | API Key Funktionalitaet |
|-------|------------------------|
| Settings → Connect | "API Key erstellen" Button, "Neuen Key generieren" Button |
| Settings → API Keys | (separate Seite fuer API Key Verwaltung) |

**Problem:** API Keys koennen an zwei Stellen verwaltet werden.

---

## D) SOLL-Flow Vorschlag

### Prinzipien

1. **Maximal ein Oberflaechenwechsel pro Schritt**
2. **Ein Weg, nicht fuenf** — der "goldene Pfad" ist klar
3. **Board ist der Startpunkt** — der User kommt immer vom Board
4. **Projekt-Verbindung ist ein Schritt**, nicht vier

### Vorgeschlagener Flow

```
BOARD                          TERMINAL                   CLAUDE CODE
-----                          --------                   -----------

1. Register + Login
   Workspace wird erstellt

2. Stepper Step 3:
   "Projekt verbinden"

   Zeigt NUR:
   ┌────────────────────────┐
   │ 1. Terminal oeffnen:   │
   │                        │
   │ curl ... | bash        │ ──>  3. install.sh
   │        [Copy]          │      Output:
   │                        │      "OK. Run /setup-just-ship
   │ 2. Claude Code oeffnen │       in Claude Code."
   │    und /setup-just-ship│
   │    ausfuehren          │               ──────────>
   │                        │               4. /setup-just-ship
   └────────────────────────┘                  - Installiert Framework
                                               - Erkennt Stack
                                               - Fuellt project.json
                                               - Fragt: "Board verbinden?"
                                               ↓
                                               Falls ja:
                                               "Geh zu Board →
                                                Settings → Connect
                                                und kopiere den Code"
   ←────────────────────────
   5. User geht zu
      Settings → Connect
      Kopiert:
      just-ship connect "jsp_..."
                              <──────────────
                              6. User fuehrt         ← EIN Terminal-Befehl,
                                 just-ship connect      setzt Workspace UND
                                 "jsp_..." aus           erkennt Projekt automatisch
                                                         (aus project.json name/cwd)

                              Output:
                              "Verbunden! Erstelle
                               dein erstes Ticket
                               mit /ticket in
                               Claude Code."
                                                    ──────────>
                                                    7. /ticket
```

### Konkrete Aenderungen

#### 1. Onboarding-Stepper vereinfachen

Nur 2 Anweisungen statt 3:
```
1. Installiere Just Ship: curl -fsSL https://just-ship.io/install | bash
2. Oeffne dein Projekt in Claude Code und fuehre /setup-just-ship aus
```

Dritter Punkt ("Connection Code findest du unter Settings → Connect") entfernen — `/setup-just-ship` leitet dort hin.

#### 2. Install-URLs vereinheitlichen

Ueberall `https://just-ship.io/install` verwenden, nicht die GitHub-Raw-URL.

#### 3. ProjectSetupDialog: Nur EINEN Weg zeigen

Aktuell zeigt der Dialog drei Optionen (Quick Connect, CLI Command, Manual JSON). Reduzieren auf:
- Primaer: `just-ship connect "jsp_..."` (Terminal-Befehl mit Token)
- Fallback (collapsible): Manuelle project.json Werte

`/connect-board jsp_...` als "paste in Claude Code" entfernen — Secrets gehoeren nicht in den Chat.

#### 4. Settings → Connect: Anleitung vervollstaendigen

"Fertig!" durch echten naechsten Schritt ersetzen:
```
1. Kopiere den Terminal-Befehl
2. Fuehre ihn in deinem Projekt-Terminal aus
3. Fuehre /add-project in Claude Code aus
```

Oder besser: `just-ship connect` so aendern, dass es automatisch `set-project` aufruft wenn ein offensichtlicher Projekt-Kontext existiert (project.json vorhanden, nur ein Projekt im Board).

#### 5. `/connect-board` vereinfachen oder entfernen

`/connect-board` ist durch `/setup-just-ship` mit Flags und `just-ship connect` (Terminal) redundant. Optionen:
- **Option A:** `/connect-board` entfernen, `/setup-just-ship` uebernimmt Board-Verbindung
- **Option B:** `/connect-board` behalten als Alias fuer den Fall dass jemand nur den Workspace neu verbinden will, aber Interaktions-Logik drastisch kuerzen

#### 6. Sprache vereinheitlichen

Alles Board-UI auf Deutsch ODER Englisch. Aktuell: Onboarding-Stepper ist deutsch, ProjectSetupDialog ist englisch, Connect-Settings-View ist deutsch. Die Commands/Skills sind laut CLAUDE.md deutsch.

#### 7. `setup.sh` interaktiven Modus abschaffen

`setup.sh` sollte nur noch `--auto` (aufgerufen von Claude Code) und `--update` unterstuetzen. Der interaktive Modus (`just-ship setup` ohne Flags) dupliziert zu viel von dem was `/setup-just-ship` macht und hat veraltete Anweisungen (z.B. "click the terminal icon next to your project").

#### 8. `/add-project` in `just-ship connect` integrieren

Wenn `just-ship connect` in einem Verzeichnis mit `project.json` ausgefuehrt wird, sollte es:
1. Workspace verbinden (wie bisher)
2. Board-API nach Projekten abfragen
3. Falls genau ein Projekt: automatisch verknuepfen
4. Falls mehrere: User fragen welches
5. Falls keines: Hinweis dass ein Projekt im Board erstellt werden muss

Damit entfaellt `/add-project` als separater Schritt.

---

## Zusammenfassung

| Kategorie | Anzahl |
|-----------|--------|
| Inkonsistenzen | 12 |
| Redundanzen | 4 |
| Oberflaechenwechsel (IST) | 5-7 pro Connect-Flow |
| Oberflaechenwechsel (SOLL) | 3-4 |
| Verschiedene Wege zum Verbinden (IST) | 5 |
| Verschiedene Wege zum Verbinden (SOLL) | 1 (mit 1 Fallback) |

Die Kern-Probleme sind:
1. **Zu viele Wege** — 5 verschiedene Methoden fuer "Workspace verbinden"
2. **Widerspruechliche Nachrichten** — jede Oberflaeche sagt etwas anderes als naechsten Schritt
3. **Secret-Handling-Widerspruch** — Board sagt "paste in Claude Code", Command sagt "niemals in den Chat"
4. **"Fertig" heisst nicht fertig** — Connect-Page sagt "Fertig!" obwohl noch `/add-project` fehlt
5. **Stepper taeuscht Einfachheit vor** — 1 Stepper-Step umfasst 4+ reale Schritte ueber 3 Oberflaechen
