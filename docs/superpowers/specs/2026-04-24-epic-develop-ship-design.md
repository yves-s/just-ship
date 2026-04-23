# Epic-Level `/develop` und `/ship` — Design

**Date:** 2026-04-24
**Status:** Draft
**Author:** Product CTO (via brainstorming)

---

## Problem

Heute sind `/develop` und `/ship` auf Single-Ticket-Granularität gebaut. Ein Epic ist im Board nur ein organisatorischer Container; um ein Epic abzuarbeiten, muss der User jeden Child manuell `/develop T-{N}` aufrufen und nach jedem Merge den nächsten starten. Das skaliert nicht:

- Bei einem Epic mit 5-8 Children ist das 5-8 × Kontext-Switch für den User.
- Dependencies zwischen Children sind nirgends maschinenlesbar — der User muss sie im Kopf halten und die Reihenfolge manuell einhalten.
- Unabhängige Children könnten parallel laufen, tun es aber nicht, weil es keinen Orchestrator gibt.
- Epic-Status im Board ist manuell: niemand hält ihn synchron mit den Children, er verliert Informationsgehalt.
- Shipping mehrerer PRs aus einem Epic ist Mergetetris — Rebases nach jedem Merge, Order-of-Operations im Kopf.

Epic-Level-Commands sind der nächste logische Schritt: `/develop E-42` arbeitet das ganze Epic ab, `/ship E-42` merged alle Children in korrekter Reihenfolge.

## Goals

- `/develop E-{N}` orchestriert alle Children eines Epics in Dependency-Order (seriell im MVP), mit expliziter Dependency-Struktur als First-Class-Citizen.
- `/ship E-{N}` merged alle Child-PRs in Dependency-Order mit Fail-Fast-Semantik.
- Epic-Status im Board reflektiert automatisch den Fortschritt der Children.
- Dependency-Struktur ist im Ticket-Schema verankert (`depends_on`), sodass später ein Parallel-Executor ohne Datenmodell-Änderung draufgesetzt werden kann.
- Recovery-Semantik ist symmetrisch mit Single-Ticket-Flow: ein Child-Problem pausiert das Epic, `/develop E-{N} --resume` macht weiter.

## Non-Goals

- **Echte Parallel-Execution im MVP.** Der Dependency-Graph ist parallel-ready modelliert, aber der Executor arbeitet seriell. Parallel-Executor (Worker-Pool, Worktree-Fan-Out, Conflict-Detection) ist ein Follow-up-Ticket.
- **Multi-Parent-Dependencies.** Ein Child mit `depends_on: [T-X, T-Y]` ist im MVP nicht unterstützt. Validierung lehnt solche Graphen beim Epic-Start ab. Grund: Merge-Commits in der Dev-Chain sind Graph-Komplexität ohne Payoff für die ersten Epics.
- **Stacked-PR-Tooling.** Wir bauen keine Graphite/Sapling-artige Stacked-Review-Infrastruktur. Jeder Child-PR ist ein separater Review, ggf. mit Dependency-Branching als Base.
- **Board-UI-Änderungen.** Epic-Status wird automatisch gesetzt, aber das Board-UI rendert ihn mit bestehenden Mechanismen. Kein neues UI für Dependency-Graph-Visualisierung im MVP.

## Design

### 1. Datenmodell: `depends_on` im Ticket-Schema

Jedes Ticket bekommt ein neues Feld:

```ts
{
  depends_on: string[]  // Array of ticket IDs, e.g. ["T-123"]
}
```

- `[]` (leer) → Child kann parallel zu anderen laufen, branched von `main`.
- `["T-X"]` → Child wartet auf T-X, branched vom T-X-Feature-Branch.
- `["T-X", "T-Y"]` → **Nicht unterstützt im MVP.** Validator lehnt beim Epic-Start ab.

Das Feld ist nullable (Backward-Compatibility mit bestehenden Tickets). Ein fehlendes Feld bedeutet "nicht gesetzt" — beim Epic-Start greift dann die LLM-Graph-Inferenz (siehe §5).

### 2. Epic-Runner: `/develop E-{N}`

Neuer Command, der ein Epic-Ticket aufnimmt und seine Children orchestriert.

**Flow:**

1. **Epic laden.** Board-API: `GET tickets?parent={epic-id}` → Liste der Children.
2. **Graph bauen.** Für jedes Child `depends_on` lesen. Wenn mindestens eines fehlt → LLM-Inferenz (§5). Single-Parent-Validation: jedes Child hat max. eine Dependency.
3. **Topological Sort.** Dependency-Graph → serielle Execution-Order. Unabhängige Children (depends_on: []) sind im MVP sequentiell nach Ticket-Nummer angeordnet, aber im Graph als "parallelisierbar" markiert (für späteren Executor).
4. **Graph-Preview.** Ausgabe:
   ```
   Epic E-42 — Execution-Plan:
     T-101 (from main)
     └─ T-102 (depends on T-101)
         └─ T-103 (depends on T-102)
     T-104 (from main, parallel)
     T-105 (from main, parallel)
   ```
   - Wenn Graph aus expliziten `depends_on` kommt: sofort weiter.
   - Wenn Graph LLM-inferiert wurde: 3-Sekunden-Pause, Ctrl-C zum Abbrechen.
   - `--yes` / `--no-preview` Flag: überspringt Pause auch bei inferiertem Graph (für Scripted-Runs).
5. **Execution-Loop.** Für jedes Child in Order:
    1. **Status-Check (unmittelbar vor Dispatch).** Board-API: aktueller Status des Childs. Wenn `in_progress`, `in_review`, `done` → skip (manueller Eingriff gedeckt).
    2. **Branch-Base bestimmen.** `depends_on: []` → `main`. `depends_on: [T-X]` → `feature/T-X-*` (Worktree existiert bereits aus früherem Child-Run).
    3. **Worktree erstellen.** `.worktrees/T-{child-id}/` mit Feature-Branch, basiert auf ermittelter Base.
    4. **Single-Ticket-Develop ausführen.** Bestehende Pipeline (triage → orchestrator → agents → qa → PR). Kein neuer Code, nur Wiederverwendung.
    5. **PR öffnen, nicht mergen.** Branch bleibt open, Epic-Status wird per Hook (§4) aktualisiert.
6. **Terminal-State.** Alle Children `in_review`? → Epic auf `in_review`. Ein Child gecrasht? → Epic bleibt `in_progress`, User kriegt Recovery-Hinweis.

**Resume:**

`/develop E-{N} --resume` läuft denselben Flow, aber der Status-Check in Step 5.1 skipt Children, die schon `in_review`/`done` sind. Keine Zustands-Datei nötig — Board-Status ist die Source of Truth.

### 3. Epic-Ship: `/ship E-{N}`

Neuer Command, der alle Child-PRs eines Epics merged.

**Flow:**

1. **Epic-Children laden.** Alle Children mit `in_review`-Status + offenem PR.
2. **Graph laden.** Dependency-Graph aus `depends_on` rekonstruieren.
3. **Ship-Order = Topological Order.** Unabhängige Children (aus main gebrancht) können zuerst; Ketten werden sequentiell abgearbeitet.
4. **Merge-Loop.** Für jeden Child in Order:
    1. **Mergeability-Check.** GitHub API: PR mergeable? (CI grün, keine Conflicts, alle Reviews.)
    2. **Nicht mergeable → Fail-Fast.** Stop. Report an User: welche Children gemerged sind, wo's hängt, was zu tun ist.
    3. **Mergeable → Merge.** Squash-Merge auf `main`, wie Single-Ticket-`/ship`.
    4. **Downstream-Rebase.** Alle noch nicht gemergten Children mit `depends_on: [T-{just-merged}]` → automatisches Rebase auf `main`. Conflict? → Fail-Fast mit klarer Meldung.
5. **Abschluss.** Alle Children gemerged → Epic-Status auf `done` (via Ship-Command explizit, nicht via Hook — Ship ist der Gate).

**Nuance:** Ship-Order ≠ Ticket-Nummer-Order. Ein Child mit `depends_on: []` kann vor einem niedriger-nummerierten Child aus einer Kette gemerged werden. Das ist bewusst — Graph-aware Order macht Ship schneller, nicht komplexer.

### 4. Epic-Status-Hook: Aggregation

Ein neuer Handler im bestehenden Board-Event-Hook-System (`detect-ticket-post.ts`), der bei jedem Child-Status-Change den Epic neu aggregiert.

**Aggregation-Funktion (pure, in `pipeline/lib/epic-aggregate.ts`):**

```ts
function aggregateEpicStatus(childStatuses: Status[]): Status {
  if (childStatuses.every(s => s === "done"))          return "in_review"
  // ↑ "done" ist Terminal nur via /ship E-{N}
  if (childStatuses.every(s => s === "ready_to_develop")) return "ready_to_develop"
  if (childStatuses.some(s => s === "in_progress"))    return "in_progress"
  if (childStatuses.some(s => s === "in_review"))      return "in_progress"
  return "ready_to_develop"
}
```

**Call-Sites:**

- `/develop E-{N}`: setzt Epic sofort auf `in_progress` (sichtbarer Start).
- Board-Event-Hook: bei jedem Child-Status-Change aufrufen, Epic entsprechend updaten.
- `/ship E-{N}`: setzt Epic am Ende auf `done` (explizit, nicht via Hook).

**Terminal-Semantik:** `in_review` ist der höchste Status, den der Hook setzen kann. `done` nur via `/ship`. Grund: Symmetrie mit Single-Ticket-Flow. Ein Ticket geht nicht automatisch nach `done`, wenn der PR merged-ready ist — der Mensch gibt die Merge-Entscheidung. Gleiche Semantik für Epics.

**Rückweg:** Wenn ein Child manuell auf `ready_to_develop` zurückgesetzt wird (Revert, Bug gefunden), aggregiert der Hook den Epic-Status neu — aus `in_review` zurück auf `in_progress`. Keine Sonderlogik, die Funktion ist symmetrisch.

### 5. LLM-Graph-Inferenz (Fallback)

Wenn ein Epic-Child kein explizites `depends_on`-Feld hat, läuft beim Epic-Start einmalig eine LLM-Inferenz.

**Call:**

- Model: `claude-sonnet-4-6` (günstig, strukturierter Output gut genug).
- Input: Epic-Titel/Body + alle Children (Titel + Body + ACs).
- Output: JSON-Array mit `{ticket_id, depends_on[]}` pro Child.
- Prompt enthält die Single-Parent-Constraint + Beispiele für typische Muster (Schema → Migration → UI).

**Confidence-Handling:**

- Inferenz-Ergebnis wird **nicht** in die Tickets persistiert (könnte falsch sein). Es lebt nur für den aktuellen Run.
- Graph-Preview zeigt "⚠ Graph inferiert" Badge.
- 3-Sekunden-Pause vor Execution-Start.
- `--yes` skippt die Pause (Scripted/CI-Runs).

**Kostenabschätzung:** 1 Sonnet-Call pro Epic-Run (wenn nötig), ~5-10 Sekunden Latency, <$0.05 für typische 5-8-Children-Epics.

### 6. Konkurrenz: Einzel-`/develop` während Epic-Run

Der Epic-Runner holt vor jedem Child-Dispatch den **aktuellen** Status aus dem Board (siehe §2, Step 5.1). Das bedeutet:

- User ruft `/develop T-{child5}` manuell → Child 5 geht auf `in_progress`, landet in `in_review`.
- Epic-Runner erreicht irgendwann Child 5 → Status-Check → `in_review` → skip.

Keine Locks, kein Koordinations-Layer über Ticket-Status. Das ist die bestehende Worker-Idempotenz, die wir ausnutzen.

**Edge-Case:** Race-Condition, wenn beide gleichzeitig starten. In der Praxis extrem selten (User + Runner müssten im Millisekunden-Fenster dispatchen). Worst Case: zwei Worker arbeiten am selben Child, einer von beiden kriegt einen Worktree-Collision-Error, Recovery via `/recover`. Kein Daten-Verlust, nur doppelte Laufzeit. Akzeptabel für MVP.

### 7. Worktree-Strategie

Ein Worktree pro Child: `.worktrees/T-{child-id}/`. Branch: `feature/T-{child-id}-{slug}`.

**Dependency-Branching (A2):**

- `depends_on: []` → `git worktree add .worktrees/T-101 -b feature/T-101-foo origin/main`
- `depends_on: ["T-100"]` → `git worktree add .worktrees/T-101 -b feature/T-101-foo feature/T-100-bar`

**Rebase beim Merge:**

Wenn T-100 nach `main` merged wird, müssen alle Children mit `depends_on: ["T-100"]` auf `main` rebased werden, **bevor** sie gemerged werden können. Der Ship-Flow macht das automatisch:

```sh
git fetch origin main
git checkout feature/T-101-foo
git rebase origin/main
# → wenn sauber: force-push, dann merge
# → wenn Conflict: Fail-Fast, Report an User
```

Conflict heißt: die Children waren nicht sauber entkoppelt. Das ist ein legitimes Signal, der User muss manuell auflösen.

## Trade-offs

### Gewählt: Seriell im MVP, Parallel-Ready-Datenmodell

**Pro:** Schneller lieferbar (keine Worker-Pool-Infrastruktur), Recovery-Semantik einfach, Dependency-Graph als Datenfeld ist billig mitzunehmen.

**Con:** User wartet auf sequentielle Ausführung auch bei unabhängigen Children. Bei einem 5-Children-Epic mit 3 unabhängigen ist der Payoff der Parallelität (3× Speedup) sichtbar, aber verschoben.

**Mitigation:** Parallel-Executor als klar abgegrenztes Follow-up-Ticket. Der Datenmodell-Teil (`depends_on`) ist dann schon da, der Parallel-Executor ist ein reiner Executor-Swap.

### Gewählt: Dependency-Branching (A2) statt Branch-from-main (A1)

**Pro:** Children mit echten Dependencies sehen ihren Parent-State (Schema, Types, etc.) lokal und können entwickelt/getestet werden.

**Con:** Rebase-Kaskade beim Merge. Wenn T-100 merged, müssen T-101, T-102, T-103 rebased werden.

**Mitigation:** Rebase ist im Ship-Flow automatisiert. Conflicts sind echtes Signal für lose gekoppelte Children.

### Gewählt: LLM-Inferenz als Fallback, nicht als Default

**Pro:** Split-Flow erzeugt explizite `depends_on` → Graph ist maschinenlesbar und correct-by-construction. Manuell erstellte Epics funktionieren trotzdem (Inferenz deckt den Gap).

**Con:** LLM-Inferenz kann falsch sein. Confidence-Pause ist der Schutz-Mechanismus, aber nicht narrensicher.

**Mitigation:** Graph-Preview zeigt das Ergebnis klar an; User kann mit Ctrl-C abbrechen. Inferenz wird nicht persistiert, um schlechte Defaults nicht zu verankern.

### Gewählt: Fail-Fast statt Skip-and-Continue für Ship

**Pro:** Konsistent mit Dependency-Order. Child N+1 baut auf N auf; wenn N nicht mergen kann, ist N+1 sowieso blockiert (Rebase würde auf nicht-gemergten Commit laufen).

**Con:** Ein Flake in Child 3 blockiert Merges von Children 4+5, auch wenn die unabhängig wären.

**Mitigation:** Ship-Order ist Graph-aware, nicht Ticket-Nummern-aware. Unabhängige Children werden **vor** der Kette gemergt, wenn der Graph das zulässt. Wenn die problematische Kette später in der Order kommt, merged Ship erst alle unabhängigen, dann scheitert die Kette.

## Implementation Sketch

### Code-Verortung

```
pipeline/lib/
  epic-aggregate.ts     (pure function, used everywhere)
  epic-graph.ts         (topological sort, cycle detection, validation)
  epic-graph-infer.ts   (LLM inference, only called on missing depends_on)

commands/
  develop.md            (extended to handle E-{N} — detects epic vs ticket)
  ship.md               (extended to handle E-{N} — calls epic-ship flow)

pipeline/
  detect-ticket-post.ts (extended to call epic-aggregate on child status change)
```

### Schema-Migration

`tickets`-Tabelle: neue Spalte `depends_on TEXT[]` (Postgres Array, nullable).

Keine Backfill nötig — bestehende Tickets haben NULL, was "nicht gesetzt" bedeutet. Epic-Runner greift bei NULL auf LLM-Fallback zurück.

### Command-Disambiguation

`/develop T-123` → Single-Ticket-Flow (bestehend).
`/develop E-42` → Epic-Flow (neu). Erkennbar am Prefix `E-` vs. `T-`.

Entscheidung für explizites `E-`-Prefix statt "lass mich raten, was der User meint": klar, unambiguous, kein Magic.

### Testing

- Unit-Test für `epic-aggregate.ts` (pure function, alle Status-Kombinationen).
- Unit-Test für `epic-graph.ts` (topological sort, cycle detection, multi-parent rejection).
- Integration-Test für `/develop E-{N}`: 3-Children-Epic mit Dependencies, seriell abarbeiten, Stuck-Recovery.
- Integration-Test für `/ship E-{N}`: 3-Children-Epic, alle PRs grün, Merge in Order, Epic auf `done`.
- Integration-Test für Fail-Fast: ein Child mit CI-rot, Ship stoppt, Report korrekt.
- Smoke-Test für LLM-Inferenz: Children ohne `depends_on`, Inferenz produziert plausiblen Graph.

## Open Questions

Keine — die 10 Design-Entscheidungen aus dem Brainstorming decken den MVP-Scope ab. Follow-up-Tickets (Parallel-Executor, Multi-Parent-Dependencies, Board-UI-Graph-Visualisierung) sind bewusst ausgeklammert.

## Rollout

1. Schema-Migration (Ticket 1) — additiv, kein Breaking-Change.
2. `epic-aggregate.ts` + Hook-Integration (Ticket 2) — sichtbar im Board als automatischer Epic-Status, aber Epic-Commands noch nicht da. Kein Risiko.
3. `/develop E-{N}` (Ticket 3) — neues Command, beeinflusst keine bestehenden Flows.
4. `/ship E-{N}` (Ticket 4) — neues Command, beeinflusst keine bestehenden Flows.
5. LLM-Inferenz + Graph-Preview (Ticket 5) — Feature-Addition für manuell erstellte Epics.
6. `--resume` + `--yes` Flags (Ticket 6) — Polish.

Jedes Ticket ist für sich shippable. Die Reihenfolge ist so gewählt, dass der User nach Ticket 3 schon einen nutzbaren MVP hat (Epic-Develop für Epics mit expliziten `depends_on`); Ticket 4 komplettiert den Flow; 5+6 sind Quality-of-Life.
