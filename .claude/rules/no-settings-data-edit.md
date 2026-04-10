---
description: Never edit settings_data.json in Shopify projects — it contains merchant customizations
paths:
  - "sections/**"
  - "snippets/**"
  - "templates/**"
  - "layout/**"
  - "config/**"
  - "**/*.liquid"
---

NEVER edit, create, or overwrite `config/settings_data.json` in Shopify theme projects.

This file contains all merchant customizations (colors, fonts, section ordering, content). Editing it overwrites the customer's work.

- If a ticket asks to change theme settings: modify `config/settings_schema.json` (the definition), not `settings_data.json` (the merchant's values)
- If you need default values: set them in section schema `"default"` fields
- The shopify-preview.sh script always passes `--ignore "config/settings_data.json"` on push

No exceptions. This is a destructive action equivalent to dropping a database table.
