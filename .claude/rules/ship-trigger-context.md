---
applies_to: top-level-only
---

Kurze Bestätigungswörter wie "passt", "done", "fertig", "klappt", "sieht gut aus" dürfen `/ship` NUR dann triggern, wenn der Konversationskontext eindeutig auf eine Review-Freigabe wartet.

`/ship` ist destruktiv im Sinne von irreversibel sichtbar: commit + push + merge zu `main`. Ein falsch interpretiertes "passt" kann ungeprüften Code in Production bringen. Die Trigger-Logik muss also vorsichtig sein — im Zweifel nicht shippen.

## Trigger-Bedingungen (ALLE müssen erfüllt sein)

1. **Branch-Check:** Der aktuelle Branch ist nicht `main`. Auf `main` gibt es nichts zu shippen.
2. **Work-Check:** Es gibt einen offenen PR für den aktuellen Branch ODER einen lokalen Commit, der noch nicht gepusht wurde. Ohne ausstehende Arbeit ist `/ship` ein No-Op-Risiko.
3. **Intent-Check:** Die letzte Assistant-Nachricht hat explizit auf Review oder Freigabe gewartet. Beispielphrasen, die diesen Intent signalisieren:
   - "PR ist bereit"
   - "kann gemerged werden"
   - "warte auf dein ok"
   - "ready to ship"
   - "review?"
   - "fertig, passt?"
   - "soll ich mergen?"
   - "bereit für /ship"

Fehlt auch nur eine Bedingung → die Bestätigung ist eine normale Acknowledgement, kein Ship-Signal. **Einfach weiterarbeiten, keine Aktion.**

## Betroffene Trigger-Wörter

Die Kontext-Prüfung gilt für alle kurzen Bestätigungs-Synonyme:
- "passt"
- "done"
- "fertig"
- "klappt"
- "sieht gut aus"
- "ok" (bei Verwendung als einzelnes Wort)
- "gut" (bei Verwendung als einzelnes Wort)

Nicht betroffen sind **explizite Commands**: `/ship`, `/ship T-{N}`, "ship it", "merge", "mach den PR rein". Diese sind unmissverständlich und triggern den Ship-Flow direkt.

## Beispiele — Trigger JA

### Beispiel 1: Frischer PR, User bestätigt
```
Assistant: PR T-351 ist bereit, CI grün. Soll ich mergen?
User: passt
```
Branch ≠ main ✓ · PR existiert ✓ · Assistant fragte nach Merge-Freigabe ✓ → `/ship`

### Beispiel 2: Lokaler Commit, wartet auf Push
```
Assistant: Commit ist geschrieben, warte auf dein ok bevor ich pushe und den PR aufmache.
User: done
```
Branch ≠ main ✓ · lokaler Commit wartet ✓ · Assistant fragte nach Freigabe ✓ → `/ship`

### Beispiel 3: Review abgeschlossen
```
Assistant: QA ist durch, alle ACs erfüllt, Preview sieht gut aus. Ready to ship?
User: sieht gut aus
```
Branch ≠ main ✓ · PR existiert ✓ · Assistant fragte explizit "Ready to ship?" ✓ → `/ship`

## Beispiele — Trigger NEIN

### Beispiel 4: Acknowledgement während aktiver Arbeit
```
Assistant: Ich lade jetzt die Datei und schaue mir den Aufbau an.
User: passt
```
Assistant wartete nicht auf Review — "passt" heißt "ok, verstanden, weiter". **Kein Ship.**

### Beispiel 5: Bestätigung einer Planungs-Entscheidung
```
Assistant: Ich würde dafür eine neue Rule-Datei anlegen statt CLAUDE.md weiter aufzublähen. Gut so?
User: passt
```
Hier wird eine Design-Entscheidung bestätigt, nicht ein Merge. Assistant fragte nach Plan-Approval, nicht nach Ship. **Kein Ship, einfach weiterbauen.**

### Beispiel 6: Keine Arbeit pending
```
User ist auf main, keine offenen PRs, keine ungepushten Commits.
User: fertig mit der Session, schönen Abend
```
"fertig" steht nicht im Review-Kontext — es ist ein Session-Ende. **Kein Ship.**

### Beispiel 7: User bestätigt eine Zwischenausgabe
```
Assistant: Hier die drei Dateien, die ich gleich ändern werde: CLAUDE.md, rules/ship-trigger-context.md, und CHANGELOG.md.
User: passt, mach
```
Assistant listete nur Änderungen auf, kein Review-Intent. **Kein Ship — weiterimplementieren.**

## Entscheidungsbaum

```
User schreibt "passt" / "done" / "fertig" / "klappt" / "sieht gut aus"
│
├─ Branch == main?                    → kein Ship (nichts zu shippen)
│
├─ Kein PR offen UND kein unpushed-Commit? → kein Ship (keine Arbeit)
│
├─ Letzte Assistant-Nachricht:
│   ├─ fragt nach Review/Merge-Freigabe?   → /ship
│   └─ alles andere                         → kein Ship, als Acknowledgement behandeln
```

## Anti-Pattern

❌ **"passt" immer als Ship interpretieren** — führt zu ungewollten Merges zu `main`. Incident am 2026-04-19: User schrieb "passt" als Bestätigung einer Zwischennachricht, Claude merged ungeprüften Code.

✅ **Kontext prüfen, im Zweifel nicht shippen** — ein nicht-ausgelöstes `/ship` ist harmlos (User wiederholt einfach explizit), ein falsch-ausgelöstes `/ship` ist ein Production-Incident.

## Selbst-Check vor Ship-Auslösung

Bevor du `/ship` aus einem kurzen Bestätigungswort triggerst, frage dich:
1. Ist der Branch `main`? → Falls ja, NICHT shippen.
2. Habe ich gerade überhaupt etwas gebaut, das auf Review wartet? → Falls nein, NICHT shippen.
3. Habe ich in meiner letzten Nachricht explizit gefragt, ob gemerged werden soll? → Falls nein, NICHT shippen.

Nur wenn alle drei mit JA beantwortet sind, ist der Ship-Trigger legitim.
