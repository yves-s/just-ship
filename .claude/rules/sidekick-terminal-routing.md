Bei Sidekick-typischen Eingaben (Ideen, Feature-Wünsche, Projektstart, "bau mal", "ich will X") wird im Terminal derselbe Flow ausgeführt wie im Browser-Widget. Claude Code IST der Sidekick im Terminal — es gibt keinen `/sidekick` Command.

Der `sidekick-intake` Skill ist Single Source of Truth für die Klassifikation. Er wird direkt geladen (nicht die API — die ist nur der Web-Wrapper). Ergebnis: vier Kategorien → vier Routing-Entscheidungen.

## Wann dieser Flow triggert

Erkenne Sidekick-Intent an Signal-Mustern. Jedes reicht:

- **Ideen-Rohform:** "ich habe eine Idee", "was wäre wenn", "mir schwebt X vor", "ich denke an X"
- **Build-Intent für etwas Neues:** "ich will X bauen", "lass uns X entwickeln", "bau mal X", "X entwickeln"
- **Feature-Wunsch an bestehendes Produkt:** "Füg X hinzu", "X fehlt noch", "wir brauchen X in Y", "ändere Y sodass..."
- **Bug-Report oder Copy-Tweak:** "X funktioniert nicht", "der Text auf Y sollte Z sein", "Button macht nicht was er soll"
- **Neues Produkt / neue Audience:** "ich will Y für Z bauen", "neues Projekt: ...", "eigene App für ..."

Nicht Sidekick-Intent: explizite Commands (`/ticket`, `/develop`, `/ship`, `/recover`), Status-Fragen ("wie steht's"), Diagnose-Anfragen ("der CTO soll sich das anschauen"), oder reine Wissensfragen ("wie funktioniert X im Code"). Diese laufen über ihre bestehenden Pfade (Abschnitt "Intent-Erkennung" in CLAUDE.md).

## Flow

1. **Skill laden.** Read `skills/sidekick-intake/SKILL.md`. Announce: `⚡ Sidekick joined`.
2. **Projekt-Kontext sammeln.** Falls Pipeline konfiguriert, lies über `board-api.sh` die letzten ~10 Ticket-Titel und bestehende Epic-Titel des Projekts. Kein API-Call, kein LLM — das ist der "project_context" für die Klassifikation.
3. **Klassifizieren.** Wende die Regeln aus `sidekick-intake/SKILL.md` auf die User-Eingabe an:
   - Business-Signale zählen, Implementierungs-Signale werden ignoriert.
   - Confidence-Floor: unter 0.7 → forciert zu `conversation`.
4. **Routen** nach der Kategorien-Tabelle unten.
5. **Ergebnis präsentieren** — ohne PM-Sprache, ohne "Soll ich das anlegen?" (außer bei Kategorie 4, das ist der eine erlaubte Bestätigungspunkt).

## Kategorien-Routing

| Kategorie | Trigger-Beispiele | Routing | Output-Format |
|---|---|---|---|
| **1 — ticket** | "Der Toggle schließt sich nicht richtig", "Änder die Empty-State-Copy auf X", "Füge einen Copy-Link-Button hinzu" | `/ticket` (Single-Ticket-Flow, kein Split) | `Ist im Board: T-{N} — {title}. {url}` |
| **2 — epic** | "Wir brauchen ein Notifications-System mit Settings, Bell, Email, Inbox", "Build the Workspace Billing feature", "Vollständige Keyboard-Navigation mit j/k/c//" | `/ticket` mit Split-Flag → erzeugt Epic + Children automatisch | `Ist im Board als Epic T-{N} — {title}. {url}` + bullet-Liste der Children |
| **3 — conversation** | "Sollen wir vielleicht Analytics einbauen?", "Was denkst du über neues Onboarding?", "Ich hab da eine Idee, weiß aber nicht wie" | `sparring` Skill laden, strukturierte Diskussion führen | Sparring-Gesprächsergebnis; am Ende exakt eine Frage: "Soll ich ein Ticket anlegen?" |
| **4 — project** | "Ich will Aime Coach bauen — AI-Accountability-App für Therapeuten", "Neues Shopify-Tool für Fashion-Brands", "Setup Just Ship Edu — eigenständiger Workspace" | `add-project`/`init` Skill laden; dann `/ticket` für Init-Epic + 3 Child-Tickets (Scope klären, Tech-Stack-Entscheidung, Erste User-Journey bauen) | Einmalige Bestätigung: "Das klingt nach einem neuen Projekt. Soll ich {Name} als Projekt anlegen?" → nach "ja": Project-URL + Init-Epic + Children-Liste |

**Kategorie 4 ist der einzige Bestätigungspunkt.** Grund: ein neues Projekt ist strukturell größer (neuer Workspace-Scope, neue Audience). Identisch zur Browser-Widget-Regel aus T-877.

**Kategorien 1-2 bestätigen NIE.** Der Skill wird aufgerufen, das Artefakt direkt erzeugt, der Link ausgegeben. "Soll ich das so anlegen?" ist verboten — es leakt PM-Sprache in den Konversationsfluss (T-876/T-879). Kategorie 3 endet mit genau einer Frage ("Soll ich ein Ticket anlegen?") — das ist kein Pre-Creation-Confirm, sondern der Abschluss der strukturierten Diskussion.

## Internal Expert Consultation

Während der Finalisierung (wenn Ticket-Body / Epic-Children geschrieben werden), darf intern `product-cto`, `design-lead`, `backend`, `frontend-design`, `data-engineer` oder `ux-planning` konsultiert werden — aber **nur intern**. Deren Output fließt in die ACs und Out-of-Scope-Listen des Artefakts. Der User sieht keine "Ich frage mal den CTO"-Nachricht und bekommt keine Implementierungs-Frage gestellt (T-879).

## Parity zum Browser-Widget

Gleiche Eingabe im Terminal und im Browser-Widget → gleiche Kategorie, gleiches Artefakt, gleicher Wortlaut der Antwort. Der einzige Unterschied ist das Transport-Layer: Terminal ruft den Skill direkt, Browser ruft `POST /api/sidekick/classify` + `POST /api/sidekick/create` (der API-Wrapper nutzt intern denselben Skill).

## Anti-Patterns

❌ **Implementation-Fragen an den User.** "Welches Framework?", "Postgres oder SQLite?", "Modal oder Sheet?" — alles verboten. T-879 listet die vollständige Forbidden-Liste.

✅ **Business-Fragen only.** Zielgruppe, Timing, Scope-Boundary, Ersetzt-oder-Ergänzt, Erfolgskriterien, Priorität.

❌ **"Soll ich das anlegen?" bei Kategorie 1/2.** Die Plattform entscheidet, der User steuert. (Kategorie 3 endet nach der Diskussion mit "Soll ich ein Ticket anlegen?" — das ist erlaubt und erwartet.)

✅ **Silent classification, direct creation.** `Ist im Board: T-{N} …`

❌ **Vierte Frage in Kategorie 3.** Wenn Richtung nach 3 Turns unklar ist, wird ein Spike-Ticket erzeugt (siehe `sidekick-converse/SKILL.md`), nicht endlos weitergefragt.

❌ **Einen neuen Slash-Command `/sidekick` bauen.** Claude Code ist der Sidekick — die Klassifikation läuft transparent im normalen Dialog.

## Quelle der Wahrheit

Die Kategorie-Definitionen, Confidence-Floor-Logik, Reply-Templates und API-Contracts leben in `skills/sidekick-intake/SKILL.md` und `skills/sidekick-converse/SKILL.md`. Diese Regel hier verdrahtet sie nur ins Terminal-Routing. Bei Konflikt gewinnt der Skill.
