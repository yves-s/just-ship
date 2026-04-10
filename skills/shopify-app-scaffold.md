---
name: shopify-app-scaffold
description: Use after running `shopify app init --template=remix` to clean up the generated scaffold into an opinionated starter. Removes demo content, keeps auth and infrastructure, creates a minimal app shell. Load when scaffold_type is "shopify-app" in Triage result.
triggers:
  - shopify
  - scaffold
  - remix
  - app-init
  - starter
---

# Shopify App Scaffold Cleanup

**When to Use:** Loaded by the Orchestrator when the Triage result contains `scaffold_type === "shopify-app"`. This skill runs after `shopify app init --template=remix` (or `shopify app create --template=remix`) has completed and the generated project exists on disk.

**Announce at start:** "Cleaning up Shopify Remix scaffold -- removing demo content, keeping auth infrastructure."

## Cleanup Rules (Opinionated Starter)

The Remix template ships with example routes, demo components, and placeholder data. Strip it down to a clean starting point while preserving all infrastructure the app needs to function.

### Remove (DELETE these files/content)

| Target | Why |
|--------|-----|
| Demo content inside `app/routes/app._index.tsx` | Contains example welcome page, tutorial links, placeholder cards |
| `app/routes/app.additional.tsx` (and any other example routes like `app.qrcodes*.tsx`) | Demo feature routes that do not belong to the real app |
| QR code generator components/routes (if present) | Common demo feature in older templates |
| Placeholder UI components (e.g. example Card content, fake product lists) | Not part of the real app |
| Placeholder/mock data files and hardcoded sample data | Fake data should not survive into production |
| Mock API calls or example GraphQL queries used only by demo pages | Dead code after demo routes are removed |
| Example migration files that only serve the demo (e.g. QR code tables) | Database schema should start clean -- but read before deleting, some migrations set up session storage |

### Keep (DO NOT DELETE)

These files are load-bearing infrastructure. Deleting them breaks auth, builds, or deployments.

| File/Pattern | Purpose |
|--------------|---------|
| `app/root.tsx` | Remix root layout, Polaris provider, App Bridge script tag |
| `app/entry.server.tsx` | Server-side rendering entry point |
| `app/shopify.server.ts` | Shopify auth configuration (session storage, API client, webhook registration) |
| `shopify.app.toml` | App identity, scopes, webhook subscriptions, deploy config |
| `package.json` | Dependencies and scripts |
| `tsconfig.json` | TypeScript configuration |
| `.env` / `.env` handling | Environment variable loading (API key, secret, scopes) |
| Prisma/DB setup (`prisma/`, `app/db.server.ts`) | Session storage and app data -- keep if present |
| `app/routes/auth.*.tsx` | OAuth callback routes -- required for installation flow |
| `app/routes/webhooks.tsx` | Webhook handler -- mandatory for `app/uninstalled` |
| `app/routes/app.tsx` | Parent layout route for the `/app` path (renders Outlet, nav) |
| `remix.config.js` / `vite.config.ts` | Build configuration |
| `Dockerfile` (if present) | Deployment config |

### Create (new files for the clean starter)

#### 1. Minimal `app/routes/app._index.tsx`

Replace the demo content with a clean Polaris page:

```tsx
import type { LoaderFunctionArgs } from "@remix-run/node";
import { Page, Layout, Card, BlockStack, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return null;
}

export default function Index() {
  return (
    <Page title="Home">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Welcome
              </Text>
              <Text as="p" variant="bodyMd">
                Your app is ready. Start building.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
```

#### 2. `.env.example`

Create a `.env.example` so developers know which variables are required:

```env
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SCOPES=read_products
SHOPIFY_APP_URL=https://your-tunnel-url.trycloudflare.com
```

Do NOT commit an actual `.env` file -- only the example.

#### 3. Cleaned `README.md`

Replace the template README with a minimal project README:

```markdown
# App Name

Shopify app built with Remix.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in values
3. `shopify app dev`

## Deployment

`shopify app deploy`
```

## project.json After Scaffold

After cleanup, the target project's `project.json` should contain:

```json
{
  "stack": {
    "platform": "shopify",
    "variant": "remix",
    "framework": "remix"
  }
}
```

The Orchestrator or Triage agent sets these values so that subsequent pipeline runs load the correct Shopify skills (via `VARIANT_DEFAULTS` and `SKILL_AGENT_MAP` in `load-skills.ts`).

## Verification

After cleanup, run these commands to confirm the scaffold is healthy:

```bash
npm install
npm run build
```

Both must pass with zero errors. If `npm run build` fails:

1. Check that no import references a deleted demo file
2. Check that `app/routes/app._index.tsx` exports a default component and a loader
3. Check that `app/root.tsx` still imports Polaris styles and renders the AppProvider

Additionally verify:

- [ ] `shopify app dev` starts without errors
- [ ] The app installs on a development store via OAuth
- [ ] The `/app` route renders the minimal Polaris page
- [ ] No demo routes remain (no `/app/additional`, no `/app/qrcodes`)
- [ ] `prisma migrate deploy` succeeds (if Prisma is present)
- [ ] Webhook endpoint responds to `app/uninstalled`

## Typical Tickets

| Ticket | Approach |
|--------|----------|
| Scaffold new Shopify app | Run `shopify app init`, then apply this cleanup skill |
| Clean up existing demo app | Audit routes against the Remove list, strip demo content, verify build |
| Add first real feature after scaffold | Build on the clean `app._index.tsx`, add new routes under `app/routes/app.*.tsx` |
