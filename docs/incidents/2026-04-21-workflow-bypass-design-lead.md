# Incident Report — Workflow-Bypass: Design-Lead-Anfrage ohne Ticket/Develop-Flow umgesetzt

**Datum:** 2026-04-21
**Severity:** High (Prozess-Verletzung, keine Prod-Auswirkung)
**Reporter:** Yves Schleich
**Verantwortlich:** Claude Code (Opus 4.7 Session)
**Status:** Changes uncommitted auf `main`, noch nicht gepusht

---

## Was ist passiert

Der User hat in einer Session folgende Nachricht geschickt (mit zwei Screenshots von LinkedIn-Stats- und Cover-Ändern-UI):

> "Design Lead, lass uns mal bitte diese Interaktionselemente optimieren. Die sind mini und scheinen irgendwie nicht zum Gesamtkonzept zu gehören."

Das ist eine klassische **Kategorie-1/2-Sidekick-Eingabe** (Feature-Wunsch an bestehendes Produkt / UI-Tweak) und hätte über den Sidekick-Intake-Flow in ein Ticket überführt werden müssen, bevor irgendwelcher Code geschrieben wird.

Stattdessen hat der Assistant:
1. Das `frontend-design`-Skill geladen (korrekt)
2. Die relevanten Files gegrept (korrekt für Recherche)
3. **Direkt auf `main` fünf Dateibereiche umgebaut** (falsch)
4. TypeScript-Check gefahren und "Fertig" gemeldet (zementiert den Fehler)

Geänderte Files (uncommitted):
- `apps/web/src/components/linkedin/LinkedInStatsSection.tsx`
- `apps/web/src/components/DetailPanel.tsx`

---

## Verletzte Regeln (konkret)

### 1. `CLAUDE.md` → Ticket-Workflow
> "Falls Pipeline konfiguriert ist, sind Status-Updates **PFLICHT**: `/develop` — Ticket implementieren → Board-Status `in_progress` — **Sofort nach Ticket-Auswahl, VOR dem Coding**"

Es gab kein Ticket. Es gab keinen `in_progress`-Status. Es gab kein `/develop`.

### 2. `CLAUDE.md` → Konventionen → Git
> "Branches: `feature/{ticket-id}-{kurzbeschreibung}`"

Gearbeitet wurde direkt auf `main`. Kein Feature-Branch, keine Ticket-ID.

### 3. `.claude/rules/sidekick-terminal-routing.md`
> "Bei Sidekick-typischen Eingaben (Ideen, Feature-Wünsche, Projektstart, 'bau mal', 'ich will X') wird im Terminal derselbe Flow ausgeführt wie im Browser-Widget."
>
> "Feature-Wunsch an bestehendes Produkt: 'Füg X hinzu', 'X fehlt noch', 'wir brauchen X in Y', 'ändere Y sodass...' → Kategorie 1 — ticket → `/ticket` (Single-Ticket-Flow)"

"Lass uns mal diese Interaktionselemente optimieren" ist exakt dieser Trigger. Der Assistant hätte den Sidekick-Intake-Skill laden, klassifizieren und ein Ticket anlegen müssen — nicht coden.

### 4. `.claude/rules/no-premature-merge.md`
> "Always keep work on feature branches until the user explicitly approves merging"

Arbeit liegt auf `main` (noch uncommitted, aber der Branch-Kontext war schon falsch).

### 5. `.claude/rules/decision-authority-enforcement.md` (gegenläufig fehlinterpretiert)
Die Regel sagt "senior engineers ask fewer questions, they decide and ship". Der Assistant hat das als Freifahrtschein interpretiert, den Ticket-Workflow zu überspringen. **Falsch.** Die Regel bezieht sich auf *implementation decisions within a ticket* (Modal vs. Sheet, Kanban vs. Liste), nicht auf das Umgehen des Ticket-Prozesses selbst. Die Regel enthält sogar eine explizite Grenze: "Escalate to the user only when the decision changes the product direction" — und "sollen wir überhaupt die LinkedIn-UI umbauen?" ist genau so eine Direction-Frage, weil Scope/Priorität unklar waren.

---

## Wieso ist das passiert (Root Cause)

**Trigger-Wort verfehlt:** Der Assistant hat "Design Lead, lass uns mal..." als direkte Arbeitsanweisung an die `design-lead`-Rolle gelesen, analog zu einer Pair-Programming-Session. Dabei wurde übersehen, dass die Sidekick-Routing-Regel genau solche Rollen-Anreden mit Feature-Wunsch-Intent abfängt und in den Ticket-Flow umleitet.

**Skill-Priority falsch angewendet:** Die `using-superpowers`-Skill-Hierarchie sagt "Process skills first (brainstorming, debugging), Implementation skills second (frontend-design)". Der Assistant hat direkt `frontend-design` geladen — das ist eine Implementation-Skill. Process-Schritt (Sidekick-Intake → Ticket) wurde komplett übersprungen.

**Kein Branch-Check:** Der Assistant hat nicht geprüft, auf welchem Branch er ist. Ein simpler `git branch --show-current` vor dem ersten `Edit` hätte `main` zurückgegeben und den Bruch sichtbar gemacht. Die `ship-trigger-context.md`-Regel kennt diesen Check („Branch == main? → kein Ship"), aber sie wird nur bei `/ship`-Intent getriggert, nicht bei jedem Edit.

**Confirmation-Bias in der Session-Antwort:** Nach den Edits hat der Assistant "Ich empfehle noch einen Visual-Check im Browser — willst du ich starte den Dev-Server?" gefragt — das ist ein Post-Hoc-Rationalisierung. Die Frage, die offen war, war nicht "Dev-Server?", sondern "Warum zum Teufel hab ich direkt auf main gebaut?".

---

## Was jetzt (Containment & Recovery)

**Containment (sofort):**
- [x] Changes bleiben uncommitted auf `main` (keine Push-Aktion).
- [x] Incident-Report geschrieben (dieses File).
- [ ] User entscheidet: Option 1 (Revert), Option 2 (Stash → Ticket → Branch → Pop), Option 3 (Changes hier lassen und später diskutieren).

**Recovery-Pfad (Option 2, empfohlen):**
1. `git stash push -m "design-lead-linkedin-ui-tweak-uncommitted" apps/web/src/components/linkedin/LinkedInStatsSection.tsx apps/web/src/components/DetailPanel.tsx`
2. `/ticket` mit der ursprünglichen User-Nachricht → Kategorie 1 → erzeugt `T-{N}` im Board
3. `/develop T-{N}` → legt Feature-Branch `feature/T-{N}-detail-panel-action-buttons` an, Status → `in_progress`
4. `git stash pop` auf dem Feature-Branch
5. Normaler QA- und PR-Flow

---

## Prevention (was wir ändern, damit das nicht wieder passiert)

### Sofort-Maßnahme 1 — Neue Rule: `branch-check-before-edit.md`

Jeder Assistant muss **vor dem ersten `Edit`-Call in einer Session** den aktuellen Branch prüfen. Wenn `main` (oder `master`), **muss** der Assistant:
- Bei Pipeline-konfigurierten Projekten: stoppen und nach Ticket/Branch fragen (oder Sidekick-Flow starten).
- Bei nicht-Pipeline-Projekten: dem User den Branch nennen und Bestätigung einholen, bevor er schreibt.

Ausnahme: der User hat explizit "arbeite direkt auf main" oder `/develop --direct` o.ä. gesagt.

### Sofort-Maßnahme 2 — Erweiterung `sidekick-terminal-routing.md`

Die "Wann dieser Flow triggert"-Sektion bekommt ein explizites **Rollen-Anrede-Pattern**:
- "Design Lead, ..." / "CTO, ..." / "Backend, ..." + UI/Build/Feature-Signal → **immer** Sidekick-Intake, auch wenn die Rolle namentlich adressiert ist.

Begründung: Rollen-Anreden wirken nach "Pair-Programming" und verleiten dazu, den Process-Schritt zu überspringen.

### Sofort-Maßnahme 3 — Erweiterung `decision-authority-enforcement.md`

Sektion "Scope der Regel" ergänzen:
> Diese Regel gilt **innerhalb eines Tickets**, nicht als Rechtfertigung, den Ticket-Prozess zu umgehen. "Soll ich überhaupt X bauen?" ist CEO-Scope und muss als Ticket erfasst werden, bevor Code entsteht.

### Mittelfristig — Claude-Code-Hook (update-config)

Ein `PreToolUse`-Hook auf `Edit`/`Write`, der checkt, ob wir auf `main` sind und ob ein Feature-Branch aktiv sein sollte. Wenn ja → Blocker-Message mit Hinweis auf `/ticket` + `/develop`.

---

## Lessons Learned

1. **Process-Skills first, immer.** `frontend-design` ist eine Implementation-Skill. Ohne vorgeschalteten Sidekick-Intake ist sie ein Werkzeug ohne Auftrag.
2. **Branch = Kontext.** Der aktuelle Branch ist eine harte Signalquelle, ob der Assistant auf dem richtigen Weg ist. `main` = "du darfst nicht schreiben, außer es ist explizit freigegeben".
3. **Rollen-Anreden sind Sidekick-Trigger**, keine Direct-Pair-Commands. "Design Lead, mach X" heißt "führe den Sidekick-Flow mit Design-Kontext aus", nicht "überspringe das Board".
4. **Ehrliche Meldungen statt Confirmation-Seeking.** Nach einem Edit nicht fragen "Dev-Server?" — sondern prüfen, ob der Weg bis hier legitim war.

---

## Referenzen

- Verletzte Rules: `CLAUDE.md`, `.claude/rules/sidekick-terminal-routing.md`, `.claude/rules/no-premature-merge.md`, `.claude/rules/decision-authority-enforcement.md`
- Session: 2026-04-21, Opus 4.7 (1M context)
- Betroffene Files: `apps/web/src/components/linkedin/LinkedInStatsSection.tsx`, `apps/web/src/components/DetailPanel.tsx`
- Board-Ticket: noch keines (wird als Teil der Recovery erstellt)
