When the project contains Shopify theme files (e.g. `sections/`, `snippets/`, `templates/`, `layout/theme.liquid`), load the Shopify skills before writing any Liquid, theme, or metafield code.

**Before writing Shopify code**, invoke the relevant skills via the Skill tool:

| Task | Skill |
|---|---|
| Liquid templates, sections, snippets, schema | `shopify-liquid` |
| Theme structure, JSON templates, JS, assets, i18n | `shopify-theme` |
| Metafields, metaobjects, custom data | `shopify-metafields` |

If the Skill tool doesn't find them, read the files directly from `.claude/skills/`:

| Task | Read |
|---|---|
| Liquid code | `.claude/skills/shopify-liquid.md` |
| Theme architecture | `.claude/skills/shopify-theme.md` |
| Metafields / metaobjects | `.claude/skills/shopify-metafields.md` |

**Why:** Shopify skills are project-level skills (`.claude/skills/`) that don't appear in the system-reminder skill list. Without this rule, Claude doesn't know they exist and writes generic Liquid code instead of following the skill's patterns for section schema, whitespace control, Online Store 2.0 conventions, and metafield dereferencing.

**How to apply:**
1. At session start or when first encountering a Shopify-related task, check if the project has Shopify theme files
2. If yes, invoke or read the relevant Shopify skills before writing any code
3. For section development: always load `shopify-liquid` — it covers schema patterns, snippet vs section decisions, and Liquid gotchas
4. For structural changes (new templates, asset loading, settings): also load `shopify-theme`
5. For custom data (metafields, metaobjects): also load `shopify-metafields`
