# Features Bento Grid Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic 2x2 Features grid with an asymmetric bento grid that integrates Board visuals as proof points.

**Architecture:** Single component rewrite of `features.tsx` + one attribute addition to `skills.tsx`. All visuals are pure HTML/CSS (no images, no JS). Uses Tailwind v4 utility classes + inline styles for custom values not in the design system. CSS animations for pulsing dots.

**Tech Stack:** React, Tailwind CSS v4, Next.js 16

**Spec:** `docs/superpowers/specs/2026-03-15-features-bento-redesign-design.md`
**Visual mockup:** `.superpowers/brainstorm/26817-1773599920/bento-features-v2.html`

---

## Chunk 1: Implementation

### Task 1: Add skills section anchor

**Files:**
- Modify: `apps/web/src/components/skills.tsx:26`

- [ ] **Step 1: Add id="skills" to the Skills section root element**

In `skills.tsx`, change line 26 from:
```tsx
    <section className="bg-brand-900 py-24 sm:py-32">
```
to:
```tsx
    <section id="skills" className="bg-brand-900 py-24 sm:py-32">
```

- [ ] **Step 2: Verify the change**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/skills.tsx
git commit -m "feat(web): add skills section anchor for bento grid link"
```

---

### Task 2: Rewrite features.tsx with bento grid

**Files:**
- Rewrite: `apps/web/src/components/features.tsx`

The complete component is below. It translates the approved mockup (`.superpowers/brainstorm/26817-1773599920/bento-features-v2.html`) from vanilla HTML/CSS into React + Tailwind. Where Tailwind classes don't cover custom values (e.g., specific hex colors for the visual areas, `#12141c` background), use inline styles or arbitrary Tailwind values.

- [ ] **Step 1: Rewrite the full features.tsx**

Replace the entire contents of `apps/web/src/components/features.tsx` with this component:

```tsx
import type { ReactNode } from "react";

function PulseDot() {
  return (
    <span className="relative inline-block h-2 w-2">
      <span className="absolute inset-0 rounded-full bg-success" />
      <span
        className="absolute -inset-[3px] rounded-full bg-success opacity-40"
        style={{ animation: "agent-pulse 2s ease-in-out infinite" }}
      />
    </span>
  );
}

function CheckIcon() {
  return <span className="text-sm text-success">&#10003;</span>;
}

/* ── Live Board cell ──────────────────────────────────── */

function LiveBoardCell() {
  return (
    <div className="col-span-1 overflow-hidden rounded-2xl border border-brand-800 bg-brand-900 sm:col-span-2">
      {/* Text */}
      <div className="p-7">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[1.5px] text-accent">
          Live Board
        </p>
        <h3 className="mb-1.5 text-lg font-bold text-white">
          Watch agents work in real time
        </h3>
        <p className="text-sm leading-relaxed text-brand-400">
          Kanban board with live agent activity. See what&apos;s building,
          what&apos;s reviewing, what shipped.
        </p>
      </div>

      {/* Agent status bar */}
      <div
        className="flex items-center gap-2.5 overflow-x-auto border-y border-brand-800 px-5 py-2.5"
        style={{ background: "#12141c" }}
      >
        <div className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-brand-800 bg-brand-900 px-3 py-1 text-xs font-semibold text-brand-400">
          <span className="text-[13px]">&#9881;</span>
          Agents
          <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-md bg-accent text-[10px] font-bold text-white">
            4
          </span>
        </div>

        {[
          { name: "orchestrator", ticket: "T-318", active: false },
          { name: "orchestrator", ticket: "T-298", active: true },
          { name: "qa", ticket: "T-318", active: false },
          { name: "backend", ticket: "T-298", active: true },
        ].map((agent, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-brand-800 bg-brand-900 px-3 py-1 text-xs text-brand-400"
          >
            <span className="rounded bg-accent/15 px-2 py-px text-[11px] font-semibold text-accent-light">
              {agent.name}
            </span>
            <span className="text-[11px] text-brand-600">{agent.ticket}</span>
            <span className="inline-flex h-4 w-4 items-center justify-center">
              {agent.active ? <PulseDot /> : <CheckIcon />}
            </span>
          </div>
        ))}
      </div>

      {/* Kanban */}
      <div
        className="flex gap-3.5 p-4 sm:p-5"
        style={{ background: "#12141c" }}
      >
        {/* Ready */}
        <div className="min-w-0 flex-1">
          <div className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-brand-400">
            <span
              className="h-[7px] w-[7px] rounded-full"
              style={{ background: "#6b7394" }}
            />
            Ready
            <span className="font-normal text-brand-700">12</span>
          </div>
          <div className="mb-2 rounded-lg border border-brand-800 bg-brand-900 p-2.5">
            <p className="mb-1 font-mono text-[10px] text-brand-600">T-311</p>
            <p className="text-xs leading-snug text-brand-200">
              Claude Code Best Practices analysieren
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span className="rounded bg-brand-800 px-1.5 py-px text-[10px] text-brand-600">
                spike
              </span>
              <span className="rounded bg-brand-800 px-1.5 py-px text-[10px] text-brand-600">
                dx
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-brand-800 bg-brand-900 p-2.5">
            <p className="mb-1 font-mono text-[10px] text-brand-600">T-306</p>
            <p className="text-xs leading-snug text-brand-200">
              Setup.sh Next Steps output verbessern
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span className="rounded bg-brand-800 px-1.5 py-px text-[10px] text-brand-600">
                improvement
              </span>
              <span className="rounded bg-brand-800 px-1.5 py-px text-[10px] text-brand-600">
                ux
              </span>
            </div>
          </div>
        </div>

        {/* In Progress */}
        <div className="min-w-0 flex-1">
          <div className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-brand-400">
            <span
              className="h-[7px] w-[7px] rounded-full"
              style={{ background: "#f59e0b" }}
            />
            In Progress
            <span className="font-normal text-brand-700">2</span>
          </div>
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-2.5">
            <p className="mb-1 flex items-center gap-1.5 font-mono text-[10px] text-brand-600">
              T-293 <PulseDot />
            </p>
            <p className="text-xs leading-snug text-brand-200">
              Rollen, Rechte und Invite Flow
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span className="rounded bg-brand-800 px-1.5 py-px text-[10px] text-brand-600">
                auth
              </span>
              <span className="rounded bg-brand-800 px-1.5 py-px text-[10px] text-brand-600">
                roles
              </span>
            </div>
          </div>
        </div>

        {/* In Review */}
        <div className="min-w-0 flex-1">
          <div className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-brand-400">
            <span
              className="h-[7px] w-[7px] rounded-full"
              style={{ background: "#a855f7" }}
            />
            In Review
            <span className="font-normal text-brand-700">1</span>
          </div>
          <div className="rounded-lg border border-brand-800 bg-brand-900 p-2.5">
            <p className="mb-1 font-mono text-[10px] text-brand-600">T-298</p>
            <p className="text-xs leading-snug text-brand-200">
              Autonome Ticket-Umsetzung
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span className="rounded bg-brand-800 px-1.5 py-px text-[10px] text-brand-600">
                feature
              </span>
              <span className="rounded bg-brand-800 px-1.5 py-px text-[10px] text-brand-600">
                automation
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Smart Cost Routing cell ──────────────────────────── */

function CostRoutingCell() {
  const tiers = [
    {
      name: "Opus",
      role: "Plans & orchestrates",
      usage: "~5% of tokens",
      badgeClass: "bg-accent text-white",
    },
    {
      name: "Sonnet",
      role: "Builds features",
      usage: "~35% of tokens",
      badgeClass: "bg-brand-700 text-brand-300",
    },
    {
      name: "Haiku",
      role: "Reviews & checks",
      usage: "~60% of tokens",
      badgeClass: "bg-brand-800 text-brand-600",
    },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-brand-800 bg-brand-900">
      <div className="p-7">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[1.5px] text-accent">
          Smart Cost Routing
        </p>
        <h3 className="mb-1.5 text-lg font-bold text-white">
          Pay only for what matters
        </h3>
        <p className="text-sm leading-relaxed text-brand-400">
          The right model for each task. Power where it counts, efficiency
          everywhere else.
        </p>
      </div>
      <div className="flex flex-col gap-2 px-7 pb-6">
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className="flex items-center gap-2.5 rounded-[10px] px-3.5 py-2.5"
            style={{ background: "#12141c" }}
          >
            <span
              className={`rounded-md px-2.5 py-0.5 text-[11px] font-bold ${tier.badgeClass}`}
            >
              {tier.name}
            </span>
            <span className="text-xs text-brand-400">{tier.role}</span>
            <span className="ml-auto whitespace-nowrap text-[11px] text-brand-600">
              {tier.usage}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Runs 24/7 cell ───────────────────────────────────── */

function VpsCell() {
  const logLines = [
    { time: "03:12", agent: "worker", msg: "Polling... found T-293", success: "✓ claimed" },
    { time: "03:12", agent: "orchestrator", msg: "Analyzing ticket, planning implementation..." },
    { time: "03:14", agent: "backend", msg: "Creating API endpoints for role management" },
    { time: "03:14", agent: "frontend", msg: "Building invite flow UI components" },
    { time: "03:21", agent: "qa", msg: "All acceptance criteria verified", success: "✓" },
    { time: "03:22", agent: "orchestrator", msg: "PR #47 created", success: "✓ ready for review" },
  ];

  return (
    <div className="col-span-1 overflow-hidden rounded-2xl border border-brand-800 bg-brand-900 sm:col-span-2">
      <div className="p-7">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[1.5px] text-accent">
          Runs 24/7
        </p>
        <h3 className="mb-1.5 text-lg font-bold text-white">
          Deploy to VPS. Ship while you sleep.
        </h3>
        <p className="text-sm leading-relaxed text-brand-400">
          Worker polls your board for new tickets. Agents build, test, and open
          PRs — fully autonomous, around the clock.
        </p>
      </div>
      <div
        className="border-t border-brand-800 px-5 py-4 font-mono text-xs leading-[1.8]"
        style={{ background: "#12141c" }}
      >
        {logLines.map((line, i) => (
          <div key={i} className="flex gap-2">
            <span className="min-w-[56px] text-brand-700">{line.time}</span>
            <span className="min-w-[100px] text-accent">{line.agent}</span>
            <span className="text-brand-400">
              {line.msg}
              {line.success && (
                <span className="text-success"> {line.success}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Parallel Agents cell ─────────────────────────────── */

function ParallelAgentsCell() {
  const agents = [
    { name: "Orchestrator", progress: 100, status: "done" as const },
    { name: "Backend", progress: 75, status: "active" as const },
    { name: "Frontend", progress: 60, status: "active" as const },
    { name: "QA", progress: 0, status: "waiting" as const },
    { name: "DevOps", progress: 0, status: "waiting" as const },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-brand-800 bg-brand-900">
      <div className="p-7">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[1.5px] text-accent">
          Parallel Agents
        </p>
        <h3 className="mb-1.5 text-lg font-bold text-white">
          Ship in half the time
        </h3>
        <p className="text-sm leading-relaxed text-brand-400">
          Backend and Frontend work simultaneously. No waiting, no bottlenecks.
        </p>
      </div>
      <div className="relative px-7 pb-6 pl-11">
        {/* Vertical line */}
        <div className="absolute bottom-6 left-7 top-1 w-0.5 bg-brand-800" />

        {agents.map((agent) => (
          <div
            key={agent.name}
            className="relative flex items-center gap-2.5 py-1.5"
          >
            {/* Dot */}
            <span
              className={`absolute -left-[20px] h-2.5 w-2.5 rounded-full border-2 ${
                agent.status === "done"
                  ? "border-success bg-success"
                  : agent.status === "active"
                    ? "border-accent bg-accent shadow-[0_0_8px_rgba(59,130,246,0.4)]"
                    : "border-brand-800 bg-brand-900"
              }`}
            />
            <span className="min-w-[70px] text-xs font-semibold text-brand-200">
              {agent.name}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-brand-800">
              <div
                className={`h-full rounded-full ${
                  agent.status === "done" ? "bg-success" : "bg-accent"
                }`}
                style={{ width: `${agent.progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Small icon cell wrapper ──────────────────────────── */

function SmallCell({
  icon,
  label,
  headline,
  children,
}: {
  icon: ReactNode;
  label: ReactNode;
  headline: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-brand-800 bg-brand-900 p-7">
      <div className="mb-3.5 flex h-10 w-10 items-center justify-center rounded-[10px] bg-accent/10 text-accent">
        {icon}
      </div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[1.5px] text-accent">
        {label}
      </p>
      <h3 className="mb-1.5 text-lg font-bold text-white">{headline}</h3>
      {children}
    </div>
  );
}

/* ── Exported section ─────────────────────────────────── */

export function Features() {
  return (
    <section className="bg-brand-950 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="mb-4 text-center text-3xl font-bold text-white sm:text-4xl">
          Built for Shipping
        </h2>
        <p className="mx-auto mb-16 max-w-xl text-center text-brand-400">
          Everything you need to go from ticket to production — autonomously,
          efficiently, and at scale.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Row 1 */}
          <LiveBoardCell />
          <CostRoutingCell />

          {/* Row 2 */}
          <VpsCell />
          <ParallelAgentsCell />

          {/* Row 3 */}
          <SmallCell
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
              </svg>
            }
            label="Zero-Config Setup"
            headline="Auto-detects your stack"
          >
            <p className="text-sm leading-relaxed text-brand-400">
              Framework, language, styling, database — detected and configured.
              One command, 60 seconds.
            </p>
          </SmallCell>

          <SmallCell
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            }
            label={
              <span className="flex items-center gap-2">
                Battle-tested Skills
                <span className="rounded-md bg-brand-800 px-2 py-px text-[10px] font-bold normal-case tracking-normal text-brand-600">
                  17
                </span>
              </span>
            }
            headline="No prompt engineering needed"
          >
            <div className="mt-2.5 flex flex-wrap gap-[5px]">
              {["TDD", "debugging", "frontend-design", "code-review", "ux-planning"].map(
                (skill) => (
                  <span
                    key={skill}
                    className="rounded-md border border-brand-800 px-2.5 py-0.5 font-mono text-[11px] text-accent-light"
                    style={{ background: "#12141c" }}
                  >
                    {skill}
                  </span>
                )
              )}
              <a
                href="#skills"
                className="rounded-md border border-accent/30 px-2.5 py-0.5 font-mono text-[11px] text-accent transition-colors hover:border-accent/50"
                style={{ background: "#12141c" }}
              >
                +12 more &darr;
              </a>
            </div>
          </SmallCell>

          <SmallCell
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 8V21H3V8" />
                <path d="M1 3h22v5H1z" />
                <path d="M10 12h4" />
              </svg>
            }
            label="Non-Invasive"
            headline="Your project stays clean"
          >
            <p className="text-sm leading-relaxed text-brand-400">
              Everything lives under{" "}
              <code className="font-mono text-[13px] text-accent-light">.claude/</code>
              {" "}— no pollution, no lock-in. Updates preserve your customizations.
            </p>
          </SmallCell>
        </div>
      </div>

      {/* Pulsing dot keyframes */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes agent-pulse {
              0%, 100% { transform: scale(1); opacity: 0.4; }
              50% { transform: scale(1.6); opacity: 0; }
            }
          `,
        }}
      />
    </section>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify build succeeds**

Run: `cd apps/web && npm run build`
Expected: Build completes successfully

- [ ] **Step 4: Visual check (dev server)**

Run: `cd apps/web && npm run dev`
Open `http://localhost:3001` and scroll to Features section. Verify:
- Bento grid renders with 3-column layout on desktop
- Agent status bar shows 4 chips with pulsing green dots
- Kanban cards display correctly
- T-293 has pulsing green dot
- VPS log shows terminal-style output
- Parallel agents timeline shows progress bars
- Small cells (Zero-Config, Skills, Non-Invasive) render with icons
- "+12 more" link scrolls to Skills section
- Mobile (resize to <768px): collapses to single column

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/features.tsx
git commit -m "feat(web): redesign features section with bento grid and board visuals"
```
