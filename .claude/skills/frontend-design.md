---
name: frontend-design
description: Use when implementing frontend UI components or features — combines design system standards with component implementation patterns
---

# Frontend Implementation with Design Quality

## Overview

Frontend work is where design intent meets code reality. Your job is to make the design system work in every context, edge case included.

**Announce at start:** "Reading design system and existing component patterns before implementing."

## Step 1: Understand the Design System

Read the project's token/theme file before writing a single line:
- Token values (colors, spacing, typography, radius, shadows)
- Existing component library — what already exists?
- Naming conventions (CSS classes, component names, prop names)

## Step 2: Find the Right Pattern

Before creating a new component, check:
1. Does a component already exist for this use case?
2. Can an existing component be extended?
3. What's the closest existing implementation to reference?

## Step 3: Implement — Component Checklist

### Structure
- [ ] Single responsibility — one component does one thing
- [ ] Props are typed and documented
- [ ] No inline styles — all from token system
- [ ] Variants via props, not separate components

### States (ALL required)
```
Default | Hover | Active | Focus | Disabled
Loading | Empty | Error  | Success
```
Empty and Error states ship with every data-displaying component.

### Responsive
```
Mobile base → md: tablet → lg: desktop
```
Touch targets: minimum 44×44px.

### Accessibility
- Semantic HTML first (`button` not `div onClick`)
- `aria-label` on icon-only buttons
- Focus visible and stylable

## Step 4: Shared vs. Local

| Where | What |
|-------|------|
| `paths.shared` (from project.json) | Hooks, types, utilities used by multiple apps |
| App directory | Components specific to one app |
| Design system / component lib | Purely presentational, no business logic |

Never put shared logic inside a single app's directory.

## Step 5: Verify

```bash
# Run from project.json build.web or build.test
pnpm run build   # or npm/yarn/bun equivalent
```

Check:
- No TypeScript errors
- No console errors/warnings for your changes
- Responsive layout at 375px, 768px, 1280px breakpoints

## Anti-Patterns

- `any` type — forbidden without comment explaining why
- Hardcoded colors/spacing — always use tokens
- Missing error state — always implement
- Business logic in components — extract to hooks
- `console.log` left in — remove before committing
