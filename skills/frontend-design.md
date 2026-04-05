---
name: frontend-design
description: Use when implementing frontend UI components or features within an existing design system or component library. Also triggers for responsive implementation, component composition, animation/transitions, data display (tables, lists, dashboards), form design, state management in UI, and any task where visual quality and interaction craft matter. This skill doesn't just assemble components — it implements them with the craft quality of Linear or Stripe. Use proactively on every frontend task, even "simple" ones — because users experience every pixel.
---

# Frontend Implementation with Craft

You implement frontend code like a senior UI engineer at Linear — every component handles all its states, every transition has intentional timing, every data display uses appropriate typography, and the result feels considered rather than assembled.

## Core Philosophy

**Implementing design is design.** The gap between a mockup and a shipped component is where craft lives or dies. Loading states, error boundaries, keyboard navigation, animation timing — these aren't in any mockup, and they define whether the product feels polished or patched together.

**Defaults should be excellent.** When no design spec exists for spacing, animation timing, or empty states, you don't ask — you apply proven defaults from this skill and note what you chose. Asking "what padding do you want?" is an abdication of craft.

**Systems, not snowflakes.** Every component decision should work across the product. A card style isn't just this card — it's every card. A spacing choice isn't just this page — it's every page.

## Before You Write Code

Read the project's design system before writing a single line:
1. Token/theme file — colors, spacing, typography, radius, shadows
2. Existing component library — what already exists?
3. Naming conventions — CSS classes, component names, prop names
4. Check if shadcn/ui is used (`components/ui/` or `components.json`)

If a component exists, extend it. If shadcn/ui has it, use it. Only build custom when neither applies.

## Spacing System

When the project has tokens, use them. When it doesn't, apply these defaults (4px base, industry standard):

| Token | Value | Usage |
|-------|-------|-------|
| `xs` | 4px (p-1) | Tight internal padding, icon gaps |
| `sm` | 8px (p-2) | Compact element spacing, inline gaps |
| `md` | 12px (p-3) | Small element internal padding |
| `base` | 16px (p-4) | Standard padding, paragraph gaps |
| `lg` | 24px (p-6) | Card content spacing, section padding |
| `xl` | 32px (p-8) | Between content groups |
| `2xl` | 48px (py-12) | Between major sections |
| `3xl` | 64px (py-16) | Page section separators |

Never use arbitrary values. `p-[13px]` means the system has a gap, not the component.

## Typography Defaults

When no type scale exists, use these (based on 1.25 ratio, works for any interface):

| Role | Size/LH | Weight | Tailwind |
|------|---------|--------|----------|
| Caption | 12px/16px | Regular | `text-xs` |
| Secondary | 14px/20px | Regular | `text-sm` |
| Body | 16px/24px | Regular | `text-base` |
| Lead | 18px/28px | Regular | `text-lg` |
| Card Title | 20px/28px | Semibold | `text-xl font-semibold` |
| Section Head | 24px/32px | Semibold | `text-2xl font-semibold` |
| Page Title | 30px/36px | Semibold | `text-3xl font-semibold` |

**Data-specific typography:**
- Numbers/currency: `font-variant-numeric: tabular-nums` (Tailwind: `tabular-nums`) — aligns decimal points in columns
- IDs, codes, technical values: `font-mono` — visually distinguishes data from text
- Numbers right-aligned in tables, text left-aligned — this makes columns scannable

## Component States

Every component that displays data must handle all these states. This is not a checklist — it's a requirement.

### The Five States

**Empty** — No data yet. Never show "No results." Always guide toward the next action.
```tsx
<EmptyState
  icon={<InboxIcon />}
  title="No orders yet"
  description="Your orders will appear here after your first purchase."
  action={{ label: "Browse products", href: "/shop" }}
/>
```

**Loading** — Data is being fetched. Use skeleton screens, not spinners.
```tsx
// Skeleton that matches the real layout
<div className="space-y-3">
  {[...Array(3)].map((_, i) => (
    <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
  ))}
</div>
```
Spinners are acceptable only for actions (button loading state). Never for page/section loading.

**Error** — Something went wrong. Explain what happened and offer a recovery action.
```tsx
<ErrorState
  title="Couldn't load orders"
  description="We're having trouble connecting. Please try again."
  action={{ label: "Retry", onClick: refetch }}
/>
```
Never show raw error messages, stack traces, or error codes to users.

**Partial** — Some data loaded, some failed. Show what you have, indicate what's missing.

**Success/Complete** — Data is loaded and displayed. This is the "normal" state but it's the one you design last, not first.

### Interactive States

Every interactive element also needs:
- **Default** — resting state
- **Hover** — cursor over (desktop only, use `@media (hover: hover)`)
- **Active/Pressed** — during click/tap (subtle scale or opacity change)
- **Focus** — keyboard navigation (visible ring, never remove outlines without replacing)
- **Disabled** — non-interactive (reduced opacity, no pointer events, `aria-disabled`)

## Animation & Transitions

Animation communicates change. It's functional, not decorative.

### Timing Defaults

| Category | Duration | Easing | Use |
|----------|----------|--------|-----|
| Micro | 100-150ms | ease-out | Hover, toggle, button press |
| Content | 200-300ms | ease-out | Modals, drawers, dropdowns |
| Complex | 300-500ms | ease-in-out | Page transitions, onboarding |

```css
/* Tailwind utility classes */
.transition-micro { @apply transition-all duration-150 ease-out; }
.transition-content { @apply transition-all duration-200 ease-out; }
```

### What to Animate
- State changes (appear, disappear, toggle)
- Spatial transitions (slide-in from source direction)
- Skeleton → content (crossfade, not pop)
- Feedback (success checkmark, error shake)

### What NOT to Animate
- First paint (page loads should render immediately)
- Body text (fade-in-on-scroll for paragraphs is distracting)
- Anything that delays task completion
- Decorative loops that compete with content

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```
This is non-negotiable. Replace animations with instant state changes.

## Responsive Implementation

Mobile-first always. Start with the smallest constraint, enhance upward.

### Breakpoints
```
Base (0+):     Mobile — single column, full-width elements
sm (640px+):   Large mobile / small tablet
md (768px+):   Tablet — 2 columns where appropriate
lg (1024px+):  Desktop — full layout
xl (1280px+):  Wide — use for max-width containers
```

### Common Responsive Patterns

**Navigation:** Bottom tabs (mobile) → Sidebar (desktop)
**Lists:** Single column cards (mobile) → Table with columns (desktop)
**Forms:** Full-width stacked (mobile) → Constrained width centered (desktop, max-w-lg)
**Dashboards:** Stacked cards (mobile) → Grid with sidebar (desktop)

### Touch Targets
Minimum 44×44px for all tappable elements on mobile. A 20px icon button needs `p-3` around it to reach the 44px target. This is a hard requirement (Apple HIG, WCAG 2.5.5).

## Data Display Patterns

### Tables
- Right-align numbers, left-align text
- Sticky headers for tables exceeding viewport height
- Sort indicators on sortable columns (subtle up/down icon)
- Row hover state: subtle background change (`hover:bg-muted/50`)
- Mobile: Transform to card list — each row becomes a card with key-value pairs

```tsx
// Responsive table → card pattern
<div className="hidden md:block">
  <Table>...</Table>
</div>
<div className="md:hidden space-y-3">
  {data.map(row => <OrderCard key={row.id} {...row} />)}
</div>
```

### Forms (Luke Wroblewski's principles)
- Single column layout always
- Labels above inputs (not beside, not floating inside)
- Inline validation on blur — show success too, not just errors
- Group related fields visually (fieldset with legend)
- Mark optional fields, not required ones
- Error messages directly below the field, specific guidance ("Must include @") not generic ("Invalid")

### Status Badges
Use consistent semantic colors across the entire product:

```tsx
const statusColors = {
  active:     "bg-emerald-500/15 text-emerald-600",
  pending:    "bg-amber-500/15 text-amber-600",
  failed:     "bg-red-500/15 text-red-600",
  cancelled:  "bg-zinc-500/15 text-zinc-600",
  shipped:    "bg-blue-500/15 text-blue-600",
} as const;
```

## Accessibility

Not a phase. Not a checklist at the end. Built into every component from the start.

- **Semantic HTML:** `<button>` not `<div onClick>`, `<nav>` not `<div class="nav">`, `<main>`, `<section>`, `<article>`
- **Focus management:** Visible focus rings (2px, offset), logical tab order, focus trap in modals
- **Screen readers:** `aria-label` on icon-only buttons, `aria-live` for dynamic updates, meaningful alt text
- **Keyboard:** Enter/Space activates buttons, Escape closes modals, Arrow keys navigate lists
- **Contrast:** 4.5:1 minimum for normal text, 3:1 for large text (18px+). Check every color combination.
- **Color independence:** Never convey information through color alone. Add icons, text labels, or patterns.

## Performance

- **Bundle awareness:** Every `import` adds weight. Justify external dependencies.
- **Code splitting:** Lazy load routes and heavy components (`React.lazy`, `next/dynamic`)
- **Image optimization:** `next/image` or equivalent, proper sizing, WebP/AVIF format, lazy loading below fold
- **Render performance:** Memoize expensive computations (`useMemo`), prevent unnecessary re-renders (`React.memo` for pure components)
- **CSS:** Prefer Tailwind utilities over runtime CSS-in-JS. Avoid layout thrashing.

## shadcn/ui Patterns

When the project uses shadcn/ui:

```bash
npx shadcn@latest add button card dialog form input select table
```

- Always check if a component exists before building custom
- Use semantic color tokens (`bg-background`, `text-foreground`, `bg-muted`) — never `bg-white`/`bg-black`
- Form validation: Zod + react-hook-form + `<Form>` components
- Dark mode: `next-themes` with `<ThemeProvider attribute="class">`

## Verify

- [ ] All 5 data states implemented (empty, loading, error, partial, complete)
- [ ] All interactive states work (hover, focus, active, disabled)
- [ ] Responsive at 375px, 768px, 1280px
- [ ] Touch targets ≥ 44px on mobile
- [ ] Keyboard navigation works for all interactive elements
- [ ] Focus indicators visible
- [ ] `prefers-reduced-motion` respected
- [ ] No TypeScript errors, no console warnings
- [ ] Data typography: tabular-nums for numbers, right-aligned in tables
- [ ] Skeleton loading, not spinners, for content areas

## Anti-Patterns

- Spinner for page/section loading — use skeleton screens
- `any` type — forbidden without justification
- Hardcoded colors/spacing — always use tokens or the defaults from this skill
- `bg-white dark:bg-gray-900` — use `bg-background` (semantic)
- Missing empty state — every list/table needs one with guidance
- `div` with `onClick` — use `button` or `a`
- Focus outlines removed without replacement — always provide visible focus
- Numbers left-aligned in columns — right-align for scannability
- Animation without `prefers-reduced-motion` fallback — always respect user preference
