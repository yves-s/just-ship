---
name: shopify-storefront-api
description: Use when building custom storefronts, data fetching, or working with Shopify's GraphQL Storefront API. Covers queries, mutations, pagination, authentication, caching, and rate limits. Load for Hydrogen projects, headless builds, or any code that fetches products/collections/cart data from Shopify.
---

# Shopify Storefront API

**Announce at start:** "Reading Storefront API usage patterns before writing queries or mutations."

Before writing any Storefront API code, check the project's existing GraphQL queries/fragments to understand naming conventions, fragment reuse, and API version in use.

## Endpoint & Authentication

### GraphQL Endpoint

```
https://{store}.myshopify.com/api/{version}/graphql.json
```

Example: `https://my-store.myshopify.com/api/2026-01/graphql.json`

### Access Tokens

| Token Type | Header | Visibility | Use Case |
|---|---|---|---|
| Public (Storefront) | `X-Shopify-Storefront-Access-Token` | Safe for client-side | Browser fetches, Hydrogen, mobile apps |
| Private (Server) | `Shopify-Storefront-Private-Token` | Server-only | SSR, server components, API routes |

**Private tokens** unlock additional fields (e.g., customer data, draft orders) and have higher rate limits. They must never be exposed to the browser.

```typescript
// Server-side fetch
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Shopify-Storefront-Private-Token': process.env.PRIVATE_STOREFRONT_TOKEN,
  },
  body: JSON.stringify({ query, variables }),
});
```

## API Versioning

Shopify uses **calendar versioning** (CalVer): `YYYY-MM` with quarterly releases.

| Version | Status | Notes |
|---|---|---|
| `2026-04` | Latest | Current stable release |
| `2026-01` | Supported | Previous quarter |
| `2025-10` | Supported | Two quarters back |
| `2025-07` | Deprecated | Will be removed |
| `unstable` | Preview | Breaking changes at any time |

**Rules:**
- Always pin to a **stable** version, never `unstable` in production
- Migrate within **12 months** of a version's release before it is removed
- Read the changelog for each version bump — fields get renamed, types change, enums get removed
- Set up a calendar reminder to check for deprecations quarterly

## Key Queries

### Products

```graphql
query Products($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      title
      handle
      description
      priceRange {
        minVariantPrice {
          amount
          currencyCode
        }
      }
      featuredImage {
        url
        altText
        width
        height
      }
      variants(first: 10) {
        nodes {
          id
          title
          availableForSale
          price {
            amount
            currencyCode
          }
          selectedOptions {
            name
            value
          }
        }
      }
    }
  }
}
```

### Single Product by Handle

```graphql
query ProductByHandle($handle: String!) {
  product(handle: $handle) {
    id
    title
    descriptionHtml
    seo {
      title
      description
    }
    variants(first: 100) {
      nodes {
        id
        title
        availableForSale
        price { amount currencyCode }
        compareAtPrice { amount currencyCode }
        selectedOptions { name value }
        image { url altText width height }
      }
    }
    options {
      name
      optionValues {
        name
        swatch { color image { previewImage { url } } }
      }
    }
    media(first: 20) {
      nodes {
        __typename
        ... on MediaImage {
          image { url altText width height }
        }
        ... on Video {
          sources { url mimeType }
        }
      }
    }
    metafields(identifiers: [
      { namespace: "custom", key: "care_instructions" }
    ]) {
      key
      value
      type
    }
  }
}
```

### Collections

```graphql
query Collection($handle: String!, $first: Int!, $filters: [ProductFilter!]) {
  collection(handle: $handle) {
    id
    title
    description
    products(first: $first, filters: $filters, sortKey: BEST_SELLING) {
      pageInfo { hasNextPage endCursor }
      filters {
        id
        label
        type
        values { id label count input }
      }
      nodes {
        id
        title
        handle
        priceRange {
          minVariantPrice { amount currencyCode }
        }
        featuredImage { url altText }
      }
    }
  }
}
```

### Cart Operations

```graphql
mutation CartCreate($input: CartInput!) {
  cartCreate(input: $input) {
    cart {
      id
      checkoutUrl
      totalQuantity
      cost {
        totalAmount { amount currencyCode }
        subtotalAmount { amount currencyCode }
      }
      lines(first: 50) {
        nodes {
          id
          quantity
          merchandise {
            ... on ProductVariant {
              id
              title
              price { amount currencyCode }
              product { title handle }
              image { url altText }
            }
          }
          cost {
            totalAmount { amount currencyCode }
          }
        }
      }
    }
    userErrors { field message code }
  }
}

mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
  cartLinesAdd(cartId: $cartId, lines: $lines) {
    cart { id totalQuantity cost { totalAmount { amount currencyCode } } }
    userErrors { field message code }
  }
}

mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
  cartLinesUpdate(cartId: $cartId, lines: $lines) {
    cart { id totalQuantity }
    userErrors { field message code }
  }
}

mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
  cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
    cart { id totalQuantity }
    userErrors { field message code }
  }
}
```

### Search

```graphql
query Search($query: String!, $first: Int!, $types: [SearchType!]) {
  search(query: $query, first: $first, types: $types) {
    totalCount
    nodes {
      __typename
      ... on Product {
        id
        title
        handle
        featuredImage { url altText }
        priceRange { minVariantPrice { amount currencyCode } }
      }
      ... on Article {
        id
        title
        handle
        blog { handle }
      }
      ... on Page {
        id
        title
        handle
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

### Metaobjects

```graphql
query Metaobjects($type: String!, $first: Int!) {
  metaobjects(type: $type, first: $first) {
    nodes {
      id
      handle
      fields {
        key
        value
        type
        reference {
          ... on MediaImage {
            image { url altText }
          }
        }
      }
    }
  }
}
```

## Cursor-Based Pagination

The Storefront API uses **forward cursor pagination** exclusively.

```graphql
query PaginatedProducts($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
    nodes {
      id
      title
    }
  }
}
```

**Implementation pattern:**

```typescript
async function fetchAllProducts(storefront) {
  let allProducts = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const { products } = await storefront.query(PRODUCTS_QUERY, {
      variables: { first: 50, after: cursor },
    });

    allProducts.push(...products.nodes);
    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
  }

  return allProducts;
}
```

- Maximum `first` value: **250** per request
- Always check `pageInfo.hasNextPage` before requesting more
- Use `last` / `before` for backward pagination where supported

## Rate Limits

### Public Storefront Token (IP-based)

No calculated query cost. Rate limited per IP address. Shopify does not publish exact thresholds, but aggressive polling or scraping from a single IP will trigger `429 Too Many Requests`.

### Private Storefront Token (Calculated Cost)

| Bucket | Max | Restore Rate |
|---|---|---|
| Cost points | 1000 | 100 points/second |

Every query has a calculated cost based on the fields and connections requested. Check the `extensions` field in the response:

```json
{
  "extensions": {
    "cost": {
      "requestedQueryCost": 42,
      "actualQueryCost": 38,
      "throttleStatus": {
        "maximumAvailable": 1000,
        "currentlyAvailable": 962,
        "restoreRate": 100
      }
    }
  }
}
```

**Cost estimation formula:** Each connection multiplies its child cost by `first`. Nested connections compound. `products(first: 50) { variants(first: 10) }` = roughly 50 * 10 = 500 points.

## Multi-Currency & Localization

Use the `@inContext` directive for localized pricing and content:

```graphql
query Product($handle: String!, $country: CountryCode!, $language: LanguageCode!)
  @inContext(country: $country, language: $language) {
  product(handle: $handle) {
    title
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
    }
  }
}
```

Pass the buyer's country and language as variables. Prices automatically convert to local currency based on the store's Markets configuration.

## Anti-Patterns

- **Loading all products at once** — max `first` is 250; for full catalogs, paginate in batches of 50-100
- **Using deprecated API versions** — queries may silently return incomplete data or fail; pin to a supported version and migrate quarterly
- **Exposing private tokens client-side** — private Storefront tokens in browser JS give attackers access to customer data and elevated rate limits
- **Nesting more than 3 connections** — `products > variants > metafields > references` causes exponential cost blowup; flatten queries or split into multiple requests
- **Ignoring `userErrors` on mutations** — cart mutations return `userErrors` alongside `cart`; always check the errors array before treating the operation as successful
- **Hardcoding currency/locale** — use `@inContext` and read from the buyer's session; never assume USD or English
- **Polling for cart updates** — use mutation responses directly; each mutation returns the updated cart state
- **Fetching fields you don't use** — every field adds to query cost; only request what the UI renders

## Typical Tickets

| Ticket | Key Patterns |
|---|---|
| Custom product page | `product(handle:)` query, variant selector, media gallery, metafields for extra data |
| Cart functionality | `cartCreate`, `cartLinesAdd`, `cartLinesUpdate`, `cartLinesRemove`, persist `cartId` in cookie/localStorage |
| Search with filters | `search()` query with `types` filter, predictive search for autocomplete |
| Collection filtering | `collection.products(filters:)` with `ProductFilter` input, read available filters from `filters` field |
| Multi-currency storefront | `@inContext(country:)` directive, `Money` component formatting, Markets configuration |
| Metaobject-driven pages | `metaobjects(type:)` query for custom content types like FAQs, store locators, lookbooks |
| Predictive search | `predictiveSearch` query with `types` for instant results as user types |

## Verify

- [ ] GraphQL queries return expected data shape (test in Shopify GraphiQL app)
- [ ] API version is pinned to a supported CalVer release (not `unstable`)
- [ ] Private tokens are only used server-side, never in client bundles
- [ ] Pagination uses cursor-based pattern with `pageInfo` checks
- [ ] `userErrors` are checked on every mutation response
- [ ] Query cost stays under budget (check `extensions.cost` in responses)
- [ ] `@inContext` is used for multi-currency/multi-language stores
