# Shopify Skills für Just Ship Agents

**Datum:** 2026-03-29
**Kontext:** Just Ship wird als Agency OS mit Shopify-Spezialisierung positioniert. Drei domänenspezifische Skills steuern, wie Agents mit Shopify-Themes und -Daten arbeiten.
**Sprache:** Skill-Dateien auf Englisch (per CLAUDE.md Konvention). Technische Begriffe (Liquid, Section, Schema) bleiben Englisch.

---

## Entscheidungen

### Skill-Schnitt: nach Domäne, nicht nach Agent-Rolle
Shopify-Wissen liegt quer zu den Agent-Rollen. Liquid wird von Frontend- und Backend-Agents gebraucht, Metafields von Data Engineer, Backend und Frontend. Die Skills folgen der Shopify-Domäne — das Agent-System routet bereits nach Rolle.

### 3 Skills, nicht 4
`shopify-api` wurde bewusst geparkt. Für Theme-Arbeit reicht die Ajax API (/cart.js), die in `shopify-theme` als JS-Pattern unterkommt. Admin API und Storefront API werden erst relevant bei App-Entwicklung oder Daten-Migration (P3 Roadmap).

### Kein CLI in Skills
CLI-Commands (`shopify theme dev/push/check`) sind Infrastruktur, nicht Skill-Wissen. `shopify theme check --fail-level error` steht in `project.json` unter `build.check` — Agents nutzen das über den normalen Build-Check-Workflow, nicht über Skill-Wissen.

### Overlap-Vermeidung bei Metafields
Trennlinie ist `.value` Dereferenzierung:
- **shopify-liquid:** `{{ product.metafields.namespace.key }}` (ohne `.value`)
- **shopify-metafields:** Alles mit `.value` — typed access, reference resolution, list iteration, metaobjects

### Skill-Struktur: Reference Style, nicht Workflow Style
Bestehende Skills (frontend-design, backend) folgen einem Workflow-Pattern (Step 1, Step 2, ...). Die Shopify-Skills sind **Domänenwissen-Referenzen** — sie ergänzen die bestehenden Workflow-Skills, ersetzen sie nicht. Der Frontend-Agent lädt `frontend-design` (Workflow) UND `shopify-liquid` + `shopify-theme` (Domänenwissen). Jeder Shopify-Skill hat trotzdem: Announce, Context-Reading, Verify-Schritt und Anti-Patterns.

### Cross-References
Skills verweisen aufeinander wo Wissen aufgeteilt ist:
- `shopify-liquid` → "Für komplexe Metafield-Patterns (`.value`, References, Lists) → shopify-metafields"
- `shopify-theme` → "Für Liquid-Syntax und Section Schema → shopify-liquid"
- `shopify-metafields` → "Für einfachen Metafield-Zugriff in Templates → shopify-liquid"

---

## Skill 1: `shopify-liquid.md`

**Frontmatter:**
```yaml
---
name: shopify-liquid
description: Use when writing, modifying, or debugging Shopify Liquid code — sections, snippets, schema, template logic
---
```

**Agents:** Frontend, Backend
**Geschätzte Größe:** ~4 KB

### Inhalt

#### Announce + Context
- "Reading existing theme sections and Liquid patterns before writing."
- Read existing sections in `sections/` to match conventions (naming, schema style, CSS approach)

#### Syntax Essentials
- Output `{{ }}`, Tags `{% %}`, Whitespace Control `{%- -%}`
- Operator-Präzedenz: rechts-nach-links, KEINE Klammern
- Variablen sind immutable nach `assign`

#### Template-Hierarchie
- `layout/theme.liquid` → `templates/*.json` → `sections/*.liquid` → `snippets/*.liquid`
- Entscheidungshilfe: Wann Section vs. Snippet
  - Section = eigenständig, hat Schema, vom Merchant konfigurierbar
  - Snippet = wiederverwendbar, kein Schema, wird per `render` eingebunden

#### Section Schema — Zwei Beispiele
1. **Minimal** (3 Settings, kein Block): Heading, Text, Button-URL
2. **Komplex** (Settings + Blocks + Presets): Featured Content mit verschiedenen Block-Typen

**Schema-Constraints:**
- `{% schema %}` muss der letzte Tag in der Section-Datei sein
- Nur ein Schema pro Section
- Setting-IDs müssen innerhalb der Section unique sein
- Max 16 Block-Typen pro Section

**Setting-Types** (nur die mit nicht-offensichtlichem Verhalten):
- `richtext` → gibt HTML zurück, nicht Plain Text
- `image_picker` → gibt Image-Object zurück, nicht URL — braucht `| image_url`
- `product` / `collection` / `page` → gibt Ressource-Object zurück
- `font_picker` → gibt Font-Object zurück, Zugriff über `.family`, `.style`, `.weight`
- Vollständige Liste: text, textarea, richtext, range, checkbox, select, color, image_picker, product, collection, page, url, video_url, header, paragraph

#### Rendering
- `{% render 'snippet', param: value %}` — isolierter Scope, IMMER verwenden
- `{% include %}` ist deprecated
- Parameter-Passing Patterns

#### Filter (nur Shopify-spezifisch)
- Money: `| money`, `| money_without_currency`
- Media: `| image_url: width: 400`, `| img_tag`
- Localization: `| t`
- Assets: `| asset_url`, `| stylesheet_tag`, `| script_tag`
- Utility: `| default`, `| json`
- Standard Liquid-Filter (upcase, downcase, replace, etc.) sind dem Agent bekannt — nicht wiederholen

#### Objects (die häufigsten für Theme-Arbeit)
- Global: `shop`, `request`, `settings`, `routes`, `section`, `block`
- Content: `product`, `variant`, `collection`, `cart`, `page`, `article`, `blog`
- Einfacher Metafield-Zugriff: `{{ product.metafields.namespace.key }}`
- → Für komplexe Metafield-Patterns (`.value`, References, Lists) → `shopify-metafields`

#### Limitations & Gotchas
- Max 50 Items in for-Loop → `{% paginate %}` verwenden
- Keine Custom Functions/Logic
- Kein Zustand zwischen Requests
- Truthy/Falsy: nur `nil` und `false` sind falsy
- Integer Division: `5 / 2 = 2` (nicht 2.5)
- String-Vergleich ist case-sensitive

#### Anti-Patterns
- `{% include %}` statt `{% render %}` (deprecated, leaks Scope)
- Nested for-Loops ohne Pagination
- String-Concatenation in Loops statt `{% capture %}`
- Fehlende `{% if %}` nil-Guards auf optionalen Objects
- `| default: ''` als Falsy-Guard wenn der Wert `false` sein kann
- Schema nach anderem Content (muss letzter Tag sein)

#### Verify
- Liquid-Syntax fehlerfrei (keine unclosed Tags, keine undefined Objects)
- Section rendert im Theme Editor (Schema ist valide)
- Localization Keys existieren in `locales/`

---

## Skill 2: `shopify-theme.md`

**Frontmatter:**
```yaml
---
name: shopify-theme
description: Use when working with Shopify theme file structure, JSON templates, assets, settings, localization, or theme JavaScript
---
```

**Agents:** Frontend, QA
**Geschätzte Größe:** ~5 KB

### Inhalt

#### Announce + Context
- "Reading existing theme structure, settings_schema.json, and section patterns before making changes."
- Check: Dawn-basiert oder Custom Theme? Conventions unterscheiden sich.

#### File Structure
Kompletter Verzeichnisbaum mit Zweck:
```
assets/        → CSS, JS, Bilder, Fonts (kein Bundler)
config/        → settings_schema.json, settings_data.json
layout/        → theme.liquid (Shell)
locales/       → Übersetzungen (de.json, de.default.schema.json)
sections/      → Eigenständige UI-Blöcke mit Schema
snippets/      → Wiederverwendbare Fragmente ohne Schema
templates/     → JSON-Dateien die Sections verdrahten
blocks/        → Theme Blocks (nested in Sections)
```

#### JSON Templates (OS 2.0)
- Wie `templates/*.json` Sections verdrahten
- Minimales Beispiel (`index.json` mit 2 Sections)
- Unterschied zu alten `.liquid` Templates (nicht mehr verwenden)

#### Layout
- `theme.liquid` als Shell: `{{ content_for_header }}`, `{{ content_for_layout }}`
- Section Groups (`header-group`, `footer-group`)

#### Settings
- `config/settings_schema.json` → Theme-Level-Settings definieren
- `config/settings_data.json` → NIEMALS manuell editieren (Merchant-Daten)
- CSS Custom Properties Pattern: `settings.*` → `:root` vars → `var(--*)` in Sections

#### Asset Pipeline
- Kein Bundler — rohe CSS/JS Dateien
- `{{ 'file.css' | asset_url | stylesheet_tag }}`
- `{{ 'file.js' | asset_url | script_tag }}`
- `defer` für JS, critical CSS inline
- CSS-Architektur: base.css + component-spezifische CSS, CSS Custom Properties aus settings_schema

#### JS Pattern: Web Components
- Modernes Shopify-Theme JS nutzt Custom Elements, nicht jQuery oder Module
- Pattern: `class XY extends HTMLElement` mit `constructor()` + `connectedCallback()`
- Shopify Section Events: `shopify:section:load`, `shopify:section:unload`, `shopify:section:select`
- Kurzes Beispiel: Collapsible/Accordion als Custom Element

#### JS Pattern: Ajax API (Cart)
- `/cart.js` (GET), `/cart/add.js` (POST), `/cart/change.js` (POST), `/cart/update.js` (POST)
- Fetch-Pattern mit error handling
- 422 = out of stock
- → Für Liquid Cart-Object → `shopify-liquid`

#### JS Pattern: Section Rendering API
- Dynamische Section-Updates ohne Full Page Reload
- `fetch(url + '?sections=section-id')` → HTML-Fragment zurück
- Use Cases: Cart Drawer Update, Variant-Wechsel, Quick Add
- Kurzes Fetch + DOM-Replace Beispiel

#### JS Pattern: Predictive Search
- `routes.predictive_search_url` aus Liquid an JS übergeben
- Fetch mit Query-Parameter, Debounce, Result-Rendering
- Kurzes Pattern-Beispiel

#### Localization
- `locales/de.json` für Content-Übersetzungen
- `locales/de.default.schema.json` für Editor-Labels
- `{{ 'key.path' | t }}` im Liquid
- `t:sections.name.settings.key.label` im Schema

#### Anti-Patterns
- `settings_data.json` manuell editieren
- Inline Styles statt CSS Custom Properties
- `.liquid` Templates statt `.json` (OS 2.0)
- jQuery oder Script-Tags ohne `defer`
- JS ohne Web Component Pattern (lose Funktionen im globalen Scope)
- Full Page Reload statt Section Rendering API für dynamische Updates

#### Verify
- Section rendert korrekt im Theme Editor
- Localization Keys vorhanden
- JS-Fehler in Browser Console geprüft
- Responsive: Mobile (375px), Tablet (768px), Desktop (1280px)

---

## Skill 3: `shopify-metafields.md`

**Frontmatter:**
```yaml
---
name: shopify-metafields
description: Use when working with Shopify metafields, metaobjects, custom structured content, or complex metafield access patterns
---
```

**Agents:** Data Engineer, Backend, Frontend
**Geschätzte Größe:** ~3-4 KB

### Inhalt

#### Announce + Context
- "Reading existing metafield definitions and usage patterns before making changes."
- Check: Welche Namespaces/Definitions existieren bereits im Theme?

#### Konzept
- Zusätzliche strukturierte Daten an bestehende Ressourcen (Product, Collection, Page, Shop, etc.)
- Namespace + Key = eindeutiger Identifier
- Definition (= Schema) vs. Value (= Daten)
- → Für einfachen Zugriff (`{{ product.metafields.namespace.key }}`) → `shopify-liquid`

#### Metafield Types (nur nicht-offensichtliches Verhalten)
- `rich_text_field` → gibt JSON zurück, nicht HTML — braucht spezielles Rendering
- `file_reference` → gibt Media-Object zurück, nicht URL
- `list.*` Varianten → Array in Liquid, braucht `{% for %}`
- `product_reference` / `collection_reference` etc. → gibt Ressource-Object zurück, Zugriff über `.value`
- Vollständige Liste: single_line_text_field, multi_line_text_field, rich_text_field, number_integer, number_decimal, boolean, date, date_time, color, url, json, file_reference, product_reference, collection_reference, page_reference, variant_reference, list.*, dimension, volume, weight

#### Komplexe Liquid-Patterns
Alles mit `.value` Dereferenzierung — die Trennlinie zu `shopify-liquid`:
- Typed Access: `{{ product.metafields.custom.ingredients.value }}`
- Reference-Auflösung: `{{ product.metafields.custom.related_product.value.title }}`
- List-Iteration: `{% for item in product.metafields.custom.features.value %}`
- Bedingte Ausgabe mit Typ-Check
- Verschachtelte Referenzen (Metafield → Metaobject → Feld)

#### API-Zugriff (Kurzreferenz)
- Admin GraphQL: `metafieldSet` Mutation (create + update in einem)
- `metafieldsSet` für Bulk-Updates
- Storefront API: `metafield(namespace, key)` Query

#### Metaobjects
- Custom Content Types (Mini-CMS)
- Workflow: Definition erstellen → Entries anlegen → per Metafield referenzieren
- Liquid-Zugriff: `{{ shop.metaobjects.type_handle.entry_handle }}`
- Use Cases: Teammitglieder, FAQ, Testimonials, Größentabellen, Inhaltsstoff-Listen

#### Anti-Patterns
- Metafields ohne Definition (untyped = fragil)
- Namespace `custom` für alles — sinnvolle Namespaces verwenden
- JSON-Metafield wo ein typed Field reicht
- Metaobjects für Daten die ins Produkt gehören
- Metafields im Theme-Code ohne `{% if %}` Guard (kann nil sein)

#### Verify
- Metafield-Definitionen existieren im Shopify Admin
- Liquid-Zugriff gibt erwartete Daten zurück
- Nil-Guards auf allen Metafield-Zugriffen

---

## Agent-Mapping

| Skill | Frontend | Backend | Data Engineer | QA |
|-------|----------|---------|---------------|-----|
| `shopify-liquid` | Primary | Secondary | — | Read-only |
| `shopify-theme` | Primary | — | — | Secondary |
| `shopify-metafields` | Secondary | Secondary | Primary | — |

**Wie laden?** Über `skills:` Array in der Agent-Definition, analog zu bestehenden Skills. Der Orchestrator weist dem richtigen Agent zu, der Agent lädt den passenden Skill.

---

## Nicht im Scope

- **Shopify API Skill** — geparkt bis App-Entwicklung/Daten-Migration (P3)
- **Hydrogen/Headless** — kein aktueller Use Case
- **App Development** (Polaris, Extensions) — kein aktueller Use Case
- **CLI Commands** — Infrastruktur, in `project.json` unter `build.check`
- **Performance Skill** — Web Vitals Patterns fließen in `shopify-theme` ein (Asset Pipeline, defer, critical CSS), kein separater Skill nötig
