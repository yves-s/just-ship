When the project contains Shopify theme files (e.g. `sections/`, `snippets/`, `templates/`, `layout/theme.liquid`) or Shopify app files (e.g. `app/`, `shopify.app.toml`, Polaris components), load the relevant Shopify skills before writing any code.

**Before writing Shopify code**, invoke the relevant skills via the Skill tool:

**Theme skills:**

| Task | Skill |
|---|---|
| Liquid templates, sections, snippets, schema | `shopify-liquid` |
| Theme structure, JSON templates, JS, assets, i18n | `shopify-theme` |
| Metafields, metaobjects, custom data | `shopify-metafields` |

**App skills:**

| Task | Skill |
|---|---|
| Shopify Apps (App Bridge, Polaris, OAuth, billing) | `shopify-apps` |
| App scaffold cleanup after `shopify app init` | `shopify-app-scaffold` |
| Admin API (GraphQL/REST, products, orders, webhooks) | `shopify-admin-api` |
| Storefront API (headless, cart, collections) | `shopify-storefront-api` |
| Hydrogen storefronts (React Router, SSR, Oxygen) | `shopify-hydrogen` |
| Checkout extensions, Shopify Functions (Plus only) | `shopify-checkout` |

If the Skill tool doesn't find them, read the files directly from `.claude/skills/`:

| Task | Read |
|---|---|
| Liquid code | `.claude/skills/shopify-liquid.md` |
| Theme architecture | `.claude/skills/shopify-theme.md` |
| Metafields / metaobjects | `.claude/skills/shopify-metafields.md` |
| App development | `.claude/skills/shopify-apps.md` |
| App scaffold | `.claude/skills/shopify-app-scaffold.md` |
| Admin API | `.claude/skills/shopify-admin-api.md` |
| Storefront API | `.claude/skills/shopify-storefront-api.md` |
| Hydrogen | `.claude/skills/shopify-hydrogen.md` |
| Checkout / Functions | `.claude/skills/shopify-checkout.md` |

**Why:** Shopify skills are project-level skills (`.claude/skills/`) that don't appear in the system-reminder skill list. Without this rule, Claude writes generic code instead of following skill patterns for section schema, App Bridge v4, GraphQL pagination, Oxygen deployment, etc.

**How to apply:**
1. At session start or when first encountering a Shopify-related task, identify the project type (theme vs. app vs. headless)
2. Load the relevant skills before writing any code
3. **Theme projects:** always load `shopify-liquid`; add `shopify-theme` for structural changes, `shopify-metafields` for custom data
4. **App projects:** always load `shopify-apps`; add `shopify-admin-api` for backend ops, `shopify-app-scaffold` after `shopify app init`
5. **Headless / Hydrogen:** load `shopify-storefront-api` and `shopify-hydrogen`; add `shopify-checkout` for Plus checkout customizations
6. Respect `.shopifyignore` — never modify or push files listed there
