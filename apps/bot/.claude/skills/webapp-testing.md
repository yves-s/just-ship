---
name: webapp-testing
description: Use after frontend implementation to visually verify UI behavior — screenshots, DOM inspection, console log capture, and interactive testing via Playwright
---

# Web Application Testing

Visuelles Testing lokaler Web-Applikationen mit Playwright. Verifiziert Frontend-Funktionalität, fängt Browser-Errors und macht Screenshots.

**Announce at start:** "Starting visual verification with Playwright."

## Voraussetzung

Playwright muss installiert sein:
```bash
pip install playwright && playwright install chromium
```

## Decision Tree

```
Aufgabe -> Statisches HTML?
    |-- Ja -> HTML-Datei lesen, Selektoren identifizieren
    |          |-- Playwright-Script mit file:// URL
    |
    |-- Nein (dynamische App) -> Server schon gestartet?
        |-- Nein -> with_server.py nutzen (siehe unten)
        |-- Ja  -> Reconnaissance-then-Action:
            1. Navigieren + networkidle abwarten
            2. Screenshot oder DOM inspizieren
            3. Selektoren aus gerenderten Zustand identifizieren
            4. Aktionen mit gefundenen Selektoren ausführen
```

## Server-Lifecycle mit with_server.py

Das Framework enthält `.claude/scripts/with_server.py` — startet Server, wartet auf Port-Readiness, führt Automation aus, räumt auf.

```bash
# --help zuerst ausführen um Optionen zu sehen
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

## Playwright-Script schreiben

Automation-Scripts enthalten nur Playwright-Logik — Server werden von `with_server.py` verwaltet:

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')  # KRITISCH: Warten bis JS geladen

    # ... Automation-Logik ...

    browser.close()
```

## Reconnaissance-then-Action Pattern

### 1. Inspizieren
```python
# Screenshot machen
page.screenshot(path='/tmp/inspect.png', full_page=True)

# DOM inspizieren
content = page.content()

# Elemente entdecken
buttons = page.locator('button').all()
links = page.locator('a[href]').all()
inputs = page.locator('input, textarea, select').all()
```

### 2. Selektoren identifizieren
Aus Screenshot oder DOM die richtigen Selektoren ableiten.

### 3. Aktionen ausführen
```python
page.click('text=Dashboard')
page.fill('#email', 'test@example.com')
page.click('button[type="submit"]')
```

## Console-Logs erfassen

```python
console_logs = []

def handle_console(msg):
    console_logs.append(f"[{msg.type}] {msg.text}")

page.on("console", handle_console)
page.goto('http://localhost:5173')
page.wait_for_load_state('networkidle')

# Nach Interaktionen Logs auswerten
for log in console_logs:
    if log.startswith("[error]"):
        print(f"CONSOLE ERROR: {log}")
```

## Wichtige Regeln

- **Immer `headless=True`** — kein GUI nötig
- **Immer `wait_for_load_state('networkidle')`** vor DOM-Inspektion bei dynamischen Apps
- **Immer Browser schliessen** am Ende (`browser.close()`)
- **Deskriptive Selektoren** verwenden: `text=`, `role=`, CSS-Selektoren, IDs
- **Screenshots nach `/tmp/`** speichern und per Read Tool verifizieren

## Häufiger Fehler

Nicht den DOM inspizieren bevor `networkidle` erreicht ist — bei dynamischen Apps ist der initiale DOM leer/unvollständig.

## Verifikations-Checkliste

- [ ] Seite lädt ohne Console-Errors
- [ ] Wichtige UI-Elemente sind sichtbar (Screenshot prüfen)
- [ ] Interaktive Elemente reagieren korrekt (Click, Fill, Submit)
- [ ] Responsive Layout stimmt (verschiedene Viewports testen)
- [ ] Keine unerwarteten Warnungen oder Errors in Console-Logs
