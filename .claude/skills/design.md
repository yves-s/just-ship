---
name: design
description: Use when making any visual or UX decision — choosing layout, spacing, colors, typography, or component structure. Enforces design system consistency and quality standards.
---

# Design Quality Standards

## Overview

Good UI is not decoration — it is communication. Every visual decision either builds or breaks trust with the user.

**Core principle:** Use the project's design system. Never invent values. Never guess.

## The Iron Law

```
NO HARDCODED VALUES — ALWAYS USE TOKENS
```

Colors, spacing, typography, border-radius, shadows — all from the design system defined in the project.

## Before Any Visual Implementation

1. Read `CLAUDE.md` for the project's design system / token structure
2. Read `project.json` for paths to design tokens or theme files
3. Find existing components that solve a similar problem — reuse patterns

## Design Token Usage

| Wrong | Right |
|-------|-------|
| `color: #3B82F6` | `color: var(--color-primary)` / `text-blue-500` |
| `padding: 16px` | `p-4` / `spacing.md` / `var(--spacing-4)` |
| `font-size: 14px` | `text-sm` / `typography.body` |
| `border-radius: 8px` | `rounded-lg` / `var(--radius-md)` |

## Component States — All Required

Every interactive component must implement all states:

```
Default → Hover → Active → Focus → Disabled
Loading → Empty → Error → Success
```

No component ships without Error and Empty states. These are not edge cases.

## Spacing System

Use the spacing scale consistently. Never add arbitrary px values between defined steps.

- **Micro spacing** (within a component): 1–3 scale steps
- **Component spacing** (between elements): 3–5 scale steps
- **Section spacing** (between sections): 6–8 scale steps

## Typography Hierarchy

- One H1 per page — the primary action or title
- H2 for major sections, H3 for subsections
- Body text: readable line-height (1.5–1.6), max 65–75 characters per line
- Never use more than 2 font weights in a component

## Responsive — Mobile First

```
Base styles = mobile
md: = tablet adjustments
lg: = desktop adjustments
```

Touch targets minimum 44×44px on mobile. Never smaller.

## Accessibility Baseline

- Color contrast: 4.5:1 for body text, 3:1 for large text
- Focus styles: always visible, never `outline: none` without replacement
- Interactive elements: keyboard accessible
- Images: meaningful alt text

## Visual QA Checklist

Before marking any UI work complete:

- [ ] All values from token system — no hardcoded colors/spacing
- [ ] All states implemented (default, hover, loading, error, empty)
- [ ] Mobile layout works (touch targets ≥44px)
- [ ] Consistent with adjacent components (same spacing rhythm)
- [ ] Focus state visible
- [ ] No lorem ipsum or placeholder data
