---
name: shopify-checkout
description: Use when customizing Shopify checkout (Shopify Plus). Covers Checkout UI Extensions (React sandbox), Shopify Functions (discounts, payment, delivery customizations), Cart Transform, Checkout Branding API, and post-purchase extensions. Load when working on checkout customizations.
triggers:
  - shopify
  - checkout
  - extensions
  - discounts
  - payment
  - functions
---

# Shopify Checkout Customization

**Announce at start:** "Reading existing checkout extensions and Shopify Functions before writing."

**Shopify Plus required.** All checkout customization features described here are exclusive to Shopify Plus plans. Standard Shopify plans cannot use Checkout UI Extensions, Shopify Functions, or Cart Transform.

Before writing any checkout code, read the `extensions/` directory to understand existing extension targets, function types, and configuration patterns.

## Checkout UI Extensions

Checkout UI Extensions run in a **sandboxed React environment** -- not the standard React DOM. They use Shopify's proprietary component library. No arbitrary HTML, CSS, or DOM access.

### Extension Targets

| Target | Location |
|--------|----------|
| `purchase.checkout.block.render` | Static block (merchant-placed via editor) |
| `purchase.checkout.header.render-after` | After checkout header |
| `purchase.checkout.contact.render-after` | After contact information |
| `purchase.checkout.shipping-option-list.render-after` | After shipping options |
| `purchase.checkout.payment-method-list.render-after` | After payment methods |
| `purchase.checkout.actions.render-before` | Before "Pay now" button |
| `purchase.checkout.cart-line-item.render-after` | After each cart line item |
| `purchase.thank-you.block.render` | Thank-you page block |
| `purchase.checkout.delivery-address.render-before` | Before delivery address form |

### Components

Extensions use Shopify's component library -- not HTML elements:

`Banner`, `BlockStack`, `Button`, `Checkbox`, `Divider`, `Heading`, `Icon`, `Image`, `InlineStack`, `Link`, `List`, `ListItem`, `Select`, `SkeletonText`, `Spinner`, `Text`, `TextField`, `View`

All imported from `@shopify/ui-extensions-react/checkout`.

### Extension Structure

```tsx
import { reactExtension, BlockStack, Checkbox, Text, useApplyMetafieldsChange } from "@shopify/ui-extensions-react/checkout";

export default reactExtension("purchase.checkout.block.render", () => <GiftWrap />);

function GiftWrap() {
  const applyMetafieldsChange = useApplyMetafieldsChange();
  const handleChange = async (checked: boolean) => {
    await applyMetafieldsChange({
      type: "updateMetafield",
      namespace: "custom", key: "gift_wrap",
      valueType: "boolean", value: checked ? "true" : "false",
    });
  };
  return (
    <BlockStack spacing="tight">
      <Checkbox onChange={handleChange}><Text>Add gift wrapping (+$5.00)</Text></Checkbox>
    </BlockStack>
  );
}
```

### Available Hooks

| Hook | Purpose |
|------|---------|
| `useCartLines()` | Read cart line items |
| `useShippingAddress()` | Read shipping address |
| `useBuyerJourneyIntercept()` | Block or allow checkout progression |
| `useApplyCartLinesChange()` | Add, remove, update cart lines |
| `useApplyMetafieldsChange()` | Set metafields on the checkout |
| `useApplyDiscountCodeChange()` | Apply or remove discount codes |
| `useTotalAmount()` / `useSubtotalAmount()` | Read cart totals |
| `useEmail()` / `usePhone()` | Read customer contact |
| `useLocalizationCountry()` / `useLanguage()` | Read locale info |
| `useSettings()` | Read merchant-configured extension settings |

### Buyer Journey Interception

```tsx
useBuyerJourneyIntercept(({ canBlockProgress }) => {
  if (canBlockProgress && !verified) {
    return { behavior: "block", reason: "Age verification required",
      errors: [{ message: "Please confirm you are 18 or older" }] };
  }
  return { behavior: "allow" };
});
```

Always check `canBlockProgress` before blocking -- not all targets support it.

## Shopify Functions

Functions run **server-side** as compiled WASM modules. They customize backend logic -- no UI capabilities.

### Function Types

| Type | Purpose | API type |
|------|---------|----------|
| Discount | Custom discount logic | `discounts` |
| Payment Customization | Hide/reorder/rename payment methods | `payment-customization` |
| Delivery Customization | Hide/reorder/rename delivery options | `delivery-customization` |
| Cart Transform | Auto-manipulate cart contents | `cart-transform` |
| Fulfillment Constraints | Route orders to locations | `fulfillment-constraints` |
| Order Validation | Validate orders before completion | `cart-checkout-validation` |

### Language Support

**Rust** (compiled to WASM) or **JavaScript** (compiled via Javy). Rust for performance; JS for simplicity.

### Input-Output Pattern

Every Function: receive JSON input, return JSON output.

```
Shopify sends input --> Function processes --> Function returns operations
```

Functions define input via GraphQL in `input.graphql`:

```graphql
query RunInput {
  cart {
    lines {
      quantity
      merchandise { ... on ProductVariant { id product { title hasAnyTag(tags: ["vip-only"]) } } }
    }
    buyerIdentity { customer { hasTags(tags: ["vip"]) } }
  }
}
```

**JavaScript Function (Delivery Customization):**

```javascript
export function run(input) {
  const operations = input.cart.deliveryGroups.flatMap((group) =>
    group.deliveryOptions
      .filter((option) => option.title.includes("Express"))
      .map((option) => ({ rename: { deliveryOptionHandle: option.handle, title: "Priority Express" } }))
  );
  return { operations };
}
```

### Function Configuration (`shopify.extension.toml`)

```toml
api_version = "2024-10"
[[extensions]]
name = "delivery-customization"
type = "delivery_customization"
handle = "delivery-customization"
[extensions.build]
command = "npm exec -- shopify app function build"
path = "dist/function.wasm"
```

## Cart Transform

Cart Transform functions run **before checkout** and auto-manipulate cart contents:

- **Bundle expansion:** Replace bundle product with component line items
- **Free gift:** Auto-add a gift when conditions are met
- **Auto-add:** Warranty, insurance, complementary products
- **Price adjustment:** Modify line item prices based on rules

```javascript
export function run(input) {
  const operations = [];
  for (const line of input.cart.lines) {
    const freeGiftId = line.merchandise?.product?.metafield?.value;
    if (freeGiftId && line.quantity >= 2) {
      operations.push({
        expand: { cartLineId: line.id, expandedCartItems: [
          { merchandiseId: line.merchandise.id, quantity: line.quantity },
          { merchandiseId: freeGiftId, quantity: 1, price: { adjustment: { fixedPricePerUnit: { amount: "0.00" } } } },
        ] },
      });
    }
  }
  return { operations };
}
```

Cart Transform runs server-side before the checkout UI renders. It cannot display UI or interact with the customer.

## Checkout Branding API

Customizes checkout appearance **without code** -- colors, fonts, corner radius, layout, logo. Configure via Admin API or checkout editor.

| Property | Controls |
|----------|----------|
| `colors.primary` | Buttons, links, accents |
| `colors.background` | Page background |
| `typography.primary` / `secondary` | Font families |
| `cornerRadius` | Button and input corners |
| `logo` | Checkout header logo |

Use `checkoutBrandingUpsert` GraphQL mutation with a `checkoutProfileId`. **Prefer Branding API over code** for purely visual changes.

## Post-Purchase Extensions

Render on the **thank-you page** after order completion. Use cases: upsell, survey, cross-sell.

Two render targets:
- `Checkout::PostPurchase::ShouldRender` -- decide whether to show the extension
- `Checkout::PostPurchase::Render` -- render the UI, call `done()` when finished

Components come from `@shopify/post-purchase-ui-extensions-react`.

## Extension Configuration

Every extension has a `shopify.extension.toml`:

```toml
api_version = "2024-10"
[[extensions]]
type = "ui_extension"
name = "Gift Wrap Option"
handle = "gift-wrap"
[[extensions.targeting]]
module = "./src/Checkout.tsx"
target = "purchase.checkout.block.render"
[extensions.settings]
  [[extensions.settings.fields]]
  key = "title"
  type = "single_line_text_field"
  name = "Block title"
```

## Anti-Patterns

- **Never edit `checkout.liquid`** -- deprecated, will be removed. Use Checkout UI Extensions
- **Never attempt DOM manipulation** -- extensions have no access to `document` or `window`
- **Never make external API calls from UI Extensions** -- use metafields or app proxy to pass data in
- **Never use Functions for UI logic** -- Functions are server-side WASM, no UI capabilities
- **Never hardcode prices or currencies** -- read from cart data or shop settings
- **Never ignore `canBlockProgress`** -- only block progression when the flag is true
- **Never skip input validation in Functions** -- malformed output crashes the checkout

## Verify

- [ ] Extension renders correctly via `shopify app dev`
- [ ] Extension target matches the intended checkout location
- [ ] Only Shopify UI components are used (no HTML elements)
- [ ] `useBuyerJourneyIntercept` respects `canBlockProgress`
- [ ] Functions return valid output matching the expected schema
- [ ] `input.graphql` requests only needed fields
- [ ] Cart Transform operations are idempotent
- [ ] Extension deployed successfully via `shopify app deploy`

## Typical Tickets

| Ticket | Approach |
|--------|----------|
| Custom checkout field (delivery notes) | UI Extension at `shipping-option-list.render-after`, store as metafield |
| Custom discount logic (tiered pricing) | Shopify Function type `discounts`, define tiers in input query |
| Payment filtering (hide COD above $500) | Function type `payment-customization`, read cart total, return hide ops |
| Delivery date picker | UI Extension with `Select`, store selection as metafield |
| Post-purchase upsell | Post-purchase extension, check eligibility in `ShouldRender` |
| Bundle expansion | Cart Transform function, expand bundle into component line items |
| Age verification gate | UI Extension with `useBuyerJourneyIntercept`, block until confirmed |
| Rename shipping options | Function type `delivery-customization`, map handles to new titles |
