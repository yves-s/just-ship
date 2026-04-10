---
name: shopify-admin-api
description: Use when working with Shopify's Admin API for backend operations — products, orders, customers, inventory, metafields, webhooks, and bulk operations. Covers GraphQL and REST endpoints, authentication, rate limits, and data migration patterns.
triggers:
  - shopify
  - admin-api
  - graphql
  - products
  - orders
  - webhooks
---

# Shopify Admin API

**Announce at start:** "Reading existing Admin API integrations and webhook handlers before writing backend code."

Before writing Admin API code, check the project for existing API clients, authentication patterns, and webhook handlers. Understand which API version the project targets and whether it uses the official Shopify API library (`@shopify/shopify-api`).

## GraphQL vs REST

| | GraphQL Admin API | REST Admin API |
|---|---|---|
| Status | **Primary** — use for all new work | Legacy — use only when required |
| Endpoint | `https://{store}.myshopify.com/admin/api/{version}/graphql.json` | `https://{store}.myshopify.com/admin/api/{version}/{resource}.json` |
| Strengths | Precise field selection, mutations, bulk operations | Webhook registration, simple CRUD, some resources not yet in GraphQL |
| Rate Limits | Calculated query cost (1000 points) | Leaky bucket (40 requests) |

**Rule:** Default to GraphQL. Only fall back to REST for webhook CRUD, resources missing from GraphQL, or when working with legacy code that already uses REST.

## Authentication

### Custom Apps (OAuth)

Used for public apps and custom apps installed via the Shopify admin.

```typescript
// OAuth flow produces an access token per shop
const headers = {
  'Content-Type': 'application/json',
  'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
};
```

The access token is scoped — it only has permissions for the scopes requested during installation (e.g., `read_products`, `write_orders`).

### Private Apps (API Key + Password)

Deprecated for new apps but still used in some existing integrations.

```typescript
// HTTP Basic Auth
const credentials = Buffer.from(
  `${process.env.SHOPIFY_API_KEY}:${process.env.SHOPIFY_API_PASSWORD}`
).toString('base64');

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Basic ${credentials}`,
};
```

**Never expose these credentials client-side.** All Admin API calls must happen server-to-server.

## API Versioning

Same CalVer scheme as Storefront API: `YYYY-MM` quarterly releases.

```
https://{store}.myshopify.com/admin/api/2026-01/graphql.json
```

- Pin to a stable version
- Monitor the `X-Shopify-API-Deprecated-Reason` response header
- Migrate before a version is sunset (12 months after release)

## Rate Limits

### REST — Leaky Bucket

| Parameter | Value |
|---|---|
| Bucket size | 40 requests |
| Leak (refill) rate | 2 requests/second |
| Response when exceeded | `429 Too Many Requests` with `Retry-After` header |

Check remaining capacity via response headers:

```
X-Shopify-Shop-Api-Call-Limit: 32/40
```

### GraphQL — Calculated Query Cost

| Parameter | Value |
|---|---|
| Max available points | 1000 |
| Restore rate | 50 points/second |

Every GraphQL response includes cost information:

```json
{
  "extensions": {
    "cost": {
      "requestedQueryCost": 112,
      "actualQueryCost": 108,
      "throttleStatus": {
        "maximumAvailable": 1000.0,
        "currentlyAvailable": 892.0,
        "restoreRate": 50.0
      }
    }
  }
}
```

**Throttle handling pattern:**

```typescript
async function adminQuery(query: string, variables: Record<string, unknown>) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 429) {
    const retryAfter = parseFloat(response.headers.get('Retry-After') ?? '2');
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return adminQuery(query, variables); // Retry once
  }

  const json = await response.json();

  if (json.errors?.some((e: { extensions?: { code: string } }) =>
    e.extensions?.code === 'THROTTLED'
  )) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return adminQuery(query, variables);
  }

  return json.data;
}
```

## Key Mutations

### Product Create / Update

```graphql
mutation ProductCreate($input: ProductInput!, $media: [CreateMediaInput!]) {
  productCreate(input: $input, media: $media) {
    product {
      id
      title
      handle
      status
      variants(first: 10) {
        nodes {
          id
          title
          price
          sku
          inventoryQuantity
        }
      }
    }
    userErrors {
      field
      message
      code
    }
  }
}
```

```graphql
mutation ProductUpdate($input: ProductInput!) {
  productUpdate(input: $input) {
    product {
      id
      title
      updatedAt
    }
    userErrors { field message code }
  }
}
```

**Note:** `ProductInput` uses the product's GID (`gid://shopify/Product/123`) as `id` for updates.

### Customer Create / Update

```graphql
mutation CustomerCreate($input: CustomerInput!) {
  customerCreate(input: $input) {
    customer {
      id
      email
      firstName
      lastName
      tags
    }
    userErrors { field message code }
  }
}

mutation CustomerUpdate($input: CustomerInput!) {
  customerUpdate(input: $input) {
    customer {
      id
      email
      tags
    }
    userErrors { field message code }
  }
}
```

### Inventory Adjustment

```graphql
mutation InventoryAdjust($input: InventoryAdjustQuantitiesInput!) {
  inventoryAdjustQuantities(input: $input) {
    inventoryAdjustmentGroup {
      reason
      changes {
        name
        delta
        quantityAfterChange
      }
    }
    userErrors { field message code }
  }
}
```

Variables:

```json
{
  "input": {
    "reason": "correction",
    "name": "available",
    "changes": [
      {
        "inventoryItemId": "gid://shopify/InventoryItem/123",
        "locationId": "gid://shopify/Location/456",
        "delta": -5
      }
    ]
  }
}
```

### Metafields Set

```graphql
mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields {
      id
      namespace
      key
      value
      type
    }
    userErrors { field message code }
  }
}
```

Variables:

```json
{
  "metafields": [
    {
      "ownerId": "gid://shopify/Product/123",
      "namespace": "custom",
      "key": "care_instructions",
      "type": "multi_line_text_field",
      "value": "Machine wash cold.\nTumble dry low."
    },
    {
      "ownerId": "gid://shopify/Product/123",
      "namespace": "custom",
      "key": "fabric_weight",
      "type": "number_integer",
      "value": "180"
    }
  ]
}
```

`metafieldsSet` is idempotent — it creates or updates based on `ownerId` + `namespace` + `key`.

## Webhooks

### Event Subscriptions

Register webhooks via GraphQL:

```graphql
mutation WebhookCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
    webhookSubscription {
      id
      topic
      endpoint {
        ... on WebhookHttpEndpoint {
          callbackUrl
        }
      }
    }
    userErrors { field message code }
  }
}
```

Variables:

```json
{
  "topic": "ORDERS_CREATE",
  "webhookSubscription": {
    "callbackUrl": "https://your-app.com/webhooks/orders/create",
    "format": "JSON"
  }
}
```

Common topics: `ORDERS_CREATE`, `ORDERS_UPDATED`, `PRODUCTS_UPDATE`, `PRODUCTS_CREATE`, `PRODUCTS_DELETE`, `CUSTOMERS_CREATE`, `CUSTOMERS_UPDATE`, `INVENTORY_LEVELS_UPDATE`, `APP_UNINSTALLED`.

### HMAC-SHA256 Verification

Every webhook must be verified before processing. Shopify signs payloads with the app's shared secret.

```typescript
import crypto from 'crypto';

function verifyWebhook(
  rawBody: string | Buffer,
  hmacHeader: string,
  secret: string
): boolean {
  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(digest),
    Buffer.from(hmacHeader)
  );
}

// In handler
export async function handleWebhook(request: Request) {
  const hmac = request.headers.get('X-Shopify-Hmac-Sha256');
  const rawBody = await request.text();

  if (!hmac || !verifyWebhook(rawBody, hmac, process.env.SHOPIFY_WEBHOOK_SECRET!)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const topic = request.headers.get('X-Shopify-Topic');

  // Process webhook...
  return new Response('OK', { status: 200 });
}
```

**Always use `crypto.timingSafeEqual`** — string comparison (`===`) is vulnerable to timing attacks.

### Mandatory Webhooks

Every Shopify app **must** handle these GDPR/privacy webhooks:

| Topic | Purpose | Action |
|---|---|---|
| `customers/data_request` | Customer requests their data | Return all stored data for that customer |
| `customers/redact` | Customer requests deletion | Delete all stored data for that customer |
| `shop/redact` | Store uninstalls app (48h after) | Delete all stored data for that shop |

These are required for app review. Even if you store no customer data, you must respond with `200 OK`.

## Bulk Operations

For large datasets (exporting all products, updating thousands of records), use Bulk Operations instead of paginated queries.

### Running a Bulk Query

```graphql
mutation BulkOperationRunQuery($query: String!) {
  bulkOperationRunQuery(query: $query) {
    bulkOperation {
      id
      status
      url
    }
    userErrors { field message code }
  }
}
```

The `query` variable is a standalone GraphQL query string:

```json
{
  "query": "{ products { edges { node { id title handle variants { edges { node { id sku price } } } } } } }"
}
```

**Note:** Bulk queries use `edges/node` pagination syntax internally. Do not include `first`, `after`, or pagination variables — Shopify iterates automatically.

### Polling for Completion

```graphql
query BulkOperationStatus {
  currentBulkOperation {
    id
    status
    errorCode
    objectCount
    fileSize
    url
    createdAt
    completedAt
  }
}
```

Poll every 5-10 seconds. Statuses: `CREATED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELED`.

### Download and Process Results

Bulk operations produce a **JSONL** file (one JSON object per line):

```typescript
async function processBulkResults(url: string) {
  const response = await fetch(url);
  const text = await response.text();
  const lines = text.trim().split('\n');

  const results = lines.map((line) => JSON.parse(line));

  // Parent-child relationships use __parentId
  const products = results.filter((r) => !r.__parentId);
  const variants = results.filter((r) => r.__parentId);

  for (const variant of variants) {
    const parent = products.find((p) => p.id === variant.__parentId);
    if (parent) {
      parent.variants = parent.variants || [];
      parent.variants.push(variant);
    }
  }

  return products;
}
```

**Constraints:**
- Only **one bulk operation** can run per shop at a time
- Results are available for **24 hours** after completion
- No variables — the query must be self-contained
- Nested connections use `__parentId` to link children to parents in the JSONL output

## Anti-Patterns

- **REST for new features** — always use GraphQL Admin API unless the resource is REST-only; GraphQL has better rate limits and field selection
- **Looping single API calls** when bulk operations are available — exporting 10,000 products one-by-one wastes rate limit budget and takes hours; use `bulkOperationRunQuery`
- **Skipping HMAC verification** on webhooks — any publicly accessible webhook endpoint without verification can be spoofed; always verify with `timingSafeEqual`
- **Exposing Admin API credentials client-side** — Admin tokens have full read/write access to the store; they must only exist in server environments
- **Ignoring `userErrors`** — Admin API mutations return `userErrors` even on `200 OK` responses; a successful HTTP status does not mean the operation succeeded
- **Hardcoding GIDs** — Global IDs like `gid://shopify/Product/123` differ between stores and environments; always query for them dynamically
- **Not handling rate limit responses** — both `429` HTTP status and GraphQL `THROTTLED` errors must trigger retry logic with backoff
- **Running multiple bulk operations** — only one can run at a time per shop; check `currentBulkOperation` status before starting a new one
- **Webhook handlers that take too long** — Shopify expects a response within 5 seconds; offload heavy processing to a background queue
- **Not implementing mandatory webhooks** — missing `customers/data_request`, `customers/redact`, or `shop/redact` will cause app review rejection

## Data Migration Pattern

For migrating data into Shopify (e.g., from another platform):

```typescript
async function migrateProducts(products: ExternalProduct[]) {
  const results = { success: 0, failed: 0, errors: [] as string[] };

  // Batch in groups to respect rate limits
  const BATCH_SIZE = 10;
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);

    const mutations = batch.map((product) =>
      adminQuery(PRODUCT_CREATE_MUTATION, {
        input: {
          title: product.name,
          bodyHtml: product.description,
          vendor: product.brand,
          productType: product.category,
          tags: product.tags,
          status: 'DRAFT', // Always create as draft first
          variants: product.variants.map((v) => ({
            price: v.price.toString(),
            sku: v.sku,
            inventoryQuantity: v.stock,
            options: [v.size, v.color].filter(Boolean),
          })),
        },
      })
    );

    const responses = await Promise.allSettled(mutations);

    for (const response of responses) {
      if (response.status === 'fulfilled' && !response.value?.userErrors?.length) {
        results.success++;
      } else {
        results.failed++;
        const error = response.status === 'rejected'
          ? response.reason.message
          : response.value?.userErrors?.map((e: { message: string }) => e.message).join(', ');
        results.errors.push(error);
      }
    }

    // Respect rate limits between batches
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return results;
}
```

**Rules for migrations:**
- Always create products as `DRAFT` first, activate after verification
- Log every error with the source product identifier for debugging
- Process in batches with delays between them
- Use bulk operations for exports, paginated mutations for imports
- Validate data before sending (required fields, value constraints)

## Typical Tickets

| Ticket | Key Patterns |
|---|---|
| Data migration (import products) | Batch `productCreate` mutations, `DRAFT` status, error logging, rate limit handling |
| Webhook handler (orders/create) | HMAC verification, parse payload, offload to queue, respond within 5 seconds |
| Inventory management | `inventoryAdjustQuantities` mutation, location-aware stock levels, delta-based adjustments |
| Metafield setup via API | `metafieldsSet` mutation with `ownerId`, idempotent upsert, define types in metafield definition first |
| Bulk export (all orders) | `bulkOperationRunQuery`, poll `currentBulkOperation`, download JSONL, process `__parentId` relationships |
| Customer data sync | `customerCreate` / `customerUpdate`, tag-based segmentation, handle `customers/redact` for GDPR |
| Product status management | `productUpdate` with `status: ACTIVE/DRAFT/ARCHIVED`, batch updates via bulk mutation |

## Verify

- [ ] All Admin API calls use GraphQL unless REST is specifically required
- [ ] Credentials are stored in environment variables, never in code
- [ ] API version is pinned to a supported CalVer release
- [ ] Rate limit handling is implemented (retry on `429` and `THROTTLED`)
- [ ] `userErrors` are checked on every mutation response
- [ ] Webhook endpoints verify HMAC-SHA256 signature with `timingSafeEqual`
- [ ] Mandatory webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) are implemented
- [ ] Bulk operations check `currentBulkOperation` status before starting
- [ ] No Admin API credentials are exposed in client-side code
- [ ] Migrations create resources as `DRAFT` first, activate after verification
