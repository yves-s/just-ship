# Intake Proposal & Kalkulation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing intake system with automatic AI-powered pricing calculation and a public proposal landing page for value-based offers.

**Architecture:** New columns on `project_intakes` table (no new entity). Kalkulation auto-triggers when intake reaches `ready` status. Public proposal page at `/proposal/[token]` with accept flow. Admin sees kalkulation panel in existing intake detail view.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Supabase (PostgreSQL), Anthropic SDK (Claude Sonnet 4), TanStack Query 5

**Spec:** `docs/superpowers/specs/2026-04-02-intake-proposal-kalkulation-design.md`

**Target Repo:** `/Users/yschleich/Developer/just-ship-board/`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `supabase/migrations/021_proposal_columns.sql` | DB migration — new columns on `project_intakes` |
| `src/lib/intake/pricing-knowledge.ts` | Static market data for AI pricing context |
| `src/lib/intake/calculate-proposal.ts` | AI kalkulation logic — calls Claude, returns structured pricing |
| `src/lib/intake/proposal-prompts.ts` | System + user prompts for pricing AI |
| `src/app/api/proposal/[token]/route.ts` | Public GET — fetch proposal data, set `viewed_at` |
| `src/app/api/proposal/[token]/accept/route.ts` | Public POST — accept proposal |
| `src/app/proposal/[token]/page.tsx` | Public proposal landing page (SSR) |
| `src/app/proposal/[token]/proposal-page-client.tsx` | Client component for proposal page (accept flow, interactivity) |
| `src/components/intake/proposal-panel.tsx` | Admin panel — price editing, urgency config, link copy |

### Modified Files
| File | Change |
|------|--------|
| `src/lib/types/intake.ts` | Add proposal fields to `ProjectIntake` type |
| `src/lib/validations/intake.ts` | Extend `updateIntakeSchema` with proposal fields |
| `src/lib/constants/intake.ts` | Add proposal status constants |
| `src/app/api/intake/[token]/route.ts` | Trigger kalkulation on `ready` status transition |
| `src/components/intake/intake-detail-view.tsx` | Integrate `ProposalPanel` component |
| `src/app/api/intakes/[id]/route.ts` | Support PATCH for proposal fields |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/021_proposal_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 021_proposal_columns.sql
-- Add proposal/kalkulation columns to project_intakes

ALTER TABLE project_intakes
  ADD COLUMN proposal_token TEXT UNIQUE,
  ADD COLUMN proposal_status TEXT DEFAULT NULL
    CHECK (proposal_status IN ('draft', 'sent', 'viewed', 'accepted')),
  ADD COLUMN proposal_price NUMERIC DEFAULT NULL,
  ADD COLUMN proposal_comparison JSONB DEFAULT NULL,
  ADD COLUMN proposal_scope JSONB DEFAULT NULL,
  ADD COLUMN proposal_advantages JSONB DEFAULT NULL,
  ADD COLUMN proposal_urgency JSONB DEFAULT NULL,
  ADD COLUMN proposal_accepted_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN proposal_viewed_at TIMESTAMPTZ DEFAULT NULL;

-- Index for public proposal page lookup
CREATE UNIQUE INDEX idx_intakes_proposal_token ON project_intakes(proposal_token) WHERE proposal_token IS NOT NULL;
```

- [ ] **Step 2: Apply migration locally**

Run: `cd /Users/yschleich/Developer/just-ship-board && npx supabase db push`

If using remote Supabase, apply via MCP tool `apply_migration` on project `wsmnutkobalfrceavpxs`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/021_proposal_columns.sql
git commit -m "feat: add proposal columns to project_intakes (migration 021)"
```

---

## Task 2: Types, Constants & Validations

**Files:**
- Modify: `src/lib/types/intake.ts`
- Modify: `src/lib/types.ts` (barrel re-export)
- Modify: `src/lib/constants/intake.ts`
- Modify: `src/lib/validations/intake.ts`

- [ ] **Step 1: Extend types**

In `src/lib/types/intake.ts`, add proposal types after the existing `IntakeAiAnalysis` interface (after line 29):

```typescript
export type ProposalStatus = 'draft' | 'sent' | 'viewed' | 'accepted'

export interface ProposalComparison {
  freelancer: { price: number; timeline: string; currency: string }
  internal: { price: number; timeline: string; currency: string }
  agency: { price: number; timeline: string; currency: string }
}

export interface ProposalScope {
  summary: string
  features: string[]
  deliverables: string[]
}

export interface ProposalAdvantage {
  icon: string
  title: string
  description: string
}

export interface ProposalUrgency {
  discount_percent: number
  deadline_days: number
  expires_at: string
  message: string
}
```

Then add proposal fields to the `ProjectIntake` interface (after `updated_at`):

```typescript
  // Proposal fields
  proposal_token: string | null
  proposal_status: ProposalStatus | null
  proposal_price: number | null
  proposal_comparison: ProposalComparison | null
  proposal_scope: ProposalScope | null
  proposal_advantages: ProposalAdvantage[] | null
  proposal_urgency: ProposalUrgency | null
  proposal_accepted_at: string | null
  proposal_viewed_at: string | null
```

- [ ] **Step 1b: Re-export new types from barrel**

In `src/lib/types.ts`, the existing re-export from `./types/intake` needs to include the new types. Find the existing import block and extend it:

```typescript
export type {
  // ... existing exports ...
  IntakeListItem,
  IntakeStatus,
  IntakeItemType,
  IntakeItemCategory,
  // New proposal types
  ProposalStatus,
  ProposalComparison,
  ProposalScope,
  ProposalAdvantage,
  ProposalUrgency,
} from "./types/intake";
```

- [ ] **Step 2: Add proposal constants**

In `src/lib/constants/intake.ts`, add after existing constants:

```typescript
export const PROPOSAL_STATUSES = ['draft', 'sent', 'viewed', 'accepted'] as const

export const PROPOSAL_STATUS_LABELS: Record<string, string> = {
  draft: 'Entwurf',
  sent: 'Gesendet',
  viewed: 'Angesehen',
  accepted: 'Angenommen',
}

export const PROPOSAL_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  viewed: 'bg-yellow-100 text-yellow-700',
  accepted: 'bg-green-100 text-green-700',
}
```

- [ ] **Step 3: Extend validation schema**

In `src/lib/validations/intake.ts`, extend `updateIntakeSchema` (currently lines 28-33) to include proposal fields:

```typescript
export const updateIntakeSchema = z.object({
  title: z.string().max(200).optional(),
  status: z.enum(['sent', 'in_progress', 'waiting', 'ready', 'building', 'archived']).optional(),
  client_name: z.string().max(200).nullable().optional(),
  client_email: z.string().email().nullable().optional(),
  // Proposal fields
  proposal_price: z.number().positive().nullable().optional(),
  proposal_scope: z.object({
    summary: z.string(),
    features: z.array(z.string()),
    deliverables: z.array(z.string()),
  }).nullable().optional(),
  proposal_urgency: z.object({
    discount_percent: z.number().min(0).max(100),
    deadline_days: z.number().positive(),
    expires_at: z.string(),
    message: z.string().max(500),
  }).nullable().optional(),
}).strict()
```

**Note:** The existing schema uses `.strict()` which rejects fields not listed in the schema. Since we've added all proposal fields above, `.strict()` stays — it ensures only valid fields are accepted.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types/intake.ts src/lib/constants/intake.ts src/lib/validations/intake.ts
git commit -m "feat: add proposal types, constants, and validation schemas"
```

---

## Task 3: Pricing Knowledge Base

**Files:**
- Create: `src/lib/intake/pricing-knowledge.ts`

- [ ] **Step 1: Create the pricing knowledge base**

This file contains researched market data that the AI uses as context for pricing. Values are approximate DACH-market benchmarks.

```typescript
export const PRICING_KNOWLEDGE = `
## Market Pricing Reference (DACH Region, 2025/2026)

### Freelancer Rates
- Junior Developer: 60–80 €/h
- Mid-Level Developer: 80–120 €/h
- Senior Developer: 120–180 €/h
- UI/UX Designer: 80–130 €/h
- Average effective rate (blended team): ~100 €/h
- Typical availability: 6–7 productive hours/day
- Project overhead (communication, revisions): +20–30%

### Internal Developer (Vollkosten DACH)
- Junior: 55.000–70.000 €/Jahr Vollkosten
- Mid-Level: 70.000–95.000 €/Jahr Vollkosten
- Senior: 95.000–130.000 €/Jahr Vollkosten
- Vollkosten = Brutto + Sozialabgaben (~21%) + Tooling (~3.000 €/Jahr) + Büro/Overhead (~10.000 €/Jahr)
- Recruiting: 2–4 Monate + 15–25% Jahresgehalt Vermittlung
- Onboarding: 1–3 Monate bis produktiv
- Effective daily rate (Senior, Vollkosten): ~550–650 €/Tag

### Agentur
- Tagessatz pro Person: 800–1.500 €
- Typisches Team: PM (0.5) + Designer (0.5) + 2 Devs (2.0) + QA (0.25) = 3.25 FTE
- Overhead-Faktor: 1.5–2x (Meetings, Abstimmung, Projektmanagement)
- Minimum Engagement: oft 10.000–20.000 €

### Projekttyp-Benchmarks (traditionelle Entwicklung)
| Projekttyp | Freelancer | Interner Dev | Agentur | Dauer (traditionell) |
|---|---|---|---|---|
| Landing Page / Marketing Site | 3.000–8.000 € | 2–4 Wochen | 8.000–20.000 € | 2–6 Wochen |
| Web App (einfach) | 10.000–25.000 € | 1–3 Monate | 25.000–60.000 € | 2–4 Monate |
| Web App (komplex/SaaS) | 25.000–80.000 € | 3–6 Monate | 60.000–150.000 € | 4–8 Monate |
| E-Commerce (Shopify Custom) | 5.000–15.000 € | 1–2 Monate | 15.000–40.000 € | 1–3 Monate |
| E-Commerce (Custom Build) | 20.000–60.000 € | 2–5 Monate | 50.000–120.000 € | 3–6 Monate |
| Mobile App (einfach) | 15.000–40.000 € | 2–4 Monate | 40.000–80.000 € | 3–5 Monate |
| Mobile App (komplex) | 40.000–120.000 € | 4–8 Monate | 80.000–200.000 € | 6–12 Monate |
| Admin Dashboard / Internal Tool | 8.000–25.000 € | 1–3 Monate | 20.000–50.000 € | 2–4 Monate |

### Just Ship Reference
- Delivery time: 1–3 Tage (je nach Komplexität)
- Arbeitsweise: Multi-Agent AI Development, 24/7, parallel
- Qualität: Automatisierte Tests, Security Reviews, Multi-Agent QA
- Fixpreis: Wertbasiert, keine Nachforderungen
- Kein Recruiting, kein Onboarding, kein Projektmanagement-Overhead

### Value-Based Pricing Principles
- Preis orientiert sich am Kundennutzen, nicht am Aufwand
- Just Ship Preis sollte deutlich unter Freelancer-Preis liegen (60–80% günstiger)
- Aber nicht zu niedrig — der Wert ist real, die Qualität ist hoch
- Lieferzeit ist der größte Differentiator (Tage statt Monate)
- Preisrange für Just Ship: typisch 10–30% des Agentur-Preises
`

export const JUST_SHIP_ADVANTAGES = [
  {
    icon: 'rocket',
    title: '2 Tage statt Monate',
    description: 'AI-gestützte Entwicklung liefert in Tagen, was traditionell Monate dauert.',
  },
  {
    icon: 'refresh',
    title: '24/7 Entwicklung',
    description: 'Unsere Agents arbeiten rund um die Uhr — kein Warten auf Verfügbarkeit.',
  },
  {
    icon: 'check',
    title: 'Fixpreis, kein Risiko',
    description: 'Wertbasiertes Angebot — keine versteckten Stunden, keine Nachforderungen.',
  },
  {
    icon: 'shield',
    title: 'Production-Ready Qualität',
    description: 'Multi-Agent QA, Security Reviews und automatisierte Tests — kein MVP-Hack.',
  },
]
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/intake/pricing-knowledge.ts
git commit -m "feat: add pricing knowledge base for AI kalkulation"
```

---

## Task 4: AI Kalkulation Logic

**Files:**
- Create: `src/lib/intake/proposal-prompts.ts`
- Create: `src/lib/intake/calculate-proposal.ts`

- [ ] **Step 1: Create the proposal prompts**

```typescript
// src/lib/intake/proposal-prompts.ts
import { PRICING_KNOWLEDGE } from './pricing-knowledge'

export const PROPOSAL_SYSTEM_PROMPT = `Du bist ein Pricing-Experte für AI-gestützte Softwareentwicklung.

Deine Aufgabe: Erstelle eine wertbasierte Kalkulation für ein Kundenprojekt.

Regeln:
- Preise in EUR, gerundet auf 100er
- Wertbasiert: Preis orientiert sich am Kundennutzen, NICHT am Aufwand
- Just Ship Preis soll 60-80% günstiger als Freelancer sein
- Vergleichspreise realistisch schätzen basierend auf Marktdaten
- Timeline für Alternativen realistisch, für Just Ship in Tagen
- Scope klar und verständlich formulieren, in Du-Form
- Vorteile projektspezifisch formulieren (nicht generisch)

${PRICING_KNOWLEDGE}

Antworte NUR mit validem JSON. Kein Markdown, keine Erklärungen.`

export function buildProposalUserPrompt(input: {
  title: string
  description: string
  aiAnalysis: {
    project_type: string
    complexity: string
    summary: string
    tags: string[]
    gaps: string[]
  }
  answers: Array<{ question: string; answer: string }>
}): string {
  const answersText = input.answers
    .map((a) => \`Q: \${a.question}\\nA: \${a.answer}\`)
    .join('\\n\\n')

  return \`## Projekt: \${input.title}

## Beschreibung
\${input.description}

## AI-Analyse
- Typ: \${input.aiAnalysis.project_type}
- Komplexität: \${input.aiAnalysis.complexity}
- Zusammenfassung: \${input.aiAnalysis.summary}
- Tags: \${input.aiAnalysis.tags.join(', ')}
\${input.aiAnalysis.gaps.length > 0 ? \`- Offene Punkte: \${input.aiAnalysis.gaps.join(', ')}\` : ''}

## Kundeantworten
\${answersText || 'Keine zusätzlichen Antworten'}

## Erwartetes JSON-Format
{
  "price": 4900,
  "comparison": {
    "freelancer": { "price": 25000, "timeline": "3–4 Monate", "currency": "EUR" },
    "internal": { "price": 45000, "timeline": "2–3 Monate", "currency": "EUR" },
    "agency": { "price": 60000, "timeline": "4–6 Monate", "currency": "EUR" }
  },
  "scope": {
    "summary": "Kurze Projektbeschreibung für den Kunden...",
    "features": ["Feature 1", "Feature 2"],
    "deliverables": ["Deliverable 1", "Deliverable 2"]
  },
  "advantages": [
    { "icon": "rocket", "title": "...", "description": "..." },
    { "icon": "refresh", "title": "...", "description": "..." },
    { "icon": "check", "title": "...", "description": "..." },
    { "icon": "shield", "title": "...", "description": "..." }
  ]
}\`
}
```

- [ ] **Step 2: Create the kalkulation function**

```typescript
// src/lib/intake/calculate-proposal.ts
import Anthropic from '@anthropic-ai/sdk'
import { PROPOSAL_SYSTEM_PROMPT, buildProposalUserPrompt } from './proposal-prompts'
import type {
  ProposalComparison,
  ProposalScope,
  ProposalAdvantage,
} from '@/lib/types/intake'

interface CalculateProposalInput {
  title: string
  description: string
  aiAnalysis: {
    project_type: string
    complexity: string
    summary: string
    tags: string[]
    gaps: string[]
  }
  answers: Array<{ question: string; answer: string }>
}

interface CalculateProposalResult {
  price: number
  comparison: ProposalComparison
  scope: ProposalScope
  advantages: ProposalAdvantage[]
}

export async function calculateProposal(
  input: CalculateProposalInput
): Promise<CalculateProposalResult> {
  const client = new Anthropic()

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: PROPOSAL_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildProposalUserPrompt(input),
      },
    ],
  })

  const text =
    response.content[0].type === 'text' ? response.content[0].text : ''

  const parsed = JSON.parse(text) as CalculateProposalResult
  return parsed
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/intake/proposal-prompts.ts src/lib/intake/calculate-proposal.ts
git commit -m "feat: add AI proposal kalkulation with pricing prompts"
```

---

## Task 5: Trigger Kalkulation on Ready Status

**Files:**
- Modify: `src/app/api/intake/[token]/route.ts` (lines 105-110 — where `ready` transition happens)

- [ ] **Step 1: Add kalkulation trigger**

In the PATCH handler of `src/app/api/intake/[token]/route.ts`, after the status transitions to `ready` (around line 105-110), add the kalkulation call.

Find the block where `isReady` is checked and status is updated. After that update, add:

```typescript
import { calculateProposal } from '@/lib/intake/calculate-proposal'
import { randomBytes } from 'crypto'
```

After the `ready` status update block (after the existing supabase update that sets status to `ready`), add:

```typescript
// Trigger proposal kalkulation when intake reaches ready
if (isReady && currentIntake.status !== 'ready') {
  try {
    const proposalResult = await calculateProposal({
      title: currentIntake.title,
      description: currentIntake.description || '',
      aiAnalysis: currentIntake.ai_analysis || {
        project_type: 'unknown',
        complexity: 'medium',
        summary: '',
        tags: [],
        gaps: [],
      },
      answers: items
        .filter((item: { answer: string | null; question: string }) => item.answer)
        .map((item: { question: string; answer: string }) => ({
          question: item.question,
          answer: item.answer,
        })),
    })

    const proposalToken = randomBytes(32).toString('base64url')

    await supabase
      .from('project_intakes')
      .update({
        proposal_token: proposalToken,
        proposal_status: 'draft',
        proposal_price: proposalResult.price,
        proposal_comparison: proposalResult.comparison,
        proposal_scope: proposalResult.scope,
        proposal_advantages: proposalResult.advantages,
      })
      .eq('id', currentIntake.id)
  } catch (error) {
    // Kalkulation failure should not block the intake status transition
    console.error('Proposal kalkulation failed:', error)
  }
}
```

**Important:** The kalkulation runs async but is awaited. If it fails, the intake still reaches `ready` — the proposal just won't be generated. Admin can re-trigger manually later.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/intake/[token]/route.ts
git commit -m "feat: auto-trigger proposal kalkulation when intake reaches ready"
```

---

## Task 6: Public Proposal API Routes

**Files:**
- Create: `src/app/api/proposal/[token]/route.ts`
- Create: `src/app/api/proposal/[token]/accept/route.ts`

- [ ] **Step 1: Create GET proposal endpoint**

```typescript
// src/app/api/proposal/[token]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const supabase = createServiceClient()

  const { data: intake, error } = await supabase
    .from('project_intakes')
    .select(
      'id, title, client_name, proposal_status, proposal_price, proposal_comparison, proposal_scope, proposal_advantages, proposal_urgency, proposal_viewed_at, proposal_accepted_at'
    )
    .eq('proposal_token', token)
    .single()

  if (error || !intake) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!intake.proposal_status || intake.proposal_status === 'draft') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Set viewed_at on first view
  if (!intake.proposal_viewed_at) {
    await supabase
      .from('project_intakes')
      .update({
        proposal_viewed_at: new Date().toISOString(),
        proposal_status: 'viewed',
      })
      .eq('proposal_token', token)
  }

  return NextResponse.json({
    title: intake.title,
    client_name: intake.client_name,
    status: intake.proposal_status,
    price: intake.proposal_price,
    comparison: intake.proposal_comparison,
    scope: intake.proposal_scope,
    advantages: intake.proposal_advantages,
    urgency: intake.proposal_urgency,
    accepted_at: intake.proposal_accepted_at,
  })
}
```

- [ ] **Step 2: Create POST accept endpoint**

```typescript
// src/app/api/proposal/[token]/accept/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const supabase = createServiceClient()

  const { data: intake, error } = await supabase
    .from('project_intakes')
    .select('id, proposal_status')
    .eq('proposal_token', token)
    .single()

  if (error || !intake) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (intake.proposal_status === 'accepted') {
    return NextResponse.json({ error: 'Already accepted' }, { status: 400 })
  }

  if (!intake.proposal_status || intake.proposal_status === 'draft') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error: updateError } = await supabase
    .from('project_intakes')
    .update({
      proposal_status: 'accepted',
      proposal_accepted_at: new Date().toISOString(),
    })
    .eq('proposal_token', token)

  if (updateError) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ status: 'accepted' })
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/proposal/
git commit -m "feat: add public proposal API routes (GET + accept)"
```

---

## Task 7: Public Proposal Landing Page

**Files:**
- Create: `src/app/proposal/[token]/page.tsx`

- [ ] **Step 1: Create the proposal page**

This is a server-rendered public page. It fetches proposal data server-side and renders the sales page.

```typescript
// src/app/proposal/[token]/page.tsx
import { createServiceClient } from '@/lib/supabase/service'
import { notFound } from 'next/navigation'
import { ProposalPageClient } from './proposal-page-client'

export default async function ProposalPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = createServiceClient()

  const { data: intake } = await supabase
    .from('project_intakes')
    .select(
      'id, title, client_name, proposal_status, proposal_price, proposal_comparison, proposal_scope, proposal_advantages, proposal_urgency, proposal_viewed_at, proposal_accepted_at'
    )
    .eq('proposal_token', token)
    .single()

  if (!intake || !intake.proposal_status || intake.proposal_status === 'draft') {
    notFound()
  }

  // Set viewed_at on first view (server-side)
  if (!intake.proposal_viewed_at) {
    await supabase
      .from('project_intakes')
      .update({
        proposal_viewed_at: new Date().toISOString(),
        proposal_status: 'viewed',
      })
      .eq('proposal_token', token)
  }

  return (
    <ProposalPageClient
      token={token}
      title={intake.title}
      clientName={intake.client_name}
      status={intake.proposal_status}
      price={intake.proposal_price}
      comparison={intake.proposal_comparison}
      scope={intake.proposal_scope}
      advantages={intake.proposal_advantages}
      urgency={intake.proposal_urgency}
      acceptedAt={intake.proposal_accepted_at}
    />
  )
}
```

- [ ] **Step 2: Create the client component**

Create `src/app/proposal/[token]/proposal-page-client.tsx`:

```typescript
'use client'

import { useState } from 'react'
import type {
  ProposalComparison,
  ProposalScope,
  ProposalAdvantage,
  ProposalUrgency,
} from '@/lib/types/intake'

// Icon mapping
const ICONS: Record<string, string> = {
  rocket: '🚀',
  refresh: '🔄',
  check: '✅',
  shield: '🛡️',
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'decimal',
    minimumFractionDigits: 0,
  }).format(price) + ' €'
}

interface ProposalPageClientProps {
  token: string
  title: string
  clientName: string | null
  status: string
  price: number | null
  comparison: ProposalComparison | null
  scope: ProposalScope | null
  advantages: ProposalAdvantage[] | null
  urgency: ProposalUrgency | null
  acceptedAt: string | null
}

export function ProposalPageClient({
  token,
  title,
  clientName,
  status: initialStatus,
  price,
  comparison,
  scope,
  advantages,
  urgency,
  acceptedAt: initialAcceptedAt,
}: ProposalPageClientProps) {
  const [status, setStatus] = useState(initialStatus)
  const [acceptedAt, setAcceptedAt] = useState(initialAcceptedAt)
  const [accepting, setAccepting] = useState(false)

  async function handleAccept() {
    setAccepting(true)
    try {
      const res = await fetch(`/api/proposal/${token}/accept`, {
        method: 'POST',
      })
      if (res.ok) {
        setStatus('accepted')
        setAcceptedAt(new Date().toISOString())
      }
    } finally {
      setAccepting(false)
    }
  }

  const isAccepted = status === 'accepted'

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e5e5e5]" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div className="mx-auto max-w-[800px] flex items-center justify-between border-b border-[#222] px-6 py-6 sm:px-8">
        <div className="text-lg font-bold tracking-tight">Just Ship</div>
        {clientName && (
          <div className="text-xs text-[#888]">
            Angebot für <span className="text-[#e5e5e5]">{clientName}</span>
          </div>
        )}
      </div>

      {/* Hero / Scope */}
      <div className="mx-auto max-w-[800px] px-6 pt-12 pb-8 text-center sm:px-8">
        <div className="mb-3 text-xs uppercase tracking-[1.5px] text-[#666]">Dein Projekt</div>
        <h1 className="mb-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
        {scope?.summary && (
          <p className="mx-auto max-w-[600px] text-[15px] leading-relaxed text-[#999]">
            {scope.summary}
          </p>
        )}
      </div>

      {/* Features */}
      {scope?.features && scope.features.length > 0 && (
        <div className="mx-auto max-w-[800px] px-6 pb-8 sm:px-8">
          <div className="mb-4 text-center text-xs uppercase tracking-[1.5px] text-[#666]">Was wir bauen</div>
          <div className="mx-auto grid max-w-[600px] grid-cols-1 gap-2 sm:grid-cols-2">
            {scope.features.map((feature, i) => (
              <div key={i} className="rounded-lg border border-[#222] bg-[#141414] px-4 py-3.5 text-sm">
                <span className="mr-2 text-green-500">✓</span> {feature}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Price Comparison */}
      {comparison && price && (
        <div className="mx-auto max-w-[800px] px-6 py-8 sm:px-8">
          <div className="mb-5 text-center text-xs uppercase tracking-[1.5px] text-[#666]">Was es normalerweise kostet</div>

          <div className="mx-auto mb-6 grid max-w-[600px] grid-cols-1 gap-3 sm:grid-cols-3">
            {/* Freelancer */}
            <div className="rounded-xl border border-[#222] bg-[#141414] p-5 text-center">
              <div className="mb-1 text-xs text-[#888]">Freelancer</div>
              <div className="mb-1 text-2xl font-bold text-red-500">{formatPrice(comparison.freelancer.price)}</div>
              <div className="text-xs text-[#666]">{comparison.freelancer.timeline}</div>
            </div>
            {/* Internal */}
            <div className="rounded-xl border border-[#222] bg-[#141414] p-5 text-center">
              <div className="mb-1 text-xs text-[#888]">Interner Entwickler</div>
              <div className="mb-1 text-2xl font-bold text-red-500">{formatPrice(comparison.internal.price)}</div>
              <div className="text-xs text-[#666]">{comparison.internal.timeline}</div>
            </div>
            {/* Agency */}
            <div className="rounded-xl border border-[#222] bg-[#141414] p-5 text-center">
              <div className="mb-1 text-xs text-[#888]">Agentur</div>
              <div className="mb-1 text-2xl font-bold text-red-500">{formatPrice(comparison.agency.price)}</div>
              <div className="text-xs text-[#666]">{comparison.agency.timeline}</div>
            </div>
          </div>

          {/* Just Ship Price */}
          <div className="mx-auto max-w-[600px] rounded-2xl border-2 border-green-500 bg-gradient-to-br from-[#0f1a0f] to-[#0a150a] p-8 text-center">
            <div className="mb-2 text-xs uppercase tracking-[1.5px] text-green-500">Dein Preis mit Just Ship</div>
            <div className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">{formatPrice(price)}</div>
            <div className="mt-1 text-sm text-[#888]">Fertig in 2 Tagen</div>
          </div>
        </div>
      )}

      {/* Urgency Trigger */}
      {urgency && !isAccepted && (
        <div className="mx-auto max-w-[800px] px-6 sm:px-8">
          <div className="mx-auto flex max-w-[600px] items-center justify-center gap-3 rounded-xl border border-yellow-600 bg-[#1a1a0a] px-5 py-4">
            <span className="text-xl">⚡</span>
            <div className="text-left">
              <div className="text-sm font-semibold text-[#e5e5e5]">{urgency.message}</div>
              {urgency.expires_at && (
                <div className="text-[13px] text-[#888]">
                  Angebot gültig bis{' '}
                  {new Date(urgency.expires_at).toLocaleDateString('de-DE', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Advantages */}
      {advantages && advantages.length > 0 && (
        <div className="mx-auto max-w-[800px] px-6 py-8 sm:px-8">
          <div className="mb-4 text-center text-xs uppercase tracking-[1.5px] text-[#666]">Warum Just Ship</div>
          <div className="mx-auto grid max-w-[600px] gap-3">
            {advantages.map((adv, i) => (
              <div key={i} className="flex items-start gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#222] bg-[#141414] text-base">
                  {ICONS[adv.icon] || '💡'}
                </div>
                <div>
                  <div className="text-sm font-semibold">{adv.title}</div>
                  <div className="text-[13px] text-[#888]">{adv.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="mx-auto max-w-[800px] px-6 py-8 text-center sm:px-8">
        {isAccepted ? (
          <div className="mx-auto max-w-[400px] rounded-2xl border-2 border-green-500 bg-gradient-to-br from-[#0f1a0f] to-[#0a150a] p-8">
            <div className="mb-2 text-2xl">✅</div>
            <div className="text-lg font-bold text-white">Angebot angenommen</div>
            <div className="mt-1 text-sm text-[#888]">Wir melden uns in Kürze bei dir!</div>
          </div>
        ) : (
          <>
            <button
              onClick={handleAccept}
              disabled={accepting}
              className="rounded-xl bg-green-500 px-12 py-4 text-base font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {accepting ? 'Wird verarbeitet...' : 'Angebot annehmen'}
            </button>
            <div className="mt-3 text-xs text-[#666]">Fragen? Einfach antworten oder anrufen</div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-[#222] py-6 text-center text-xs text-[#666]">
        Just Ship · AI-Powered Software Development
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/proposal/
git commit -m "feat: add public proposal landing page with accept flow"
```

---

## Task 8: Admin Proposal Panel Component

**Files:**
- Create: `src/components/intake/proposal-panel.tsx`

- [ ] **Step 1: Create the proposal panel**

This component is embedded in the intake detail view and shows the kalkulation results, allows price editing, urgency config, and link copying.

```typescript
// src/components/intake/proposal-panel.tsx
'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  PROPOSAL_STATUS_LABELS,
  PROPOSAL_STATUS_COLORS,
} from '@/lib/constants/intake'
import type { ProjectIntake, ProposalUrgency } from '@/lib/types/intake'

function formatPrice(price: number): string {
  return new Intl.NumberFormat('de-DE').format(price) + ' €'
}

interface ProposalPanelProps {
  intake: ProjectIntake
  intakeId: string
  boardUrl: string
}

export function ProposalPanel({ intake, intakeId, boardUrl }: ProposalPanelProps) {
  const queryClient = useQueryClient()
  const [editingPrice, setEditingPrice] = useState(false)
  const [priceValue, setPriceValue] = useState(String(intake.proposal_price || ''))
  const [copied, setCopied] = useState(false)

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch(`/api/intakes/${intakeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Update failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intake', intakeId] })
    },
  })

  function handleSavePrice() {
    const numPrice = parseFloat(priceValue)
    if (isNaN(numPrice) || numPrice <= 0) return
    updateMutation.mutate({ proposal_price: numPrice })
    setEditingPrice(false)
  }

  async function handleCopyLink() {
    if (!intake.proposal_token) return
    const url = `${boardUrl}/proposal/${intake.proposal_token}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)

    // Set proposal_status to sent if still draft
    if (intake.proposal_status === 'draft') {
      updateMutation.mutate({ proposal_status: 'sent' })
    }
  }

  if (!intake.proposal_status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Kalkulation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Kalkulation wird automatisch erstellt wenn der Intake &quot;ready&quot; ist.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium">Kalkulation & Angebot</CardTitle>
        <Badge className={PROPOSAL_STATUS_COLORS[intake.proposal_status] || ''}>
          {PROPOSAL_STATUS_LABELS[intake.proposal_status] || intake.proposal_status}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Price */}
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Angebotspreis</div>
          {editingPrice ? (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={priceValue}
                onChange={(e) => setPriceValue(e.target.value)}
                className="w-32"
              />
              <span className="text-sm">€</span>
              <Button size="sm" onClick={handleSavePrice}>
                Speichern
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingPrice(false)}>
                Abbrechen
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold">
                {intake.proposal_price ? formatPrice(intake.proposal_price) : '—'}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEditingPrice(true)}>
                Bearbeiten
              </Button>
            </div>
          )}
        </div>

        {/* Comparison */}
        {intake.proposal_comparison && (
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Vergleichspreise</div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded border p-2 text-center">
                <div className="text-xs text-muted-foreground">Freelancer</div>
                <div className="font-medium">{formatPrice(intake.proposal_comparison.freelancer.price)}</div>
                <div className="text-xs text-muted-foreground">{intake.proposal_comparison.freelancer.timeline}</div>
              </div>
              <div className="rounded border p-2 text-center">
                <div className="text-xs text-muted-foreground">Intern</div>
                <div className="font-medium">{formatPrice(intake.proposal_comparison.internal.price)}</div>
                <div className="text-xs text-muted-foreground">{intake.proposal_comparison.internal.timeline}</div>
              </div>
              <div className="rounded border p-2 text-center">
                <div className="text-xs text-muted-foreground">Agentur</div>
                <div className="font-medium">{formatPrice(intake.proposal_comparison.agency.price)}</div>
                <div className="text-xs text-muted-foreground">{intake.proposal_comparison.agency.timeline}</div>
              </div>
            </div>
          </div>
        )}

        {/* Scope */}
        {intake.proposal_scope && (
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Scope</div>
            <p className="text-sm">{intake.proposal_scope.summary}</p>
            {intake.proposal_scope.features.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {intake.proposal_scope.features.map((f, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">{f}</Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Timestamps */}
        <div className="space-y-1 text-xs text-muted-foreground">
          {intake.proposal_viewed_at && (
            <div>Angesehen: {new Date(intake.proposal_viewed_at).toLocaleString('de-DE')}</div>
          )}
          {intake.proposal_accepted_at && (
            <div>Angenommen: {new Date(intake.proposal_accepted_at).toLocaleString('de-DE')}</div>
          )}
        </div>

        {/* Copy Link */}
        {intake.proposal_token && (
          <Button onClick={handleCopyLink} className="w-full" variant="outline">
            {copied ? 'Link kopiert!' : 'Angebotslink kopieren'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/intake/proposal-panel.tsx
git commit -m "feat: add admin proposal panel component"
```

---

## Task 9: Integrate Proposal Panel into Intake Detail View

**Files:**
- Modify: `src/components/intake/intake-detail-view.tsx`

- [ ] **Step 1: Add ProposalPanel import and render**

In `src/components/intake/intake-detail-view.tsx`:

Add import at the top:
```typescript
import { ProposalPanel } from './proposal-panel'
```

In the right sidebar section (around lines 215-310), add the ProposalPanel after the existing client info card. Find the sidebar grid area and add:

```typescript
<ProposalPanel
  intake={intake}
  intakeId={intakeId}
  boardUrl={typeof window !== 'undefined' ? window.location.origin : ''}
/>
```

Place it between the AI Analysis card and the Share Link card, or as the first item in the right sidebar — wherever it makes the most visual sense given the existing layout.

- [ ] **Step 2: Commit**

```bash
git add src/components/intake/intake-detail-view.tsx
git commit -m "feat: integrate proposal panel into intake detail view"
```

---

## Task 10: Extend Admin PATCH to Support Proposal Status Transition

**Files:**
- Modify: `src/app/api/intakes/[id]/route.ts`

- [ ] **Step 1: Handle proposal_status sent transition on link copy**

The admin PATCH endpoint needs to support updating `proposal_status` to `sent` when the link is copied. Since the validation schema already includes proposal fields, we need to add logic for the status transition.

In the PATCH handler of `src/app/api/intakes/[id]/route.ts`, in the update path (around lines 68-81), after the existing update logic, check if we need to transition proposal_status:

The existing update already passes validated data through to supabase. The `updateIntakeSchema` now includes `proposal_price` and `proposal_urgency`. For the `draft` → `sent` transition, add a separate field or handle it in the ProposalPanel client-side by making a direct supabase call.

Simpler approach: Add a dedicated mini-endpoint or extend the PATCH to accept `proposal_status`:

In `src/lib/validations/intake.ts`, add `proposal_status` to the update schema:

```typescript
proposal_status: z.enum(['draft', 'sent', 'viewed', 'accepted']).optional(),
```

This allows the admin to manually set proposal status (e.g., `sent` on link copy).

- [ ] **Step 2: Commit**

```bash
git add src/app/api/intakes/[id]/route.ts src/lib/validations/intake.ts
git commit -m "feat: support proposal status updates in admin PATCH endpoint"
```

---

## Task 11: Final Integration Test

- [ ] **Step 1: Manual integration test**

Test the full flow:
1. Create a new intake in the Board
2. Fill in description as client via the public intake link
3. Verify AI analysis runs and generates questions
4. Answer all questions as client
5. Verify intake transitions to `ready` and kalkulation runs automatically
6. Open the intake in the admin detail view — verify kalkulation panel shows price, comparison, scope
7. Edit the price, save
8. Copy the proposal link
9. Open the proposal link in incognito — verify the landing page renders correctly
10. Click "Angebot annehmen" — verify status updates
11. Check admin view — verify `accepted` status and timestamps

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration test fixes for proposal flow"
```
