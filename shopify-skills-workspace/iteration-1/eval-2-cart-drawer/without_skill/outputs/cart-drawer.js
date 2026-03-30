/**
 * Shopify AJAX Cart Drawer
 *
 * Intercepts add-to-cart form submissions and product-card buttons,
 * adds the item via the Shopify AJAX Cart API, then refreshes the
 * cart-drawer section rendering without a full page reload.
 *
 * Requirements:
 *   - A section file registered as 'cart-drawer' (renders with id="cart-drawer")
 *   - Add-to-cart forms use the standard Shopify <form action="/cart/add" ...> pattern
 *     OR buttons/links carry the attribute [data-add-to-cart] with an optional
 *     data-variant-id for quick-add scenarios.
 *
 * Drop this script into your theme's assets/ folder and include it in your layout:
 *   <script src="{{ 'cart-drawer.js' | asset_url }}" defer></script>
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------
  const DRAWER_SECTION_ID = 'cart-drawer';
  const DRAWER_SELECTOR = '#cart-drawer';
  const OPEN_CLASS = 'cart-drawer--open';
  const LOADING_CLASS = 'cart-drawer--loading';
  const BODY_NO_SCROLL_CLASS = 'overflow-hidden';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Wrapper around fetch that returns parsed JSON and throws on HTTP errors.
   */
  async function fetchJSON(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Request failed: ${response.status} ${response.statusText} – ${body}`
      );
    }
    return response.json();
  }

  /**
   * Fetch the freshly-rendered cart-drawer section HTML from Shopify's
   * Section Rendering API and swap it into the DOM.
   */
  async function refreshCartDrawer() {
    const drawer = document.querySelector(DRAWER_SELECTOR);
    if (!drawer) return;

    drawer.classList.add(LOADING_CLASS);

    try {
      const url = `${window.Shopify?.routes?.root || '/'}?sections=${DRAWER_SECTION_ID}`;
      const sections = await fetchJSON(url);
      const html = sections[DRAWER_SECTION_ID];

      if (html) {
        // Parse the returned HTML and extract the inner content of the section
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const freshDrawer = parsed.querySelector(DRAWER_SELECTOR);

        if (freshDrawer) {
          drawer.innerHTML = freshDrawer.innerHTML;
        } else {
          // Fallback: replace entire innerHTML with the section response
          drawer.innerHTML = html;
        }

        // Re-bind close buttons and quantity controls inside the drawer
        bindDrawerInteractions();
      }
    } catch (err) {
      console.error('[cart-drawer] Failed to refresh section:', err);
    } finally {
      drawer.classList.remove(LOADING_CLASS);
    }
  }

  /**
   * Add an item to the cart via the AJAX API.
   *
   * @param {Object} itemData  – must include at least { id: variantId }
   *                              Optionally: { quantity, properties, selling_plan }
   * @returns {Promise<Object>} – the line item returned by Shopify
   */
  async function addToCart(itemData) {
    return fetchJSON(
      `${window.Shopify?.routes?.root || '/'}cart/add.js`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: [itemData] }),
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Drawer open / close
  // ---------------------------------------------------------------------------

  function openDrawer() {
    const drawer = document.querySelector(DRAWER_SELECTOR);
    if (!drawer) return;
    drawer.classList.add(OPEN_CLASS);
    document.body.classList.add(BODY_NO_SCROLL_CLASS);
    drawer.setAttribute('aria-hidden', 'false');

    // Trap focus: move focus into drawer for accessibility
    const focusTarget =
      drawer.querySelector('[data-cart-drawer-close]') ||
      drawer.querySelector('button, a, input');
    if (focusTarget) focusTarget.focus();
  }

  function closeDrawer() {
    const drawer = document.querySelector(DRAWER_SELECTOR);
    if (!drawer) return;
    drawer.classList.remove(OPEN_CLASS);
    document.body.classList.remove(BODY_NO_SCROLL_CLASS);
    drawer.setAttribute('aria-hidden', 'true');
  }

  // ---------------------------------------------------------------------------
  // Drawer internal interactions (close button, quantity, remove)
  // ---------------------------------------------------------------------------

  function bindDrawerInteractions() {
    const drawer = document.querySelector(DRAWER_SELECTOR);
    if (!drawer) return;

    // Close buttons
    drawer.querySelectorAll('[data-cart-drawer-close]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        closeDrawer();
      });
    });

    // Close on overlay / backdrop click
    const overlay = drawer.querySelector('[data-cart-drawer-overlay]');
    if (overlay) {
      overlay.addEventListener('click', closeDrawer);
    }

    // Quantity change buttons
    drawer.querySelectorAll('[data-cart-quantity-button]').forEach(function (btn) {
      btn.addEventListener('click', handleQuantityChange);
    });

    // Remove line item buttons
    drawer.querySelectorAll('[data-cart-remove]').forEach(function (btn) {
      btn.addEventListener('click', handleRemoveItem);
    });
  }

  /**
   * Handle +/- quantity buttons inside the drawer.
   * Expects the button to carry:
   *   data-cart-quantity-button="plus|minus"
   *   data-line-key="{line item key}"
   *   data-current-quantity="{number}"
   */
  async function handleQuantityChange(e) {
    e.preventDefault();
    const btn = e.currentTarget;
    const key = btn.dataset.lineKey;
    const direction = btn.dataset.cartQuantityButton;
    let qty = parseInt(btn.dataset.currentQuantity, 10) || 1;

    qty = direction === 'plus' ? qty + 1 : Math.max(0, qty - 1);

    try {
      await fetchJSON(
        `${window.Shopify?.routes?.root || '/'}cart/change.js`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ id: key, quantity: qty }),
        }
      );
      await refreshCartDrawer();
    } catch (err) {
      console.error('[cart-drawer] Quantity change failed:', err);
    }
  }

  /**
   * Remove a line item (set quantity to 0).
   * Expects the button to carry:
   *   data-cart-remove
   *   data-line-key="{line item key}"
   */
  async function handleRemoveItem(e) {
    e.preventDefault();
    const key = e.currentTarget.dataset.lineKey;

    try {
      await fetchJSON(
        `${window.Shopify?.routes?.root || '/'}cart/change.js`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ id: key, quantity: 0 }),
        }
      );
      await refreshCartDrawer();
    } catch (err) {
      console.error('[cart-drawer] Remove item failed:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Close drawer on Escape key
  // ---------------------------------------------------------------------------

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
  });

  // ---------------------------------------------------------------------------
  // Intercept add-to-cart form submissions
  // ---------------------------------------------------------------------------

  document.addEventListener('submit', async function (e) {
    const form = e.target;
    if (
      !form.matches('form[action*="/cart/add"]') &&
      !form.matches('form[action$="/cart/add"]')
    ) {
      return;
    }

    e.preventDefault();

    const formData = new FormData(form);
    const variantId = formData.get('id');
    const quantity = parseInt(formData.get('quantity'), 10) || 1;

    if (!variantId) {
      console.warn('[cart-drawer] No variant id found in form');
      return;
    }

    const itemData = { id: parseInt(variantId, 10), quantity: quantity };

    // Forward selling plan if present
    const sellingPlan = formData.get('selling_plan');
    if (sellingPlan) itemData.selling_plan = sellingPlan;

    // Collect line item properties (fields named properties[...])
    const properties = {};
    for (const [key, value] of formData.entries()) {
      const match = key.match(/^properties\[(.+)]$/);
      if (match && value) {
        properties[match[1]] = value;
      }
    }
    if (Object.keys(properties).length) {
      itemData.properties = properties;
    }

    // Disable submit button while working
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      await addToCart(itemData);
      await refreshCartDrawer();
      openDrawer();
    } catch (err) {
      console.error('[cart-drawer] Add to cart failed:', err);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // ---------------------------------------------------------------------------
  // Quick-add buttons (outside of forms)
  //
  // Usage:
  //   <button data-add-to-cart data-variant-id="12345678" data-quantity="1">
  //     Add to cart
  //   </button>
  // ---------------------------------------------------------------------------

  document.addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-add-to-cart]');
    if (!btn) return;

    // Skip if this click is inside a form — the submit handler will catch it
    if (btn.closest('form[action*="/cart/add"]')) return;

    e.preventDefault();

    const variantId = btn.dataset.variantId;
    if (!variantId) {
      console.warn('[cart-drawer] data-variant-id missing on quick-add button');
      return;
    }

    const quantity = parseInt(btn.dataset.quantity, 10) || 1;
    btn.disabled = true;

    try {
      await addToCart({ id: parseInt(variantId, 10), quantity: quantity });
      await refreshCartDrawer();
      openDrawer();
    } catch (err) {
      console.error('[cart-drawer] Quick add failed:', err);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------------------------------------------------------------------
  // Update the cart item count badge anywhere on the page.
  // After every cart mutation, fetch /cart.js and update elements with
  // [data-cart-count].
  // ---------------------------------------------------------------------------

  const _originalRefresh = refreshCartDrawer;
  async function refreshCartDrawerAndCount() {
    await _originalRefresh();
    try {
      const cart = await fetchJSON(
        `${window.Shopify?.routes?.root || '/'}cart.js`
      );
      document.querySelectorAll('[data-cart-count]').forEach(function (el) {
        el.textContent = cart.item_count;
      });
    } catch (err) {
      console.error('[cart-drawer] Failed to update cart count:', err);
    }
  }

  // Patch the public reference so all call-sites use the enhanced version.
  // (We keep it within the IIFE, no global leak.)
  // Re-wire by replacing the function reference used internally isn't possible
  // in this pattern, so instead we expose a tiny event-based API.

  /**
   * Dispatch a custom event after every cart change so other scripts can react.
   */
  function dispatchCartUpdated(cart) {
    document.dispatchEvent(
      new CustomEvent('cart:updated', { detail: { cart: cart } })
    );
  }

  // After the drawer is refreshed, also update the count badge.
  // We do this by listening on our own event rather than monkey-patching.
  const originalFetchJSON = fetchJSON;

  // Whenever the cart section is refreshed, also update the cart count badge.
  // We use a MutationObserver as a lightweight way to detect that the drawer
  // content was swapped, then update the count.
  const observer = new MutationObserver(async function () {
    try {
      const cart = await originalFetchJSON(
        `${window.Shopify?.routes?.root || '/'}cart.js`
      );
      document.querySelectorAll('[data-cart-count]').forEach(function (el) {
        el.textContent = cart.item_count;
      });
      dispatchCartUpdated(cart);
    } catch (_) {
      // Silently ignore — non-critical.
    }
  });

  const drawerEl = document.querySelector(DRAWER_SELECTOR);
  if (drawerEl) {
    observer.observe(drawerEl, { childList: true, subtree: true });
    // Initial binding
    bindDrawerInteractions();
  }
})();
