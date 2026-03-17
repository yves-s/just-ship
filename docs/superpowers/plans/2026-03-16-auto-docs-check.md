# Auto Docs-Check Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an automatic documentation check step to `/implement` and `/develop` that runs after QA and before the final commit, so README.md and CLAUDE.md stay in sync with every feature.

**Architecture:** Insert a new step in both `commands/implement.md` and `commands/develop.md`. The step uses git to diff the branch against main, determines which doc sections are affected, reads and updates them inline — no sub-agent, no separate commit.

**Tech Stack:** Markdown (Claude Code slash command format), Bash (git)

**Spec:** `docs/superpowers/specs/2026-03-16-auto-docs-check-design.md`

---

## Chunk 1: Update `commands/implement.md`

### Task 1: Insert docs-check step and update step numbers

**Files:**
- Modify: `commands/implement.md`

**What changes:**
1. Line 14: `Alle Schritte 1–6` → `Alle Schritte 1–7`
2. Line 16: `Schritt 7 endet` → `Schritt 8 endet`
3. Line 123: `SOFORT weiter zu Schritt 7` → `SOFORT weiter zu Schritt 7` ← stays the same (step 7 is now docs-check)
4. Line 125: rename heading `### 7. Abschließen` → `### 8. Abschließen`
5. Insert new `### 7. Docs-Check` section between step 6 and step 8

- [ ] **Step 1: Read the current file**

Read `commands/implement.md` to confirm current line numbers before editing.

- [ ] **Step 2: Update WICHTIGSTE REGEL banner**

In `commands/implement.md`, change:
```
**STOPPE NICHT ZWISCHEN DEN SCHRITTEN.** Alle Schritte 1–6 hintereinander ausführen.
Kein "Soll ich...?", kein "Möchtest du...?". ALLES DURCHLAUFEN.
Schritt 7 endet mit einem offenen PR — **KEIN Merge**, nicht warten auf Bestätigung.
```
To:
```
**STOPPE NICHT ZWISCHEN DEN SCHRITTEN.** Alle Schritte 1–7 hintereinander ausführen.
Kein "Soll ich...?", kein "Möchtest du...?". ALLES DURCHLAUFEN.
Schritt 8 endet mit einem offenen PR — **KEIN Merge**, nicht warten auf Bestätigung.
```

- [ ] **Step 3: Insert docs-check step and rename Abschließen**

Replace the current step 6 closing line + step 7 heading:
```
**NICHT STOPPEN.** SOFORT weiter zu Schritt 7.

### 7. Abschließen — Commit + Push + PR (KEIN Merge)
```
With:
```
**NICHT STOPPEN.** SOFORT weiter zu Schritt 7.

### 7. Docs-Check

Ausgabe: `▶ docs — Dokumentation prüfen`

Ermittle alle geänderten Dateien auf diesem Branch:
```bash
git diff --name-only $(git merge-base main HEAD) HEAD
git status --porcelain
```

Bestimme anhand der geänderten Dateien, welche Docs geprüft werden müssen:

| Geänderte Dateien | Zu prüfende Docs |
|---|---|
| `commands/*.md` | README.md → Commands-Tabelle + Architecture-Abschnitt |
| `agents/*.md` | README.md → Agents-Tabelle |
| `skills/*.md` | README.md → Skills-Tabelle |
| `pipeline/**`, `agents/*.md`, `commands/*.md` | README.md → Workflow-Diagramm |
| Pipeline/Architektur-Strukturen | CLAUDE.md |
| Keine der obigen | Schritt überspringen |

Falls Anpassung nötig: direkt mit Edit-Tool ändern. Nur `README.md` und `CLAUDE.md` — keine anderen Docs.

Ausgabe:
- `✓ docs — README.md aktualisiert` (falls Änderungen gemacht)
- `✓ docs — keine Änderungen nötig` (falls nichts zu tun)

**NICHT STOPPEN.** SOFORT weiter zu Schritt 8.

### 8. Abschließen — Commit + Push + PR (KEIN Merge)
```

- [ ] **Step 4: Verify the file looks correct**

Read `commands/implement.md` and confirm:
- WICHTIGSTE REGEL says `Alle Schritte 1–7` and `Schritt 8 endet`
- Step 7 is the new docs-check step
- Step 8 is Abschließen (previously step 7)
- The transition line at the end of step 6 still says `SOFORT weiter zu Schritt 7` ✓ (correct — step 7 is now docs-check)

- [ ] **Step 5: Commit**

```bash
git add commands/implement.md
git commit -m "feat: add auto docs-check step to /implement command"
```

---

## Chunk 2: Update `commands/develop.md`

### Task 2: Insert docs-check step and update step numbers

**Files:**
- Modify: `commands/develop.md`

**What changes:**
1. WICHTIGSTE REGEL: `Review (Schritt 7), dann Ship (Schritt 8)` → `Review (Schritt 7), dann Docs-Check (Schritt 8), dann Ship (Schritt 9)`
2. Insert new `### 8. Docs-Check` section between Review (step 7) and Ship (current step 8)
3. Ship heading: `### 8. Ship` → `### 9. Ship`
4. Checklist at bottom: update step references from 8 to 9

- [ ] **Step 1: Read the current file**

Read `commands/develop.md` to confirm exact current text before editing.

- [ ] **Step 2: Update WICHTIGSTE REGEL banner**

Change:
```
**STOPPE NICHT ZWISCHEN DEN SCHRITTEN.** Nach Build-Check (Schritt 6) kommt Review (Schritt 7), dann Ship (Schritt 8). Du darfst NICHT nach dem Build dem User die Ergebnisse zeigen und auf Antwort warten. ALLES durchlaufen bis Schritt 8 fertig ist.
```
To:
```
**STOPPE NICHT ZWISCHEN DEN SCHRITTEN.** Nach Build-Check (Schritt 6) kommt Review (Schritt 7), dann Docs-Check (Schritt 8), dann Ship (Schritt 9). Du darfst NICHT nach dem Build dem User die Ergebnisse zeigen und auf Antwort warten. ALLES durchlaufen bis Schritt 9 fertig ist.
```

- [ ] **Step 3: Insert docs-check step between Review and Ship**

Note: The transition line `**NICHT STOPPEN.** SOFORT weiter zu Schritt 8.` at the end of the Review step stays unchanged — after inserting docs-check as step 8, that reference is still correct.

Find the start of the current step 8 (Ship):
```
### 8. Ship — `/ship` ausführen
```
Replace with:
```
### 8. Docs-Check

Ausgabe: `▶ docs — Dokumentation prüfen`

Ermittle alle geänderten Dateien auf diesem Branch:
```bash
git diff --name-only $(git merge-base main HEAD) HEAD
git status --porcelain
```

Bestimme anhand der geänderten Dateien, welche Docs geprüft werden müssen:

| Geänderte Dateien | Zu prüfende Docs |
|---|---|
| `commands/*.md` | README.md → Commands-Tabelle + Architecture-Abschnitt |
| `agents/*.md` | README.md → Agents-Tabelle |
| `skills/*.md` | README.md → Skills-Tabelle |
| `pipeline/**`, `agents/*.md`, `commands/*.md` | README.md → Workflow-Diagramm |
| Pipeline/Architektur-Strukturen | CLAUDE.md |
| Keine der obigen | Schritt überspringen |

Falls Anpassung nötig: direkt mit Edit-Tool ändern. Nur `README.md` und `CLAUDE.md` — keine anderen Docs.

Ausgabe:
- `✓ docs — README.md aktualisiert` (falls Änderungen gemacht)
- `✓ docs — keine Änderungen nötig` (falls nichts zu tun)

**NICHT STOPPEN.** SOFORT weiter zu Schritt 9.

### 9. Ship — `/ship` ausführen
```

- [ ] **Step 5: Update checklist step references**

At the bottom of `commands/develop.md` there is a checklist section. Find any reference to `Schritt 8` in the checklist and update to `Schritt 9`. Specifically:
```
- [ ] **Falls Pipeline konfiguriert:** Status wurde auf "in_review" gesetzt (Schritt 8 via `/ship`)
```
→
```
- [ ] **Falls Pipeline konfiguriert:** Status wurde auf "in_review" gesetzt (Schritt 9 via `/ship`)
```

- [ ] **Step 6: Verify the file looks correct**

Read `commands/develop.md` and confirm:
- WICHTIGSTE REGEL mentions `Schritt 9` as the last step
- Step 8 is the new docs-check
- Step 9 is Ship (previously step 8)
- Checklist at bottom references `Schritt 9`

- [ ] **Step 7: Commit**

```bash
git add commands/develop.md
git commit -m "feat: add auto docs-check step to /develop command"
```

---

## Chunk 3: Manual verification (human-only, outside agent scope)

> **Agentic workers:** Skip this chunk. These steps require an interactive Claude Code session.

- [ ] Run `/implement` on a branch that adds a new command file → confirm README.md Commands table is updated in the same commit
- [ ] Run `/implement` on a branch with no docs-relevant changes → confirm `✓ docs — keine Änderungen nötig` output and no extra files staged
