# Proposal Prototype Embed — Design Spec

**Date:** 2026-04-02
**Status:** Draft
**Repo:** just-ship-board

---

## Problem

Die Angebotsseite zeigt Scope, Preise und Vorteile — aber der Kunde muss sich das Endprodukt vorstellen. Ein interaktiver Prototyp direkt im Angebot ist der emotionale Closer: nach den rationalen Argumenten sieht der Kunde sein Produkt schon vor sich, direkt gefolgt vom "Angebot annehmen" Button.

## Lösung

Admin kann eine HTML-Datei (Prototyp) hochladen, die als iframe auf der Angebotsseite angezeigt wird. Preview-Höhe (600px) mit Fullscreen-Toggle. Rein manueller Flow — keine Auto-Generierung.

## Ansatz

Minimale Erweiterung des bestehenden Intake/Proposal-Systems: zwei neue Spalten auf `project_intakes`, Upload im Admin Proposal-Panel, iframe-Rendering auf der Angebotsseite.

---

## Datenmodell

Neue Spalten auf `project_intakes`:

| Spalte | Typ | Zweck |
|---|---|---|
| `prototype_file_path` | `TEXT` | Storage-Pfad der HTML-Datei im Supabase `intake-files` Bucket |
| `prototype_filename` | `TEXT` | Originaler Dateiname für Anzeige im Admin |

Kein neuer Bucket — nutzt den bestehenden `intake-files` Storage Bucket. Dateien werden unter dem Prefix `prototypes/{intake_id}/{filename}` gespeichert.

---

## Admin-Flow

### Proposal-Panel Erweiterung

Im bestehenden `ProposalPanel` Komponente (in `src/components/intake/proposal-panel.tsx`) kommt ein neuer Bereich hinzu:

**Prototyp-Upload:**
- Drag & Drop / Click-Upload für eine einzelne HTML-Datei
- Akzeptiert nur `.html` Dateien (MIME: `text/html`)
- Nach Upload: Dateiname + "Vorschau" Link + "Löschen" Button
- Upload-Flow:
  1. Datei wird an Supabase Storage `intake-files` Bucket hochgeladen unter `prototypes/{intake_id}/{filename}`
  2. `PATCH /api/intakes/[id]` setzt `prototype_file_path` und `prototype_filename`
- Löschen: Entfernt Datei aus Storage, setzt beide Felder auf `null`

**Wenn kein Prototyp vorhanden:** Upload-Zone anzeigen
**Wenn Prototyp vorhanden:** Dateiname, Vorschau-Link, Löschen-Button

### API

Kein neuer Endpoint nötig. Der bestehende `PATCH /api/intakes/[id]` akzeptiert bereits beliebige Felder aus `updateIntakeSchema`. Die Schema-Erweiterung um `prototype_file_path` und `prototype_filename` reicht.

Für den Storage-Upload wird direkt der Supabase Client aus der Komponente genutzt (authenticated, workspace-scoped via RLS).

---

## Angebotsseite — Prototyp-Einbettung

### Position
Zwischen "Warum Just Ship" (Advantages) und dem CTA-Button ("Angebot annehmen").

### Rendering

**Wenn `prototype_file_path` gesetzt:**

1. **Sektion-Header:**
   - Label: "Ein erster Einblick" (uppercase, klein, #666)
   - Titel: "Dein Produkt als Prototyp" (groß, weiß)
   - Subtitle: "Interaktiver Prototyp — klick dich durch" (#888)

2. **iframe Preview:**
   - Source: Supabase Storage public URL (`{SUPABASE_URL}/storage/v1/object/public/intake-files/{prototype_file_path}`)
   - Max-width: 600px, zentriert
   - Höhe: 600px (fest)
   - Border-radius: 16px, Border: 2px solid #222
   - Gradient-Overlay am unteren Rand (transparent → #141414) als visueller Teaser-Effekt
   - Sandbox: `sandbox="allow-scripts allow-same-origin"` — Prototyp kann JS ausführen, aber nicht aus dem iframe ausbrechen

3. **Vollbild-Button:**
   - Text: "Vollbild anzeigen" mit Expand-Icon
   - Unter dem iframe, zentriert
   - Style: #222 Background, #e5e5e5 Text, Border #333

4. **Fullscreen-Modal:**
   - Klick auf "Vollbild anzeigen" öffnet Overlay
   - iframe auf 100vw × 100vh
   - X-Button oben rechts + ESC zum Schließen
   - Dark semi-transparent Backdrop

**Wenn `prototype_file_path` nicht gesetzt:**
- Gesamte Prototyp-Sektion wird nicht gerendert. Kein Platzhalter.

### Daten-Flow

Die Server-Component (`src/app/proposal/[token]/page.tsx`) selektiert bereits alle Intake-Felder. Die neuen Felder `prototype_file_path` und `prototype_filename` werden einfach mit durchgereicht an die Client-Component.

---

## Validierung & Sicherheit

- **Dateityp:** Nur `.html` Dateien akzeptiert (Client-side + Storage MIME check)
- **Dateigröße:** Max 5 MB (ein HTML-Prototyp mit inline CSS/JS sollte weit darunter liegen)
- **iframe Sandbox:** `allow-scripts allow-same-origin` — JS läuft, aber kein Zugriff auf Parent-Frame
- **Storage:** Nutzt bestehenden `intake-files` Bucket mit RLS — nur Workspace-Members können hochladen
- **Public Access:** Die HTML-Datei muss über eine public Storage URL erreichbar sein (der Bucket hat bereits public read Policies für intake-files)

---

## Betroffene Dateien (Board-Repo)

### Neu
- `supabase/migrations/022_prototype_columns.sql` — Migration für neue Spalten

### Geändert
- `src/lib/types/intake.ts` — Neue Felder `prototype_file_path`, `prototype_filename` auf `ProjectIntake`
- `src/lib/validations/intake.ts` — Schema erweitern um Prototyp-Felder
- `src/components/intake/proposal-panel.tsx` — Upload-UI für Prototyp hinzufügen
- `src/app/proposal/[token]/page.tsx` — `prototype_file_path` mit selektieren und an Client weiterreichen
- `src/app/proposal/[token]/proposal-page-client.tsx` — Prototyp-Sektion + Fullscreen-Modal rendern

---

## Nicht im Scope (v1)

- Auto-Generierung von Prototypen durch AI (Phase 2)
- Mehrere Prototypen pro Intake
- Prototyp-Versionierung
- Prototyp im Client-Intake-Flow (nur auf Angebotsseite)
- Prototyp-Editor im Board
- Thumbnail/Screenshot-Generierung
