---
name: shopify-apps
description: Use when building Shopify apps -- custom or public. Covers Shopify App CLI, App Bridge v4, Polaris UI components, session tokens, OAuth, app proxy, theme app extensions, and billing API. Load when scaffolding, building, or maintaining a Shopify app.
triggers:
  - shopify
  - app
  - polaris
  - oauth
  - app-bridge
  - billing
---

# Shopify App Development

**Announce at start:** "Reading existing app structure, extensions, and configuration before writing."

Before writing any app code, read the `shopify.app.toml` configuration and existing extension directories to understand the app's setup, scopes, and patterns.

## Shopify App CLI

The Shopify CLI is the primary tool for scaffolding, developing, and deploying apps.

### Core Commands

```bash
# Scaffold a new app (Remix template is default)
shopify app init

# Start local development server with tunnel
shopify app dev

# Deploy app and extensions to Shopify
shopify app deploy

# Generate a new extension
shopify app generate extension

# View app info and configuration
shopify app info

# Manage app environment variables
shopify app env show
shopify app env pull
```

### App Configuration (`shopify.app.toml`)

```toml
name = "My App"
client_id = "your-client-id"
application_url = "https://your-app.example.com"
embedded = true

[access_scopes]
scopes = "read_products,write_products,read_orders"

[auth]
redirect_urls = [
  "https://your-app.example.com/auth/callback",
  "https://your-app.example.com/auth/shopify/callback",
  "https://your-app.example.com/api/auth/callback",
]

[webhooks]
api_version = "2024-10"

  [[webhooks.subscriptions]]
  topics = ["app/uninstalled"]
  uri = "/api/webhooks"

[pos]
embedded = false
```

## App Types

| Type | Audience | Distribution | Review |
|------|----------|-------------|--------|
| **Custom** | Single shop | Install via URL | No review needed |
| **Public** | Any shop | Shopify App Store | Requires App Store review |

**Custom apps** are for in-house tools, client-specific features, or integrations for a single merchant. They skip the App Store review but still use the same APIs.

**Public apps** are listed in the Shopify App Store and must pass review. They must use Polaris for UI, handle billing, and follow all App Store guidelines.

## App Bridge v4

App Bridge v4 is **CDN-based** -- no npm package to install. It provides navigation, modals, toasts, and communication between your embedded app and the Shopify Admin.

### Setup

App Bridge is automatically initialized in Remix apps created with the Shopify CLI. For manual setup:

```html
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
```

### Navigation

```typescript
// Navigate within the Shopify Admin
shopify.navigate("/products");
shopify.navigate("/orders/12345");

// Open a resource picker
const selected = await shopify.resourcePicker({
  type: "product",
  multiple: true,
  filter: { variants: false },
});
```

### Toast Notifications

```typescript
// Show a success toast
shopify.toast.show("Product saved successfully");

// Show an error toast
shopify.toast.show("Failed to save product", { isError: true });

// Toast with action
shopify.toast.show("Item deleted", {
  action: "Undo",
  onAction: () => handleUndo(),
});
```

### Title Bar

```typescript
// Set the page title in the Admin
shopify.titleBar.set({
  title: "Product Manager",
  breadcrumbs: [{ label: "Dashboard", destination: "/" }],
  primaryAction: {
    label: "Create Product",
    onAction: () => handleCreate(),
  },
  secondaryActions: [
    { label: "Import", onAction: () => handleImport() },
  ],
});
```

### Modal

```typescript
// Open a modal
const modal = document.createElement("ui-modal");
modal.id = "confirm-modal";
modal.setAttribute("variant", "base");
modal.innerHTML = `
  <p>Are you sure you want to delete this item?</p>
  <ui-title-bar title="Confirm Deletion">
    <button variant="primary" onclick="handleConfirm()">Delete</button>
    <button onclick="handleCancel()">Cancel</button>
  </ui-title-bar>
`;
document.body.appendChild(modal);
document.getElementById("confirm-modal").show();
```

## Polaris

Polaris is Shopify's **React component library** for building Admin UIs. Public apps **must** use Polaris to pass App Store review. Custom apps should use it for consistency.

### Core Components

```tsx
import {
  Page,
  Card,
  Layout,
  DataTable,
  IndexTable,
  Modal,
  Banner,
  TextField,
  Select,
  Button,
  Badge,
  Thumbnail,
  EmptyState,
  SkeletonPage,
  SkeletonBodyText,
  Frame,
  Toast,
  Loading,
  FormLayout,
  InlineStack,
  BlockStack,
  Text,
  Box,
  Divider,
} from "@shopify/polaris";
```

### Page Layout Pattern

```tsx
import { Page, Layout, Card, BlockStack, Text } from "@shopify/polaris";

export default function ProductManager() {
  return (
    <Page
      title="Product Manager"
      primaryAction={{ content: "Create product", onAction: handleCreate }}
      secondaryActions={[{ content: "Import", onAction: handleImport }]}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Products</Text>
              {/* Product list */}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Summary</Text>
              {/* Sidebar content */}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
```

### IndexTable (Bulk Actions)

```tsx
import { IndexTable, Badge, Text, useIndexResourceState } from "@shopify/polaris";

function OrderList({ orders }) {
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(orders);

  const rowMarkup = orders.map((order, index) => (
    <IndexTable.Row
      id={order.id}
      key={order.id}
      selected={selectedResources.includes(order.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold">{order.name}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{order.customer}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={order.status === "paid" ? "success" : "warning"}>
          {order.status}
        </Badge>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <IndexTable
      resourceName={{ singular: "order", plural: "orders" }}
      itemCount={orders.length}
      selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
      onSelectionChange={handleSelectionChange}
      headings={[
        { title: "Order" },
        { title: "Customer" },
        { title: "Status" },
      ]}
      bulkActions={[
        { content: "Mark as fulfilled", onAction: () => handleBulkFulfill(selectedResources) },
      ]}
    >
      {rowMarkup}
    </IndexTable>
  );
}
```

### Empty State

```tsx
import { EmptyState } from "@shopify/polaris";

<EmptyState
  heading="No products yet"
  action={{ content: "Create product", onAction: handleCreate }}
  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
>
  <p>Create your first product to get started.</p>
</EmptyState>
```

## Authentication

### Session Tokens (JWT)

Embedded apps use **session tokens** instead of cookies. The Shopify Admin provides a JWT that your app backend validates.

```typescript
// Remix loader — session token is verified automatically by the Shopify Remix template
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);

  // session.shop — the shop domain
  // admin — authenticated Admin API client
  const response = await admin.graphql(`
    query {
      shop { name }
    }
  `);

  return json(await response.json());
}
```

### OAuth Flow

For initial app installation, Shopify uses OAuth 2.0:

1. Merchant clicks "Install" -- Shopify redirects to your app with a `shop` parameter
2. App redirects to Shopify's OAuth authorization page with requested scopes
3. Merchant approves -- Shopify redirects back with an authorization `code`
4. App exchanges the `code` for an access token via POST to `/admin/oauth/access_token`
5. App stores the access token securely for future API calls

The Shopify Remix template handles this entire flow automatically via `shopify.server.ts`.

### Scopes

Request only the scopes your app needs:

```
read_products        write_products
read_orders          write_orders
read_customers       write_customers
read_inventory       write_inventory
read_fulfillments    write_fulfillments
read_shipping        write_shipping
```

## App Proxy

App Proxy routes requests from the storefront through Shopify to your app backend, making your endpoints available under the shop's domain.

### Configuration

Set up in Shopify Admin > App > App Proxy:
- **Sub path prefix:** `apps`, `community`, `tools`
- **Sub path:** your-app-path
- **Proxy URL:** `https://your-app.example.com/api/proxy`

This makes `https://shop.myshopify.com/apps/your-app-path/*` proxy to your server.

### HMAC Signature Verification

**Always verify** the HMAC signature on proxy requests:

```typescript
import crypto from "crypto";

function verifyAppProxy(query: Record<string, string>, secret: string): boolean {
  const { signature, ...params } = query;
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("");

  const calculatedSignature = crypto
    .createHmac("sha256", secret)
    .update(sortedParams)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(calculatedSignature),
    Buffer.from(signature),
  );
}
```

### Response Formats

App Proxy supports multiple response types:
- **Liquid:** Return `Content-Type: application/liquid` to render Liquid templates in the storefront theme
- **JSON:** Return `Content-Type: application/json` for AJAX requests
- **HTML:** Return raw HTML (not rendered within the theme)

## Theme App Extensions

Theme App Extensions let your app inject UI into the merchant's theme **without editing theme code**.

### App Blocks (Sections)

App Blocks appear as sections in the theme editor. Merchants drag and drop them.

```liquid
{%- comment -%} blocks/product-reviews.liquid {%- endcomment -%}

<div class="product-reviews" {{ block.shopify_attributes }}>
  <h3>{{ block.settings.heading | default: "Customer Reviews" }}</h3>
  <div id="reviews-container" data-product-id="{{ product.id }}"></div>
</div>

{% schema %}
{
  "name": "Product Reviews",
  "target": "section",
  "settings": [
    {
      "type": "text",
      "id": "heading",
      "label": "Heading",
      "default": "Customer Reviews"
    },
    {
      "type": "range",
      "id": "reviews_count",
      "label": "Number of reviews",
      "min": 1,
      "max": 10,
      "default": 5
    }
  ]
}
{% endschema %}
```

### App Embeds

App Embeds are **floating/global** elements (chat widgets, announcement bars, analytics scripts) that merchants toggle on/off in the theme editor.

```liquid
{%- comment -%} blocks/chat-widget.liquid {%- endcomment -%}

<div id="chat-widget" data-api-key="{{ block.settings.api_key }}"></div>

{%- if block.settings.enabled -%}
  <script src="{{ 'chat-widget.js' | asset_url }}" defer></script>
{%- endif -%}

{% schema %}
{
  "name": "Chat Widget",
  "target": "body",
  "settings": [
    {
      "type": "text",
      "id": "api_key",
      "label": "API Key"
    },
    {
      "type": "checkbox",
      "id": "enabled",
      "label": "Enable chat widget",
      "default": true
    }
  ]
}
{% endschema %}
```

## Billing API

The Billing API manages app charges -- subscriptions, usage-based billing, and one-time purchases.

### Subscription (Recurring)

```graphql
mutation appSubscriptionCreate {
  appSubscriptionCreate(
    name: "Pro Plan"
    returnUrl: "https://your-app.example.com/billing/callback"
    test: true
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: { amount: 29.99, currencyCode: USD }
            interval: EVERY_30_DAYS
          }
        }
      }
    ]
  ) {
    appSubscription { id }
    confirmationUrl
    userErrors { field message }
  }
}
```

### Usage-Based Billing

```graphql
# First: create a subscription with usage terms
mutation appSubscriptionCreate {
  appSubscriptionCreate(
    name: "Usage Plan"
    returnUrl: "https://your-app.example.com/billing/callback"
    test: true
    lineItems: [
      {
        plan: {
          appUsagePricingDetails: {
            terms: "$0.01 per API call"
            cappedAmount: { amount: 100.00, currencyCode: USD }
          }
        }
      }
    ]
  ) {
    appSubscription { id }
    confirmationUrl
    userErrors { field message }
  }
}

# Then: record usage
mutation appUsageRecordCreate {
  appUsageRecordCreate(
    subscriptionLineItemId: "gid://shopify/AppSubscriptionLineItem/123"
    price: { amount: 0.50, currencyCode: USD }
    description: "50 API calls"
  ) {
    appUsageRecord { id }
    userErrors { field message }
  }
}
```

### One-Time Purchase

```graphql
mutation appPurchaseOneTimeCreate {
  appPurchaseOneTimeCreate(
    name: "Premium Feature Unlock"
    price: { amount: 49.99, currencyCode: USD }
    returnUrl: "https://your-app.example.com/billing/callback"
    test: true
  ) {
    appPurchaseOneTime { id }
    confirmationUrl
    userErrors { field message }
  }
}
```

**Always use `test: true` during development.** Remove it only for production billing.

## Webhooks

Apps must handle critical webhooks. The `app/uninstalled` webhook is mandatory.

### Mandatory Webhooks

```toml
# shopify.app.toml
[webhooks]
api_version = "2024-10"

  [[webhooks.subscriptions]]
  topics = ["app/uninstalled"]
  uri = "/api/webhooks"

  [[webhooks.subscriptions]]
  topics = ["customers/data_request", "customers/redact", "shop/redact"]
  uri = "/api/webhooks"
```

### Webhook Handler (Remix)

```typescript
import { authenticate } from "../shopify.server";
import db from "../db.server";

export async function action({ request }) {
  const { topic, shop, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "APP_UNINSTALLED":
      await db.session.deleteMany({ where: { shop } });
      break;
    case "CUSTOMERS_DATA_REQUEST":
      // Return customer data for GDPR compliance
      break;
    case "CUSTOMERS_REDACT":
      // Delete customer data for GDPR compliance
      break;
    case "SHOP_REDACT":
      // Delete shop data 48h after uninstall
      break;
  }

  return new Response();
}
```

## Anti-Patterns

- **Never ignore session tokens** -- always validate the JWT on every request. Skipping auth opens your app to CSRF and unauthorized access
- **Never use non-Polaris UI in public apps** -- App Store review will reject apps that do not use Polaris for the admin interface
- **Never expose OAuth secrets client-side** -- the API secret must stay server-side. Only the API key (client ID) is public
- **Never skip the `app/uninstalled` webhook** -- your app must clean up session data when uninstalled. Failing this causes broken reinstalls
- **Never hardcode the shop domain** -- always read it from the session or auth context
- **Never store access tokens in plaintext** -- encrypt at rest, use environment variables for secrets
- **Never use `include` in theme app extensions** -- use `render` (same Liquid rules as themes)
- **Never make synchronous API calls in bulk** -- use GraphQL bulk operations or paginate with cursor-based pagination

## Verify

- [ ] App starts correctly via `shopify app dev`
- [ ] OAuth installation flow completes without errors
- [ ] Session tokens are validated on every authenticated request
- [ ] `app/uninstalled` webhook handler cleans up stored data
- [ ] GDPR webhooks (data request, redact) are handled
- [ ] App Proxy endpoints verify HMAC signatures
- [ ] Theme App Extensions render correctly in the theme editor
- [ ] Polaris components follow Shopify Admin design patterns
- [ ] Billing mutations use `test: true` in development
- [ ] App deployed successfully via `shopify app deploy`

## Typical Tickets

| Ticket | Approach |
|--------|----------|
| New app scaffold | `shopify app init`, choose Remix template, configure `shopify.app.toml` with scopes |
| Admin interface (settings page) | Polaris `Page`, `Layout`, `Card`, `FormLayout`, `TextField`, `Select`, save via Admin API |
| Theme app extension (product widget) | App Block in `extensions/`, Liquid template with schema, JS/CSS assets |
| Webhook handler (order created) | Add topic to `shopify.app.toml`, implement handler in webhooks route, validate payload |
| Billing setup | `appSubscriptionCreate` mutation, handle confirmation URL redirect, verify subscription status |
| App proxy endpoint | Configure sub path in admin, implement route with HMAC verification, return Liquid or JSON |
| Storefront integration | Theme App Extension (App Block or App Embed) + App Proxy for dynamic data |
| Bulk data export | GraphQL `bulkOperationRunQuery`, poll for completion, download JSONL result |
