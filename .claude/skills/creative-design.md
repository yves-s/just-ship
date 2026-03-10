---
name: creative-design
description: Use when creating new UIs from scratch — landing pages, marketing sites, prototypes, or any greenfield frontend work where no existing design system applies. Enforces bold, distinctive aesthetics and prevents generic AI output.
---

# Creative Design (Greenfield)

## Overview

This skill is for building something new from zero — where no existing design system constrains you. Your job is to create something visually distinctive and memorable, not generic.

**When to use:** Landingpages, Marketing-Seiten, Prototypen, neue Produkte ohne bestehendes Design System.
**When NOT to use:** Bestehende Produkte mit Design System — dort gelten `design` und `frontend-design` Skills.

**Announce at start:** "Greenfield design — choosing a bold aesthetic direction before writing code."

## Step 1: Design Thinking

Before coding, commit to a clear aesthetic direction:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick a direction and commit fully — brutally minimal, maximalist, retro-futuristic, organic/natural, luxury/refined, playful, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian. These are starting points — design something true to the chosen direction.
- **Differentiation**: What makes this unforgettable? What's the one thing someone will remember?

Bold maximalism and refined minimalism both work. The key is intentionality, not intensity.

## Step 2: Anti-AI-Slop Rules

NEVER produce generic AI aesthetics:

| Forbidden | Do Instead |
|-----------|------------|
| Inter, Roboto, Arial, system fonts | Distinctive, characterful font choices |
| Purple gradients on white backgrounds | Cohesive palette with dominant colors + sharp accents |
| Centered-everything layouts | Asymmetry, overlap, diagonal flow, grid-breaking |
| Uniform rounded corners everywhere | Intentional shape language matching the aesthetic |
| Cookie-cutter component patterns | Context-specific design decisions |

No two designs should look the same. Vary between light/dark themes, different fonts, different aesthetics. Never converge on common AI choices.

## Step 3: Implementation Guidelines

### Typography
- Pair a distinctive display font with a refined body font
- Avoid generic fonts — choose fonts that are beautiful, unique, and interesting
- Font choice sets the entire tone — invest time here

### Color & Theme
- Use CSS variables for consistency
- Dominant colors with sharp accents outperform timid, evenly-distributed palettes
- Commit to a cohesive aesthetic — every color serves the overall direction

### Motion & Interaction
- Prioritize CSS-only solutions for HTML
- One well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions
- Use scroll-triggering and hover states that surprise
- For React: use Motion library when available

### Spatial Composition
- Unexpected layouts. Asymmetry. Overlap. Diagonal flow.
- Grid-breaking elements for emphasis
- Generous negative space OR controlled density — both work when intentional

### Backgrounds & Visual Details
- Create atmosphere and depth — don't default to solid colors
- Gradient meshes, noise textures, geometric patterns, layered transparencies
- Dramatic shadows, decorative borders, grain overlays
- Custom cursors where they enhance the experience

## Step 4: Match Complexity to Vision

- **Maximalist designs** need elaborate code with extensive animations and effects
- **Minimalist designs** need restraint, precision, and careful attention to spacing, typography, and subtle details
- Elegance comes from executing the vision well, not from adding more

## Step 5: Verify

- [ ] Aesthetic direction is clear and consistent throughout
- [ ] No generic AI patterns (Inter font, purple gradients, centered layouts)
- [ ] Typography is distinctive and intentional
- [ ] Color palette has character — not safe/bland
- [ ] At least one element is genuinely memorable
- [ ] Responsive layout works (375px, 768px, 1280px)
- [ ] Production-grade and functional — not just pretty
