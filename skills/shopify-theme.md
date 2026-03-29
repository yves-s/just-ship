---
name: shopify-theme
description: Use when working with Shopify theme file structure, JSON templates, assets, settings, localization, or theme JavaScript. Covers OS 2.0 architecture, Web Components pattern, Ajax Cart API, Section Rendering API, CSS custom properties, and asset pipeline. Load this skill whenever a ticket involves theme structure, template wiring, JavaScript behavior, asset loading, or i18n in a Shopify theme.
---

# Shopify Theme Architecture

**Announce at start:** "Reading existing theme structure, settings_schema.json, and section patterns before making changes."

Before making changes, understand the theme's foundation:
1. Check if the theme is Dawn-based or a custom/premium theme — conventions differ
2. Read `config/settings_schema.json` for existing theme settings
3. Read 2-3 existing sections to understand the CSS and JS patterns in use

## File Structure

```
assets/        → CSS, JS, images, fonts (no bundler — raw files)
config/        → settings_schema.json (definitions), settings_data.json (merchant data)
layout/        → theme.liquid (shell), password.liquid
locales/       → Translation files (de.json, de.default.schema.json)
sections/      → Standalone UI blocks with schema
snippets/      → Reusable fragments without schema
templates/     → JSON files that wire sections together
blocks/        → Theme blocks (nested within sections)
```

## JSON Templates (OS 2.0)

Templates are JSON files that define which sections appear and in what order. The merchant rearranges sections in the theme editor — the JSON is the source of truth.

```json
{
  "sections": {
    "hero": {
      "type": "hero-banner",
      "settings": { "heading": "Welcome" }
    },
    "featured": {
      "type": "featured-collection",
      "settings": { "collection": "frontpage" }
    }
  },
  "order": ["hero", "featured"]
}
```

Never use `.liquid` template files — they bypass the theme editor and cannot be customized by merchants.

## Layout

`layout/theme.liquid` is the HTML shell wrapping every page:

```liquid
<!doctype html>
<html>
<head>
  {{ content_for_header }}  {# Required — Shopify scripts, analytics, meta #}
  {{ 'base.css' | asset_url | stylesheet_tag }}
</head>
<body>
  {% sections 'header-group' %}
  {{ content_for_layout }}  {# Page content renders here #}
  {% sections 'footer-group' %}
</body>
</html>
```

- `{{ content_for_header }}` is mandatory — removing it breaks checkout, analytics, and apps
- Section groups (`header-group`, `footer-group`) allow merchants to customize header/footer sections

## Settings

### settings_schema.json — Theme-level definitions

Defines what appears in the theme editor under "Theme settings":

```json
[
  {
    "name": "theme_info",
    "theme_name": "My Theme",
    "theme_version": "1.0.0"
  },
  {
    "name": "Colors",
    "settings": [
      { "type": "color", "id": "color_primary", "label": "Primary", "default": "#000000" },
      { "type": "color", "id": "color_background", "label": "Background", "default": "#ffffff" }
    ]
  }
]
```

### settings_data.json — NEVER manually edit

Contains the merchant's actual configuration values. Editing this file directly will overwrite merchant customizations on deploy.

### CSS Custom Properties Pattern

Bridge settings to CSS — define once, use everywhere:

```liquid
{%- comment -%} In snippets/css-variables.liquid {%- endcomment -%}
:root {
  --color-primary: {{ settings.color_primary }};
  --color-background: {{ settings.color_background }};
  --font-heading: {{ settings.heading_font.family }}, {{ settings.heading_font.fallback_families }};
  --spacing-base: {{ settings.spacing_base }}px;
}
```

Sections reference `var(--color-primary)` �� never hardcode colors or read settings directly in section CSS.

## Asset Pipeline

No bundler — raw CSS and JS files served via Shopify CDN.

```liquid
{{ 'base.css' | asset_url | stylesheet_tag }}
{{ 'component-card.css' | asset_url | stylesheet_tag }}
{{ 'product-form.js' | asset_url | script_tag: defer: true }}
```

**CSS architecture:**
- `base.css` — reset, typography, global utilities
- Component-specific CSS files loaded per section (e.g., `component-hero.css`)
- CSS custom properties from `settings_schema.json` via the `:root` pattern above

**JS loading:**
- Always use `defer` — never block rendering
- Critical inline JS only for above-the-fold interactions

## JS Pattern: Web Components

Modern Shopify themes use **Custom Elements** — not jQuery, not ES modules, not loose global functions. This is the standard pattern:

```javascript
class CollapsibleContent extends HTMLElement {
  constructor() {
    super();
    this.trigger = this.querySelector('[data-trigger]');
    this.content = this.querySelector('[data-content]');
  }

  connectedCallback() {
    this.trigger?.addEventListener('click', () => this.toggle());
  }

  toggle() {
    const expanded = this.content.style.display !== 'none';
    this.content.style.display = expanded ? 'none' : '';
    this.trigger.setAttribute('aria-expanded', !expanded);
  }
}

if (!customElements.get('collapsible-content')) {
  customElements.define('collapsible-content', CollapsibleContent);
}
```

Used in Liquid as:

```liquid
<collapsible-content>
  <button data-trigger aria-expanded="false">Toggle</button>
  <div data-content style="display: none;">Content here</div>
</collapsible-content>
```

**Why Web Components:** They are self-contained, work without build tools, survive section re-rendering in the theme editor, and are the pattern used by Dawn, Horizon, and most premium themes.

## JS Pattern: Shopify Section Events

Sections are dynamically loaded/unloaded in the theme editor. Every section with JS behavior **must** handle these events or it will break in the editor:

```javascript
// Required for theme editor compatibility
document.addEventListener('shopify:section:load', (event) => {
  // Re-initialize components inside the loaded section
  const section = event.target;
  section.querySelectorAll('collapsible-content').forEach(el => {
    // Web Components auto-initialize via connectedCallback — no manual init needed
    // But non-WC code needs re-initialization here
  });
});

document.addEventListener('shopify:section:unload', (event) => {
  // Clean up event listeners, observers, intervals
});

document.addEventListener('shopify:section:select', (event) => {
  // Section was clicked in the editor sidebar — expand/show it
});

document.addEventListener('shopify:block:select', (event) => {
  // A specific block was selected — scroll to it, highlight it
});
```

Web Components handle `load`/`unload` automatically via `connectedCallback`/`disconnectedCallback`. For non-WC code, listen to these events explicitly.

## JS Pattern: Ajax Cart API

Client-side cart operations without page reload:

```javascript
// Get cart state
const cart = await fetch('/cart.js').then(r => r.json());

// Add item
await fetch('/cart/add.js', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: variantId, quantity: 1 })
});

// Update quantity (0 = remove)
await fetch('/cart/change.js', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: variantId, quantity: newQty })
});
```

- **422 response** = item out of stock or quantity exceeds inventory
- Always update the cart UI after mutations — use the Section Rendering API below

For the Liquid `cart` object → see `shopify-liquid` skill.

## JS Pattern: Section Rendering API

Dynamically re-render a section without full page reload — the modern pattern for cart drawers, variant switches, and quick-add:

```javascript
async function refreshSection(sectionId) {
  const response = await fetch(`${window.location.pathname}?sections=${sectionId}`);
  const data = await response.json();
  const html = new DOMParser().parseFromString(data[sectionId], 'text/html');
  const newContent = html.querySelector(`#shopify-section-${sectionId}`);
  document.querySelector(`#shopify-section-${sectionId}`).innerHTML = newContent.innerHTML;
}

// After cart add → refresh cart drawer
await fetch('/cart/add.js', { method: 'POST', ... });
await refreshSection('cart-drawer');
```

Use this instead of full page reloads for any dynamic UI update.

## Localization

### Content translations — `locales/de.json`

```json
{
  "general": {
    "cart": {
      "title": "Warenkorb",
      "empty": "Dein Warenkorb ist leer"
    }
  }
}
```

### Editor labels — `locales/de.default.schema.json`

```json
{
  "sections": {
    "hero": {
      "name": "Hero Banner",
      "settings": {
        "heading": { "label": "Überschrift" }
      }
    }
  }
}
```

### Usage

```liquid
{{ 'general.cart.title' | t }}
```

In schema, reference translation keys with `t:` prefix:

```json
{ "type": "text", "id": "heading", "label": "t:sections.hero.settings.heading.label" }
```

## Anti-Patterns

- Manually editing `settings_data.json` — overwrites merchant customizations
- Inline styles instead of CSS custom properties — breaks theming
- `.liquid` templates instead of `.json` — bypasses the theme editor
- jQuery or script tags without `defer` — blocks rendering
- Loose global JS functions instead of Web Components — breaks in theme editor
- Full page reload instead of Section Rendering API for dynamic updates
- Missing section event handlers — components break when edited in the theme editor
- Hardcoded text strings — use `| t` localization filter

## Verify

- [ ] Sections render correctly in the Shopify theme editor
- [ ] Section events handled (load/unload work in editor)
- [ ] Localization keys present in all locale files
- [ ] No JS errors in browser console
- [ ] Responsive: Mobile (375px), Tablet (768px), Desktop (1280px)
- [ ] CSS uses custom properties, not hardcoded values
- [ ] JS uses `defer`, no render-blocking scripts
