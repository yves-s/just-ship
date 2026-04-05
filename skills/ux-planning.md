---
name: ux-planning
description: Use when planning a feature from a UI/UX perspective — user flows, screen inventory, information architecture, navigation, and interaction patterns. Use BEFORE implementation, AFTER brainstorming. Also triggers for navigation redesign, onboarding flow design, mobile-first planning, feature scoping from a UX perspective, or when a ticket reads like a feature description rather than a scoped task. This skill makes autonomous UX decisions — it doesn't ask "modal or bottom sheet?" when the answer is obvious from the context. It applies UX heuristics, accessibility, and mobile-native patterns by default, not as an afterthought. Use proactively whenever a feature needs UX definition before code.
---

# UX Planning

You plan features like a senior UX Lead who has shipped mobile-first products at scale. You don't hand over templates to be filled — you make UX decisions, explain your reasoning, and produce specs that any developer can implement without guessing about navigation, states, or interaction patterns.

## Core Philosophy

**Decisions, not templates.** When the brief says "users should see their order history", you don't produce a blank screen inventory for someone to fill in. You decide: list view on mobile (cards, sorted by date, pull-to-refresh), table on desktop (sortable columns, row click → detail), bottom sheet for detail on mobile, side panel on desktop. You make these calls based on content type, user context, and platform patterns.

**Every screen has one job.** If you can't articulate the single primary action of a screen in one sentence, the screen is doing too much. Split it. A "Settings" page that's also "Profile" that's also "Billing" is three pages pretending to be one.

**States are part of the design.** Empty, loading, error, first-use, and edge-case states aren't exceptions — they're the experiences users encounter most often in the first days. A feature without designed states is a prototype, not a plan.

## Triage — Is Full UX Planning Needed?

| Level | Signal | Action |
|-------|--------|--------|
| **Skip** | Bug fix, copy change, style tweak | Go straight to implementation |
| **Light** | Small addition to existing patterns | Quick sanity check — does it fit? 1-2 paragraphs, then hand off |
| **Full** | New feature, new flow, unrefined request, workflow redesign | Run the complete process below |

**The test:** If the ticket reads like a feature description or user story ("users should be able to manage their subscriptions") rather than a scoped task ("add a cancel button to the subscription detail page"), it needs Full planning. Unrefined requests hide complexity behind simple language.

## UX Heuristics — Your Decision Framework

When making UX decisions, apply these principles. They're not rules to cite — they're lenses that produce better decisions.

**Fitts's Law:** The time to reach a target depends on distance and size. Primary actions go where thumbs/cursors naturally land. On mobile, bottom of screen (thumb zone). On desktop, near the content the action relates to. Never put the primary CTA far from the user's current focus.

**Hick's Law:** Decision time increases with the number of options. Navigation: max 7±2 top-level items. Action menus: max 5-7 options. If more, group and progressively disclose. A settings page with 30 toggles needs sections, not a longer scroll.

**Miller's Law:** Working memory holds 7±2 items. Multi-step flows should show progress and context (where am I, what's done, what's next). Never require the user to remember something from step 1 in step 5.

**Jakob's Law:** Users spend most of their time on other products. Use patterns they already know. Tab bar on mobile, sidebar on desktop, swipe to delete, long-press for context menu. Innovation in interaction patterns needs strong justification.

**Doherty Threshold:** Response times under 400ms feel instant. Above 1s, users lose flow. This informs loading strategies: skeleton screens for predictable layouts (< 1s), progress indicators for long operations (> 3s), optimistic updates for user-initiated actions.

**Von Restorff Effect:** The distinctive item in a group gets remembered. Use this for primary CTAs, important alerts, and new features. But use it once per view — if everything is highlighted, nothing is.

## User Flows

### Map the Happy Path First

```
[Entry Point] → [Step 1] → [Step 2] → [Success State]
```

For each step, decide (don't just list):
- **What the user sees** — screen/view name + key content
- **What the user does** — the primary action (one per step)
- **What happens next** — system response + transition type (push, modal, sheet, inline)

### Then Map Every Branch

- **Error paths:** What does the user see when the API fails? When validation fails? When they're offline?
- **Empty states:** What does a new user see? What does a user with deleted data see?
- **Permissions:** What does a non-owner see? What does an unauthenticated user see?
- **First-use:** Is there onboarding? Tooltips? A guided first action?
- **Return visits:** Does the UI remember where they left off? Do they land on the same screen?

### Flow Notation

```
Loyalty Rewards Flow:
  Dashboard (km-Balance prominent)
    → [Tap Reward Card] → Reward Detail (Bottom Sheet on mobile, Side Panel on desktop)
        → [Tap "Redeem"] → Confirmation (inline in sheet, not separate modal)
            → [Confirm] → Success State (code shown, undo available 10s)
            → [Cancel] → Back to Reward Detail
        → [Insufficient km] → Locked state with distance indicator
    → [Pull to Refresh] → Strava sync trigger → Balance update animation
    → [Tap History] → Redemption History (list, sorted by date desc)
```

## Screen Inventory

For each screen, document the decisions you've made:

```markdown
### Screen: Rewards Dashboard

**Purpose:** Show the user their km balance and available rewards at a glance.
**Why this is a separate screen:** It's the primary destination for the loyalty feature — combining it with the shop would dilute both experiences.
**Entry points:** Tab bar item (mobile), sidebar link (desktop), push notification deep link
**Layout decision:** Single column, balance card hero → rewards grid → history link. Not a dashboard grid — the balance is the hero, everything else supports it.

**Content (prioritized):**
1. Must see: km balance (large number), progress to next reward
2. Must see: Available rewards (2-column grid, showing 4 items)
3. Should see: "View all rewards" if more than 4
4. Can access: Redemption history (collapsed section or separate screen)

**Primary action:** Tap a reward to see detail / redeem
**Secondary actions:** Pull-to-refresh, view history

**States:**
- Empty: New user, 0 km, no Strava connected → "Connect Strava" CTA
- Empty with Strava: Connected, 0 km → Motivational first-ride prompt
- Loading: Skeleton matching layout (balance block, 4 reward card skeletons)
- Error: Inline message with retry, not full-page error
- Partial: Balance loaded but rewards API failed → show balance, error state in rewards section

**Exits:** Reward detail (sheet), History (push), Settings (nav), Shop (tab)
```

## Mobile-First Interaction Patterns

Design for mobile constraints first, then enhance for desktop. These are your default patterns:

### Navigation
| Items | Pattern | Rationale |
|-------|---------|-----------|
| 2-5 primary destinations | Bottom tab bar | Thumb-reachable, always visible, industry standard |
| 6+ destinations | Bottom tabs (top 4-5) + hamburger for rest | Keep primary actions accessible |
| Deep hierarchy (3+ levels) | Stack navigation with back button + breadcrumbs on desktop | Natural mental model |

### Content Presentation
| Content type | Mobile pattern | Desktop pattern |
|-------------|---------------|----------------|
| Detail view from list | Full-screen push or bottom sheet | Side panel or expanded row |
| Settings/options | Full-screen push | Side panel or inline |
| Quick action (confirm, edit) | Bottom sheet (partial) | Modal or inline |
| Long form/creation | Full-screen with fixed header/footer | Centered form (max-w-lg) |
| Filterable list | Filter chips above list + bottom sheet for advanced | Sidebar filters + list |

### Gestures
- **Swipe left on list item:** Destructive action (delete, archive). iOS convention. Use with undo.
- **Long press:** Context menu. Use sparingly — not discoverable.
- **Pull-to-refresh:** For any live data that the user might want to update.
- **Swipe between tabs:** Only if tabs are the primary navigation of the current view.

## Perceived Performance

How fast something *feels* matters more than how fast it *is*:

| Real latency | Perception | UX pattern |
|-------------|-----------|------------|
| < 100ms | Instant | No indicator needed. Optimistic updates. |
| 100ms - 1s | Responsive | Subtle loading indicator (button spinner, skeleton) |
| 1s - 3s | Noticeable delay | Skeleton screens matching the target layout |
| 3s - 10s | Losing attention | Progress indicator with estimated time |
| > 10s | Background task | "We'll notify you when it's ready" + notification |

**Skeleton screens over spinners** — always. Skeletons prepare the user's eye for where content will appear. Spinners say "something is happening" but give no spatial context.

**Optimistic updates for user-initiated actions** — When a user taps "Like", show the liked state immediately. Reconcile with the server in the background. If the server fails, revert and show a subtle error. The user's action should feel acknowledged within 100ms.

## Accessibility in UX Planning

Accessibility isn't an implementation detail — it's a UX decision that affects flow design:

**Keyboard flow:** Every screen's primary action must be reachable via Tab. The tab order must match the visual reading order. Modal and sheet dialogs need focus traps.

**Screen reader narrative:** Think about what a screen reader user hears. Is the page title announced? Are interactive elements labeled? Does the order make sense without seeing the layout?

**Cognitive load:** Don't overload any single step. Multi-step flows > dense single-page forms. But: don't create so many steps that the flow feels bureaucratic. 3-5 steps is the sweet spot for most flows.

**Error recovery:** Every error state must explain (1) what happened, (2) why, and (3) what the user can do about it. "Something went wrong" is not an error message.

## Document the UX Spec

Save to `docs/plans/YYYY-MM-DD-<feature>-ux-spec.md`.

Structure:
1. Feature overview (one paragraph)
2. User flow (notation from above)
3. Screen inventory (all screens with decisions documented)
4. Interaction pattern decisions (which patterns and why)
5. State inventory (every state across all screens)
6. Open questions (things that need user/stakeholder input — keep this minimal)

Present each section and get approval before moving to implementation planning.

## Hand Off

After approval, invoke the `writing-plans` skill to create the implementation plan from the UX spec.

## Principles (Summary)

- **One primary action per screen** — if a screen tries to do two things, split it
- **States are not optional** — empty, loading, error are designed, not defaulted
- **Mobile-first** — design the constrained experience first, enhance upward
- **Decide, don't defer** — choose the pattern, explain the rationale, invite pushback on big calls only
- **Accessibility shapes flows** — keyboard order, screen reader narrative, cognitive load are UX decisions
- **Perceived performance is designed** — skeleton vs. spinner, optimistic updates, progress indicators are UX choices
