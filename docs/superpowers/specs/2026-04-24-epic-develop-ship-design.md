# Epic-Level `/develop` und `/ship` — Design

**Date:** 2026-04-24
**Status:** Draft (Rev 2 — spec-review issues addressed)
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

**Resume — mit Stuck-Detection:**

`/develop E-{N} --resume` läuft denselben Flow, aber mit erweiterter Status-Behandlung:

- Status `in_review`, `done`, `cancelled` → skip (bereits fertig oder out-of-scope).
- Status `ready_to_develop`, `triage` → normal dispatchen.
- Status `in_progress` → **Stuck-Detection-Pfad** (siehe unten). Nicht stumpf überspringen.
- Status `stuck`, `blocked` → Delegation an `/recover T-{child}` bevor Epic-Loop weiterläuft.

**Stuck-Detection für `in_progress`-Children:**

Ein Child kann aus drei Gründen `in_progress` sein:
1. Ein anderer Worker/User arbeitet aktiv daran (legitim) — skip.
2. Der vorherige Epic-Run ist bei diesem Child gecrasht (Worker tot, Status nie auf `stuck` eskaliert) — recover.
3. Der Worker hängt (lange Laufzeit ohne Progress) — Operator muss entscheiden.

Heuristik:
- `updated_at` des Childs lesen. Wenn älter als Stuck-Threshold (Default: 15 Minuten ohne Update) → behandeln wie `stuck` → `/recover T-{child}` aufrufen, dann Child neu dispatchen.
- Wenn jünger als Threshold → annehmen, dass ein anderer Flow aktiv arbeitet → skip mit klarer Meldung ("T-{N} is actively being worked on by another run, skipping").

Die Threshold-Konstante ist konfigurierbar in `project.json` (`pipeline.stuck_after_seconds`, Default 900). Keine Zustands-Datei für Epic-Fortschritt nötig — Board-Status plus `updated_at` sind die Source of Truth.

### 3. Epic-Ship: `/ship E-{N}`

Neuer Command, der alle Child-PRs eines Epics merged.

**Flow:**

1. **Epic-Children laden.** Alle Children mit `in_review`-Status + offenem PR.
2. **Graph laden.** Dependency-Graph aus `depends_on` rekonstruieren.
3. **Ship-Order = "Independents-First" Topological Sort.** Ein *spezifischer* Topological-Sort-Algorithmus wird verwendet, nicht irgendein gültiger: alle Nodes mit `depends_on: []` werden zuerst emittiert (in Ticket-Nummer-Order), dann die Ketten in topologischer Folge. Grund: der Fail-Fast-Trade-off (unabhängige Children merged vor einer problematischen Kette) gilt nur, wenn der Algorithmus das garantiert. Implementation: Kahn's algorithm mit Priorisierung nach `depends_on.length ASC, ticket_number ASC`.
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

Das Status-Domain umfasst: `triage`, `ready_to_develop`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`, `stuck`. Die Funktion deckt alle Kombinationen ab, nicht nur die Happy-Path-Subset.

```ts
type Status = "triage" | "ready_to_develop" | "in_progress" | "in_review"
            | "done" | "blocked" | "cancelled" | "stuck"

function aggregateEpicStatus(childStatuses: Status[]): Status {
  // Empty epic (no children) — epic stays in its current state, aggregator not called.
  if (childStatuses.length === 0) throw new Error("aggregate called with no children")

  // Rule: "blocked" or "stuck" on any child surfaces to the epic — it needs attention.
  if (childStatuses.some(s => s === "stuck"))   return "stuck"
  if (childStatuses.some(s => s === "blocked")) return "blocked"

  // "cancelled" children are ignored for aggregation (they're out of scope).
  const active = childStatuses.filter(s => s !== "cancelled")
  if (active.length === 0) return "cancelled" // all children cancelled → epic cancelled

  // All active children done → epic is in_review (ship-gate preserved).
  if (active.every(s => s === "done")) return "in_review"

  // Any active progress (in_progress, in_review, or partial done) → epic in_progress.
  if (active.some(s => s === "in_progress" || s === "in_review" || s === "done")) {
    return "in_progress"
  }

  // All active children still triage → epic triage.
  if (active.every(s => s === "triage")) return "triage"

  // Otherwise all active children are ready_to_develop (or mix of triage + ready).
  return "ready_to_develop"
}
```

**Wichtige Fixes vs. Rev 1:**

- Partial-Done (ein Child `done`, andere `ready_to_develop`) → korrekt `in_progress`, nicht mehr fälschlich `ready_to_develop`.
- `blocked` und `stuck` werden surface-up gereicht: Epic zeigt, dass es Aufmerksamkeit braucht, nicht dass es fröhlich weiterläuft.
- `cancelled` Children werden aus der Aggregation rausgefiltert (sind out-of-scope), aber wenn alle cancelled sind, ist das Epic selbst cancelled.
- `triage`-Status ist modelliert (wenn Children noch in der Triage sind, ist das Epic auch noch in Triage).

**Call-Sites:**

- `/develop E-{N}`: setzt Epic sofort auf `in_progress` (sichtbarer Start).
- Board-Event-Hook: bei jedem Child-Status-Change aufrufen, Epic entsprechend updaten.
- `/ship E-{N}`: setzt Epic am Ende auf `done` (explizit, nicht via Hook).

**Terminal-Semantik:** `in_review` ist der höchste Status, den der Hook setzen kann. `done` nur via `/ship`. Grund: Symmetrie mit Single-Ticket-Flow. Ein Ticket geht nicht automatisch nach `done`, wenn der PR merged-ready ist — der Mensch gibt die Merge-Entscheidung. Gleiche Semantik für Epics.

**Rückweg:** Wenn ein Child manuell auf `ready_to_develop` zurückgesetzt wird (Revert, Bug gefunden), aggregiert der Hook den Epic-Status neu — aus `in_review` zurück auf `in_progress`. Keine Sonderlogik, die Funktion ist symmetrisch.

### 5. LLM-Graph-Inferenz (Fallback)

Wenn ein Epic-Child kein explizites `depends_on`-Feld hat, läuft beim Epic-Start einmalig eine LLM-Inferenz.

**Call:**

- Model: `claude-sonnet-4-7` (aktueller Default, strukturierter Output).
- Input: Epic-Titel/Body + alle Children (Titel + Body + ACs).
- Output: JSON mit `{graph: [{ticket_id, depends_on[]}], ambiguity: null | string}` pro Epic.
- Prompt fordert das Modell explizit auf, **Ambiguität zu melden statt zu raten**. Wenn ein Child echte Multi-Parent-Abhängigkeiten hat, echte Diamond-Deps existieren, oder die Reihenfolge aus den Bodies nicht herleitbar ist → `ambiguity`-Feld füllen und **keinen** Graph vorschlagen.
- Prompt enthält Beispiele:
  - Eindeutig: Schema-Ticket → Migration-Ticket → UI-Ticket → linearer Single-Parent-Graph.
  - Ambigue: vier UI-Tickets, die alle aufs gleiche neue Feature zeigen, ohne klare Reihenfolge → `ambiguity: "Order between T-101/T-102/T-103/T-104 is not inferrable from content. Set depends_on explicitly."` und `graph: []`.
  - Diamond: T-102 braucht Änderungen aus T-100 und T-101 → `ambiguity: "T-102 has diamond dependency, not supported in MVP. Refactor children."` und `graph: []`.

**Ambiguity-Handling:**

Wenn `ambiguity` nicht null ist, bricht `/develop E-{N}` mit klarem Fehler ab. Der User bekommt die Ambiguity-Message plus Hinweis, wie er die Children händisch korrigieren kann (entweder `depends_on` per `/ticket edit T-{N}` setzen, oder den Split refactorn). Kein Silent-Fallback auf Single-Parent-Collapse — das wäre der Correctness-Bug, den die Non-Goal gerade verhindern soll.

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

**Lock-Mechanismus — `.worktrees/T-{N}/` als Mutex:**

Es gibt keinen expliziten Lock-File, keinen Redis-Lock, keine Board-API-Claim. Der **Worktree-Pfad selbst** ist der Lock:

- `git worktree add .worktrees/T-{N}` ist atomic und schlägt mit klarem Fehler fehl, wenn der Pfad existiert. Das ist die Ground Truth für "wird gerade bearbeitet".
- Vor dem Status-Update auf `in_progress` prüft der Dispatcher erst per Filesystem-Check, ob `.worktrees/T-{N}` existiert. Wenn ja → skip mit Meldung.
- Nach PR-Erstellung wird der Worktree **nicht** sofort gelöscht (siehe §9 Worktree-Lifecycle), weil er für Downstream-Children als Branch-Base dient. Ende-Cleanup erfolgt nach `/ship E-{N}`.

**Race-Szenarien:**

1. **Runner bei T-101, User startet `/develop T-103` parallel.** Runner bleibt auf T-101, User läuft T-103 parallel im eigenen Worktree. Kein Konflikt. Wenn Runner später T-103 erreicht → Worktree existiert bereits → skip.
2. **Runner bei T-102, User startet `/develop T-102` parallel.** Millisekunden-Race: beide versuchen `git worktree add`, einer gewinnt, der andere kriegt "fatal: '.worktrees/T-102' already exists". Der Verlierer gibt eine klare Meldung aus und exited. Kein Daten-Verlust, der Sieger arbeitet normal weiter.
3. **Runner crasht mid-dispatch, Worktree bleibt zurück.** Stuck-Detection aus §Resume greift: `updated_at` > Threshold → `/recover` → Worktree-Zustand wird geprüft und entweder fortgesetzt oder bereinigt.

**Kein verteilter Lock nötig** für MVP (alle Worker laufen auf demselben VPS, Filesystem ist shared). Falls später Multi-VPS-Worker kommen, wird ein Board-API-Claim (`POST /tickets/{N}/claim` mit Worker-ID + TTL) der logische nächste Schritt.

### 7. Worktree-Strategie

Ein Worktree pro Child: `.worktrees/T-{child-id}/`. Branch: `feature/T-{child-id}-{slug}`.

**Dependency-Branching (A2):**

- `depends_on: []` → `git worktree add .worktrees/T-101 -b feature/T-101-foo origin/main`
- `depends_on: ["T-100"]` → `git worktree add .worktrees/T-101 -b feature/T-101-foo feature/T-100-bar`

**Rebase beim Merge — vollständiger Contract:**

Wenn T-100 nach `main` merged wird, müssen alle Children mit `depends_on: ["T-100"]` auf `main` rebased werden, **bevor** sie gemerged werden können. Der Ship-Flow macht das automatisch:

```sh
git fetch origin main
git checkout feature/T-101-foo
git rebase origin/main
# → wenn sauber: push-with-lease, CI abwarten, mergen
# → wenn Conflict: Fail-Fast, Report an User
```

**Contract-Details:**

1. **`--force-with-lease`, nie `--force`.** Schützt gegen Race mit Reviewer-Commits auf dem Child-Branch.
2. **Review-Approvals bleiben gültig.** GitHub invalidiert Approvals nach Force-Push nur, wenn das Repo-Setting "Dismiss stale reviews" aktiv ist. Für Epic-PRs ist diese Einstellung **nicht** gewünscht — Rebase ist kein Content-Change, Approvals bleiben gültig. Wird im Rollout-Ticket als Repo-Setting dokumentiert.
3. **CI-Rerun ist Pflicht-Gate.** Nach dem Rebase triggert der Force-Push einen neuen CI-Run. Ship wartet auf Grün, bevor der Merge ausgeführt wird. CI-Rot nach Rebase zählt als Fail-Fast (der Rebase kann funktionale Regressionen einführen, auch wenn git keinen Conflict meldet). User kriegt Report mit Diff-Link: "CI failed after rebase of T-101 onto main, likely semantic conflict with T-100 changes."
4. **Conflict bei Rebase = Fail-Fast.** Git-Rebase-Conflict bedeutet, die Children waren nicht sauber entkoppelt. Ship stoppt, Worktree bleibt im Rebase-In-Progress-State, User löst manuell auf oder abbricht mit `git rebase --abort` und splittet die Children neu.
5. **Auto-Approve-Bot nicht nötig.** Rebase-only-Commits erzeugen kein neues Review-Required-Signal, weil die Change-Set-Diff gleich bleibt (wenn Rebase clean war). Falls Branch-Protection auf "require approving review after push" steht, muss das Ship-Command das erkennen und als Blocker melden — kein automatisches Umgehen des Review-Gates.

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

## Additional Sections (Rev 2)

### 8. Single-Ticket `/develop T-{N}` auf ein Child mit `depends_on`

Wenn der User **direkt** `/develop T-101` aufruft und T-101 hat `depends_on: ["T-100"]`, gibt es zwei Szenarien:

1. **T-100 ist `done` (bereits in `main` gemerged).** Branch von `origin/main` — der Parent-State ist dort. Direkt wie Standard-Single-Ticket-Flow.
2. **T-100 ist nicht `done` (noch `in_review` oder früher).** Branch von `feature/T-100-*` — der Child braucht den Parent-State, der noch nicht in `main` ist.

Der Single-Ticket-Develop-Flow wird um denselben Base-Resolver erweitert wie der Epic-Runner (§2 Step 5.2). Das heißt: ein einzelnes Child zu entwickeln funktioniert identisch, egal ob via Epic-Runner oder direkt — die Branch-Base wird aus `depends_on` abgeleitet, nicht aus "weil Epic-Runner sagt so".

**Spezialfall:** Wenn `depends_on: ["T-100"]` gesetzt ist, aber `feature/T-100-*` existiert lokal nicht (z.B. der User startet Child direkt auf einer frischen Maschine ohne vorher den Parent gemacht zu haben) → der Flow bricht mit klarer Meldung ab: "T-101 depends on T-100, but branch `feature/T-100-*` does not exist locally. Run `/develop T-100` first or set `depends_on: []` if the dependency is no longer needed."

### 9. Worktree-Lifecycle

Worktrees sind nicht kurzlebig — sie müssen überleben, solange Downstream-Children sie als Branch-Base brauchen.

**Lebenszyklus eines Child-Worktrees:**

1. **Create:** beim Dispatch (Epic-Runner oder `/develop T-{N}` direkt).
2. **Active:** während Implementation läuft, PR offen, Child-Status `in_progress` oder `in_review`.
3. **Blocked:** Worktree bleibt liegen, solange der Child als Base für andere Children dient, die noch nicht gemerged sind.
4. **Cleanup:** erst wenn der Child nach `main` gemerged ist UND keine ungemergten Downstream-Children mehr auf ihn zeigen.

**Cleanup-Trigger:**

- Nach erfolgreichem `/ship E-{N}`: Alle Child-Worktrees des Epics werden gelöscht (`git worktree remove`), weil alle Children in `main` sind.
- Nach erfolgreichem Single-Ticket-Merge (via `/ship T-{N}`): Der Worktree wird gelöscht, wenn keine anderen Tickets mit `depends_on: ["T-{N}"]` noch offen sind. Check erfolgt per Board-API.
- Bei `/develop E-{N} --abort` oder Epic-Crash: Worktrees bleiben liegen für Recovery. User bereinigt manuell via `git worktree prune` oder via `/recover T-{N} --cleanup`.

**Disk-Growth:**

Worst-Case: 8-Children-Epic mit tiefer Kette (jeder Child ~2 GB Repo-Clone) → 16 GB temporär. Bei drei parallel laufenden Epics ~48 GB. Das ist für den VPS relevant, aber im MVP-Rahmen akzeptabel. Follow-up-Ticket: Shallow-Worktrees (`git worktree add --depth 1`) um pro Worktree auf ~200 MB zu kommen.

**Orphan-Detection:**

Session-Start-Hook (existiert bereits via `.claude/rules/detect-stuck-tickets.md`) wird erweitert: wenn `.worktrees/T-{N}` existiert und Board sagt Child ist `done`, melde "orphan worktree for T-{N}, run `git worktree remove .worktrees/T-{N}` to clean up".

### 10. Observability

Debugging eines Epic-Runs mit 8 Children, 3 Rebases und 2 Worker-Restarts erfordert strukturierte Trails — Print-Logs reichen nicht.

**Emitted Events (in bestehender Board-Event-Struktur):**

- `epic.run.started` — `{epic_id, children: [ids], graph: [edges], inferred: bool}`
- `epic.child.dispatched` — `{epic_id, child_id, base_branch}`
- `epic.child.completed` — `{epic_id, child_id, duration_ms, status}`
- `epic.child.skipped` — `{epic_id, child_id, reason}`
- `epic.child.stuck` — `{epic_id, child_id, last_updated_at}`
- `epic.ship.started` — `{epic_id, merge_order: [ids]}`
- `epic.ship.merged` — `{epic_id, child_id, merge_commit_sha}`
- `epic.ship.rebased` — `{epic_id, child_id, conflict: bool}`
- `epic.ship.failed` — `{epic_id, child_id, reason}`
- `epic.run.completed` — `{epic_id, duration_ms, final_status}`

**Logs:**

Pipeline-Logs (`pipeline/run.ts` und `pipeline/worker.ts`) bekommen einen strukturierten Präfix `[epic E-{N}]` für alle Zeilen, die Teil eines Epic-Runs sind. Das ermöglicht `grep "\[epic E-42\]"` über den gesamten Worker-Log.

**Metrics (für späteres Dashboard):**

- `epic_run_duration_seconds` (Histogram, gelabelt nach `child_count`)
- `epic_ship_rebase_conflicts_total` (Counter)
- `epic_child_stuck_total` (Counter)

Metrics sind nicht im MVP implementiert, aber die Event-Namen sind so gewählt, dass ein späteres Dashboard direkt draufbauen kann.

### 11. Ship-Rollback bei Partial-Failure

Happy-Path: alle Children mergen sauber. Sad-Path: Ship merged Children 1-4, Child 5 fails (CI-rot nach Rebase, Conflict, was auch immer). Was dann?

**Grundsatz:** Kein Auto-Rollback. Gemergte Commits in `main` zu reverten ist eine destruktive Aktion mit breitem Blast-Radius (CI-Runs, Deployments, andere offene PRs, die auf `main` rebasen) — das gehört in die Hand des Users, nicht des Ship-Commands.

**Stattdessen:**

1. **Klarer State-Report.** Ship-Command gibt beim Fail aus:
   ```
   Epic E-42 — partial ship:
     ✓ T-101 merged into main (commit: abc123)
     ✓ T-102 merged into main (commit: def456)
     ✓ T-103 merged into main (commit: ghi789)
     ✓ T-104 merged into main (commit: jkl012)
     ✗ T-105 failed: CI red after rebase onto main
        → PR: https://github.com/.../pull/1234
        → Rebased branch: feature/T-105-xyz (local)
   Epic stays in_progress. Options:
     a) Fix T-105, re-run /ship E-42 to merge it
     b) Mark T-105 as cancelled, re-run /ship E-42 to finalize the epic without it
     c) Revert T-101..T-104 manually: git revert abc123..jkl012 (destructive)
   ```
2. **Epic-Status bleibt `in_progress`.** Der Hook aggregiert: vier Children `done`, einer `in_review` mit Failure-Annotation → Epic ist nicht fertig.
3. **Child-Status für T-105 bleibt `in_review`.** Der PR ist noch offen, CI ist rot, User sieht den Zustand direkt auf GitHub.
4. **Wenn User Option (a) wählt:** `/ship E-42` nochmal aufrufen. Ship merkt: T-101..T-104 sind `done` → skip. T-105 ist `in_review` → versuche zu mergen. Wenn CI jetzt grün → merge → Epic auf `done`.
5. **Wenn User Option (b) wählt:** Child auf `cancelled` setzen (via Board-UI oder `board-api.sh patch tickets/T-105 '{"status":"cancelled"}'`), dann `/ship E-42` nochmal. Aggregation: vier `done`, einer `cancelled` → `done` (Aggregator filtert cancelled raus). Ship merkt: keine ungemergten Children mehr → Epic auf `done`.
6. **Wenn User Option (c) wählt:** Das ist manuelle Git-Arbeit, keine Ship-Unterstützung. Dokumentation im Report reicht.

**Warum kein Auto-Rollback:** Revert in `main` ist semantisch unsicher. Wenn T-101 eine Datenbankmigration ist, ist `git revert` allein nicht genug — es braucht eine Down-Migration, die im Child nicht geplant war. Autorollback würde den User in einen Zustand bringen, den er gar nicht antizipiert hat. Fail-Fast mit klarem Report + User-Entscheidung ist die richtige Grenze.

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
