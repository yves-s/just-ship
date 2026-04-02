# Intake Proposal & Kalkulation — Design Spec

**Date:** 2026-04-02
**Status:** Draft
**Repo:** just-ship-board

---

## Problem

Nach einem Sales-Call liegen alle Infos vor (read.ai Aufnahme, Screenshots, Notizen), aber es gibt keinen strukturierten Weg von Intake → Kalkulation → Angebot → Zusage. Preise müssen manuell recherchiert werden, Vergleichspreise fehlen, und es gibt keine überzeugende Angebotsseite die man dem Kunden schicken kann.

## Lösung

Erweiterung des bestehenden Intake-Systems um automatische AI-Kalkulation und eine öffentliche Angebotslandingpage. Wertbasierte Preisfindung statt Time & Material.

## Ansatz

**Proposal als Intake-Erweiterung (Ansatz A):** Keine neue Entität, sondern neue Spalten auf der bestehenden `project_intakes` Tabelle. Intake und Angebot sind eine logische Einheit.

---

## Datenmodell

Neue Spalten auf `project_intakes`:

| Spalte | Typ | Zweck |
|---|---|---|
| `proposal_token` | `TEXT UNIQUE` | Separater Token für Angebotsseite (Base64-URL-safe, 32 Bytes) |
| `proposal_status` | `TEXT` | `draft` → `sent` → `viewed` → `accepted` |
| `proposal_price` | `NUMERIC` | Wertbasierter Angebotspreis in EUR |
| `proposal_comparison` | `JSONB` | AI-generierte Vergleichspreise |
| `proposal_scope` | `JSONB` | AI-generierte Scope-Zusammenfassung |
| `proposal_advantages` | `JSONB` | Just Ship Vorteile vs. Alternativen |
| `proposal_urgency` | `JSONB` | Urgency-Trigger Config (optional) |
| `proposal_accepted_at` | `TIMESTAMPTZ` | Zeitpunkt der Annahme |
| `proposal_viewed_at` | `TIMESTAMPTZ` | Erster Aufruf der Angebotsseite |

`proposal_token` ist bewusst separat vom Intake-Token — Client kann Intake ausfüllen ohne Zugriff auf das Angebot.

### JSONB Strukturen

**proposal_comparison:**
```json
{
  "freelancer": { "price": 25000, "timeline": "3–4 Monate", "currency": "EUR" },
  "internal": { "price": 45000, "timeline": "2–3 Monate", "currency": "EUR" },
  "agency": { "price": 60000, "timeline": "4–6 Monate", "currency": "EUR" }
}
```

**proposal_scope:**
```json
{
  "summary": "Eine moderne Web-Applikation mit...",
  "features": ["Auth & User Management", "Produktkatalog", ...],
  "deliverables": ["Web App", "Admin Panel", ...]
}
```

**proposal_advantages:**
```json
[
  { "icon": "rocket", "title": "2 Tage statt Monate", "description": "AI-gestützte Entwicklung..." },
  { "icon": "refresh", "title": "24/7 Entwicklung", "description": "..." },
  { "icon": "check", "title": "Fixpreis, kein Risiko", "description": "..." },
  { "icon": "shield", "title": "Production-Ready Qualität", "description": "..." }
]
```

**proposal_urgency:**
```json
{
  "discount_percent": 10,
  "deadline_days": 7,
  "expires_at": "2026-04-15T00:00:00Z",
  "message": "10% Rabatt bei Annahme innerhalb von 7 Tagen"
}
```

---

## Kalkulations-Flow

### Trigger
Automatisch wenn der Intake-Status auf `ready` wechselt (= Client hat 100% der Fragen beantwortet). Zu diesem Zeitpunkt liegen vor: die initiale AI-Analyse (`ai_analysis`), alle beantworteten Fragen (`intake_items`), und eventuelle Datei-Uploads (`intake_files`).

**Nicht** bei der initialen Analyse — die läuft früh im Lifecycle und generiert erst die Fragen. Die Kalkulation braucht die vollständigen Antworten für eine sinnvolle Preisschätzung.

### Ablauf
1. Client beantwortet letzte Frage → `completion_percent` erreicht 100% → Status wechselt auf `ready`
2. Status-Wechsel triggert Kalkulations-Call (im `PATCH /api/intake/[token]` Handler, wenn Status auf `ready` wechselt)
3. Kalkulations-AI wird aufgerufen mit:
   - `ai_analysis` (Projekttyp, Komplexität, Features — bereits vorhanden)
   - Alle `intake_items` mit Antworten
   - `intake_files` Kontext (falls vorhanden)
   - Pricing-Knowledge-Base als System-Context
4. AI generiert: `proposal_price`, `proposal_comparison`, `proposal_scope`, `proposal_advantages`
5. Ergebnis wird in die Intake-Zeile geschrieben
6. `proposal_status` = `draft`, `proposal_token` wird generiert

### Kalkulations-Endpoint
Kein separater Endpoint. Die Kalkulation wird inline im bestehenden `PATCH /api/intake/[token]` getriggert, wenn der Status auf `ready` wechselt. Alternativ kann sie über einen neuen Button im Admin-View manuell re-getriggert werden (z.B. nach Scope-Änderungen).

### AI-Kalkulation
- Modell: Claude Sonnet 4 (wie bestehende Analyse)
- Input: Intake-Daten + AI-Analyse + vollständige Antworten + Pricing-Knowledge-Base
- Output: Strukturierte JSON-Antwort mit allen Proposal-Feldern
- Wertbasiert: Preis basiert auf Kundennutzen, nicht auf Stunden/Aufwand

---

## Pricing Knowledge Base

**Datei:** `src/lib/intake/pricing-knowledge.ts`

Einmal recherchierte, statische Marktdaten die der AI als Kontext mitgegeben werden:

| Kategorie | Datenpunkte |
|---|---|
| **Freelancer** | Stundensätze nach Skill-Level (Junior/Mid/Senior), Region (DACH, Osteuropa, Global), typische Projektdauern nach Komplexität |
| **Interner Entwickler** | Vollkosten/Jahr (Gehalt + Sozialabgaben + Tooling + Overhead), Recruiting-Dauer, Onboarding-Zeit |
| **Agentur** | Tagessätze, typische Team-Zusammensetzung, Overhead-Faktoren |
| **Projekttyp-Benchmarks** | Typische Preisranges nach Projekttyp (Landing Page, Web App, E-Commerce, SaaS, Mobile App) |
| **Just Ship Referenz** | Tatsächliche Lieferzeiten, Qualitätsmetriken, Vorteile-Katalog |

Initiales Befüllen via Deep Research. Danach statische Pflege — kein Live-Research bei jeder Kalkulation.

---

## Backend — Intake-Detail & Proposal-Management

### Intake-Detail-View (Admin)
Neuer Bereich im bestehenden Intake-Detail:

- **Kalkulations-Panel:**
  - Angebotspreis (editierbar — AI-Vorschlag, manuell überschreibbar)
  - Scope-Zusammenfassung (editierbar)
  - Vergleichspreise (Freelancer, Interner Dev, Agentur — jeweils Preis + Timeline)
  - Urgency-Trigger Konfiguration (optional, manuell gesetzt)
  - Proposal-Status Badge (`draft` / `sent` / `viewed` / `accepted`)
  - "Link kopieren" Button — kopiert Proposal-URL in Zwischenablage
  - `proposal_viewed_at` und `proposal_accepted_at` Timestamps

### API-Erweiterungen

| Methode | Route | Zweck | Auth |
|---|---|---|---|
| `PATCH` | `/api/intakes/[id]` | Erweitert um Proposal-Felder (Preis, Urgency) | Supabase JWT |
| `GET` | `/api/proposal/[token]` | Public — liefert Proposal-Daten, setzt `viewed_at` | Token-basiert |
| `POST` | `/api/proposal/[token]/accept` | Public — setzt Status `accepted`, speichert Timestamp | Token-basiert |

Kein neuer Auth-Mechanismus — Proposal-Routes nutzen Token-basierte Auth wie die bestehenden Intake-Routes. Public Routes verwenden `createServiceClient()` (Service Role) um RLS zu bypassen, genau wie die bestehenden Public-Intake-Routes.

---

## Angebotslandingpage

**Route:** `/proposal/[token]` (public, im Board)

### Seitenaufbau (von oben nach unten)
1. **Header** — Just Ship Logo + "Angebot für [Kundenname]"
2. **Projekt-Scope** — Titel, Zusammenfassung, Feature-Grid (2 Spalten)
3. **Preisvergleich** — 3 Karten: Freelancer / Interner Entwickler / Agentur (rot, teuer)
4. **Just Ship Preis** — Groß, grün, prominent mit "Fertig in 2 Tagen"
5. **Urgency-Trigger** — Optional, z.B. "10% Rabatt bei Annahme innerhalb 7 Tagen"
6. **Vorteile** — 4 Punkte: Geschwindigkeit, 24/7, Fixpreis, Qualität
7. **CTA** — "Angebot annehmen" Button
8. **Footer** — Just Ship Branding

### Design-Prinzipien
- Dark Theme (#0a0a0a Hintergrund)
- Zentriertes Layout, max-width 800px
- Du-Form durchgehend (kein "Sie")
- Vergleichspreise in Rot (#ef4444) — teuer und langsam
- Just Ship Preis in Grün (#22c55e) — günstig und schnell
- Mobile-responsive

### Interaktion
- "Link kopieren" im Admin-View setzt Status von `draft` → `sent`
- Erster Aufruf der Proposal-Seite setzt `proposal_viewed_at` + Status `viewed`
- "Angebot annehmen" Button → `POST /api/proposal/[token]/accept`
- Nach Annahme: Bestätigungsanzeige, Status `accepted`
- v1: Keine aktive Notification — Admin sieht Status-Update im Board (Proposal-Status Badge wechselt)

---

## Gesamtflow

```
Client füllt Intake aus
        ↓
AI analysiert (existiert)
        ↓
AI kalkuliert (NEU) — automatisch bei Status "ready"
  → proposal_price, comparison, scope, advantages
  → proposal_token generiert, status = "draft"
        ↓
Admin sieht Ergebnis im Intake-Detail
  → Preis anpassen (optional)
  → Urgency-Trigger konfigurieren (optional)
  → Link kopieren → status = "sent"
        ↓
Admin schickt Link manuell (Email, Chat, etc.)
        ↓
Kunde öffnet /proposal/[token]
  → status = "viewed", viewed_at gesetzt
        ↓
Kunde klickt "Angebot annehmen"
  → status = "accepted", accepted_at gesetzt
  → Admin sieht Status-Update im Board
        ↓
Admin entscheidet wann es losgeht
```

---

## Nicht im Scope (v1)

- Automatischer Email-Versand des Links
- Automatisches Starten nach Annahme
- Mehrere Angebote pro Intake
- PDF-Export
- Zahlungsintegration
- Angebots-Versionierung
- CRO-Optimierung der Angebotsseite (Follow-up)

---

## Betroffene Dateien (Board-Repo)

### Neu
- `supabase/migrations/XXX_proposal_columns.sql` — Migration für neue Spalten
- `src/app/proposal/[token]/page.tsx` — Public Angebotsseite
- `src/app/api/proposal/[token]/route.ts` — GET Proposal-Daten
- `src/app/api/proposal/[token]/accept/route.ts` — POST Annahme
- `src/lib/intake/pricing-knowledge.ts` — Pricing Knowledge Base
- `src/lib/intake/calculate-proposal.ts` — Kalkulations-Logik (AI-Call)

### Geändert
- `src/lib/types/intake.ts` — Neue Felder im IntakeType
- `src/app/api/intake/[token]/route.ts` — Kalkulation triggern bei Status-Wechsel auf `ready`
- `src/components/intake/intake-detail-view.tsx` — Kalkulations-Panel im Admin-View
- `src/lib/validations/intake.ts` — Schema erweitern um Proposal-Felder
- `src/app/api/intakes/[id]/route.ts` — PATCH erweitert um Proposal-Felder
