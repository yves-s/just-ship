---
name: shopify-liquid
description: Use when writing, modifying, or debugging Shopify Liquid code — sections, snippets, schema, template logic. Covers Liquid syntax, section schema patterns, template hierarchy, Shopify-specific filters, and common gotchas. Load this skill whenever a ticket involves Liquid templates, section building, snippet creation, or Liquid debugging in a Shopify theme.
---

# Shopify Liquid

**Announce at start:** "Reading existing theme sections and Liquid patterns before writing."

Before writing any Liquid code, read 2-3 existing sections in `sections/` to understand the theme's conventions: naming, schema style, CSS approach, whitespace control usage.

## Syntax Essentials

```liquid
{{ product.title }}              {# Output #}
{% if product.available %}       {# Logic tag #}
{%- assign x = 'hello' -%}      {# Whitespace-trimmed tag #}
```

- Operators evaluate **right-to-left** — parentheses are not supported
- Variables are **immutable** after `assign` — reassign creates a new value
- `{% capture %}` for building strings across multiple lines

## Template Hierarchy

```
layout/theme.liquid → templates/*.json → sections/*.liquid → snippets/*.liquid
```

**Section vs. Snippet — when to use which:**

| | Section | Snippet |
|---|---|---|
| Has `{% schema %}` | Yes — merchant-configurable | No |
| Standalone | Yes — appears in theme editor | No — must be rendered |
| Reusable across sections | No | Yes |
| Use for | Page-level blocks (hero, featured products) | Shared fragments (product card, icon, price) |

## Section Schema

### Minimal — no blocks

```liquid
<section class="text-banner">
  <h2>{{ section.settings.heading }}</h2>
  <div>{{ section.settings.text }}</div>
  {%- if section.settings.button_url != blank -%}
    <a href="{{ section.settings.button_url }}">{{ section.settings.button_label }}</a>
  {%- endif -%}
</section>

{% schema %}
{
  "name": "Text Banner",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Welcome" },
    { "type": "richtext", "id": "text", "label": "Text" },
    { "type": "url", "id": "button_url", "label": "Button URL" },
    { "type": "text", "id": "button_label", "label": "Button Label", "default": "Learn more" }
  ],
  "presets": [{ "name": "Text Banner" }]
}
{% endschema %}
```

### Complex — with blocks and presets

```liquid
<section class="featured-content">
  <h2>{{ section.settings.heading }}</h2>
  <div class="grid">
    {%- for block in section.blocks -%}
      <div {{ block.shopify_attributes }}>
        {%- case block.type -%}
          {%- when 'product' -%}
            {% render 'product-card', product: block.settings.product %}
          {%- when 'text' -%}
            <div class="rich-text">{{ block.settings.content }}</div>
          {%- when 'image' -%}
            <img src="{{ block.settings.image | image_url: width: 800 }}" alt="{{ block.settings.alt }}" loading="lazy">
        {%- endcase -%}
      </div>
    {%- endfor -%}
  </div>
</section>

{% schema %}
{
  "name": "Featured Content",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading" }
  ],
  "blocks": [
    {
      "type": "product",
      "name": "Product",
      "settings": [
        { "type": "product", "id": "product", "label": "Product" }
      ]
    },
    {
      "type": "text",
      "name": "Text",
      "settings": [
        { "type": "richtext", "id": "content", "label": "Content" }
      ]
    },
    {
      "type": "image",
      "name": "Image",
      "settings": [
        { "type": "image_picker", "id": "image", "label": "Image" },
        { "type": "text", "id": "alt", "label": "Alt text" }
      ]
    }
  ],
  "presets": [{
    "name": "Featured Content",
    "blocks": [
      { "type": "product" },
      { "type": "text" }
    ]
  }]
}
{% endschema %}
```

### Schema Constraints

- `{% schema %}` must be the **last tag** in the section file
- Only **one schema per section**
- Setting IDs must be **unique within the section**
- Maximum **16 block types** per section
- Always include `{{ block.shopify_attributes }}` on block wrappers — required for theme editor

### Setting Types — non-obvious behavior

| Type | Returns | Access note |
|------|---------|-------------|
| `richtext` | HTML string | Render directly, already wrapped in `<p>` tags |
| `image_picker` | Image object | Needs `\| image_url: width: N` to get URL |
| `product` / `collection` / `page` | Resource object | Full object with all properties |
| `font_picker` | Font object | Access via `.family`, `.style`, `.weight` |

Full list: text, textarea, richtext, range, checkbox, select, color, image_picker, product, collection, page, url, video_url, header, paragraph.

## Rendering

```liquid
{# Always use render — isolated scope, no variable leaks #}
{% render 'product-card', product: item, show_vendor: true %}

{# Never use include — deprecated, leaks variables into parent scope #}
```

Pass data explicitly — rendered snippets cannot access outer variables.

## Filters — Shopify-specific

```liquid
{{ product.price | money }}                          {# Format as currency #}
{{ product.price | money_without_currency }}          {# Without symbol #}
{{ product.featured_image | image_url: width: 400 }}  {# Responsive image URL #}
{{ 'cart.title' | t }}                                {# Localization #}
{{ 'theme.css' | asset_url | stylesheet_tag }}        {# Asset pipeline #}
{{ 'app.js' | asset_url | script_tag }}               {# Script loading #}
{{ product | json }}                                   {# Debug output #}
{{ section.settings.text | default: 'Fallback' }}     {# Default value #}
```

Standard Liquid filters (upcase, downcase, replace, split, etc.) are part of the language — not repeated here.

## Objects — most common for theme work

| Object | Use |
|--------|-----|
| `shop` | Store name, currency, domain |
| `settings` | Theme-level settings from `settings_schema.json` |
| `section` | Current section's settings and blocks |
| `block` | Current block within a `for block in section.blocks` loop |
| `request` | Current locale, page type, host |
| `routes` | URL paths (cart, collections, search) |
| `product` | Product data (title, price, images, variants, tags) |
| `variant` | Product variant (price, sku, available, options) |
| `collection` | Collection (products, title, filters, sort options) |
| `cart` | Cart contents (items, total_price, item_count) |
| `page` | CMS page (title, content, handle) |
| `article` | Blog article (title, content, author, tags, image) |
| `blog` | Blog (articles, title, handle) |

Simple metafield access: `{{ product.metafields.namespace.key }}`
For complex metafield patterns (`.value` dereferencing, references, lists) → see `shopify-metafields` skill.

## Limitations & Gotchas

- **Loop limit:** Max 50 items per `{% for %}` — use `{% paginate %}` for larger collections
- **No custom logic:** No functions, no classes, no modules — Liquid is a template language
- **Stateless:** No state between requests — every page load starts fresh
- **Truthy/Falsy:** Only `nil` and `false` are falsy — empty string `""` is truthy
- **Integer division:** `5 / 2` returns `2`, not `2.5` — use `times: 1.0` first for float division
- **Case-sensitive:** String comparison is case-sensitive — `"Hello" == "hello"` is false
- **No operator precedence:** `true or false and false` evaluates right-to-left as `true or (false and false)` = `true`

## Anti-Patterns

- `{% include %}` instead of `{% render %}` — deprecated, leaks scope
- Nested for-loops without pagination — hits the 50-item limit silently
- String concatenation in loops — use `{% capture %}` instead
- Missing `{% if %}` nil-guards on optional objects — will output empty string or error
- `| default: ''` when the value could legitimately be `false` — use `| default: allow_false: true`
- `{% schema %}` not as the last tag — causes silent rendering failure
- Hardcoded text instead of `| t` localization filter

## Verify

- [ ] Liquid syntax is error-free (no unclosed tags, no undefined objects)
- [ ] Section renders correctly in the Shopify theme editor
- [ ] All user-facing text uses localization (`| t`)
- [ ] Localization keys exist in `locales/`
- [ ] `{{ block.shopify_attributes }}` present on all block wrappers
