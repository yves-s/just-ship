---
name: shopify-metafields
description: Use when working with Shopify metafields, metaobjects, custom structured content, or complex metafield access patterns in Liquid. Covers metafield types, .value dereferencing, reference resolution, list iteration, metaobjects as custom content types, and Admin API mutations. Load this skill whenever a ticket involves custom data, structured content beyond standard product fields, or metaobject definitions.
---

# Shopify Metafields & Metaobjects

**Announce at start:** "Reading existing metafield definitions and usage patterns before making changes."

Before working with metafields:
1. Check which namespaces and definitions already exist in the theme's Liquid files
2. Search for existing `metafields.` and `metaobjects.` usage patterns to stay consistent

For simple metafield access without `.value` (e.g., `{{ product.metafields.namespace.key }}`) → see `shopify-liquid` skill.

## Concepts

**Metafields** add structured data to existing Shopify resources (Product, Collection, Page, Shop, Customer, Order, etc.).

```
Namespace + Key = unique identifier
Example: custom.ingredients, specs.material, brand.story
```

**Definition** = the schema (type, validation, description). Always create definitions — untyped metafields are fragile.
**Value** = the actual data stored on a specific resource.

## Metafield Types — non-obvious behavior

| Type | Returns in Liquid | Gotcha |
|------|-------------------|--------|
| `rich_text_field` | JSON, not HTML | Needs `\| metafield_tag` or custom rendering |
| `file_reference` | Media object | Needs `\| image_url` for images, `.url` for files |
| `list.*` variants | Array | Must iterate with `{% for %}`, cannot access directly |
| `product_reference` | Resource object via `.value` | Full product object — access `.value.title`, `.value.price` |
| `collection_reference` | Resource object via `.value` | Full collection object |
| `json` | JSON string | Needs `\| parse_json` or access nested properties |

**Full type list:** single_line_text_field, multi_line_text_field, rich_text_field, number_integer, number_decimal, boolean, date, date_time, color, url, json, file_reference, product_reference, collection_reference, page_reference, variant_reference, list.single_line_text_field, list.product_reference, list.file_reference, dimension, volume, weight.

## Complex Liquid Patterns

Everything below uses `.value` dereferencing — this is the boundary with the `shopify-liquid` skill.

### Typed access

```liquid
{%- comment -%} .value gives the typed value — not the metafield wrapper {%- endcomment -%}
{{ product.metafields.custom.ingredients.value }}
{{ product.metafields.specs.weight.value }}
{{ product.metafields.custom.release_date.value | date: "%B %d, %Y" }}
```

### Reference resolution

```liquid
{%- comment -%} Reference metafields resolve to the full referenced object {%- endcomment -%}
{%- assign related = product.metafields.custom.related_product.value -%}
{%- if related -%}
  <a href="{{ related.url }}">{{ related.title }} — {{ related.price | money }}</a>
{%- endif -%}
```

### List iteration

```liquid
{%- comment -%} List metafields are arrays — iterate with for {%- endcomment -%}
{%- assign features = product.metafields.custom.features.value -%}
{%- if features.size > 0 -%}
  <ul>
    {%- for feature in features -%}
      <li>{{ feature }}</li>
    {%- endfor -%}
  </ul>
{%- endif -%}
```

### List of references

```liquid
{%- assign related_products = product.metafields.custom.related_products.value -%}
{%- if related_products.size > 0 -%}
  <div class="related-grid">
    {%- for item in related_products -%}
      {% render 'product-card', product: item %}
    {%- endfor -%}
  </div>
{%- endif -%}
```

### Rich text rendering

```liquid
{%- assign description = product.metafields.custom.long_description -%}
{%- if description -%}
  <div class="rich-text">
    {{ description | metafield_tag }}
  </div>
{%- endif -%}
```

### File/image reference

```liquid
{%- assign cert_image = product.metafields.custom.certificate.value -%}
{%- if cert_image -%}
  <img
    src="{{ cert_image | image_url: width: 600 }}"
    alt="{{ cert_image.alt | default: 'Certificate' }}"
    loading="lazy"
  >
{%- endif -%}
```

### Nested: Metafield → Metaobject → Field

```liquid
{%- assign author = article.metafields.custom.author.value -%}
{%- if author -%}
  <div class="author-bio">
    <img src="{{ author.avatar.value | image_url: width: 80 }}" alt="{{ author.name.value }}">
    <strong>{{ author.name.value }}</strong>
    <p>{{ author.bio.value }}</p>
  </div>
{%- endif -%}
```

## Metaobjects

Custom content types — a mini-CMS within Shopify. Use for structured content that doesn't belong on products/pages.

**Workflow:**
1. Create a metaobject **definition** in Shopify Admin (type, fields, display name field)
2. Create **entries** (individual records)
3. Reference entries via metafields on products/pages, or access globally

### Global access

```liquid
{%- comment -%} Access all entries of a type {%- endcomment -%}
{%- for member in shop.metaobjects.team_member.values -%}
  <div class="team-card">
    <img src="{{ member.photo.value | image_url: width: 300 }}" alt="{{ member.name.value }}">
    <h3>{{ member.name.value }}</h3>
    <p>{{ member.role.value }}</p>
  </div>
{%- endfor -%}
```

### Single entry by handle

```liquid
{%- assign ceo = shop.metaobjects.team_member.ceo -%}
{{ ceo.name.value }}
```

### Common use cases

| Metaobject type | Fields | Use |
|-----------------|--------|-----|
| `team_member` | name, role, photo, bio | About page |
| `faq_item` | question, answer, category | FAQ sections |
| `testimonial` | quote, author, company, rating | Social proof |
| `size_chart` | label, measurements (JSON) | Product size guides |
| `ingredient` | name, description, icon, benefits | Product ingredients |

## API Access (reference)

### Admin GraphQL — metafieldSet mutation

```graphql
mutation {
  metafieldsSet(metafields: [
    {
      ownerId: "gid://shopify/Product/123",
      namespace: "custom",
      key: "ingredients",
      type: "multi_line_text_field",
      value: "Ingredients list here"
    }
  ]) {
    metafields { id namespace key }
    userErrors { field message }
  }
}
```

- `metafieldsSet` handles both create and update — upsert behavior
- Use for bulk data imports and migrations

### Storefront API

```graphql
query {
  product(handle: "example") {
    metafield(namespace: "custom", key: "ingredients") {
      value
      type
    }
  }
}
```

## Anti-Patterns

- **Metafields without definitions** — untyped metafields have no validation, no admin UI, and break unpredictably
- **Namespace `custom` for everything** — use semantic namespaces: `specs.*`, `brand.*`, `seo.*`
- **JSON metafield where a typed field works** — `json` bypasses type validation, use specific types
- **Metaobjects for data that belongs on products** — if every product needs it, it's a metafield not a metaobject
- **Missing nil-guards** — metafields can be empty on any resource, always wrap in `{% if %}`
- **Accessing `.value` on a nil metafield** — causes error, check the metafield exists first
- **Hardcoded metafield keys** — use consistent naming conventions across the theme

## Verify

- [ ] Metafield definitions exist in Shopify Admin (not just untyped values)
- [ ] All Liquid access wrapped in `{% if %}` nil-guards
- [ ] `.value` used for typed access, references, and lists
- [ ] Reference metafields resolve to valid objects
- [ ] Namespace naming is consistent with existing theme patterns
