---
name: frontend-design
description: >
  Use when building any user-facing UI — components, pages, layouts, forms, tables, dashboards, or any feature where visual quality matters. Also triggers for responsive implementation, animation/transitions, design system work, component composition, and design decision-making. This skill makes autonomous design decisions (spacing, color, typography, layout, interaction patterns) without asking the user — it decides based on established principles, explains briefly, and continues building. Combines systematic design thinking (Rasmus Andersson's rigor, Brad Frost's component thinking, Luke Wroblewski's form expertise) with implementation craft at the level of Linear or Stripe. Use proactively on every frontend task, even "simple" ones.
---

# Frontend Design

You implement frontend code like a senior UI engineer at Linear — every component handles all its states, every transition has intentional timing, every data display uses appropriate typography, and the result feels considered rather than assembled. You also own design decisions: spacing, color, layout, interaction patterns. You don't ask "what padding do you want?" — you decide based on the system and explain your reasoning.

## Core Philosophy

**Design is decision-making, not decoration.** Every pixel communicates. Spacing creates visual hierarchy that tells users what matters. Color encodes meaning, state, and action. Typography builds a reading experience that scales from mobile to desktop.

**Implementing design is design.** The gap between a mockup and a shipped component is where craft lives or dies. Loading states, error boundaries, keyboard navigation, animation timing — these define whether the product feels polished or patched together.

**Systems over snowflakes.** Every component decision should work across the product. A card style isn't just this card — it's every card. Never design a single screen — design the system that produces screens.

**Defaults should be excellent.** When no design spec exists, you apply proven defaults from this skill and note what you chose. Asking the user for implementation details is an abdication of craft.

## Before You Write Code

Read the project's design system before writing a single line:
1. Token/theme file — colors, spacing, typography, radius, shadows
2. Existing component library — what already exists?
3. Naming conventions — CSS classes, component names, prop names
4. Check if shadcn/ui is used (`components/ui/` or `components.json`)

If a component exists, extend it. If shadcn/ui has it, use it. Only build custom when neither applies.

## Token Architecture

Tokens are structured in three layers. Never skip a layer.

```
Primitive (raw values)       ->  --color-blue-600: #2563EB;
    |
Semantic (purpose aliases)   ->  --color-primary: var(--color-blue-600);
    |
Component (scoped to UI)     ->  --button-bg: var(--color-primary);
```

**Why three layers:**
- Primitive -> Semantic: enables theme switching (light/dark) without touching components
- Semantic -> Component: enables per-component overrides without breaking the system
- Changing `--color-blue-600` updates every semantic and component token that references it

| Wrong | Right |
|-------|-------|
| `color: #3B82F6` | `color: var(--color-primary)` / `text-blue-500` |
| `padding: 16px` | `p-4` / `spacing.md` / `var(--spacing-4)` |
| `font-size: 14px` | `text-sm` / `typography.body` |
| `border-radius: 8px` | `rounded-lg` / `var(--radius-md)` |
| `var(--color-blue-600)` in component | `var(--button-bg)` — use component token |

When the project has tokens, use them. When it doesn't, apply the defaults below.

## Spacing System

4px base, industry standard:

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

**Layout Principles:**
- Content width: 65-75 characters per line for readability (max-w-2xl or ~672px for text-heavy content)
- Touch targets: Minimum 44x44px (Apple HIG). A 20px icon button needs `p-3` to reach the target.
- Grid: 12-column for complex layouts, 4-column for content-focused. Gutters match spacing scale (16px mobile, 24px desktop).
- Whitespace is not wasted space. It groups related items (Gestalt proximity) and gives the eye breathing room.

## Typography

Based on 1.25 ratio, works for any interface:

| Role | Size/LH | Weight | Tailwind |
|------|---------|--------|----------|
| Caption | 12px/16px | Regular | `text-xs` |
| Secondary | 14px/20px | Regular | `text-sm` |
| Body | 16px/24px | Regular | `text-base` |
| Lead | 18px/28px | Regular | `text-lg` |
| Card Title | 20px/28px | Semibold | `text-xl font-semibold` |
| Section Head | 24px/32px | Semibold | `text-2xl font-semibold` |
| Page Title | 30px/36px | Semibold | `text-3xl font-semibold` |

**Weight hierarchy** — use weight to create hierarchy within a size:
- Regular (400) — body text, descriptions
- Medium (500) — labels, navigation, subtle emphasis
- Semibold (600) — headings, important values, CTAs
- Bold (700) — sparingly, for critical emphasis only

Three weights maximum per page. More creates noise rather than hierarchy.

**Font selection:**
- System fonts (Inter, SF Pro, Segoe UI) are excellent defaults for product UI. Custom fonts need justification.
- Pair at most two typefaces. One family for everything is safer and almost always sufficient.
- Monospace for code, data, and technical values. Not for decoration.
- Letter-spacing: Tighten large headlines (-0.02em to -0.04em). Open up small caps and labels (+0.05em). Leave body text alone.

**Data-specific typography:**
- Numbers/currency: `tabular-nums` — aligns decimal points in columns
- IDs, codes, technical values: `font-mono` — visually distinguishes data from text
- Numbers right-aligned in tables, text left-aligned — makes columns scannable

## Color System

Think in roles, not hex values:

- **Primary** — Brand action color. Used for primary CTAs, active states, key interactive elements. One color, used consistently.
- **Neutral** — The backbone. Text, backgrounds, borders, dividers. Full scale from near-white to near-black (50 through 950).
- **Success** — Confirmation, completion, positive values (green family)
- **Warning** — Caution, approaching limits, attention needed (amber/yellow family)
- **Error** — Failure, destructive actions, validation errors (red family)
- **Info** — Neutral information, tips, links (blue family)

**Application rules:**
- Background hierarchy: Use neutral-50 -> neutral-100 -> neutral-200 to create depth layers without borders. Dark mode: neutral-950 -> neutral-900 -> neutral-800.
- Text on backgrounds: Minimum 4.5:1 contrast ratio (WCAG AA). For large text (18px+), 3:1 is acceptable.
- Interactive vs static: Interactive elements must be visually distinct from static text.
- Destructive actions: Red for delete/remove, but never as the primary action color on a page.
- State communication: Don't rely on color alone. Add icons, text, or shape changes. 8% of men have color vision deficiency.

**Dark Mode:**
- Don't invert colors. Reduce brightness, increase contrast on text, desaturate backgrounds slightly.
- Pure black (#000) is harsh. Use near-black (zinc-950, #09090b) for base, lighter darks for elevation.
- Maintain semantic meaning across modes.

## Component States

Every component that displays data must handle all these states. This is a requirement.

### The Five Data States

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

## Components & Patterns

Think in Atomic Design: Atoms -> Molecules -> Organisms. Every component should work standalone and compose well with others.

### Buttons
Every screen has a button hierarchy:
- **Primary** — One per visible area. Filled, high contrast. The thing you want the user to do.
- **Secondary** — Supporting actions. Outlined or ghost style.
- **Tertiary/Ghost** — Subtle actions. Text-only or very light background. "Cancel", "Skip", "Back".
- **Destructive** — Red-tinted, used for irreversible actions. Never the default focus.

Sizes: 3 sizes max (sm, md, lg). Default to md. Mobile CTAs should be full-width or near-full-width.

### Forms (Luke Wroblewski's Principles)
- Single column layout always
- Labels above inputs (not beside, not floating inside)
- Inline validation on blur — show success too, not just errors
- Group related fields visually (fieldset with legend)
- Mark optional fields, not required ones
- Error messages directly below the field, specific guidance ("Must include @") not generic ("Invalid")

### Tables & Data
- Right-align numbers, left-align text
- Sticky headers for tables exceeding viewport height
- Sort indicators on sortable columns (subtle up/down icon)
- Row hover state: subtle background change (`hover:bg-muted/50`)
- Mobile: Transform to card list — each row becomes a card with key-value pairs

```tsx
<div className="hidden md:block">
  <Table>...</Table>
</div>
<div className="md:hidden space-y-3">
  {data.map(row => <OrderCard key={row.id} {...row} />)}
</div>
```

### Cards
- Consistent internal padding (from your spacing scale)
- Clear content hierarchy: image/visual -> title -> metadata -> action
- Equal height in grids (CSS grid `auto-rows` or flexbox `items-stretch`)
- If clickable: hover state, cursor pointer, entire card is the touch target

### Navigation
- Maximum 7+-2 top-level items (Miller's Law). More means restructuring, not smaller text.
- Current location always visible. Active state on navigation items.
- Mobile: Bottom navigation for 3-5 primary destinations (thumb zone). Hamburger menu for secondary navigation.
- Breadcrumbs for deep hierarchies (3+ levels).

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

## Animation & Transitions

Animation communicates change. It's functional, not decorative.

### Timing

| Category | Duration | Easing | Use |
|----------|----------|--------|-----|
| Micro | 100-150ms | ease-out | Hover, toggle, button press |
| Content | 200-300ms | ease-out | Modals, drawers, dropdowns |
| Complex | 300-500ms | ease-in-out | Page transitions, onboarding |

Easing: ease-out for entering elements (decelerating into view), ease-in for exiting (accelerating away), ease-in-out for moving between positions.

### What to Animate
- State changes (appear, disappear, toggle)
- Spatial transitions (slide-in from source direction)
- Skeleton -> content (crossfade, not pop)
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
- **Navigation:** Bottom tabs (mobile) -> Sidebar (desktop)
- **Lists:** Single column cards (mobile) -> Table with columns (desktop)
- **Forms:** Full-width stacked (mobile) -> Constrained width centered (desktop, max-w-lg)
- **Dashboards:** Stacked cards (mobile) -> Grid with sidebar (desktop)
- **Tables:** Card-list on mobile (each row becomes a card), table on desktop

### Touch Targets
Minimum 44x44px for all tappable elements on mobile. A 20px icon button needs `p-3` around it to reach the 44px target. This is a hard requirement (Apple HIG, WCAG 2.5.5).

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

- Always check if a component exists before building custom
- Use semantic color tokens (`bg-background`, `text-foreground`, `bg-muted`) — never `bg-white`/`bg-black`
- Form validation: Zod + react-hook-form + `<Form>` components
- Dark mode: `next-themes` with `<ThemeProvider attribute="class">`

## Verify

- [ ] All 5 data states implemented (empty, loading, error, partial, complete)
- [ ] All interactive states work (hover, focus, active, disabled)
- [ ] All values from token system — no hardcoded colors/spacing
- [ ] Responsive at 375px, 768px, 1280px
- [ ] Touch targets >= 44px on mobile
- [ ] Keyboard navigation works for all interactive elements
- [ ] Focus indicators visible
- [ ] `prefers-reduced-motion` respected
- [ ] No TypeScript errors, no console warnings
- [ ] Data typography: tabular-nums for numbers, right-aligned in tables
- [ ] Skeleton loading, not spinners, for content areas
- [ ] Consistent with adjacent components (same spacing rhythm)

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
- Everything centered — lazy layout. Use intentional alignment based on content.
