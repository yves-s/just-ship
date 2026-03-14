---
name: webapp-testing
description: Use after frontend implementation to verify rendered UI matches expectations, catch browser errors, and test interactive elements
---

# Web Application Testing

Visual testing of local web applications with Playwright. Verifies frontend functionality, captures browser errors, and takes screenshots.

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
