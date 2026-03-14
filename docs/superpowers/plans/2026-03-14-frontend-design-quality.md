# Frontend Design Quality Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve UI/UX quality of the autonomous pipeline's frontend output through a Design-Thinking step and design principles in the frontend agent, plus Design-Kontext from the orchestrator.

**Architecture:** Two markdown agent definitions are modified. The frontend agent gets a new workflow step (Design-Thinking) and a new section (Design-Prinzipien). The orchestrator gets an extended prompt pattern for frontend agents that includes a Design-Kontext block.

**Tech Stack:** Markdown (agent definitions)

**Spec:** `docs/superpowers/specs/2026-03-14-frontend-design-quality-design.md`

---

## Chunk 1: Frontend-Agent — Design-Thinking-Schritt & Design-Prinzipien

### Task 1: Add Design-Thinking step to frontend agent workflow

**Files:**
- Modify: `agents/frontend.md:40-57` (insert new step 3, renumber existing steps)

- [ ] **Step 1: Insert new Step 3 (Design-Thinking) between Design-Modus and Implementieren**

Replace the current `### 3. Implementieren` section (line 51-54) with the new Design-Thinking step, then add the renumbered Implementieren as Step 4:

```markdown
### 3. Design-Thinking — VOR dem Coden

Bevor du Code schreibst: Studieren, Entscheiden, Begründen.

**3a. Studieren** — Lies 2-3 bestehende Seiten/Komponenten im Projekt, die dem Feature am ähnlichsten sind. Verstehe die visuelle Sprache: Dichte, Abstände, Aktionspräsentation, Typografie-Hierarchie.

Falls der Orchestrator eine Referenz-Seite im `## Design-Kontext` angegeben hat, starte dort. Validiere selbst, ob die Referenz passt — wenn nicht, wähle eine bessere.

Bei Greenfield (kein bestehendes UI): Wähle bewusst eine Referenz-App als Anker ("Ich orientiere mich an der Dichte und Klarheit von Linear's Project Views").

**3b. Entscheiden** — Formuliere eine Design-Rationale (3-5 Sätze), die drei Fragen beantwortet:
- **Layout:** Warum dieses Layout und nicht ein anderes?
- **Interaktion:** Wie interagiert der User mit den Elementen — und warum so?
- **Visuelles Level:** Dicht oder luftig? Prominent oder zurückhaltend? Warum?

**3c. Begründen** — Gib die Rationale als kurze Ankündigung aus, dann sofort coden. Kein Warten, kein User-Approval.

Beispiel:
> "Design-Entscheidung: Card Grid statt Table, weil die Items visuell unterschiedlich sind und wenig tabellarische Daten haben. Aktionen per Hover-Overlay, Verwaltungskontext → ghost Buttons. Orientierung an bestehender `/dashboard`-Seite für Spacing und Hierarchie."

### 4. Implementieren
- Folge den Code-Konventionen aus `CLAUDE.md`
- Implementiere alle States: Default, Hover, Active, Loading, Empty, Error
- Responsive: Mobile-first, dann Desktop erweitern
```

- [ ] **Step 2: Renumber existing Step 4 (Shared Logic) to Step 5**

Change `### 4. Shared Logic` to `### 5. Shared Logic`. Content stays identical.

- [ ] **Step 3: Verify the workflow reads correctly**

Read `agents/frontend.md` and verify the step sequence is:
```
1 → 1b → 2 → 3 (Design-Thinking) → 4 (Implementieren) → 5 (Shared Logic)
```

---

### Task 2: Rename existing Design-Prinzipien and add new section

**Files:**
- Modify: `agents/frontend.md:59-65` (rename section, add new section)

- [ ] **Step 1: Rename existing "Design-Prinzipien" to "Implementierungs-Standards"**

Change line 59 from `## Design-Prinzipien` to `## Implementierungs-Standards`. All bullet points underneath stay identical.

- [ ] **Step 2: Add new "Design-Prinzipien" section before Implementierungs-Standards**

Insert the following section before `## Implementierungs-Standards`:

```markdown
## Design-Prinzipien

Fünf Prinzipien, die erklären *warum* etwas gut aussieht. Wende sie im Design-Thinking-Schritt (Schritt 3) an.

**1. Visuelle Hierarchie ist die halbe Arbeit**
Jede Seite hat genau eine Sache, die der User zuerst sehen soll. Wenn alles gleich gewichtet ist, sieht alles gleich unwichtig aus. Developer-UI-Fehler: Alles hat die gleiche Schriftgröße, gleiche Farbe, gleichen Abstand.

**2. Reduktion vor Addition**
Gutes UI entsteht durch Weglassen, nicht durch Hinzufügen. Bevor du ein Element einbaust, frage: Braucht der User das *jetzt*, oder nur *manchmal*? Was nur manchmal gebraucht wird, gehört in Hover, Overflow-Menü oder eine Unterseite. Developer-UI-Fehler: Alles ist permanent sichtbar.

**3. Rhythm & Breathing**
Konsistente Abstände erzeugen visuellen Rhythmus. Großzügiger Weißraum zwischen Sektionen, enge Abstände innerhalb einer Gruppe. Developer-UI-Fehler: Gleichmäßige Abstände überall — keine Gruppierung, keine Hierarchie.

**4. Zurückhaltung bei Interaktivität**
Nicht jedes Element braucht einen sichtbaren Button. Aktionen können durch den Kontext implizit sein (Klick auf eine Card öffnet sie). Developer-UI-Fehler: Jedes Element hat explizite Buttons für jede mögliche Aktion.

**5. Das Referenz-Prinzip**
Wenn du unsicher bist: Wie würde das in der besten App aussehen, die du kennst? Nicht kopieren, aber das Qualitätslevel matchen. "Würde das in Linear so aussehen?" ist die konstante Prüffrage.
```

- [ ] **Step 3: Verify section order**

Read `agents/frontend.md` and verify section order is:
```
## Workflow (with steps 1, 1b, 2, 3, 4, 5)
## Design-Prinzipien (NEW — the 5 principles)
## Implementierungs-Standards (RENAMED — mobile-first, touch targets, etc.)
## Qualitätskriterien (unchanged)
```

- [ ] **Step 4: Commit frontend agent changes**

```bash
git add agents/frontend.md
git commit -m "feat: add design-thinking step and design principles to frontend agent

Add mandatory Design-Thinking step (study, decide, justify) before coding.
Add 5 design principles that explain why something looks good.
Rename existing Design-Prinzipien to Implementierungs-Standards.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: Orchestrator — Design-Kontext

### Task 3: Extend orchestrator prompt pattern with Design-Kontext

**Files:**
- Modify: `agents/orchestrator.md:47-64` (extend prompt pattern and frontend-agent instructions)

- [ ] **Step 1: Update the frontend-specific instructions with Design-Kontext**

Replace the current "Bei Frontend-Agents" block (lines 62-64) with the extended version that includes Design-Kontext. The general prompt pattern (lines 47-60) stays unchanged — Design-Kontext is frontend-specific and documented only in the frontend instructions:

```markdown
**Bei Frontend-Agents** immer den Design-Modus UND Design-Kontext angeben:
- Neue Seite/Feature ohne bestehendes Design System → `## Design-Modus: Greenfield` (creative-design Skill)
- Bestehende Komponente erweitern → `## Design-Modus: Bestehend` (design + frontend-design Skills)

Zusätzlich `## Design-Kontext` zwischen `## Aufgabe` und `## Datei 1` einfügen:

```
## Aufgabe
{1-2 Sätze was zu tun ist}

## Design-Modus: Bestehend

## Design-Kontext
- Kontext: {Verwaltung/Settings | Conversion-Flow | Daten-Display | Dashboard}
- Ähnlichste bestehende Seite: {Pfad} — dort Spacing und Patterns studieren
- Komplexität: {Wenige/Viele Daten, wenige/viele Aktionen} → {luftig/dicht}

## Datei 1: ...
```

Der Design-Kontext gibt dem Frontend-Agent **Koordinaten** — keine Pattern-Vorgabe. Der Agent trifft die Design-Entscheidung selbst in seinem Design-Thinking-Schritt.
```

- [ ] **Step 2: Verify orchestrator reads correctly**

Read `agents/orchestrator.md` and verify:
- Prompt pattern is intact
- Frontend-specific instructions mention both Design-Modus AND Design-Kontext
- No pattern dictation ("nimm Cards") in the Design-Kontext example

- [ ] **Step 3: Commit orchestrator changes**

```bash
git add agents/orchestrator.md
git commit -m "feat: add design-kontext to orchestrator frontend prompt pattern

Orchestrator now provides Design-Kontext (context type, reference page,
complexity hint) when spawning frontend agents, giving them coordinates
for better design decisions.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
