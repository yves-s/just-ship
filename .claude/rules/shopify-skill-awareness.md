When the project contains Shopify theme files (e.g. `sections/`, `snippets/`, `templates/`, `layout/theme.liquid`) or Shopify app files (e.g. `app/`, `shopify.app.toml`, Polaris components), the Shopify AI Toolkit provides all Shopify domain knowledge.

**The Shopify AI Toolkit (`@shopify/dev-mcp`) is configured as an MCP server** during `setup.sh`. It provides:

- Live documentation search across all Shopify APIs
- GraphQL and Liquid code validation against current schemas
- 16 domain-specific skills (admin, liquid, hydrogen, functions, checkout extensions, etc.)
- Auto-updates — always current with the latest Shopify API versions

**There are NO local Shopify skill files.** Do not look for `.claude/skills/shopify-*.md` — they do not exist. All Shopify expertise comes from the MCP server tools.

**Pipeline scripts remain local** and are NOT part of the toolkit:

| Script | Purpose |
|---|---|
| `.claude/scripts/shopify-env-check.sh` | Validate dev environment (Node, CLI, store, auth) |
| `.claude/scripts/shopify-dev.sh` | Start dev server or push preview theme |
| `.claude/scripts/shopify-preview.sh` | Create/cleanup unpublished preview themes |
| `.claude/scripts/shopify-qa.sh` | Static analysis for Liquid/theme consistency |
| `.claude/scripts/shopify-app-deploy.sh` | Deploy app extensions after merge |

**How to apply:**
1. For Shopify code questions, use the MCP server's search and validation tools
2. For pipeline operations (preview, deploy, QA), use the local scripts listed above
3. Respect `.shopifyignore` — never modify or push files listed there
4. The rule `no-settings-data-edit.md` still applies — never touch `config/settings_data.json`
