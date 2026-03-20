# Onboarding Flow Fix — Design Spec

> Alle Onboarding-Wege von Null zur funktionierenden just-ship Installation schließen.

## Problem

Es gibt 5 verschiedene Wege, wie ein User zu just-ship kommt. Keiner davon ist durchgängig geführt. Zwischen Board und CLI gibt es keinen bidirektionalen Verweis — egal wo der User einsteigt, landet er irgendwann in einer Sackgasse.

### Identifizierte Flows

| # | Flow | Beschreibung |
|---|------|-------------|
| 1 | CLI-First → Board | Pipeline installieren → Board registrieren → Workspace → Projekt |
| 2 | Board-First → CLI | Board finden → Registrieren → Workspace → Projekt → CLI installieren |
| 3 | CLI-Only → Später Board | CLI nutzen → Später Board verbinden wollen |
| 4 | VPS-Deployment | Server aufsetzen → Repo klonen → setup.sh → .env konfigurieren |
| 5 | Team-Mitglied | Repo klonen → project.json existiert → Board-Zugang fehlt |

### Identifizierte Lücken (9 Stück)

1. Nach Workspace-Erstellung im Board kommt KEIN Hinweis wo API Key / Workspace ID zu finden sind
2. /connect-board fragt nach 4 Werten ohne zu erklären wo sie im Board sind
3. Nach Projekt-Erstellung im Board gibt es keine Anleitung was als nächstes zu tun ist
4. Board-First User weiß nicht dass eine CLI/Pipeline existiert
5. Selbst wenn CLI gefunden, müssen Werte ohne Hilfestellung aus dem Board kopiert werden
6. /connect-board setzt Board-Konto voraus, kein Fallback für neue User
7. Kein "Du hast noch kein Board-Konto?" Registrierungs-Hinweis in der CLI
8. Team-Mitglied bekommt keine Anleitung für Workspace-Zugang
9. /setup-just-ship erkennt nicht dass project.json schon existiert und nur Board-Verbindung fehlt

## Lösungsansatz: Bidirektional (Board + CLI verbessern)

Beide Seiten kennen einander und führen zum jeweils nächsten Schritt.

---

## 1. Verbindungs-Code Format (`jsp_`)

**Format:** Base64-encoded JSON mit `jsp_` Prefix.

**Beispiel:**
```
jsp_eyJ3IjoibXktd29ya3NwYWNlIiwiaSI6IjEyMzQ1Njc4LTEyMzQtMTIzNC0xMjM0LTEyMzQ1Njc4OTAxMiIsImsiOiJhZHBfYWJjMTIzZGVmNDU2In0=
```

**Decoded JSON:**
```json
{
  "b": "https://board.just-ship.io",
  "w": "my-workspace",
  "i": "12345678-1234-1234-1234-123456789012",
  "k": "adp_abc123def456"
}
```

**Felder:**
- `v` — Format-Version (aktuell: `1`)
- `b` — Board URL
- `w` — Workspace Slug
- `i` — Workspace ID (UUID)
- `k` — API Key (`adp_` Prefix)

**Decoded JSON (mit Version):**
```json
{
  "v": 1,
  "b": "https://board.just-ship.io",
  "w": "my-workspace",
  "i": "12345678-1234-1234-1234-123456789012",
  "k": "adp_abc123def456"
}
```

**Generiert von:** Board (Workspace Settings + Onboarding Stepper)
**Konsumiert von:** CLI (/connect-board — Smart Detection via `jsp_` Prefix)

**Versionierung:** Das `v` Feld ermöglicht zukünftige Erweiterungen (z.B. Project ID, Ablaufdatum). Parser prüfen `v` und ignorieren unbekannte Felder.

**Sicherheitshinweis:** Base64 ist Encoding, keine Verschlüsselung. Der `jsp_` String enthält den API Key im Klartext. Akzeptiertes Risiko: Der API Key ist workspace-level und hat die gleiche Lebensdauer wie ein manuell kopierter Key. Das Board zeigt einen Warnhinweis ("Nicht teilen"). Zukünftige Verbesserung: One-Time-Use Connection Tokens statt langlebiger API Keys (eigenes Feature, nicht in diesem Scope).

---

## 2. Board-Änderungen

### 2.1 Post-Registration Onboarding Stepper

**Trigger:** Nach erstem Login / Workspace-Erstellung.
**Verhalten:** Persistenter Progress-Tracker, bleibt sichtbar bis alle Schritte erledigt.

**4 Schritte:**
1. ✓ Registrieren
2. ✓ Workspace erstellen
3. Projekt verbinden (zeigt `jsp_` Code + Copy-Button + `/connect-board` Anleitung + curl-Befehl)
4. Erstes Ticket erstellen

**Schritt 3 "Projekt verbinden" enthält:**
- curl-Befehl für CLI-Installation: `curl -fsSL https://just-ship.io/install | bash`
- Verbindungs-Code (`jsp_...`) prominent mit Copy-Button
- Anleitung: "In Claude Code `/connect-board` ausführen und Code einfügen"

**Verschwindet:** Sobald alle 4 Schritte erledigt (mindestens ein Projekt connected + ein Ticket erstellt).

### 2.2 Workspace Settings → Connect

**Trigger:** Immer verfügbar unter Workspace Settings.
**Zweck:** Permanente Referenz für den Verbindungs-Code.

**Inhalte:**
- Verbindungs-Code (`jsp_...`) prominent mit Copy-Button
- Einzelwerte als Fallback:
  - Board URL
  - Workspace Slug
  - Workspace ID
  - API Key (mit Show/Hide Toggle)
- Schritt-für-Schritt Anleitung (Claude Code öffnen → /connect-board → Code einfügen)

### 2.3 Projekt "Getting Started"

**Trigger:** Projekt im Board existiert, aber kein Pipeline-Event empfangen.
**Verhalten:** "Not Connected" Badge + Verbindungs-Anleitung.

**Inhalte:**
- Badge: "Not Connected" am Projekt-Titel
- Hinweis: "Dieses Projekt ist noch nicht mit der CLI verbunden"
- Verweis auf /connect-board + Verbindungs-Code (→ Workspace Settings)
- Link: "Noch keine CLI? Installation Guide →"

**Verschwindet:** Nach erstem Pipeline-Event (task_event mit matching project_id).

---

## 3. CLI-Änderungen

### 3.1 /connect-board — 2-Wege-Flow mit Smart Detection

**Einstiegsfrage (wenn keine bestehenden Workspaces):**
```
Board verbinden

  1. Ich habe den Key — API Key aus dem Board kopiert
  2. Ich bin neu — Ich brauche erst ein Board-Konto
```

**Bei bestehenden Workspaces:** Zusätzlich Liste der verbundenen Workspaces mit Option bestehenden zu nutzen.

#### Weg 1: "Ich habe den Key"

Eingabefeld mit Smart Detection:

```
Füge den API Key oder Verbindungs-Code aus dem Board ein:

→ [Eingabe]
```

**Smart Detection:**
- Eingabe startet mit `jsp_` → Base64 dekodieren, alle Werte extrahieren, sofort verbinden
- Eingabe startet mit `adp_` → API Key erkannt, restliche Werte mit Feld-Hints nachfragen
- Alles andere → Fehlermeldung mit Hilfe

**Slug-Kollision:** Wenn ein Workspace mit gleichem Slug aber anderer Board URL bereits existiert, zeigt die CLI: "Workspace '{slug}' ist bereits mit {andere-url} verbunden. Neuen Slug vergeben oder bestehende Verbindung aktualisieren?"

**Feld-Hints bei manuellem Weg (`adp_` erkannt):**

| Feld | Hint | Default |
|------|------|---------|
| Board URL | "Die URL deines Boards. Meistens board.just-ship.io" | ✓ Enter für Default |
| Workspace Slug | "Steht in der URL: board.just-ship.io/**{slug}**" | — |
| Workspace ID | "Board → Workspace Settings → General → Workspace ID" | — |

**Erfolgsausgabe:**
```
✓ Workspace "my-workspace" verbunden
✓ Credentials gespeichert
✓ project.json aktualisiert

Nächster Schritt: /add-project um ein Board-Projekt zu verknüpfen
```

**Hinweis:** Der `jsp_` String ist workspace-level — er enthält keine Project ID. Die Projekt-Verknüpfung ist immer ein separater Schritt via `/add-project`.

#### Weg 2: "Ich bin neu"

```
Willkommen bei just-ship!

So geht's:
  1. Registriere dich: https://board.just-ship.io/register
  2. Erstelle einen Workspace
  3. Du bekommst direkt den Verbindungs-Code angezeigt — kopiere ihn
  4. Führe /connect-board erneut aus und füge ihn ein

Das Board führt dich durch alle Schritte.
```

#### Fehlerfall

Ungültiger `jsp_` String → Fehlermeldung + Fallback auf manuellen Weg:
```
✗ Verbindungs-Code ungültig
Der Code konnte nicht dekodiert werden. Kopiere ihn erneut aus dem Board.

Erneut versuchen oder manuell eingeben?
  1. Erneut versuchen
  2. Manuell eingeben
```

### 3.2 /setup-just-ship — Bestehende Config erkennen

**Neues Verhalten:** Wenn project.json bereits existiert (z.B. geklontes Repo), erkennt /setup-just-ship dass das Projekt bereits eingerichtet ist und bietet gezielt die fehlenden Schritte an.

```
✓ project.json gefunden (Next.js 15, Supabase, TypeScript)
✓ CLAUDE.md gefunden
✓ .claude/agents/ vorhanden
⚠ Board nicht verbunden

Projekt ist bereits eingerichtet. Board verbinden?
  1. Ja, Board verbinden → /connect-board
  2. Nein, CLI-only
  3. Setup komplett neu → Stack-Erkennung + Config überschreiben
```

**Löst:** Flow 5 (Team-Mitglied klont Repo).

### 3.3 write-config.sh — jsp_ Parsing

**Neuer Subcommand oder Erweiterung von `add-workspace`:**

`write-config.sh` muss `jsp_` Strings dekodieren können:
1. `jsp_` Prefix strippen
2. Base64 dekodieren
3. JSON parsen (Felder: b, w, i, k)
4. Validieren (alle Felder vorhanden, k startet mit `adp_`, i ist UUID)
5. An bestehende `add-workspace` Logik übergeben

---

## 4. Abdeckungsmatrix

| Flow | Stepper | Settings Connect | Getting Started | /connect-board | /setup-just-ship |
|------|---------|-----------------|-----------------|----------------|-----------------|
| 1. CLI-First → Board | ✓ | ✓ | ~ | ✓ | ~ |
| 2. Board-First → CLI | ✓ | ✓ | ✓ | ✓ | ~ |
| 3. CLI-Only → Später Board | ~ | ✓ | ~ | ✓ | ~ |
| 4. VPS-Deployment | — | ✓ | — | ~ | — |
| 5. Team-Mitglied | ~ | ✓ | ~ | ✓ | ✓ |

✓ = direkt gelöst, ~ = indirekt/teilweise, — = nicht relevant

**VPS-Hinweis:** VPS nutzt `~/.just-ship/config.json` identisch, aber die Verbindung erfolgt via Flags/Env-Vars statt interaktivem Flow. Der Settings Connect Screen im Board hilft beim Nachschlagen der Werte.

---

## 5. Scope

### Im Scope
- `jsp_` String-Format mit Versionierung (Generierung im Board + Parsing in CLI)
- Board: Onboarding Stepper + Settings Connect + Getting Started Badge
- CLI: /connect-board Redesign mit 2-Wege-Flow + Smart Detection + Feld-Hints
- CLI: /setup-just-ship bestehende Config Erkennung
- `write-config.sh`: `jsp_` Parsing Support
- Template-Migration: `project.json` Template auf neues Format (workspace statt api_key)

### Nicht im Scope
- Team-Invite System (eigenes Feature)
- OAuth/Browser-Auth Flow
- One-Time-Use Connection Tokens (Sicherheits-Verbesserung, eigenes Feature)
- VPS-spezifische Onboarding-Änderungen
- Board UI Redesign über die 3 Screens hinaus
