---
name: shopify-hydrogen
description: Use when building or modifying Shopify Hydrogen storefronts. Covers React Router (ex-Remix) patterns, Hydrogen-specific hooks and components, SSR/streaming, caching strategies, Oxygen deployment, and route patterns. Load whenever working in a Hydrogen project.
---

# Shopify Hydrogen

**Announce at start:** "Reading existing routes and Hydrogen patterns before writing components."

Before writing any Hydrogen code, read 2-3 existing route files and the project's `server.ts` / `app/root.tsx` to understand the store's conventions: data loading patterns, caching strategy, component library, and i18n approach.

## Framework Overview

Hydrogen is Shopify's headless commerce framework built on:

- **React Router v7** (formerly Remix) for routing, data loading, and SSR
- **Storefront API** (GraphQL) for all commerce data
- **Oxygen** for edge deployment (Shopify's hosting platform)

The mental model: React Router handles the web framework concerns (routing, streaming, forms), Hydrogen adds commerce-specific components and utilities, Storefront API provides the data.

## Project Structure

```
app/
  root.tsx                  # Root layout, global providers
  entry.server.tsx          # Server entry, streaming setup
  entry.client.tsx          # Client hydration
  routes/
    ($locale)._index.tsx    # Homepage
    ($locale).products.$handle.tsx    # Product detail page
    ($locale).collections._index.tsx  # All collections
    ($locale).collections.$handle.tsx # Single collection
    ($locale).pages.$handle.tsx       # CMS pages
    ($locale).blogs.$blogHandle.$articleHandle.tsx  # Blog articles
    cart.tsx                # Cart page
    search.tsx              # Search results
    account.tsx             # Customer account
    [sitemap.xml].tsx       # Dynamic sitemap
    [robots.txt].tsx        # Robots.txt
  components/               # Shared components
  lib/
    fragments.ts            # Reusable GraphQL fragments
    utils.ts                # Helpers
server.ts                   # Hydrogen server setup
```

### Route Naming Conventions

| Pattern | Meaning |
|---|---|
| `($locale)` | Optional locale prefix segment (e.g., `/en-us/products/...`) |
| `$handle` | Dynamic segment matched from URL |
| `_index` | Index route (renders at parent path) |
| `[sitemap.xml]` | Escaped dot — creates literal `/sitemap.xml` route |
| `_` prefix on segment | Pathless layout route (groups without adding URL segment) |

## Server Setup — createStorefrontClient

```typescript
// server.ts
import { createStorefrontClient, storefrontRedirect } from '@shopify/hydrogen';
import { createRequestHandler } from '@shopify/remix-oxygen';

export default {
  async fetch(request, env, executionContext) {
    const { storefront } = createStorefrontClient({
      privateStorefrontToken: env.PRIVATE_STOREFRONT_API_TOKEN,
      publicStorefrontToken: env.PUBLIC_STOREFRONT_API_TOKEN,
      storeDomain: env.PUBLIC_STORE_DOMAIN,
      storefrontId: env.PUBLIC_STOREFRONT_ID,
      storefrontApiVersion: '2026-01',
    });

    const handleRequest = createRequestHandler({
      build: remixBuild,
      mode: process.env.NODE_ENV,
      getLoadContext: () => ({
        storefront,
        env,
        waitUntil: executionContext.waitUntil.bind(executionContext),
      }),
    });

    const response = await handleRequest(request);

    if (response.status === 404) {
      return storefrontRedirect({ request, response, storefront });
    }

    return response;
  },
};
```

## Data Loading

Use React Router's `loader` function for all data fetching. Never use `useEffect` for initial data.

```typescript
// app/routes/($locale).products.$handle.tsx
import { type LoaderFunctionArgs } from '@shopify/remix-oxygen';
import { useLoaderData } from 'react-router';

export async function loader({ params, context }: LoaderFunctionArgs) {
  const { handle } = params;

  if (!handle) {
    throw new Response('Product handle missing', { status: 400 });
  }

  const { product } = await context.storefront.query(PRODUCT_QUERY, {
    variables: { handle },
    cache: context.storefront.CacheShort(),
  });

  if (!product) {
    throw new Response('Product not found', { status: 404 });
  }

  return { product };
}

export default function ProductPage() {
  const { product } = useLoaderData<typeof loader>();
  return <ProductDetail product={product} />;
}
```

### Deferred Data with Await

For non-critical data that should not block the initial render:

```typescript
import { defer } from '@shopify/remix-oxygen';
import { Await } from '@shopify/hydrogen';
import { Suspense } from 'react';

export async function loader({ context }: LoaderFunctionArgs) {
  const criticalData = await context.storefront.query(HERO_QUERY);
  const recommendations = context.storefront.query(RECOMMENDATIONS_QUERY);

  return defer({
    hero: criticalData,
    recommendations, // Not awaited — streams in later
  });
}

export default function Homepage() {
  const { hero, recommendations } = useLoaderData<typeof loader>();

  return (
    <>
      <HeroBanner data={hero} />
      <Suspense fallback={<ProductGridSkeleton />}>
        <Await resolve={recommendations}>
          {(data) => <RecommendedProducts products={data.products} />}
        </Await>
      </Suspense>
    </>
  );
}
```

## Hydrogen Components

### Money — Currency Formatting

```tsx
import { Money } from '@shopify/hydrogen';

<Money data={product.priceRange.minVariantPrice} />
// Renders: $29.99

<Money data={price} as="span" withoutTrailingZeros />
// Renders: <span>$30</span>
```

Never format currency manually. `Money` handles locale, currency symbol placement, and decimal conventions.

### Image — Optimized Images

```tsx
import { Image } from '@shopify/hydrogen';

<Image
  data={product.featuredImage}
  aspectRatio="1/1"
  sizes="(min-width: 768px) 50vw, 100vw"
/>
```

Automatically generates `srcset` for responsive images, handles lazy loading, and uses Shopify's CDN transforms.

### CartForm — Cart Mutations

```tsx
import { CartForm } from '@shopify/hydrogen';

function AddToCartButton({ variantId, quantity = 1 }) {
  return (
    <CartForm
      route="/cart"
      action={CartForm.ACTIONS.LinesAdd}
      inputs={{ lines: [{ merchandiseId: variantId, quantity }] }}
    >
      <button type="submit">Add to Cart</button>
    </CartForm>
  );
}
```

`CartForm` handles optimistic UI, error states, and server-side cart mutations. Always use it instead of manual fetch calls for cart operations.

### Pagination

```tsx
import { Pagination, getPaginationVariables } from '@shopify/hydrogen';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const paginationVariables = getPaginationVariables(request, { pageBy: 12 });

  const { collection } = await context.storefront.query(COLLECTION_QUERY, {
    variables: { handle: 'all', ...paginationVariables },
  });

  return { collection };
}

export default function CollectionPage() {
  const { collection } = useLoaderData<typeof loader>();

  return (
    <Pagination connection={collection.products}>
      {({ nodes, NextLink, PreviousLink, isLoading }) => (
        <>
          <PreviousLink>Load previous</PreviousLink>
          <div className="product-grid">
            {nodes.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
          <NextLink>Load more</NextLink>
        </>
      )}
    </Pagination>
  );
}
```

### ShopPayButton

```tsx
import { ShopPayButton } from '@shopify/hydrogen';

<ShopPayButton
  variantIds={[selectedVariant.id]}
  storeDomain={shop.primaryDomain.url}
/>
```

## Caching Strategies

Hydrogen provides built-in caching helpers for the Storefront API responses:

| Strategy | TTL | Stale-While-Revalidate | Use For |
|---|---|---|---|
| `CacheShort()` | 1 second | 60 seconds | Product pages, cart, search results |
| `CacheLong()` | 1 hour | 86400 seconds (1 day) | Collections index, navigation, footer |
| `CacheNone()` | No cache | — | Personalized content, account pages |
| `CacheCustom(options)` | Custom | Custom | Fine-tuned caching |

```typescript
// In loader
const { product } = await context.storefront.query(PRODUCT_QUERY, {
  variables: { handle },
  cache: context.storefront.CacheShort(),
});

// Custom cache
const { menu } = await context.storefront.query(MENU_QUERY, {
  cache: context.storefront.CacheCustom({
    mode: 'public',
    maxAge: 300,        // 5 minutes
    staleWhileRevalidate: 3600,  // 1 hour
  }),
});
```

**Rules:**
- `CacheNone()` for anything user-specific (account, wishlists, personalized recommendations)
- `CacheShort()` for product data (prices change, inventory updates)
- `CacheLong()` for structural data (menus, policies, blog articles)
- Never cache cart data — it is inherently per-session

## SEO

```typescript
// In any route
import { type MetaFunction } from '@shopify/remix-oxygen';
import { getSeoMeta } from '@shopify/hydrogen';

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return getSeoMeta({
    title: data?.product?.seo?.title ?? data?.product?.title,
    description: data?.product?.seo?.description ?? data?.product?.description,
    url: `https://store.com/products/${data?.product?.handle}`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: data?.product?.title,
    },
  });
};
```

Always use `getSeoMeta` to generate consistent meta tags. It handles OpenGraph, Twitter Cards, and JSON-LD.

## Route Patterns — Common Pages

### Sitemap

```typescript
// app/routes/[sitemap.xml].tsx
import { type LoaderFunctionArgs } from '@shopify/remix-oxygen';

export async function loader({ context }: LoaderFunctionArgs) {
  const { products } = await context.storefront.query(SITEMAP_QUERY);

  const urls = products.nodes.map((product) =>
    `<url><loc>https://store.com/products/${product.handle}</loc>
     <lastmod>${product.updatedAt}</lastmod></url>`
  ).join('');

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
     <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml' } },
  );
}
```

### Robots.txt

```typescript
// app/routes/[robots.txt].tsx
export async function loader() {
  return new Response(
    `User-agent: *\nDisallow: /cart\nDisallow: /account\nSitemap: https://store.com/sitemap.xml`,
    { headers: { 'Content-Type': 'text/plain' } },
  );
}
```

## Internationalization (i18n)

The `($locale)` optional segment enables URL-based locale routing:

```typescript
// app/lib/i18n.ts
export function getLocaleFromRequest(request: Request): {
  language: string;
  country: string;
} {
  const url = new URL(request.url);
  const [, locale] = url.pathname.split('/');

  const localeMap: Record<string, { language: string; country: string }> = {
    'de-de': { language: 'DE', country: 'DE' },
    'en-us': { language: 'EN', country: 'US' },
    'fr-fr': { language: 'FR', country: 'FR' },
  };

  return localeMap[locale?.toLowerCase()] ?? { language: 'EN', country: 'US' };
}
```

Pass locale to Storefront API via `@inContext`:

```typescript
const { product } = await context.storefront.query(PRODUCT_QUERY, {
  variables: { handle, country: locale.country, language: locale.language },
});
```

## Oxygen Deployment

Oxygen is Shopify's edge hosting for Hydrogen. Deployment is push-to-deploy:

1. Connect GitHub repo to Shopify admin
2. Push to the configured branch (usually `main`)
3. Oxygen builds and deploys automatically

**Environment variables** are set in the Shopify admin under Hydrogen > Storefront > Settings. They are available as `env` in the server fetch handler.

**Preview deployments** are created automatically for pull requests.

## Anti-Patterns

- **`useEffect` for data fetching** — always use `loader` functions; useEffect causes waterfalls, layout shift, and breaks SSR
- **Client-side rendering when SSR is possible** — Hydrogen is SSR-first; moving data fetching to the client defeats the performance and SEO benefits
- **Caching personalized content** — `CacheShort` on account pages or user-specific data leaks private information to other users
- **`index.html` as entry point** — Hydrogen is not an SPA; each route has its own server-rendered entry
- **Manual `fetch()` for cart mutations** — use `CartForm` which handles optimistic UI, error recovery, and action routing
- **Ignoring streaming** — use `defer` + `Await` for non-critical data; blocking on slow queries hurts TTFB
- **Querying all data in root loader** — root loader runs on every navigation; only load truly global data (shop info, menu) there
- **Hardcoded store domain** — always read from `env.PUBLIC_STORE_DOMAIN`; it differs between dev, preview, and production
- **Skipping error boundaries** — every route should have an `ErrorBoundary` export; unhandled errors crash the entire page

## Error Handling

```typescript
import { isRouteErrorResponse, useRouteError } from 'react-router';

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <div>
        <h1>{error.status === 404 ? 'Page not found' : 'Something went wrong'}</h1>
        <p>{error.data}</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Unexpected error</h1>
      <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
    </div>
  );
}
```

Every route file should export an `ErrorBoundary`. The root `ErrorBoundary` in `root.tsx` catches anything that bubbles up.

## Typical Tickets

| Ticket | Key Patterns |
|---|---|
| New product page route | `loader` with `product(handle:)` query, `CacheShort`, variant selector, `meta` export with `getSeoMeta` |
| Custom component (e.g., product card) | Accept typed props, use `Money` + `Image`, link to product route |
| Cart/checkout flow | `CartForm` actions, cart route `action` handler, optimistic UI via `useNavigation` |
| SEO improvements | `meta` export on every route, JSON-LD structured data, sitemap generation, canonical URLs |
| Performance optimization | `defer` non-critical data, reduce GraphQL query size, set appropriate cache strategies |
| i18n / multi-market | `($locale)` route prefix, `@inContext` directive, locale detection, hreflang in `meta` |
| Collection filtering | `ProductFilter` input in collection query, URL search params for filter state, `getPaginationVariables` |
| Blog/content pages | `pages.$handle` and `blogs.$blogHandle.$articleHandle` routes, `CacheLong` for content |

## Verify

- [ ] `npm run build` succeeds without errors
- [ ] `npm run typecheck` passes (TypeScript)
- [ ] Every route has a `loader`, `default` component export, and `ErrorBoundary`
- [ ] SEO meta tags render correctly (check with `view-source:`)
- [ ] Caching strategy is appropriate per route (no personalized data in public cache)
- [ ] Cart operations work end-to-end (add, update quantity, remove, proceed to checkout)
- [ ] `defer`/`Await` is used for non-critical data — page does not block on slow queries
- [ ] No `useEffect` calls that fetch data on mount
- [ ] Environment variables are read from `env`, not hardcoded
