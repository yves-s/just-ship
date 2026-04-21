Bei Sidekick-typischen Eingaben (Ideen, Feature-Wünsche, Projektstart, "bau mal", "ich will X") wird im Terminal derselbe Flow ausgeführt wie im Browser-Widget. Claude Code IST der Sidekick im Terminal — es gibt keinen `/sidekick` Command.

Der `sidekick-intake` Skill ist Single Source of Truth für die Klassifikation. Er wird direkt geladen (nicht die API — die ist nur der Web-Wrapper). Ergebnis: vier Kategorien → vier Routing-Entscheidungen.

## Wann dieser Flow triggert

Erkenne Sidekick-Intent an Signal-Mustern. Jedes reicht:

- **Ideen-Rohform:** "ich habe eine Idee", "was wäre wenn", "mir schwebt X vor", "ich denke an X"
- **Build-Intent für etwas Neues:** "ich will X bauen", "lass uns X entwickeln", "bau mal X", "X entwickeln"
- **Feature-Wunsch an bestehendes Produkt:** "Füg X hinzu", "X fehlt noch", "wir brauchen X in Y", "ändere Y sodass..."
- **Bug-Report oder Copy-Tweak:** "X funktioniert nicht", "der Text auf Y sollte Z sein", "Button macht nicht was er soll"
- **Neues Produkt / neue Audience:** "ich will Y für Z bauen", "neues Projekt: ...", "eigene App für ..."
- **Rollen-Anrede mit Feature-/Build-/UI-Signal:** "Design Lead, ...", "CTO, ...", "Backend, ..." + einem der oben genannten Intents. Siehe eigene Sektion unten.

Nicht Sidekick-Intent: explizite Commands (`/ticket`, `/develop`, `/ship`, `/recover`), Status-Fragen ("wie steht's"), Diagnose-Anfragen ("der CTO soll sich das anschauen"), oder reine Wissensfragen ("wie funktioniert X im Code"). Diese laufen über ihre bestehenden Pfade (Abschnitt "Intent-Erkennung" in CLAUDE.md).

## Rollen-Anrede-Pattern

Rollen-Anreden sind **keine Pair-Programming-Commands**. Eine Nachricht wie "Design Lead, lass uns die X-UI überarbeiten" adressiert zwar eine Rolle namentlich, aber der Kern-Intent bleibt ein Feature-Wunsch — und jeder Feature-Wunsch läuft durch den Sidekick-Intake. Rollen-Anrede + Feature/Build/UI-Signal → **immer Sidekick-Intake**, auch wenn die Rolle namentlich adressiert ist.

### Warum diese Regel existiert

Am 2026-04-21 hat eine Session auf "Design Lead, lass uns mal diese Interaktionselemente optimieren" direkt angefangen zu coden — Rolle adressiert, Implementation-Skill (`frontend-design`) geladen, Ticket-Flow übersprungen, Code auf `main` geschrieben. Der vollständige Incident-Report liegt unter `docs/incidents/2026-04-21-workflow-bypass-design-lead.md`. Die Rolle im Anruf verführt zum "ich bin dran" — in Wahrheit ist es genau die Stelle, an der der Sidekick-Flow starten muss.

### Klassifikations-Logik

Rollen-Anrede = einer dieser Präfixe am Anfang der User-Nachricht (oder als erste Zeile vor dem eigentlichen Request):

- "Design Lead, ...", "Design-Lead: ...", "Dear Design Lead, ..."
- "CTO, ...", "@CTO ...", "Hey CTO ..."
- "Backend, ...", "Backend Dev, ..."
- "Frontend, ...", "Frontend Dev, ..."
- "PM, ...", "Product Manager, ..."
- "Data Engineer, ...", "UX Lead, ...", "Creative Director, ..."

Feature/Build/UI-Signal = einer der Signal-Typen aus der Trigger-Liste oben (Ideen-Rohform, Build-Intent, Feature-Wunsch, Bug-Report, Copy-Tweak).

Wenn **beide** Signale gemeinsam in derselben Nachricht auftreten → Sidekick-Intake, keine Ausnahme.

### Beispiele

#### Beispiel 1 — Design Lead + UI-Tweak

```
User: Design Lead, lass uns die Card-Buttons im Detail-Panel optimieren. Die sind mini und passen nicht zum Rest.

Fehler (was 2026-04-21 passiert ist):
❌ frontend-design laden, Files grepen, Edits auf main schreiben.

Richtig:
✅ sidekick-intake laden, klassifizieren. Kategorie 1 (Feature-Wunsch an bestehendes Produkt).
   /ticket erzeugt T-{N}. Ausgabe: "Ist im Board: T-{N} — Detail-Panel Button-Sizing. {url}".
```

#### Beispiel 2 — CTO + Architektur-Wunsch

```
User: CTO, wir brauchen einen Cache-Layer vor dem Classifier, das ist zu langsam.

Fehler:
❌ product-cto als Implementation-Skill lesen, Cache-Code hinhacken.

Richtig:
✅ sidekick-intake laden. Kategorie 1 oder 2 je nach Scope (Single-Ticket vs. Epic für größere Architektur).
   Ticket(s) erstellen. product-cto wird intern konsultiert für ACs und Out-of-Scope (siehe "Internal Expert Consultation").
```

#### Beispiel 3 — Backend + neues Endpoint

```
User: Backend, füge einen POST /api/sidekick/feedback Endpoint hinzu, damit User im Widget die Klassifikation korrigieren können.

Fehler:
❌ backend-Skill laden, Endpoint-Code schreiben, Tests machen.

Richtig:
✅ sidekick-intake laden. Kategorie 1 (Feature-Wunsch, klar umrissen, Single-Ticket).
   /ticket mit Endpoint-Spec im Body. Backend-Skill wird im späteren /develop-Flow geladen.
```

### Ausnahme — Rollen-Anrede ohne Feature-Signal

Wenn die Rollen-Anrede nur ein Status-Check, eine Wissensfrage oder eine Diagnose ist, ist es **kein** Sidekick-Intent:

- "CTO, was denkst du über den aktuellen Pipeline-Aufbau?" → Diagnose → `product-cto` laden, analysieren, keine Ticket-Erstellung.
- "Design Lead, wie funktioniert unser Theme-System?" → Wissensfrage → antworten, kein Ticket.
- "Backend, warum ist das letzte Deploy gecrasht?" → Diagnose → Logs checken, Root-Cause, ggf. Ticket für den Fix.

Der Unterschied: **"wie/was/warum"** = Wissensfrage. **"lass uns / bau / füge hinzu / ändere"** = Feature-Intent = Sidekick-Intake, auch mit Rollen-Anrede.

### Selbst-Check

Bevor du auf eine Rollen-Anrede reagierst:

1. Enthält die Nachricht ein Feature-/Build-/UI-Signal (bauen, ändern, hinzufügen, optimieren, fixen)?
2. Wenn ja: Sidekick-Intake, kein Direkt-Coden. Auch wenn die Rolle namentlich angesprochen ist.
3. Wenn nein (reine Wissensfrage, Status, Diagnose): normaler Rollen-Skill-Flow, kein Ticket.

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
| **3 — conversation** | "Sollen wir vielleicht Analytics einbauen?", "Was denkst du über neues Onboarding?", "Ich hab da eine Idee, weiß aber nicht wie" | Engine-Chat (`POST /api/sidekick/chat` via `sidekick-api.sh chat`) — SSE-Stream, Thread-Persistenz, Tool-Loop. Nur bei fehlender Engine-Konfig fällt das Terminal auf `sparring` zurück. | Live-Token-Stream im Terminal, am Ende: Artefakt-Link oder eine gezielte Business-Frage (gemäß `sidekick-converse`) |
| **4 — project** | "Ich will Aime Coach bauen — AI-Accountability-App für Therapeuten", "Neues Shopify-Tool für Fashion-Brands", "Setup Just Ship Edu — eigenständiger Workspace" | `add-project`/`init` Skill laden; dann `/ticket` für Init-Epic + 3 Child-Tickets (Scope klären, Tech-Stack-Entscheidung, Erste User-Journey bauen) | Einmalige Bestätigung: "Das klingt nach einem neuen Projekt. Soll ich {Name} als Projekt anlegen?" → nach "ja": Project-URL + Init-Epic + Children-Liste |

**Kategorie 4 ist der einzige Bestätigungspunkt.** Grund: ein neues Projekt ist strukturell größer (neuer Workspace-Scope, neue Audience). Identisch zur Browser-Widget-Regel aus T-877.

**Kategorien 1-2 bestätigen NIE.** Der Skill wird aufgerufen, das Artefakt direkt erzeugt, der Link ausgegeben. "Soll ich das so anlegen?" ist verboten — es leakt PM-Sprache in den Konversationsfluss (T-876/T-879). Kategorie 3 endet mit genau einer Frage ("Soll ich ein Ticket anlegen?") — das ist kein Pre-Creation-Confirm, sondern der Abschluss der strukturierten Diskussion.

## Kategorie 3 — Engine-Chat-Flow im Terminal (T-926)

Für Kategorie 3 ist der Engine-Chat-Endpoint die Single Source of Truth — er ist derselbe Endpoint, den das Browser-Widget aufruft. Das Terminal wickelt das über `.claude/scripts/sidekick-api.sh` ab, das Credentials versteckt und SSE-Frames in lesbare Ausgabe reduziert.

### Flow

1. **Thread-Erkennung.** Wenn der User eine bestehende Konversation weiterführen will ("der Thread von gestern zu Notifications", "lass uns das mit dem Analytics-Dashboard weitermachen"), rufe zuerst `sidekick-api.sh thread-list --project-id <uuid> --status draft,waiting_for_input,ready_to_plan,planned,approved,in_progress` auf und wähle den passenden Thread — **nicht den User danach fragen**, den Titel-Match selbst machen. Bei Ambiguität den aktivsten (höchstes `last_activity_at`) nehmen und im Output kurz vermerken ("Weiter in Thread {title} — {id}"). Die Thread-ID wird in `.claude/.sidekick-thread` persistiert, damit Folge-Turns im selben Ticket ohne erneuten Listing-Call weitermachen.
2. **Chat-Turn starten.** `sidekick-api.sh chat --project-id <uuid> [--thread-id <uuid>] --text "<user input>"` ausführen. Der SSE-Stream landet live im Terminal (stdout für Text-Deltas, stderr für Status-Frames wie `[tool_call …]`, `[thread_id=…]`). Neuer Turn ohne Thread-ID → Engine vergibt eine, wird im `[thread_id=…]`-Frame zurückgeliefert und dann persistiert.
3. **Image-Pfade.** Erkenne lokale Image-Pfade im User-Input per Muster `\b(?:/|\./|\.\./)[^ ]+\.(?:png|jpe?g|webp|gif)\b` oder explizit gedroppte Pfade. Vor dem Chat-Call: `sidekick-api.sh attach <path> [<path>…]` aufrufen, die zurückgegebenen `files[*].url` sammeln und als `--attach <url>`-Flags ans `chat`-Command übergeben. Der User-Text bleibt unverändert — das Bild landet als `attachments[]` im Chat-Request.
4. **Thread-State-Übergänge.** Wenn der Engine-Chat einen Tool-Call ausführt, der den Thread-Status ändert (z.B. auf `delivered`), gibt der SSE-Stream `[tool_call …]` / `[tool_result …]` aus. Nach dem finalen `message`-Frame den aktuellen Status per `sidekick-api.sh thread-get <id>` prüfen und dem User in einer einzigen Zeile zurückmelden: `Thread {title} ist jetzt {status}.` — keine Tabelle, kein Raw-JSON.
5. **Fallback ohne Engine-Config.** Wenn weder `ENGINE_API_URL` noch `BOARD_API_URL` auflösbar sind (Exit 1 von `sidekick-api.sh`), lädt das Terminal stattdessen `skills/sparring.md` wie vor T-926. Das ist der Notfallpfad für Projekte ohne Engine-Deployment.

### Anti-Patterns

❌ **Thread-ID den User fragen.** Wenn bekannte Trigger ("der gestrige Thread", "weiter mit X") fallen, erledigt das Terminal das Matching selbst via `thread-list`. Nachfragen = Autonomy-Violation.

❌ **Raw-JSON aus `thread-get`/`thread-list` an den User ausgeben.** Immer auf eine Zeile reduzieren: Titel + Status + ggf. Timestamp-Relative ("vor 2h aktualisiert").

❌ **Parallele Chat-Turns im selben Thread.** Der Endpoint antwortet dann mit `409 thread_busy`. Im Fehlerfall: eine Zeile Rückmeldung, kein Retry-Loop — der User entscheidet.

❌ **Image-Pfade als Markdown-Links an den Engine senden.** Der Engine erwartet `attachments: [{ url }]`; Text-Inlining würde die Deduplikation und die Storage-URL-Rotation brechen.

✅ **Parity check.** Wenn der User dieselbe Eingabe ins Browser-Widget und ins Terminal tippt, erzeugt beides denselben Thread-Fortschritt und dasselbe finale Artefakt — weil beide Pfade denselben Engine-Endpoint treffen.

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
