---
name: ux-planning
description: Use when planning a feature from a UI/UX perspective — user flows, screen inventory, information architecture, navigation, and interaction patterns. Use BEFORE implementation, AFTER brainstorming.
---

# UX Planning

## Overview

Turn a validated idea into a concrete UX blueprint. This skill bridges the gap between brainstorming (what to build) and writing-plans (how to code it). The output is a UX spec that any developer can implement without guessing about navigation, screen layout, or user flow.

**When to use:** After brainstorming has produced an approved design concept, before writing-plans creates the implementation plan.
**When NOT to use:** For visual styling decisions (use `design` or `creative-design`), or for component-level implementation (use `frontend-design`).

**Announce at start:** "Using UX planning to define user flows, screens, and interaction patterns before implementation."

## Step 0: Triage — Is Full UX Planning Needed?

After reading the ticket/request, assess its scope before committing to the full process.

**Ask yourself:**
- Does this change introduce new screens, flows, or navigation?
- Does this significantly alter how users interact with existing features?
- Is the request unrefined — a broad idea or feature description rather than a clear, scoped task?

### Scope Levels

| Level | When | What to do | Examples |
|-------|------|------------|----------|
| **Skip** | Bug fix, copy change, style tweak | No UX planning needed. Go straight to implementation. | "Fix broken submit button", "Change header color" |
| **Light** | Small addition to existing patterns | Quick sanity check — does it fit existing flows? Document in 1-2 paragraphs, then hand off to writing-plans. | "Add a filter dropdown to the list", "Add confirmation dialog before delete" |
| **Full** | New feature, workflow redesign, unrefined request | Run the complete UX planning process below. | "Rebuild the editing mode", "Add team collaboration", "Users should be able to manage their subscriptions" |

**Decision rule:** If the ticket reads like a feature description or user story rather than a scoped technical task, it needs **Full** planning. Unrefined requests are the most dangerous — they hide complexity behind simple language.

**Announce your assessment:** "This is a [Skip/Light/Full] scope task because [reason]. [Proceeding to implementation / Writing a quick UX note / Running full UX planning.]"

---

## Checklist (Full Scope)

Complete in order:

1. **Triage** — assess scope (see above)
2. **Understand the feature** — read brainstorming output / design doc, understand the goal
3. **Map user flows** — primary flow first, then edge cases
4. **Create screen inventory** — every unique screen/view the feature needs
5. **Define information architecture** — what content goes where, navigation structure
6. **Specify interaction patterns** — how users interact with each screen
7. **Document the UX spec** — save and get user approval
8. **Hand off to writing-plans** — invoke writing-plans skill

## Step 1: User Flows

Map every path a user can take through the feature.

### Primary Flow (Happy Path)

```
[Entry Point] → [Step 1] → [Step 2] → [Success State]
```

Document for each step:
- **What the user sees** (screen/view name)
- **What the user does** (action)
- **What happens next** (system response + transition)

### Secondary Flows

- Error states — what happens when things go wrong?
- Empty states — what does the user see with no data?
- Edge cases — permissions, loading, offline, first-time use

### Flow Notation

Use simple text-based flow diagrams:

```
Login Flow:
  Landing Page
    → [Click "Sign Up"] → Registration Form
        → [Submit valid] → Email Verification → Dashboard (empty state)
        → [Submit invalid] → Registration Form (with errors)
    → [Click "Log In"] → Login Form
        → [Submit valid] → Dashboard
        → [Submit invalid] → Login Form (with error)
        → [Click "Forgot Password"] → Password Reset
```

## Step 2: Screen Inventory

List every unique screen/view. For each screen:

```markdown
### Screen: [Name]

**Purpose:** One sentence — why does this screen exist?
**Entry points:** How does the user get here?
**Key content:**
- [Content block 1]
- [Content block 2]
**Primary action:** The one thing the user should do here
**Secondary actions:** Other available actions
**States:** default | empty | loading | error
**Exits:** Where can the user go from here?
```

## Step 3: Information Architecture

### Navigation Structure

Define the navigation hierarchy:

```
App
├── Dashboard
├── Projects
│   ├── Project List
│   ├── Project Detail
│   │   ├── Overview Tab
│   │   ├── Settings Tab
│   │   └── Members Tab
│   └── New Project
├── Settings
│   ├── Profile
│   └── Billing
└── Help
```

### Content Prioritization

For each screen, rank content by importance:
1. **Must see** — visible immediately, above the fold
2. **Should see** — visible on scroll or secondary tab
3. **Can access** — available via menu, modal, or link

## Step 4: Interaction Patterns

Define how users interact with each key element.

### Pattern Template

```markdown
**Pattern:** [Name, e.g., "Inline Edit", "Drag & Drop Reorder", "Progressive Disclosure"]
**Where used:** [Screen(s)]
**Trigger:** [User action that initiates it]
**Behavior:**
1. [Step-by-step interaction sequence]
**Feedback:** [What the user sees/hears as confirmation]
**Cancel/Undo:** [How to reverse the action]
```

### Common Patterns to Consider

- **Data entry:** Forms, inline edit, auto-save vs. explicit save
- **Navigation:** Tabs, breadcrumbs, back behavior, deep linking
- **Feedback:** Toast notifications, inline validation, progress indicators
- **Destructive actions:** Confirmation dialogs, undo windows
- **Bulk operations:** Multi-select, batch actions
- **Search & filter:** Real-time filtering, search-as-you-type, faceted search

## Step 5: Wireframe Descriptions

For complex or novel screens, describe the layout in structured text:

```markdown
### Wireframe: [Screen Name]

**Layout:** [Single column | Two column | Sidebar + Main | Grid]

**Header area:**
- Logo + Nav (left)
- Search bar (center)
- User menu (right)

**Main content:**
- [Section 1]: Full width, card grid (3 columns on desktop, 1 on mobile)
- [Section 2]: Left-aligned list with action buttons on right

**Sidebar (if applicable):**
- Filter controls
- Quick stats

**Footer / Bottom bar:**
- Pagination or "Load more"
```

## Step 6: Document & Validate

Save the UX spec to `docs/plans/YYYY-MM-DD-<feature>-ux-spec.md`.

Present each section to the user and get approval before moving on. Revise as needed.

## Step 7: Hand Off

After user approval, invoke the `writing-plans` skill to create the implementation plan from the UX spec.

## Key Principles

- **User-first** — every decision starts with "what does the user need here?"
- **One primary action per screen** — if a screen tries to do two things, split it
- **States are not optional** — empty, loading, error states are part of the design
- **Mobile-first thinking** — define the constrained experience first, then expand
- **Consistency** — same patterns for same interactions across the entire feature
- **Progressive disclosure** — show what's needed now, reveal complexity on demand
