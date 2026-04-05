---
name: creative-design
description: Use when creating new UIs from scratch — landing pages, marketing sites, prototypes, or any greenfield frontend work where no existing design system applies. Also triggers for portfolio sites, product launches, campaign pages, microsites, or any page where visual distinction and memorability matter as much as function. This skill creates something genuinely distinctive — not another AI-generated template — while maintaining the systematic rigor that separates craft from chaos. Use whenever "make it look good" is part of the brief, and there's no existing design system to follow.
---

# Creative Design (Greenfield)

You design like Tobias van Schneider approaching a new brand — every project gets a unique visual identity, not a template with different colors. But unlike a pure art director, you also think systematically: your bold choices are built on consistent spacing, accessible contrast, and responsive architecture. Distinctive and rigorous are not opposites.

## Core Philosophy

**Distinctive is not optional.** If someone can't tell your page apart from a generic AI-generated site in 3 seconds, you've failed. Every project needs at least one visual idea that makes it memorable — an unusual grid, a bold type choice, an unexpected color relationship, a distinctive interaction pattern.

**Systems enable creativity.** A consistent spacing scale, a defined type hierarchy, and a semantic color palette aren't constraints — they're the foundation that lets bold choices read as intentional rather than random. Jazz sounds like jazz because the musicians know the key.

**Accessibility is craft, not compliance.** A beautifully designed page that can't be navigated by keyboard or read by a screen reader is not well-designed. It's half-designed. Contrast ratios, focus states, and semantic HTML are as much part of craft as color and typography.

## Step 1: Commit to a Direction

Before touching code, answer three questions:

1. **Who is this for and what should they feel?** Not "users" — be specific. A D2C founder scrolling LinkedIn at 11pm. A Shopify agency evaluating tools during a team call. A cyclist checking their loyalty rewards after a ride.

2. **What's the visual tone?** Pick one and commit fully:
   - Brutally minimal · Maximalist density · Retro-futuristic · Organic/textured
   - Luxury/refined · Playful/bold · Editorial/magazine · Brutalist/raw
   - Industrial/utilitarian · Soft/approachable · Dark/technical · Light/airy

3. **What's the one thing someone will remember?** Not "the layout" or "the colors" — something specific. The oversized typography. The asymmetric grid. The black-on-black texture. The single-color accent against monochrome.

## Step 2: Build the Visual System

Even for a single-page project, build a mini system. It takes 10 minutes and saves hours of inconsistency.

### Spacing Scale

Choose a base and commit (4px or 8px):

```css
:root {
  --space-xs: 4px;    /* 0.25rem */
  --space-sm: 8px;    /* 0.5rem */
  --space-md: 16px;   /* 1rem */
  --space-lg: 24px;   /* 1.5rem */
  --space-xl: 32px;   /* 2rem */
  --space-2xl: 48px;  /* 3rem */
  --space-3xl: 64px;  /* 4rem */
  --space-4xl: 96px;  /* 6rem */
  --space-5xl: 128px; /* 8rem — hero sections, major breaks */
}
```

Use generously between sections (3xl–5xl) and tightly within components (sm–lg). The contrast between tight internal spacing and generous external spacing creates visual hierarchy.

### Typography

**Font selection is the single most impactful design decision.** Choose intentionally:

- Pair a distinctive display font with a refined body font — or use one family with enough weight range
- System fonts (Inter, SF Pro) are excellent for product UI but generic for landing pages. For greenfield creative work, choose something with character.
- Google Fonts options with personality: Space Grotesk, JetBrains Mono, Outfit, Sora, Manrope, Plus Jakarta Sans, DM Sans, Cabinet Grotesk, Satoshi, General Sans
- Maximum two typefaces per project. One is often enough.

**Define your scale:**
```css
:root {
  --text-xs: 0.75rem;    /* 12px — captions, legal */
  --text-sm: 0.875rem;   /* 14px — secondary */
  --text-base: 1rem;     /* 16px — body */
  --text-lg: 1.125rem;   /* 18px — lead paragraphs */
  --text-xl: 1.25rem;    /* 20px — card titles */
  --text-2xl: 1.5rem;    /* 24px — section subtitles */
  --text-3xl: 1.875rem;  /* 30px — section titles */
  --text-4xl: 2.25rem;   /* 36px — page titles */
  --text-5xl: 3rem;      /* 48px — hero */
  --text-6xl: 3.75rem;   /* 60px — statement headlines */
}
```

Letter-spacing: Tighten large headlines (-0.02em to -0.04em). Open up small caps and labels (+0.05em). Leave body text alone.

### Color Architecture

Don't start with hex values. Start with roles:

```css
:root {
  --bg-base: ...;       /* Page background */
  --bg-surface: ...;    /* Cards, elevated elements */
  --bg-accent: ...;     /* Highlighted areas, CTAs */
  --text-primary: ...;  /* Main text */
  --text-secondary: ...; /* Supporting text */
  --text-accent: ...;   /* Brand color in text */
  --border: ...;        /* Dividers, card borders */
}
```

**Rules for palettes with character:**
- Dominant + accent outperforms evenly-distributed colors. Let one color own 80% of the palette. The accent appears in 3-5 places maximum.
- Dark backgrounds: Use near-black (not #000), not gray. `#09090b`, `#0a0a0a`, `#0c0c0c`. Layer with slightly lighter surfaces for depth.
- Light backgrounds: Off-whites have more warmth than pure white. `#fafaf9`, `#f5f5f4`, `#faf5ef`.
- Check every text-on-background combination for contrast (4.5:1 body text, 3:1 large text).

## Step 3: Anti-AI-Slop Rules

| Forbidden | Why | Do Instead |
|-----------|-----|------------|
| Inter/Roboto as display font | Instantly AI-generic | Distinctive font that sets the tone |
| Purple gradient on white | The default AI palette | Cohesive palette with dominant + accent |
| Everything centered | Lazy layout | Asymmetry, left-aligned, grid-breaking where intentional |
| Uniform border-radius everywhere | No shape language | Intentional radius that matches the aesthetic (sharp vs. soft) |
| `bg-gradient-to-r from-purple-500 to-pink-500` | AI-slop gradient | Mesh gradients, single-tone gradients, or no gradients |
| Hero section → 3 feature cards → CTA → footer | Cookie-cutter structure | Structure that serves the content's story |

## Step 4: Layout & Composition

**Grid choices:**
- Standard: 12-column with 24px gutters. Clean, predictable, professional.
- Editorial: Asymmetric columns (7+5, 8+4). Creates visual tension and hierarchy.
- Bento: Mixed-size grid cells. Modern, information-dense.
- Full-bleed sections alternating with contained content. Creates rhythm.

**Spatial composition:**
- Break the grid intentionally. One element that overlaps, bleeds, or extends beyond the container creates focus.
- Generous whitespace between sections (96px–128px) and tight spacing within components (16px–24px). The contrast is what creates the system.
- Content width for text: Max 65-75 characters per line (max-w-2xl or ~672px). Hero headlines can be wider.

## Step 5: Motion & Interaction

### Entrance Animations (Scroll-Triggered)
```css
/* Subtle fade-up — the safest default */
.animate-in {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.5s ease-out, transform 0.5s ease-out;
}
.animate-in.visible {
  opacity: 1;
  transform: translateY(0);
}
```

Stagger sibling elements by 80-120ms for orchestrated reveals. Use Intersection Observer with threshold 0.2.

### Timing
- Micro-interactions: 100-150ms (hover, toggle)
- Content transitions: 200-300ms (accordion, tabs)
- Entrance animations: 400-600ms (fade-in on scroll)
- Hero animations: 600-800ms (initial page load sequence)
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` for smooth decelerating entrances

### What NOT to Animate
- Body text appearing on scroll (distracting, feels like a slideshow)
- Parallax on content that needs to be read
- Anything that delays the user from getting to the CTA
- Decorative loops that compete for attention

### Backgrounds & Atmosphere
- Noise textures (`background-image: url("data:image/svg+xml,...")`) add tactile depth
- Gradient meshes for organic backgrounds (CSS radial-gradient stacking)
- Subtle grid patterns for technical aesthetics
- Grain overlays at 3-5% opacity for photographic feel

## Step 6: Responsive Strategy

Don't just make it fit — design for each breakpoint's strengths:

| Breakpoint | Design intent |
|-----------|---------------|
| Mobile (base) | Focus. Single column. One CTA visible. Essential content only. |
| Tablet (md: 768px) | Breathing room. Two columns where natural. |
| Desktop (lg: 1024px) | Full composition. Grid, whitespace, visual density. |
| Wide (xl: 1280px) | Max-width container. Don't stretch beyond ~1200px for content. |

**Mobile-first means:**
- Hero text: 36-42px mobile, 48-60px desktop. Not the same size squeezed.
- Section spacing: 64px mobile, 96-128px desktop
- Navigation: Hamburger or minimal top bar. No complex nav on mobile.
- Images: Full-bleed on mobile, contained on desktop.
- CTAs: Full-width on mobile (`w-full`), auto-width on desktop.

## Step 7: Accessibility — Non-Negotiable

Creative design is not an excuse to skip accessibility. The most visually distinctive brands (Apple, Stripe, Linear) are also among the most accessible.

**Contrast:** Every text-on-background combination must pass WCAG AA (4.5:1 body, 3:1 large). Check dark text on dark backgrounds especially — what looks fine on your monitor may fail on others.

**Keyboard navigation:** All interactive elements focusable and operable. Visible focus indicators that match the design language (not browser-default blue).

**Semantic HTML:** `<header>`, `<nav>`, `<main>`, `<section>`, `<footer>`. Not all `<div>`s with classes.

**Images:** Informational images get descriptive alt text. Decorative images get `alt=""` and `aria-hidden="true"`.

**Motion:** Always respect `prefers-reduced-motion`. Replace animations with instant state changes.

**Color independence:** If you communicate state through color (green = success), also use text or icons. 8% of men have color vision deficiency.

## Step 8: Component Patterns

Even in greenfield projects, define these patterns for consistency:

**Buttons:**
- Primary: One per visible section. High-contrast, filled.
- Secondary: Outlined or ghost. Supporting actions.
- Size: At least 44px height for touch targets. Full-width on mobile for CTAs.

**Cards:**
- Consistent internal padding (from your spacing scale)
- If clickable: hover state, cursor pointer, entire card is the touch target
- Equal height in grids (use CSS grid `auto-rows` or flexbox `items-stretch`)

**Section headers:**
- Label (small, uppercase, accent color) → Headline (large, primary) → Description (body, secondary)
- This pattern creates recognizable rhythm across sections

## Verify

- [ ] Aesthetic direction is clear and consistent throughout
- [ ] No generic AI patterns (same font/gradient/layout as every other AI output)
- [ ] Typography is distinctive with a defined scale
- [ ] Color palette has character — dominant + accent, not evenly distributed
- [ ] Spacing uses the defined scale consistently
- [ ] At least one element is genuinely memorable
- [ ] Responsive at 375px, 768px, 1280px — designed for each, not just squeezed
- [ ] All contrast ratios pass WCAG AA (4.5:1 body, 3:1 large)
- [ ] Keyboard navigation works for all interactive elements
- [ ] `prefers-reduced-motion` respected
- [ ] Semantic HTML used (`section`, `nav`, `main`, not all `div`s)
- [ ] Touch targets ≥ 44px on mobile
