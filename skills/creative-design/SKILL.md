---
name: creative-design
description: Use when creating new UIs from scratch — landing pages, marketing sites, prototypes, or any greenfield frontend work where no existing design system applies. Also triggers for portfolio sites, product launches, campaign pages, microsites, or any page where visual distinction and memorability matter as much as function. This skill creates something genuinely distinctive — not another AI-generated template. For spacing, typography defaults, responsive strategy, and accessibility, defer to `frontend-design`. This skill adds the creative layer on top.
triggers:
  - landing-page
  - marketing
  - greenfield
  - visual
  - branding
  - creative
---

⚡ Creative Director joined

# Creative Design (Greenfield)

You design like Tobias van Schneider approaching a new brand — every project gets a unique visual identity, not a template with different colors. But unlike a pure art director, you also think systematically: your bold choices are built on consistent spacing, accessible contrast, and responsive architecture.

> **Foundation:** This skill builds on `frontend-design` for spacing scale, typography defaults, responsive breakpoints, component states, and accessibility. Don't duplicate those — apply them. This skill adds visual identity, aesthetic direction, and Anti-AI-Slop standards.

## Step 1: Commit to a Direction

Before touching code, answer three questions:

1. **Who is this for and what should they feel?** Not "users" — be specific. A D2C founder scrolling LinkedIn at 11pm. A Shopify agency evaluating tools during a team call. A cyclist checking their loyalty rewards after a ride.

2. **What's the visual tone?** Pick one and commit fully:
   - Brutally minimal | Maximalist density | Retro-futuristic | Organic/textured
   - Luxury/refined | Playful/bold | Editorial/magazine | Brutalist/raw
   - Industrial/utilitarian | Soft/approachable | Dark/technical | Light/airy

3. **What's the one thing someone will remember?** Not "the layout" or "the colors" — something specific. The oversized typography. The asymmetric grid. The black-on-black texture. The single-color accent against monochrome.

## Step 2: Typography with Character

For greenfield creative work, system fonts (Inter, Roboto) are too generic. Choose intentionally:

- Google Fonts with personality: Space Grotesk, JetBrains Mono, Outfit, Sora, Manrope, Plus Jakarta Sans, DM Sans, Cabinet Grotesk, Satoshi, General Sans
- Maximum two typefaces per project. One is often enough.
- Pair a distinctive display font with a refined body font — or use one family with enough weight range

Use the type scale from `frontend-design` for sizing, but apply creative letter-spacing: tighten display headlines aggressively (-0.03em to -0.05em) for impact.

## Step 3: Color with Character

**Rules for palettes with personality:**
- Dominant + accent outperforms evenly-distributed colors. Let one color own 80% of the palette. The accent appears in 3-5 places maximum.
- Dark backgrounds: Use near-black (not #000). `#09090b`, `#0a0a0a`, `#0c0c0c`. Layer with slightly lighter surfaces for depth.
- Light backgrounds: Off-whites have more warmth than pure white. `#fafaf9`, `#f5f5f4`, `#faf5ef`.
- Check every text-on-background combination for contrast (4.5:1 body text, 3:1 large text).

## Step 4: Anti-AI-Slop Rules

| Forbidden | Why | Do Instead |
|-----------|-----|------------|
| Inter/Roboto as display font | Instantly AI-generic | Distinctive font that sets the tone |
| Purple gradient on white | The default AI palette | Cohesive palette with dominant + accent |
| Everything centered | Lazy layout | Asymmetry, left-aligned, grid-breaking where intentional |
| Uniform border-radius everywhere | No shape language | Intentional radius that matches the aesthetic (sharp vs. soft) |
| `bg-gradient-to-r from-purple-500 to-pink-500` | AI-slop gradient | Mesh gradients, single-tone gradients, or no gradients |
| Hero section -> 3 feature cards -> CTA -> footer | Cookie-cutter structure | Structure that serves the content's story |

## Step 5: Layout & Composition

**Grid choices:**
- Standard: 12-column with 24px gutters. Clean, predictable, professional.
- Editorial: Asymmetric columns (7+5, 8+4). Creates visual tension and hierarchy.
- Bento: Mixed-size grid cells. Modern, information-dense.
- Full-bleed sections alternating with contained content. Creates rhythm.

**Spatial composition:**
- Break the grid intentionally. One element that overlaps, bleeds, or extends beyond the container creates focus.
- Generous whitespace between sections (96px-128px) and tight spacing within components (16px-24px). The contrast is what creates the system.
- Content width for text: Max 65-75 characters per line.

## Step 6: Backgrounds & Atmosphere

- Noise textures (`background-image: url("data:image/svg+xml,...")`) add tactile depth
- Gradient meshes for organic backgrounds (CSS radial-gradient stacking)
- Subtle grid patterns for technical aesthetics
- Grain overlays at 3-5% opacity for photographic feel

## Step 7: Motion

### Entrance Animations (Scroll-Triggered)
```css
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

Hero animations: 600-800ms on initial page load. Use `cubic-bezier(0.16, 1, 0.3, 1)` for smooth decelerating entrances.

For all other animation timing and reduced-motion handling, apply `frontend-design` defaults.

## Step 8: Responsive Strategy

Don't just make it fit — design for each breakpoint's strengths:

| Breakpoint | Design intent |
|-----------|---------------|
| Mobile (base) | Focus. Single column. One CTA visible. Essential content only. |
| Tablet (md: 768px) | Breathing room. Two columns where natural. |
| Desktop (lg: 1024px) | Full composition. Grid, whitespace, visual density. |
| Wide (xl: 1280px) | Max-width container. Don't stretch beyond ~1200px for content. |

**Mobile-specific for creative work:**
- Hero text: 36-42px mobile, 48-60px desktop. Not the same size squeezed.
- Section spacing: 64px mobile, 96-128px desktop
- Images: Full-bleed on mobile, contained on desktop.
- CTAs: Full-width on mobile (`w-full`), auto-width on desktop.

## Verify

- [ ] Aesthetic direction is clear and consistent throughout
- [ ] No generic AI patterns (same font/gradient/layout as every other AI output)
- [ ] Typography is distinctive with a defined scale
- [ ] Color palette has character — dominant + accent, not evenly distributed
- [ ] At least one element is genuinely memorable
- [ ] All `frontend-design` checks pass (states, accessibility, responsive, tokens)
