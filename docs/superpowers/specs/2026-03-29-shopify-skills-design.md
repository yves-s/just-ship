# Shopify Skills für Just Ship Agents

**Datum:** 2026-03-29
**Kontext:** Just Ship wird als Agency OS mit Shopify-Spezialisierung positioniert. Drei domänenspezifische Skills steuern, wie Agents mit Shopify-Themes und -Daten arbeiten.

---

## Entscheidungen

### Skill-Schnitt: nach Domäne, nicht nach Agent-Rolle
Shopify-Wissen liegt quer zu den Agent-Rollen. Liquid wird von Frontend- und Backend-Agents gebraucht, Metafields von Data Engineer, Backend und Frontend. Die Skills folgen der Shopify-Domäne — das Agent-System routet bereits nach Rolle.

### 3 Skills, nicht 4
`shopify-api` wurde bewusst geparkt. Für Theme-Arbeit reicht die Ajax API (/cart.js), die in `shopify-theme` als JS-Pattern unterkommt. Admin API und Storefront API werden erst relevant bei App-Entwicklung oder Daten-Migration (P3 Roadmap).

### Kein CLI in Skills
CLI-Commands (`shopify theme dev/push/check`) sind Infrastruktur, nicht Skill-Wissen. Der DevOps-Agent hat `shopify theme check --fail-level error` in `project.json` unter `build.check`. Skills fokussieren rein auf Code-Patterns.

### Overlap-Vermeidung bei Metafields
Einfacher Metafield-Zugriff (`{{ product.metafields.namespace.key }}`) steht in `shopify-liquid`. Komplexe Patterns (Reference-Auflösung, List-Iteration, Metaobjects) stehen in `shopify-metafields`. So lädt der Frontend-Agent Skill 3 nur bei Custom-Content-Arbeit.

---

## Skill 1: `shopify-liquid.md`

**Agents:** Frontend, Backend
**Trigger:** Wenn ein Agent Liquid-Code schreibt, modifiziert oder debuggt
**Geschätzte Größe:** ~4-5 KB

### Inhalt

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

Setting-Types als Referenz-Tabelle (die häufigsten 15: text, textarea, richtext, range, checkbox, select, color, image_picker, product, collection, page, url, video_url, header, paragraph).

#### Rendering
- `{% render 'snippet', param: value %}` — isolierter Scope, IMMER verwenden
- `{% include %}` ist deprecated
- Parameter-Passing Patterns

#### Filter (Kurzreferenz)
- Money: `| money`, `| money_without_currency`
- Media: `| image_url: width: 400`, `| img_tag`
- String: `| upcase`, `| downcase`, `| replace`, `| strip_html`, `| truncate`
- Array: `| where`, `| map`, `| sort`, `| first`, `| last`, `| size`
- Shopify: `| t`, `| asset_url`, `| stylesheet_tag`, `| script_tag`
- Utility: `| default`, `| json`

#### Objects (die häufigsten)
- Global: `shop`, `request`, `settings`, `routes`, `section`, `block`
- Content: `product`, `variant`, `collection`, `cart`, `page`, `article`, `blog`
- Einfacher Metafield-Zugriff: `{{ product.metafields.namespace.key }}`

#### Limitations & Gotchas
- Max 50 Items in for-Loop → `{% paginate %}` verwenden
- Keine Custom Functions/Logic
- Kein Zustand zwischen Requests
- Truthy/Falsy: nur `nil` und `false` sind falsy
- Integer Division: `5 / 2 = 2` (nicht 2.5)
- String-Vergleich ist case-sensitive

---

## Skill 2: `shopify-theme.md`

**Agents:** Frontend, QA
**Trigger:** Wenn ein Agent an Shopify Theme-Dateien arbeitet (Struktur, Templates, Assets, Localization, JS)
**Geschätzte Größe:** ~4-5 KB

### Inhalt

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

#### JS Pattern: Web Components
- Modernes Shopify-Theme JS nutzt Custom Elements, nicht jQuery oder Module
- Pattern: `class XY extends HTMLElement` mit `constructor()` + `connectedCallback()`
- Shopify Section Events: `shopify:section:load`, `shopify:section:unload`, `shopify:section:select`
- Kurzes Beispiel: Collapsible/Accordion als Custom Element

#### JS Pattern: Ajax API (Cart)
- `/cart.js` (GET), `/cart/add.js` (POST), `/cart/change.js` (POST), `/cart/update.js` (POST)
- Fetch-Pattern mit error handling
- 422 = out of stock

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

---

## Skill 3: `shopify-metafields.md`

**Agents:** Data Engineer, Backend, Frontend
**Trigger:** Wenn ein Agent mit Metafields, Metaobjects oder Custom Content Types arbeitet
**Geschätzte Größe:** ~3-4 KB

### Inhalt

#### Konzept
- Zusätzliche strukturierte Daten an bestehende Ressourcen (Product, Collection, Page, Shop, etc.)
- Namespace + Key = eindeutiger Identifier
- Definition (= Schema) vs. Value (= Daten)

#### Metafield Types (Referenz-Tabelle)
- Text: `single_line_text_field`, `multi_line_text_field`, `rich_text_field`
- Numerisch: `number_integer`, `number_decimal`, `boolean`
- Datum: `date`, `date_time`
- Medien: `file_reference`, `color`, `url`, `json`
- Referenzen: `product_reference`, `collection_reference`, `page_reference`, `variant_reference`
- Listen: `list.*` Varianten für Multi-Values
- Einheiten: `dimension`, `volume`, `weight`

#### Komplexe Liquid-Patterns (NICHT in shopify-liquid)
- Reference-Auflösung: `{{ product.metafields.custom.related_product.value.title }}`
- Typed Access: `{{ product.metafields.custom.ingredients.value }}`
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
