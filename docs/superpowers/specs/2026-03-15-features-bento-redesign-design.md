# Features Section Redesign — Bento Grid with Board Visuals

**Date:** 2026-03-15
**Status:** Approved
**Mockup:** `.superpowers/brainstorm/26817-1773599920/bento-features-v2.html`

## Problem

The current Features section ("Built for Shipping") is a generic 2x2 card grid with icon + title + one-line description. It's visually interchangeable with any SaaS landing page and fails to communicate just-ship's strongest differentiators: the live Board, VPS autonomous mode, smart model routing, and parallel agent execution.

## Solution

Replace the 2x2 Features grid with an asymmetric **Bento Grid** layout that integrates Board visuals directly as proof points. Large cells showcase visually demonstrable features with embedded UI recreations; small cells handle text-only features.

## Layout

3-column grid, 3 rows, asymmetric cell sizes:

```
┌─────────────────────────────┬───────────────┐
│  Live Board (2 col)         │  Smart Cost   │
│  Agent bar + Kanban mockup  │  Routing      │
│                             │  Model tiers  │
├─────────────────────────────┼───────────────┤
│  Runs 24/7 (2 col)         │  Parallel     │
│  VPS worker log             │  Agents       │
│                             │  Timeline     │
├───────────┬─────────┬───────┴───────────────┤
│ Zero-     │ Exten-  │  Non-Invasive         │
│ Config    │ sible   │                       │
└───────────┴─────────┴───────────────────────┘
```

Responsive: collapses to single column on mobile (breakpoint: 768px). Board visual switches to column flex-direction.

## Section Header

- **Heading (h2):** "Built for Shipping" (unchanged from current)
- **Subtitle:** "Everything you need to go from ticket to production — autonomously, efficiently, and at scale." (new, added below heading)

## Features (7 cells)

### 1. Live Board (large, 2 columns)
- **Label:** LIVE BOARD
- **Headline:** Watch agents work in real time
- **Description:** Kanban board with live agent activity. See what's building, what's reviewing, what shipped.
- **Visual:** Agent status bar (chips with pulsing green dots for active agents, checkmarks for completed) + 3-column Kanban mockup with real ticket data (T-311, T-306, T-293, T-298). In-progress ticket T-293 has a pulsing green dot next to the ticket ID.

### 2. Smart Cost Routing (1 column)
- **Label:** SMART COST ROUTING
- **Headline:** Pay only for what matters
- **Description:** The right model for each task. Power where it counts, efficiency everywhere else.
- **Visual:** Three model tiers — Opus (blue badge, "Plans & orchestrates", ~5%), Sonnet (gray, "Builds features", ~35%), Haiku (dark, "Reviews & checks", ~60%)

### 3. Runs 24/7 (large, 2 columns)
- **Label:** RUNS 24/7
- **Headline:** Deploy to VPS. Ship while you sleep.
- **Description:** Worker polls your board for new tickets. Agents build, test, and open PRs — fully autonomous, around the clock.
- **Visual:** Terminal-style worker log showing timestamps (03:12–03:22), agent names in blue, activity messages, green checkmarks for completions

### 4. Parallel Agents (1 column)
- **Label:** PARALLEL AGENTS
- **Headline:** Ship in half the time
- **Description:** Backend and Frontend work simultaneously. No waiting, no bottlenecks.
- **Visual:** Vertical timeline with progress bars — Orchestrator (done/green), Backend (75%/blue, active), Frontend (60%/blue, active), QA (waiting), DevOps (waiting)

### 5. Zero-Config Setup (small, 1 column)
- **Label:** ZERO-CONFIG SETUP
- **Icon:** Wrench (blue, 40x40 rounded container)
- **Headline:** Auto-detects your stack
- **Description:** Framework, language, styling, database — detected and configured. One command, 60 seconds.

### 6. Battle-tested Skills (small, 1 column)
- **Label:** BATTLE-TESTED SKILLS (with "17" badge)
- **Icon:** Lightning bolt (blue, 40x40 rounded container)
- **Headline:** No prompt engineering needed
- **Visual:** Chip-tag layout showing 5 skill names (`TDD`, `debugging`, `frontend-design`, `code-review`, `ux-planning`) + a "+12 more" link that anchors to the full Skills section (`#skills`) below on the page.
- **Badge count and "+N more":** Hardcoded to "17" and "+12 more" (matching current skill count). If skills are added/removed in the future, these values should be updated manually to stay in sync with the Skills section.
- Replaces the previous "Extensible" cell. Skills implicitly prove extensibility.

### 7. Non-Invasive (small, 1 column)
- **Label:** NON-INVASIVE
- **Icon:** Package (blue, 40x40 rounded container)
- **Headline:** Your project stays clean
- **Description:** Everything lives under `.claude/` — no pollution, no lock-in. Updates preserve your customizations.

## Replaces

The existing `features.tsx` component with its 4 features (Portable, Autonomous, Extensible, Real-Time). All four are replaced with more specific, visually backed alternatives. "Extensible" is replaced by the Skills cell which proves extensibility implicitly.

## Design Details

- **Colors:** Uses existing brand palette from `globals.css` — brand-950 (#0a0b10) background, brand-900 (#1a1d27) card bg, brand-800 (#2a2e3b) borders, accent (#3b82f6) blue
- **Pulsing dot animation:** `@keyframes agent-pulse` — scale 1→1.6, opacity 0.4→0, 2s ease-in-out infinite. Used on active agent chips and in-progress ticket ID.
- **Typography:** Section label (11px uppercase, accent blue), h3 (18px bold white), body (14px brand-400)
- **Card style:** 16px border-radius, 1px border brand-800, bg brand-900
- **Visual areas:** bg #12141c (slightly darker than card), separated by 1px border-top
- **Monospace elements:** JetBrains Mono for VPS log, ticket IDs, code references

## Scope

- Replace `apps/web/src/components/features.tsx` with new bento grid component
- No changes to other sections (Hero, How It Works, Agents, Commands, Skills, Quick Start, Footer)
- No changes to page.tsx import structure (still exports `Features`)
- Add `id="skills"` to the root `<section>` element in `skills.tsx` for anchor link from "+12 more"
- No new dependencies — pure CSS grid + Tailwind classes + CSS animations

## Out of Scope

- No actual Board screenshots/images — all visuals are recreated in HTML/CSS for consistency and performance
- No JavaScript interactivity beyond CSS animations
- No changes to the Board product itself
