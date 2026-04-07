---
name: webapp-testing
description: Testing strategy and execution for web applications. Covers test pyramid decisions (unit/integration/E2E), framework selection, mocking boundaries, and visual testing with Playwright. Use when deciding what to test, how to test it, and when writing tests.
---

# Web Application Testing

Testing strategy, framework selection, and execution for web applications. Covers the full testing stack — from unit tests to visual verification.

## Testing Strategy — The Test Pyramid

Not all tests are equal. Choose the right level for what you're testing.

```
    ╱ E2E ╲           Few — slow, brittle, high confidence
   ╱───────╲
  ╱Integration╲      Some — test real boundaries
 ╱─────────────╲
╱   Unit Tests   ╲   Many — fast, isolated, focused
╰─────────────────╯
```

### When to Use Each Level

| Level | Test When... | Examples |
|---|---|---|
| **Unit** | Pure functions, business logic, data transformations, validation rules, utilities | `formatDate()`, `calculateDiscount()`, `validateEmail()`, schema parsing |
| **Integration** | Components interact with real boundaries (DB, API, auth, file system) | API endpoint returns correct data, RLS policy blocks unauthorized access, webhook processes payload |
| **Component** | UI components render correctly and respond to interaction | Button disables on click, form shows validation errors, modal opens/closes |
| **E2E** | Critical user journeys that span multiple pages/systems | Checkout flow, signup → onboarding, auth → dashboard redirect |

### Decision Shortcuts

- **Changed a utility function?** → Unit test
- **Changed an API route?** → Integration test
- **Changed a UI component?** → Component test
- **Changed a critical user flow?** → E2E test (sparingly)
- **Changed config/docs/markdown?** → No tests needed
- **Fixed a bug?** → Write the failing test FIRST (TDD), then verify the fix makes it green

### Coverage Rules

- **Always cover:** Happy path + primary error path
- **Always cover:** Edge cases for the specific function (null, empty, boundary values)
- **Skip:** Testing framework internals, third-party library behavior, obvious getters/setters
- **Skip:** Implementation details (internal state, private methods, call counts)

## Framework Decision Tree

Choose the framework based on the project's stack. Read `project.json` for the stack.

```
Stack?
├── Next.js / React → Vitest + @testing-library/react
├── Remix / React Router → Vitest + @testing-library/react
├── Vue / Nuxt → Vitest + @vue/test-utils
├── Svelte / SvelteKit → Vitest + @testing-library/svelte
├── Node.js / Express / Hono → Vitest (or Jest if already configured)
├── TypeScript (no framework) → Vitest
├── Playwright already in project → Playwright for E2E
└── Jest already configured → Keep Jest (don't migrate mid-ticket)
```

**Default choice: Vitest.** Faster than Jest, native ESM/TypeScript support, compatible API.

**Exception:** If the project already uses Jest with significant test infrastructure, keep Jest. Don't migrate frameworks within a feature ticket.

### Test File Conventions

- Test files next to source: `utils.ts` → `utils.test.ts`
- Or in `tests/` directory if `project.json` specifies `paths.tests`
- Name pattern: `{filename}.test.ts` or `{filename}.spec.ts` — match existing convention in the project

## Mocking Boundaries

Mocking is a tool, not a default. Every mock hides a real interaction.

### Mock These (external boundaries)

| What | Why | How |
|---|---|---|
| **External HTTP APIs** | Slow, unreliable, costs money | `msw` (Mock Service Worker) or Vitest `vi.mock` |
| **Database in unit tests** | Slow, needs setup/teardown | Mock the repository/data layer, not the DB client directly |
| **File system** | Side effects, cleanup needed | `memfs` or mock the fs module |
| **Timers / Dates** | Non-deterministic | `vi.useFakeTimers()`, `vi.setSystemTime()` |
| **Environment variables** | Test isolation | `vi.stubEnv()` |
| **Third-party SDKs** (Stripe, SendGrid) | External dependency, costs money | Mock at the SDK boundary |

### Do NOT Mock These

| What | Why |
|---|---|
| **Your own utility functions** | They're fast, deterministic — test them for real |
| **Framework primitives** (React hooks, Svelte stores) | Mocking them tests nothing real |
| **Anything that runs in < 50ms** | No performance reason to mock |
| **The thing you're actually testing** | Mocking the SUT = testing nothing |
| **Database in integration tests** | The whole point is testing the real query |

### The Mocking Smell Test

> "If I remove this mock, does the test still make sense?"
>
> - **Yes** → The mock is hiding a real dependency. Consider removing it.
> - **No** → The mock is simulating an external boundary. Keep it.

## Visual Testing with Playwright

**Announce at start:** "Starting visual verification with Playwright."

## Prerequisites

Playwright must be installed:
```bash
pip install playwright && playwright install chromium
```

## Decision Tree

```
Task -> Static HTML?
    |-- Yes -> Read HTML file, identify selectors
    |          |-- Playwright script with file:// URL
    |
    |-- No (dynamic app) -> Server already running?
        |-- No -> Use with_server.py (see below)
        |-- Yes -> Reconnaissance-then-Action:
            1. Navigate + wait for networkidle
            2. Screenshot or inspect DOM
            3. Identify selectors from rendered state
            4. Execute actions with found selectors
```

## Server Lifecycle with with_server.py

The framework includes `.claude/scripts/with_server.py` — starts server, waits for port readiness, runs automation, cleans up.

```bash
# Run --help first to see options
python .claude/scripts/with_server.py --help

# Single Server
python .claude/scripts/with_server.py \
  --server "npm run dev" --port 5173 \
  -- python test_script.py

# Multi-Server (Backend + Frontend)
python .claude/scripts/with_server.py \
  --server "cd backend && python server.py" --port 3000 \
  --server "cd frontend && npm run dev" --port 5173 \
  -- python test_script.py
```

## Writing Playwright Scripts

Automation scripts contain only Playwright logic — servers are managed by `with_server.py`:

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')  # CRITICAL: Wait until JS is loaded

    # ... automation logic ...

    browser.close()
```

## Reconnaissance-then-Action Pattern

### 1. Inspect
```python
# Take screenshot
page.screenshot(path='/tmp/inspect.png', full_page=True)

# Inspect DOM
content = page.content()

# Discover elements
buttons = page.locator('button').all()
links = page.locator('a[href]').all()
inputs = page.locator('input, textarea, select').all()
```

### 2. Identify Selectors
Derive correct selectors from screenshot or DOM.

### 3. Execute Actions
```python
page.click('text=Dashboard')
page.fill('#email', 'test@example.com')
page.click('button[type="submit"]')
```

## Capturing Console Logs

```python
console_logs = []

def handle_console(msg):
    console_logs.append(f"[{msg.type}] {msg.text}")

page.on("console", handle_console)
page.goto('http://localhost:5173')
page.wait_for_load_state('networkidle')

# Evaluate logs after interactions
for log in console_logs:
    if log.startswith("[error]"):
        print(f"CONSOLE ERROR: {log}")
```

## Important Rules

- **Always `headless=True`** — no GUI needed
- **Always `wait_for_load_state('networkidle')`** before DOM inspection on dynamic apps
- **Always close browser** at the end (`browser.close()`)
- **Use descriptive selectors**: `text=`, `role=`, CSS selectors, IDs
- **Save screenshots to `/tmp/`** and verify via Read tool

## Common Mistake

Do not inspect the DOM before `networkidle` is reached — on dynamic apps the initial DOM is empty/incomplete.

## Verification Checklist

- [ ] Page loads without console errors
- [ ] Key UI elements are visible (check screenshot)
- [ ] Interactive elements respond correctly (click, fill, submit)
- [ ] Responsive layout works (test various viewports)
- [ ] No unexpected warnings or errors in console logs
