# P3 — Shopify Advanced Skills

> 5 weitere Shopify Skills für fortgeschrittene Shopify-Domains.
> Voraussetzung: P0 fertig (Skill-Loader, project.json Schema).
> Kann parallel zu P1 und P2 bearbeitet werden.

---

## Done-Metrik

Ein Hydrogen-Projekt läuft komplett über die Pipeline — Ticket erstellt, Hydrogen-Skills geladen, Route gebaut, auf Oxygen deployed.

---

## Skill-Format

Alle Skills folgen dem bestehenden Format der 3 validierten Skills (shopify-liquid, shopify-theme, shopify-metafields):

- Markdown-Datei in `skills/`
- Struktur: Was der Agent wissen muss, typische Tickets, Anti-Patterns, Verification
- Länge: 200-400 Zeilen (genug Kontext ohne Context-Window zu sprengen)
- Sprache: Englisch (wie alle Skills)

---

## 1. `shopify-storefront-api` — Storefront API (GraphQL)

### Agent-Zuordnung

Backend (primär), Frontend (für Data-Fetching in Components), Orchestrator

### Skill-Inhalt

**Core Knowledge:**
- GraphQL Endpoint: `https://{shop}.myshopify.com/api/{version}/graphql.json`
- Authentication: Public Storefront Token (client-side, im HTML sichtbar) vs Private Token (server-side only)
- Versioning: Calver (2026-01, 2026-04, 2026-07, 2026-10) — Breaking Changes möglich zwischen Versionen
- Rate Limits: IP-basiert für Tokenless, Calculated Query Cost für Token-based (max 1000 Cost Points)

**Key Queries:**
- Products: `products(first: N)`, `product(handle: "...")`, Variants, Images, Metafields
- Collections: `collections(first: N)`, `collection(handle: "...")`, Products in Collection
- Cart: `cartCreate`, `cartLinesAdd`, `cartLinesUpdate`, `cartLinesRemove`, `cart(id: "...")`
- Customer Account API: `customer`, Login/Register Flows
- Search: `search(query: "...", types: [PRODUCT])`, Predictive Search
- Metaobjects: `metaobjects(type: "...")`, Custom Content Types

**Pagination:**
- Cursor-based: `first`, `after`, `last`, `before`
- `pageInfo { hasNextPage, endCursor }`
- Nie `skip/offset` — existiert nicht in Storefront API

**Anti-Patterns:**
- Nie alle Produkte auf einmal laden (`first: 250` ist Maximum)
- Nie Storefront Token im Server-Code wenn Private Token verfügbar
- Nie veraltete API-Version nutzen (immer aktuelle oder eine Version zurück)
- Nie mehr als 3 verschachtelte Connections in einer Query (Performance)

**Typische Tickets:**
- Custom Product Page mit GraphQL Data Fetching
- Cart Functionality (Add/Remove/Update)
- Search & Filtering mit Predictive Search API
- Collection Filtering (Tags, Price Range, Availability)
- Multi-Currency / Multi-Language Setup

### Verification

Kein automatischer Verification Command. Agent soll Query-Ergebnisse manuell prüfen.

---

## 2. `shopify-hydrogen` — Hydrogen Framework

### Agent-Zuordnung

Frontend (primär), Backend (Loader/Actions), Orchestrator

### Skill-Inhalt

**Core Knowledge:**
- Framework: React Router v7 (ehemals Remix) + Shopify Storefront API
- Rendering: SSR mit Streaming, Selective Hydration
- Projekt-Setup: `npm create @shopify/hydrogen@latest`
- Deployment: Oxygen (Shopify's Edge Platform), Push-to-Deploy

**Hydrogen-spezifische APIs:**
- `createStorefrontClient()` — Storefront API Client Setup
- `<Await>` — Streaming Deferred Data
- `<Analytics.Provider>` — Shopify Analytics Integration
- `useOptimisticCart()` — Optimistic Cart Updates

**Hydrogen Components:**
- `<Money>` — Formatierte Preise
- `<Image>` — Optimierte Bilder (Shopify CDN, srcset, lazy loading)
- `<ShopPayButton>` — Shop Pay Integration
- `<CartForm>` — Cart Mutations als Form Actions
- `<Pagination>` — Cursor-based Pagination UI

**Route-Patterns:**
- `app/routes/($locale)._index.tsx` — Homepage
- `app/routes/($locale).products.$handle.tsx` — Product Detail
- `app/routes/($locale).collections.$handle.tsx` — Collection
- `app/routes/($locale).cart.tsx` — Cart
- `app/routes/($locale).search.tsx` — Search
- `app/routes/[sitemap.xml].tsx` — Dynamic Sitemap
- `app/routes/[robots.txt].tsx` — Dynamic Robots

**Caching:**
- Route-level: `CacheShort()` (1min), `CacheLong()` (1h), `CacheNone()`
- `CacheCustom({ mode, maxAge, staleWhileRevalidate })`
- Cache Headers in Loader: `return json(data, { headers: { 'Cache-Control': CacheShort() } })`

**Anti-Patterns:**
- Nie `useEffect` für Data Fetching (Loader sind da)
- Nie Client-Side Storefront API Calls wenn Loader möglich (SSR > CSR)
- Nie Cache auf personalisierten Content (Cart, Customer)
- Nie `index.html` für SEO-relevante Seiten (SSR ist Pflicht)

**Typische Tickets:**
- Neue Route (Collection Page, Product Page, Blog)
- Custom Component (Hero, Product Carousel, Newsletter Signup)
- Cart & Checkout Flow
- SEO Optimization (JSON-LD, Meta Tags, Sitemap)
- Performance (Code Splitting, Prefetching, Image Optimization)
- i18n / Multi-Market Setup

### Verification

```bash
npm run build    # Hydrogen Build Check
npm run typecheck  # TypeScript Validation
```

---

## 3. `shopify-admin-api` — Admin API (GraphQL/REST)

### Agent-Zuordnung

Backend (primär), Data Engineer (Bulk Ops, Migrations), Orchestrator

### Skill-Inhalt

**Core Knowledge:**
- GraphQL Admin API: Primary API für alle Admin-Operationen
- REST Admin API: Legacy, noch für einige Endpoints nötig (Webhooks registration)
- Authentication: OAuth für Custom Apps, API Keys für Private Apps
- Versioning: Gleicher Calver wie Storefront API

**Rate Limits:**
- REST: Leaky Bucket — 40 requests, 2/sec refill
- GraphQL: Calculated Query Cost — 1000 Points/sec (actually available), max 2000 Points/request
- Bulk Operations: Eigenes Limit, kein Query Cost

**Key Mutations:**
- Products: `productCreate`, `productUpdate`, `productDelete`
- Orders: Read-only in den meisten Fällen, `orderClose`, `orderCancel`
- Customers: `customerCreate`, `customerUpdate`, Tagging
- Inventory: `inventoryAdjustQuantities`, `inventorySetOnHandQuantities`
- Metafields: `metafieldsSet` (Bulk-Set auf jeder Resource)

**Webhooks:**
- Event Topics: `orders/create`, `products/update`, `customers/create`, etc.
- Delivery: HTTPS (Endpoint-URL), EventBridge, Pub/Sub
- Registration: REST API (`POST /admin/api/2026-01/webhooks.json`) oder GraphQL (`webhookSubscriptionCreate`)
- Verification: HMAC-SHA256 Signature im `X-Shopify-Hmac-SHA256` Header
- Mandatory Webhooks: `customers/data_request`, `customers/redact`, `shop/redact`

**Bulk Operations:**
- `bulkOperationRunQuery` — Starte Bulk-Export
- Polling: `currentBulkOperation` bis `COMPLETED`
- Download: JSONL-Datei von der `url`
- Use Case: Alle Produkte exportieren, alle Orders eines Zeitraums, etc.
- Limitation: Ein Bulk-Op pro Shop gleichzeitig

**Anti-Patterns:**
- Nie REST für neue Features (GraphQL ist der Standard)
- Nie einzelne API-Calls in einer Schleife wenn Bulk-Op möglich
- Nie Webhook-Payload ohne HMAC-Verification verarbeiten
- Nie API-Credentials in Client-Side Code

**Typische Tickets:**
- Daten-Migration (Products, Customers, Orders)
- Webhook-Handler für Order Processing
- Inventory Management Integration
- Custom Metafield Setup via API
- Bulk-Export für Reporting

### Verification

Kein automatischer Verification Command. API-Calls werden über Shopify CLI oder Postman getestet.

---

## 4. `shopify-checkout` — Checkout Extensibility

### Agent-Zuordnung

Frontend (UI Extensions), Backend (Shopify Functions), Orchestrator

### Skill-Inhalt

**Core Knowledge:**
- Shopify Plus Feature (nicht für Basic/Standard Shops)
- Checkout UI Extensions: React-basiert, laufen in Sandbox
- Shopify Functions: Serverless Functions für Discount/Payment/Delivery Logic
- Checkout Branding API: Colors, Fonts, Layout ohne Code

**Checkout UI Extensions:**
- Framework: React mit Shopify-eigenem UI Kit (`@shopify/ui-extensions-react/checkout`)
- Components: `Banner`, `BlockStack`, `Button`, `Checkbox`, `Heading`, `Image`, `InlineStack`, `Text`, `TextField`
- Targets (Extension Points): `purchase.checkout.block.render`, `purchase.checkout.header.render-after`, `purchase.checkout.footer.render-before`, etc.
- APIs in Extension: `useCartLines()`, `useShippingAddress()`, `useBuyerJourney()`, `useApplyDiscountCodeChange()`
- Limitations: Kein DOM-Zugang, kein window/document, kein fetch zu externen APIs (nur Shopify APIs)

**Shopify Functions:**
- Sprache: Rust (WASM) oder JavaScript
- Types: Discount (Product, Order, Shipping), Payment Customization, Delivery Customization, Cart Transform, Fulfillment Constraints
- Input: GraphQL Query → WASM Function → JSON Output
- Beispiel Discount Function: Input = Cart Lines, Output = Discount Allocations
- Deployment: Via Shopify CLI (`shopify app deploy`)

**Cart Transform:**
- Automatische Cart-Manipulationen (Bundle-Expansion, Free Gift, Auto-Add)
- Runs before Checkout: Modifiziert Cart-Lines programmatisch
- Input: Cart Lines, Output: Cart Operations (merge, expand, update)

**Anti-Patterns:**
- Nie `checkout.liquid` editieren (deprecated, wird entfernt)
- Nie DOM-Manipulation versuchen (Sandbox verhindert es)
- Nie externe API-Calls aus Extensions (nur Shopify-eigene APIs)
- Nie Functions für UI-Logik (Functions = Backend, Extensions = Frontend)

**Typische Tickets:**
- Custom Checkout Field (Gift Message, Delivery Instructions)
- Discount Logic (Buy X Get Y, Tiered Discounts)
- Payment Method Filtering (basierend auf Cart/Address)
- Delivery Date Picker
- Post-Purchase Upsell

### Verification

```bash
shopify app dev  # Local Development Server
shopify app deploy  # Deploy Extensions + Functions
```

---

## 5. `shopify-apps` — App Development

### Agent-Zuordnung

Backend (primär), Frontend (Polaris UI), Orchestrator

### Skill-Inhalt

**Core Knowledge:**
- Shopify App CLI: `shopify app init`, `shopify app dev`, `shopify app deploy`
- App Types: Custom (für einen Shop), Public (im App Store)
- Embedding: Apps laufen als iframe im Shopify Admin
- Framework: Remix (Shopify's Standard-Template), aber jedes Framework möglich

**App Bridge:**
- Client-side API für embedded Apps
- Navigation: `shopify.navigate(url)`, `shopify.modal.show(id)`
- Toast: `shopify.toast.show('Message')`
- Title Bar: `shopify.titleBar.set({ title: '...' })`
- Version: App Bridge v4 (CDN-basiert, kein npm Package mehr)

**Polaris:**
- Shopify's React UI Component Library
- Components: `Page`, `Card`, `DataTable`, `IndexTable`, `Modal`, `Banner`, `TextField`, etc.
- Design System: Folgt Shopify Admin Design Language
- Install: `@shopify/polaris`

**Authentication:**
- Session Tokens: JWT-basiert, automatisch von App Bridge bereitgestellt
- OAuth: Für initiale App-Installation
- Scopes: `read_products`, `write_products`, `read_orders`, etc.
- Verification: `shopify.verifyRequest()` Middleware

**App Proxy:**
- Custom Endpoints unter der Shop-Domain: `https://{shop}.myshopify.com/apps/{proxy-path}`
- Use Case: Public-facing Pages, Custom Storefronts innerhalb des Shops
- Signature Verification: HMAC im Query-String

**Theme App Extensions:**
- App Blocks: Sections die in Theme-Editor erscheinen
- App Embeds: Floating/Global Elements
- Schema: Ähnlich wie Section Schema (`{% schema %}`)
- Vorteil: Keine Theme-Code-Änderung nötig

**Billing API:**
- `appSubscriptionCreate` — Recurring Charges
- `appUsageRecordCreate` — Usage-based Billing
- `appPurchaseOneTimeCreate` — Einmalige Käufe
- Testing: Immer `test: true` in Development

**Anti-Patterns:**
- Nie Session Tokens ignorieren (Security-Risiko)
- Nie Polaris-Alternativen nutzen (App Store Review schlägt fehl)
- Nie OAuth Secrets client-side exponieren
- Nie App ohne Webhook für `app/uninstalled` (Cleanup nötig)

**Typische Tickets:**
- Neue App scaffolden (Remix Template)
- Admin-Interface für Custom Functionality (Polaris)
- Theme App Extension für Store-Integration
- Webhook Handler (Order Events, App Lifecycle)
- Billing Integration

### Verification

```bash
shopify app dev    # Local Dev + Tunnel
shopify app deploy  # Deploy to Shopify
```

---

## Skill-Loader Erweiterung

### Variant-Automatik

```typescript
const VARIANT_DEFAULTS: Record<string, string[]> = {
  'liquid':   ['shopify-liquid', 'shopify-theme'],
  'hydrogen': ['shopify-hydrogen', 'shopify-storefront-api'],
};
```

Wenn `skills.domain` explizit gesetzt ist, überschreibt es die Automatik. So kann ein Projekt `skills.domain: ["shopify-hydrogen", "shopify-admin-api", "shopify-apps"]` setzen für ein Hydrogen-Projekt das auch eine Custom App baut.

### project.json Beispiele

**Liquid Theme Projekt:**
```json
{
  "stack": { "platform": "shopify", "variant": "liquid" }
}
```
→ Lädt automatisch: shopify-liquid, shopify-theme

**Hydrogen Projekt:**
```json
{
  "stack": { "platform": "shopify", "variant": "hydrogen" }
}
```
→ Lädt automatisch: shopify-hydrogen, shopify-storefront-api

**Hydrogen + Custom App:**
```json
{
  "stack": { "platform": "shopify", "variant": "hydrogen" },
  "skills": {
    "domain": ["shopify-hydrogen", "shopify-storefront-api", "shopify-admin-api", "shopify-apps"]
  }
}
```
→ Lädt explizit alle 4 Skills

---

## Ticket-Reihenfolge

```
T-1: shopify-storefront-api Skill schreiben + validieren
T-2: shopify-hydrogen Skill schreiben + validieren
T-3: shopify-admin-api Skill schreiben + validieren
T-4: shopify-checkout Skill schreiben + validieren
T-5: shopify-apps Skill schreiben + validieren
T-6: Skill-Loader Variant-Automatik erweitern (neue Skills zu bestehenden Defaults aus P0 hinzufügen)
```

T-1 bis T-5 sind unabhängig und können parallel bearbeitet werden.
T-6 erweitert die in P0 gebaute Variant-Automatik um die neuen Skills (z.B. `hydrogen` Default bekommt zusätzlich `shopify-admin-api` wenn es sich als Standard etabliert). Kann jederzeit nach P0 implementiert werden.

### Validierung

Jeder Skill wird mit einem realen Ticket gegen ein echtes Shopify-Projekt validiert (wie bei den ersten 3 Skills mit dem Eval-Workspace).
