/**
 * cart-drawer.js
 *
 * Ajax add-to-cart with dynamic cart drawer refresh via Section Rendering API.
 * Uses Web Components pattern per Shopify OS 2.0 conventions.
 * Load with defer: {{ 'cart-drawer.js' | asset_url | script_tag: defer: true }}
 */

class CartDrawerItems extends HTMLElement {
  /**
   * Wraps the cart drawer section content.
   * Automatically refreshes its innerHTML when a cart:updated event fires.
   */
  constructor() {
    super();
    this.sectionId = this.dataset.sectionId || 'cart-drawer';
  }

  connectedCallback() {
    this.onCartUpdated = this.onCartUpdated.bind(this);
    document.addEventListener('cart:updated', this.onCartUpdated);
  }

  disconnectedCallback() {
    document.removeEventListener('cart:updated', this.onCartUpdated);
  }

  async onCartUpdated() {
    await this.refreshSection();
  }

  async refreshSection() {
    try {
      const response = await fetch(`${window.location.pathname}?sections=${this.sectionId}`);
      if (!response.ok) throw new Error(`Section render failed: ${response.status}`);

      const data = await response.json();
      const html = new DOMParser().parseFromString(data[this.sectionId], 'text/html');
      const newContent = html.querySelector(`#shopify-section-${this.sectionId}`);

      if (newContent) {
        const target = document.querySelector(`#shopify-section-${this.sectionId}`);
        if (target) {
          target.innerHTML = newContent.innerHTML;
        }
      }
    } catch (error) {
      console.error('[cart-drawer] Failed to refresh section:', error);
    }
  }
}

if (!customElements.get('cart-drawer-items')) {
  customElements.define('cart-drawer-items', CartDrawerItems);
}

class AddToCartButton extends HTMLElement {
  /**
   * Intercepts product form submissions to add items via the Ajax Cart API,
   * then dispatches a cart:updated event and opens the cart drawer.
   *
   * Usage in Liquid:
   *
   * <add-to-cart-button>
   *   <form action="/cart/add" method="post">
   *     <input type="hidden" name="id" value="{{ variant.id }}">
   *     <input type="hidden" name="quantity" value="1">
   *     <button type="submit" data-add-to-cart>
   *       {{ 'products.product.add_to_cart' | t }}
   *     </button>
   *   </form>
   * </add-to-cart-button>
   */
  constructor() {
    super();
    this.form = this.querySelector('form[action="/cart/add"]');
    this.submitButton = this.querySelector('[data-add-to-cart]');
  }

  connectedCallback() {
    if (!this.form) return;
    this.onSubmit = this.onSubmit.bind(this);
    this.form.addEventListener('submit', this.onSubmit);
  }

  disconnectedCallback() {
    if (this.form) {
      this.form.removeEventListener('submit', this.onSubmit);
    }
  }

  async onSubmit(event) {
    event.preventDefault();

    if (this.submitButton) {
      this.submitButton.setAttribute('disabled', '');
      this.submitButton.setAttribute('aria-busy', 'true');
    }

    const formData = new FormData(this.form);
    const body = {};

    // Build the request body from form data.
    // Supports standard Shopify add-to-cart fields: id, quantity, properties.
    for (const [key, value] of formData.entries()) {
      if (key === 'id') {
        body.id = parseInt(value, 10);
      } else if (key === 'quantity') {
        body.quantity = parseInt(value, 10) || 1;
      } else if (key.startsWith('properties[')) {
        if (!body.properties) body.properties = {};
        const propKey = key.replace('properties[', '').replace(']', '');
        body.properties[propKey] = value;
      }
    }

    // Default quantity to 1 if not provided.
    if (!body.quantity) body.quantity = 1;

    try {
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // 422 = out of stock or quantity exceeds inventory
        if (response.status === 422) {
          this.handleError(errorData.description || errorData.message || 'Item is unavailable');
          return;
        }
        throw new Error(errorData.message || `Add to cart failed: ${response.status}`);
      }

      // Notify the cart drawer (and any other listeners) that the cart changed.
      document.dispatchEvent(new CustomEvent('cart:updated'));

      // Open the cart drawer.
      this.openCartDrawer();
    } catch (error) {
      console.error('[add-to-cart]', error);
      this.handleError(error.message);
    } finally {
      if (this.submitButton) {
        this.submitButton.removeAttribute('disabled');
        this.submitButton.removeAttribute('aria-busy');
      }
    }
  }

  /**
   * Opens the cart drawer by setting its open attribute.
   * Expects the drawer element to toggle visibility based on the [open] attribute.
   */
  openCartDrawer() {
    const drawer = document.querySelector('#cart-drawer');
    if (drawer) {
      drawer.setAttribute('open', '');
      drawer.classList.add('is-active');

      // Trap focus inside the drawer for accessibility.
      const focusTarget = drawer.querySelector('[data-drawer-close], button, a, input');
      if (focusTarget) focusTarget.focus();
    }
  }

  handleError(message) {
    // Dispatch an error event that the theme can listen to for toast/notification display.
    document.dispatchEvent(
      new CustomEvent('cart:error', { detail: { message } })
    );

    // Also set an aria-live region if present, for screen reader announcements.
    const errorContainer = this.querySelector('[data-cart-error]');
    if (errorContainer) {
      errorContainer.textContent = message;
      errorContainer.removeAttribute('hidden');
    }
  }
}

if (!customElements.get('add-to-cart-button')) {
  customElements.define('add-to-cart-button', AddToCartButton);
}

/**
 * Theme editor compatibility.
 * Web Components handle load/unload automatically via connectedCallback/disconnectedCallback.
 * These listeners cover edge cases for non-WC content within the cart drawer section.
 */
document.addEventListener('shopify:section:load', (event) => {
  const section = event.target;
  if (section.id === 'shopify-section-cart-drawer') {
    // Web Components inside the re-rendered section auto-initialize.
    // Fire a cart:updated event to ensure the drawer content is current.
    document.dispatchEvent(new CustomEvent('cart:updated'));
  }
});
