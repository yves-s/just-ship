# P2 — Project Intake (Phase 1 MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete AI-powered project intake system where clients submit project descriptions via a token-based public link, AI generates follow-up questions, and developers manage intakes from the Board dashboard.

**Architecture:** New tables in Pipeline-DB (`project_intakes`, `intake_items`, `intake_files`) with RLS policies allowing token-based public access + workspace-member access. Client-facing pages live at `/intake/[token]` (public, no auth). Developer pages live at `/[slug]/intakes` (Board auth). AI analysis uses Claude Sonnet via the existing `@anthropic-ai/sdk`. File uploads use Supabase Storage with a new `intake-files` bucket.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui, Supabase (DB + Storage + RLS), TanStack Query 5, React Hook Form + Zod 4, @anthropic-ai/sdk (Claude Sonnet)

**Spec:** `docs/specs/p2-agency-layer.md` — Section 1 (Project Intake)

**Target repo:** `just-ship-board` at `/Users/yschleich/Developer/just-ship-board/`

**Important context:**
- Board uses Next.js 16 App Router with `(main)` route group for workspace pages
- Auth: Supabase Auth (cookies) for Board pages, token-based for client pages (no auth)
- API patterns: `success()`/`error()` from `lib/api/error-response.ts`, Zod validation, service client for bypassing RLS
- Workspace context via `WorkspaceProvider` + `useWorkspace()` in `[slug]` layout
- Existing patterns for file upload in `api/tickets/upload` and `api/sidekick/upload`
- Pipeline-DB project ID: `wsmnutkobalfrceavpxs`
- Sidebar nav items defined in `components/layout/sidebar.tsx` as `NAV_ITEMS` array

---

## File Structure

### New Files (Board Repo)

| File | Responsibility |
|---|---|
| **DB / Types** | |
| `supabase/migrations/016_project_intakes.sql` | Tables: `project_intakes`, `intake_items`, `intake_files` + RLS + triggers + storage bucket |
| `src/lib/types/intake.ts` | TypeScript interfaces for intake entities |
| `src/lib/validations/intake.ts` | Zod schemas for create/update intake, submit answers |
| `src/lib/constants/intake.ts` | Intake status constants + colors |
| **Client-Facing Pages (public, token-based)** | |
| `src/app/intake/[token]/page.tsx` | Step 1: Welcome + Description + Upload (Server Component shell) |
| `src/app/intake/[token]/layout.tsx` | Public layout (no sidebar, no auth, intake branding) |
| `src/app/intake/[token]/questions/page.tsx` | Step 3: Follow-up questions (one per screen) |
| `src/app/intake/[token]/checklist/page.tsx` | Step 4: Checklist with progress |
| `src/components/intake/intake-description-form.tsx` | Client component: description + file upload + links |
| `src/components/intake/intake-questions-flow.tsx` | Client component: question-by-question wizard |
| `src/components/intake/intake-checklist.tsx` | Client component: checklist with inline actions |
| `src/components/intake/intake-file-upload.tsx` | Shared drag-and-drop file upload zone |
| `src/components/intake/intake-analyzing.tsx` | AI analysis loading state (spinner + progress) |
| **Developer Pages (Board auth)** | |
| `src/app/(main)/[slug]/intakes/page.tsx` | Intake overview dashboard |
| `src/app/(main)/[slug]/intakes/new/page.tsx` | Create new intake form |
| `src/app/(main)/[slug]/intakes/[id]/page.tsx` | Intake detail view |
| `src/components/intake/intakes-list.tsx` | Client component: intake table with status/progress |
| `src/components/intake/intake-detail-view.tsx` | Client component: detail with AI summary + materials + checklist |
| `src/components/intake/create-intake-dialog.tsx` | Dialog for creating new intake + copying link |
| `src/components/intake/start-building-dialog.tsx` | Dialog for "Start Building" confirmation |
| **API Routes** | |
| `src/app/api/intake/[token]/route.ts` | GET (load intake) + PATCH (save description/answers) — token auth |
| `src/app/api/intake/[token]/files/route.ts` | POST file upload — token auth |
| `src/app/api/intake/[token]/analyze/route.ts` | POST trigger AI analysis — token auth |
| `src/app/api/intakes/route.ts` | GET (list all) + POST (create new) — Board auth |
| `src/app/api/intakes/[id]/route.ts` | GET + PATCH — Board auth |
| `src/app/api/intakes/[id]/start-building/route.ts` | POST — Board auth, creates project + tickets |
| **AI Integration** | |
| `src/lib/intake/analyze.ts` | AI analysis pipeline: classify project, detect gaps, generate questions |
| `src/lib/intake/prompts.ts` | System prompts for intake analysis |

### Modified Files (Board Repo)

| File | Changes |
|---|---|
| `src/lib/types.ts` | Re-export from `types/intake.ts` |
| `src/components/layout/sidebar.tsx` | Add "Intakes" nav item with `FileInput` icon |
| `src/lib/supabase/middleware.ts` | Add `/intake` to public routes |

---

## Task 1: DB Migration — Tables, RLS, Storage

**Files:**
- Create: `just-ship-board/supabase/migrations/016_project_intakes.sql`

- [ ] **Step 1: Apply migration via Supabase MCP**

Run against Pipeline-DB `wsmnutkobalfrceavpxs`:

```sql
-- ============================================
-- Project Intakes
-- ============================================

CREATE TABLE project_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  title text,
  client_name text,
  client_email text,
  status text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'in_progress', 'waiting', 'ready', 'building', 'archived')),
  description text,
  ai_analysis jsonb,
  completion_percent integer DEFAULT 0,
  last_client_activity timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_intakes_workspace ON project_intakes(workspace_id);
CREATE INDEX idx_intakes_token ON project_intakes(token);
CREATE INDEX idx_intakes_status ON project_intakes(workspace_id, status);

-- Auto-update updated_at
CREATE TRIGGER set_updated_at_intakes
  BEFORE UPDATE ON project_intakes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Intake Items (Questions + Checklist)
-- ============================================

CREATE TABLE intake_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid REFERENCES project_intakes(id) ON DELETE CASCADE NOT NULL,
  type text NOT NULL CHECK (type IN ('question', 'file_upload', 'link', 'guided_action')),
  category text CHECK (category IN ('description', 'design', 'content', 'access', 'technical', 'other')),
  question text NOT NULL,
  guidance text,
  answer text,
  answer_files text[],
  answer_links text[],
  choices jsonb,
  is_completed boolean DEFAULT false,
  is_required boolean DEFAULT true,
  is_ai_generated boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_intake_items_intake ON intake_items(intake_id);

CREATE TRIGGER set_updated_at_intake_items
  BEFORE UPDATE ON intake_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Intake Files
-- ============================================

CREATE TABLE intake_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid REFERENCES project_intakes(id) ON DELETE CASCADE NOT NULL,
  item_id uuid REFERENCES intake_items(id) ON DELETE SET NULL,
  filename text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  uploaded_at timestamptz DEFAULT now()
);

CREATE INDEX idx_intake_files_intake ON intake_files(intake_id);

-- ============================================
-- RLS Policies
-- ============================================

ALTER TABLE project_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_files ENABLE ROW LEVEL SECURITY;

-- Workspace members: full access to their workspace intakes
CREATE POLICY "workspace_members_select_intakes"
  ON project_intakes FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "workspace_members_insert_intakes"
  ON project_intakes FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY "workspace_members_update_intakes"
  ON project_intakes FOR UPDATE
  USING (is_workspace_member(workspace_id));

CREATE POLICY "workspace_members_delete_intakes"
  ON project_intakes FOR DELETE
  USING (is_workspace_member(workspace_id));

-- Token-based access: service role handles token lookup in API routes
-- (No RLS policy for token access — API routes use service client)

-- Intake items: workspace members via join to parent intake
CREATE POLICY "workspace_members_select_items"
  ON intake_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM project_intakes
    WHERE project_intakes.id = intake_items.intake_id
    AND is_workspace_member(project_intakes.workspace_id)
  ));

CREATE POLICY "workspace_members_insert_items"
  ON intake_items FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM project_intakes
    WHERE project_intakes.id = intake_items.intake_id
    AND is_workspace_member(project_intakes.workspace_id)
  ));

CREATE POLICY "workspace_members_update_items"
  ON intake_items FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM project_intakes
    WHERE project_intakes.id = intake_items.intake_id
    AND is_workspace_member(project_intakes.workspace_id)
  ));

CREATE POLICY "workspace_members_delete_items"
  ON intake_items FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM project_intakes
    WHERE project_intakes.id = intake_items.intake_id
    AND is_workspace_member(project_intakes.workspace_id)
  ));

-- Intake files: same pattern
CREATE POLICY "workspace_members_select_files"
  ON intake_files FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM project_intakes
    WHERE project_intakes.id = intake_files.intake_id
    AND is_workspace_member(project_intakes.workspace_id)
  ));

CREATE POLICY "workspace_members_insert_files"
  ON intake_files FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM project_intakes
    WHERE project_intakes.id = intake_files.intake_id
    AND is_workspace_member(project_intakes.workspace_id)
  ));

CREATE POLICY "workspace_members_delete_files"
  ON intake_files FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM project_intakes
    WHERE project_intakes.id = intake_files.intake_id
    AND is_workspace_member(project_intakes.workspace_id)
  ));

-- ============================================
-- Storage Bucket
-- ============================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'intake-files',
  'intake-files',
  false,
  52428800, -- 50MB
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
        'application/zip', 'text/plain', 'text/csv',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'image/svg+xml', 'application/json']
);

-- Storage RLS: service role handles uploads via API routes
-- Public read for workspace members (download via signed URLs)
CREATE POLICY "intake_files_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'intake-files');

CREATE POLICY "intake_files_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'intake-files');

CREATE POLICY "intake_files_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'intake-files');
```

- [ ] **Step 2: Save migration file locally**

Save the SQL above to `supabase/migrations/016_project_intakes.sql` in the Board repo for version control.

- [ ] **Step 3: Verify tables exist**

Query the Pipeline-DB to confirm all 3 tables were created:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('project_intakes', 'intake_items', 'intake_files');
```

Expected: 3 rows returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/016_project_intakes.sql
git commit -m "feat: add project_intakes DB schema, RLS policies, and storage bucket"
```

---

## Task 2: TypeScript Types, Constants, Validations

**Files:**
- Create: `src/lib/types/intake.ts`
- Create: `src/lib/constants/intake.ts`
- Create: `src/lib/validations/intake.ts`
- Modify: `src/lib/types.ts` (add re-export)

- [ ] **Step 1: Create intake types**

Create `src/lib/types/intake.ts`:

```typescript
export type IntakeStatus = 'sent' | 'in_progress' | 'waiting' | 'ready' | 'building' | 'archived';
export type IntakeItemType = 'question' | 'file_upload' | 'link' | 'guided_action';
export type IntakeItemCategory = 'description' | 'design' | 'content' | 'access' | 'technical' | 'other';

export interface ProjectIntake {
  id: string;
  workspace_id: string;
  project_id: string | null;
  token: string;
  title: string | null;
  client_name: string | null;
  client_email: string | null;
  status: IntakeStatus;
  description: string | null;
  ai_analysis: IntakeAiAnalysis | null;
  completion_percent: number;
  last_client_activity: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntakeAiAnalysis {
  project_type: string;
  complexity: string;
  summary: string;
  tags: string[];
  gaps: string[];
}

export interface IntakeItem {
  id: string;
  intake_id: string;
  type: IntakeItemType;
  category: IntakeItemCategory | null;
  question: string;
  guidance: string | null;
  answer: string | null;
  answer_files: string[] | null;
  answer_links: string[] | null;
  choices: IntakeItemChoice[] | null;
  is_completed: boolean;
  is_required: boolean;
  is_ai_generated: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface IntakeItemChoice {
  key: string;
  label: string;
}

export interface IntakeFile {
  id: string;
  intake_id: string;
  item_id: string | null;
  filename: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string;
}

/** Payload returned to the client-facing pages (no workspace details) */
export interface IntakeClientData {
  id: string;
  token: string;
  title: string | null;
  status: IntakeStatus;
  description: string | null;
  client_name: string | null;
  client_email: string | null;
  completion_percent: number;
  items: IntakeItem[];
  files: IntakeFile[];
}

/** Payload for developer dashboard list */
export interface IntakeListItem {
  id: string;
  title: string | null;
  client_name: string | null;
  client_email: string | null;
  status: IntakeStatus;
  completion_percent: number;
  last_client_activity: string | null;
  created_at: string;
  token: string;
}
```

- [ ] **Step 2: Create intake constants**

Create `src/lib/constants/intake.ts`:

```typescript
export const INTAKE_STATUSES = ['sent', 'in_progress', 'waiting', 'ready', 'building', 'archived'] as const;

export const INTAKE_STATUS_LABELS: Record<string, string> = {
  sent: 'Sent',
  in_progress: 'In Progress',
  waiting: 'Waiting',
  ready: 'Ready',
  building: 'Building',
  archived: 'Archived',
};

export const INTAKE_STATUS_COLORS: Record<string, string> = {
  sent: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  waiting: 'bg-amber-100 text-amber-700',
  ready: 'bg-emerald-100 text-emerald-700',
  building: 'bg-purple-100 text-purple-700',
  archived: 'bg-gray-100 text-gray-500',
};

export const INTAKE_ITEM_TYPES = ['question', 'file_upload', 'link', 'guided_action'] as const;
export const INTAKE_ITEM_CATEGORIES = ['description', 'design', 'content', 'access', 'technical', 'other'] as const;
```

- [ ] **Step 3: Create intake validations**

Create `src/lib/validations/intake.ts`:

```typescript
import { z } from "zod";
import { INTAKE_STATUSES, INTAKE_ITEM_TYPES, INTAKE_ITEM_CATEGORIES } from "@/lib/constants/intake";

export const createIntakeSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  client_name: z.string().max(200).optional(),
  client_email: z.string().email().max(200).optional(),
}).strict();

export const updateIntakeClientSchema = z.object({
  client_name: z.string().min(1).max(200).optional(),
  client_email: z.string().email().max(200).optional(),
  description: z.string().max(50000).optional(),
  title: z.string().min(1).max(200).optional(),
}).strict();

export const submitAnswerSchema = z.object({
  item_id: z.string().uuid(),
  answer: z.string().max(10000).optional(),
  answer_links: z.array(z.string().url().max(2000)).max(10).optional(),
  is_completed: z.boolean().optional(),
}).strict();

export const submitAnswersSchema = z.object({
  answers: z.array(submitAnswerSchema).min(1).max(50),
}).strict();

export const updateIntakeSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(INTAKE_STATUSES).optional(),
  client_name: z.string().max(200).nullable().optional(),
  client_email: z.string().email().max(200).nullable().optional(),
}).strict();

export const addIntakeItemSchema = z.object({
  type: z.enum(INTAKE_ITEM_TYPES),
  category: z.enum(INTAKE_ITEM_CATEGORIES).optional(),
  question: z.string().min(1).max(2000),
  guidance: z.string().max(5000).optional(),
  is_required: z.boolean().default(true),
  choices: z.array(z.object({
    key: z.string().max(100),
    label: z.string().max(500),
  })).max(20).optional(),
}).strict();

export type CreateIntakeInput = z.infer<typeof createIntakeSchema>;
export type UpdateIntakeClientInput = z.infer<typeof updateIntakeClientSchema>;
export type SubmitAnswersInput = z.infer<typeof submitAnswersSchema>;
export type UpdateIntakeInput = z.infer<typeof updateIntakeSchema>;
export type AddIntakeItemInput = z.infer<typeof addIntakeItemSchema>;
```

- [ ] **Step 4: Add re-export to main types file**

Append to `src/lib/types.ts`:

```typescript
export type {
  ProjectIntake,
  IntakeAiAnalysis,
  IntakeItem,
  IntakeItemChoice,
  IntakeFile,
  IntakeClientData,
  IntakeListItem,
  IntakeStatus,
  IntakeItemType,
  IntakeItemCategory,
} from "./types/intake";
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/intake.ts src/lib/constants/intake.ts src/lib/validations/intake.ts src/lib/types.ts
git commit -m "feat: add intake TypeScript types, constants, and Zod validations"
```

---

## Task 3: Client-Facing API Routes (Token Auth)

**Files:**
- Create: `src/app/api/intake/[token]/route.ts`
- Create: `src/app/api/intake/[token]/files/route.ts`
- Create: `src/app/api/intake/[token]/analyze/route.ts`
- Modify: `src/lib/supabase/middleware.ts` (add `/intake` to public routes)

- [ ] **Step 1: Add /intake to middleware public routes**

In `src/lib/supabase/middleware.ts`, add `/intake` to the `isPublicRoute` check:

```typescript
// Add after the existing public route checks:
request.nextUrl.pathname.startsWith("/intake") ||
```

Also add to the `isPublicRoute` check:
```typescript
request.nextUrl.pathname.startsWith("/api/intake") ||
```

- [ ] **Step 2: Create GET + PATCH /api/intake/[token]**

Create `src/app/api/intake/[token]/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { success, error, notFound, validationError } from "@/lib/api/error-response";
import { updateIntakeClientSchema, submitAnswersSchema } from "@/lib/validations/intake";

async function resolveIntake(token: string) {
  const supabase = createServiceClient();
  const { data: intake } = await supabase
    .from("project_intakes")
    .select("*")
    .eq("token", token)
    .single();
  return { supabase, intake };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { supabase, intake } = await resolveIntake(token);
  if (!intake) return notFound("Intake not found");

  const [{ data: items }, { data: files }] = await Promise.all([
    supabase
      .from("intake_items")
      .select("*")
      .eq("intake_id", intake.id)
      .order("sort_order"),
    supabase
      .from("intake_files")
      .select("*")
      .eq("intake_id", intake.id)
      .order("uploaded_at"),
  ]);

  return success({
    id: intake.id,
    token: intake.token,
    title: intake.title,
    status: intake.status,
    description: intake.description,
    client_name: intake.client_name,
    client_email: intake.client_email,
    completion_percent: intake.completion_percent,
    items: items ?? [],
    files: files ?? [],
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { supabase, intake } = await resolveIntake(token);
  if (!intake) return notFound("Intake not found");
  if (intake.status === "archived") return error("ARCHIVED", "This intake has been archived", 400);

  const body = await req.json();

  // Check if this is an answers submission or a description update
  if (body.answers) {
    const parsed = submitAnswersSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    for (const answer of parsed.data.answers) {
      const update: Record<string, unknown> = {};
      if (answer.answer !== undefined) update.answer = answer.answer;
      if (answer.answer_links !== undefined) update.answer_links = answer.answer_links;
      if (answer.is_completed !== undefined) update.is_completed = answer.is_completed;

      await supabase
        .from("intake_items")
        .update(update)
        .eq("id", answer.item_id)
        .eq("intake_id", intake.id);
    }
  } else {
    const parsed = updateIntakeClientSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    await supabase
      .from("project_intakes")
      .update(parsed.data)
      .eq("id", intake.id);
  }

  // Update status + completion
  const newStatus = intake.status === "sent" ? "in_progress" : intake.status;
  const { data: allItems } = await supabase
    .from("intake_items")
    .select("is_completed, is_required")
    .eq("intake_id", intake.id);

  const requiredItems = (allItems ?? []).filter((i) => i.is_required);
  const completedRequired = requiredItems.filter((i) => i.is_completed).length;
  const totalRequired = Math.max(requiredItems.length, 1);
  const hasDescription = body.description || intake.description;
  const descriptionWeight = hasDescription ? 1 : 0;
  const completion = Math.round(
    ((completedRequired + descriptionWeight) / (totalRequired + 1)) * 100
  );

  const isReady = completion >= 100 && requiredItems.length > 0;

  await supabase
    .from("project_intakes")
    .update({
      status: isReady ? "ready" : newStatus,
      completion_percent: completion,
      last_client_activity: new Date().toISOString(),
    })
    .eq("id", intake.id);

  return success({ updated: true, completion_percent: completion, status: isReady ? "ready" : newStatus });
}
```

- [ ] **Step 3: Create POST /api/intake/[token]/files**

Create `src/app/api/intake/[token]/files/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { success, error, notFound } from "@/lib/api/error-response";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const supabase = createServiceClient();

  const { data: intake } = await supabase
    .from("project_intakes")
    .select("id, status")
    .eq("token", token)
    .single();

  if (!intake) return notFound("Intake not found");
  if (intake.status === "archived") return error("ARCHIVED", "This intake has been archived", 400);

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const itemId = formData.get("item_id") as string | null;

  if (!file) return error("NO_FILE", "No file provided", 400);
  if (file.size > 52428800) return error("FILE_TOO_LARGE", "File must be under 50MB", 400);

  const ext = file.name.split(".").pop() || "bin";
  const storagePath = `${intake.id}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("intake-files")
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) return error("UPLOAD_FAILED", uploadError.message, 500);

  const { data: fileRecord } = await supabase
    .from("intake_files")
    .insert({
      intake_id: intake.id,
      item_id: itemId || null,
      filename: file.name,
      storage_path: storagePath,
      mime_type: file.type,
      size_bytes: file.size,
    })
    .select()
    .single();

  // Update last activity
  await supabase
    .from("project_intakes")
    .update({
      status: intake.status === "sent" ? "in_progress" : intake.status,
      last_client_activity: new Date().toISOString(),
    })
    .eq("id", intake.id);

  return success(fileRecord, 201);
}
```

- [ ] **Step 4: Create POST /api/intake/[token]/analyze**

Create `src/app/api/intake/[token]/analyze/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { success, error, notFound } from "@/lib/api/error-response";
import { analyzeIntake } from "@/lib/intake/analyze";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const supabase = createServiceClient();

  const { data: intake } = await supabase
    .from("project_intakes")
    .select("*")
    .eq("token", token)
    .single();

  if (!intake) return notFound("Intake not found");
  if (intake.status === "archived") return error("ARCHIVED", "This intake has been archived", 400);

  const { data: existingFiles } = await supabase
    .from("intake_files")
    .select("filename, mime_type")
    .eq("intake_id", intake.id);

  const result = await analyzeIntake({
    description: intake.description || "",
    title: intake.title || "",
    files: existingFiles ?? [],
  });

  // Save AI analysis
  await supabase
    .from("project_intakes")
    .update({ ai_analysis: result.analysis })
    .eq("id", intake.id);

  // Insert generated questions as intake items
  if (result.questions.length > 0) {
    await supabase
      .from("intake_items")
      .insert(
        result.questions.map((q, i) => ({
          intake_id: intake.id,
          type: q.type,
          category: q.category,
          question: q.question,
          guidance: q.guidance,
          is_required: q.is_required,
          is_ai_generated: true,
          choices: q.choices || null,
          sort_order: i,
        }))
      );
  }

  return success({ analysis: result.analysis, questions_count: result.questions.length });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/intake/ src/lib/supabase/middleware.ts
git commit -m "feat: add client-facing intake API routes (token auth)"
```

---

## Task 4: AI Analysis Pipeline

**Files:**
- Create: `src/lib/intake/analyze.ts`
- Create: `src/lib/intake/prompts.ts`

- [ ] **Step 1: Create system prompt**

Create `src/lib/intake/prompts.ts`:

```typescript
export const INTAKE_ANALYSIS_SYSTEM_PROMPT = `You are a project intake assistant for a software development team.
Analyze the project description and generate follow-up questions that gather all
information a development team needs to start building.

Rules:
- ALL questions must be non-technical. No jargon without explanation.
- Do NOT ask about technical decisions (framework, database, etc.)
- Ask about: functionality, users, content, design, existing systems, credentials/access, deadlines, references.
- Each question has: question, guidance, type, is_required, category.
- Maximum 8 questions. If the client already provided a lot of detail: fewer questions.
- Prioritize must-have information over nice-to-have.

Question types:
- "question" — free text answer
- "file_upload" — client needs to upload a file (design, logo, content, etc.)
- "link" — client needs to share a URL (Figma, Drive, existing site, etc.)
- "guided_action" — client needs to perform an action (e.g., share access credentials)

Categories: description, design, content, access, technical, other

Respond in the same language as the project description.`;

export const INTAKE_ANALYSIS_USER_PROMPT = (input: {
  title: string;
  description: string;
  files: { filename: string; mime_type: string | null }[];
}) => `Project title: ${input.title || "Not provided"}

Project description:
${input.description || "No description provided yet."}

Attached files: ${input.files.length > 0
    ? input.files.map((f) => `${f.filename} (${f.mime_type || "unknown"})`).join(", ")
    : "None"}

Analyze this project and respond with JSON:

{
  "analysis": {
    "project_type": "string — e.g. 'E-Commerce Shop', 'Web Application', 'Landing Page'",
    "complexity": "low | medium | high",
    "summary": "2-3 sentence summary of the project",
    "tags": ["tag1", "tag2"],
    "gaps": ["What information is missing or unclear"]
  },
  "questions": [
    {
      "question": "The question text",
      "guidance": "Helper text explaining why we need this / what a good answer looks like",
      "type": "question | file_upload | link | guided_action",
      "is_required": true,
      "category": "description | design | content | access | technical | other",
      "choices": [{"key": "option_a", "label": "Option A"}] // only for multiple-choice, otherwise omit
    }
  ]
}

Return ONLY valid JSON. No markdown, no explanation.`;
```

- [ ] **Step 2: Create analyze function**

Create `src/lib/intake/analyze.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { INTAKE_ANALYSIS_SYSTEM_PROMPT, INTAKE_ANALYSIS_USER_PROMPT } from "./prompts";
import type { IntakeAiAnalysis, IntakeItemType, IntakeItemCategory } from "@/lib/types/intake";

interface AnalyzeInput {
  title: string;
  description: string;
  files: { filename: string; mime_type: string | null }[];
}

interface GeneratedQuestion {
  question: string;
  guidance: string | null;
  type: IntakeItemType;
  is_required: boolean;
  category: IntakeItemCategory;
  choices?: { key: string; label: string }[];
}

interface AnalyzeResult {
  analysis: IntakeAiAnalysis;
  questions: GeneratedQuestion[];
}

export async function analyzeIntake(input: AnalyzeInput): Promise<AnalyzeResult> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: INTAKE_ANALYSIS_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: INTAKE_ANALYSIS_USER_PROMPT(input),
      },
    ],
  });

  const text = response.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");

  const parsed = JSON.parse(text);

  return {
    analysis: {
      project_type: parsed.analysis?.project_type || "Unknown",
      complexity: parsed.analysis?.complexity || "medium",
      summary: parsed.analysis?.summary || "",
      tags: parsed.analysis?.tags || [],
      gaps: parsed.analysis?.gaps || [],
    },
    questions: (parsed.questions || []).map((q: Record<string, unknown>) => ({
      question: q.question as string,
      guidance: (q.guidance as string) || null,
      type: (q.type as IntakeItemType) || "question",
      is_required: q.is_required !== false,
      category: (q.category as IntakeItemCategory) || "other",
      choices: q.choices || undefined,
    })),
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/intake/
git commit -m "feat: add AI intake analysis pipeline with Claude Sonnet"
```

---

## Task 5: Developer API Routes (Board Auth)

**Files:**
- Create: `src/app/api/intakes/route.ts`
- Create: `src/app/api/intakes/[id]/route.ts`
- Create: `src/app/api/intakes/[id]/start-building/route.ts`

- [ ] **Step 1: Create GET + POST /api/intakes**

Create `src/app/api/intakes/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { success, error, unauthorized, validationError } from "@/lib/api/error-response";
import { createIntakeSchema } from "@/lib/validations/intake";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const workspaceId = req.nextUrl.searchParams.get("workspace_id");
  if (!workspaceId) return error("MISSING_PARAM", "workspace_id is required", 400);

  const { data: intakes } = await supabase
    .from("project_intakes")
    .select("id, title, client_name, client_email, status, completion_percent, last_client_activity, created_at, token")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  return success(intakes ?? []);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const body = await req.json();
  const workspaceId = body.workspace_id;
  if (!workspaceId) return error("MISSING_PARAM", "workspace_id is required", 400);

  const parsed = createIntakeSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const { data: intake, error: dbError } = await supabase
    .from("project_intakes")
    .insert({
      workspace_id: workspaceId,
      title: parsed.data.title,
      client_name: parsed.data.client_name || null,
      client_email: parsed.data.client_email || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (dbError) return error("INSERT_FAILED", dbError.message, 500);

  return success(intake, 201);
}
```

- [ ] **Step 2: Create GET + PATCH /api/intakes/[id]**

Create `src/app/api/intakes/[id]/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { success, unauthorized, notFound, validationError } from "@/lib/api/error-response";
import { updateIntakeSchema, addIntakeItemSchema } from "@/lib/validations/intake";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { data: intake } = await supabase
    .from("project_intakes")
    .select("*")
    .eq("id", id)
    .single();

  if (!intake) return notFound("Intake not found");

  const [{ data: items }, { data: files }] = await Promise.all([
    supabase
      .from("intake_items")
      .select("*")
      .eq("intake_id", id)
      .order("sort_order"),
    supabase
      .from("intake_files")
      .select("*")
      .eq("intake_id", id)
      .order("uploaded_at"),
  ]);

  return success({ ...intake, items: items ?? [], files: files ?? [] });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const body = await req.json();

  // If body has "question" field, it's adding a new item
  if (body.question) {
    const parsed = addIntakeItemSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const { data: item } = await supabase
      .from("intake_items")
      .insert({
        intake_id: id,
        ...parsed.data,
        is_ai_generated: false,
      })
      .select()
      .single();

    return success(item, 201);
  }

  // Otherwise it's updating the intake itself
  const parsed = updateIntakeSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const { data: intake } = await supabase
    .from("project_intakes")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();

  if (!intake) return notFound("Intake not found");

  return success(intake);
}
```

- [ ] **Step 3: Create POST /api/intakes/[id]/start-building**

Create `src/app/api/intakes/[id]/start-building/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { success, error, unauthorized, notFound } from "@/lib/api/error-response";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { data: intake } = await supabase
    .from("project_intakes")
    .select("*")
    .eq("id", id)
    .single();

  if (!intake) return notFound("Intake not found");
  if (intake.project_id) return error("ALREADY_STARTED", "This intake already has a project", 400);

  // Create project from intake
  const projectName = intake.title || `Intake ${intake.id.slice(0, 8)}`;
  const projectSlug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      workspace_id: intake.workspace_id,
      name: projectName,
      slug: projectSlug,
      description: intake.ai_analysis?.summary || intake.description?.slice(0, 500) || null,
    })
    .select()
    .single();

  if (projectError) return error("PROJECT_FAILED", projectError.message, 500);

  // Link intake to project and set status to building
  await supabase
    .from("project_intakes")
    .update({
      project_id: project.id,
      status: "building",
    })
    .eq("id", id);

  return success({ project, intake_status: "building" });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/intakes/
git commit -m "feat: add developer intake API routes (Board auth)"
```

---

## Task 6: Client-Facing Pages (Public, Token-Based)

**Files:**
- Create: `src/app/intake/[token]/layout.tsx`
- Create: `src/app/intake/[token]/page.tsx`
- Create: `src/app/intake/[token]/questions/page.tsx`
- Create: `src/app/intake/[token]/checklist/page.tsx`
- Create: `src/components/intake/intake-description-form.tsx`
- Create: `src/components/intake/intake-file-upload.tsx`
- Create: `src/components/intake/intake-analyzing.tsx`
- Create: `src/components/intake/intake-questions-flow.tsx`
- Create: `src/components/intake/intake-checklist.tsx`

This is a large task. The agent implementing it should follow the mockup designs from `.superpowers/brainstorm/55239-1774873735/intake-client-flow.html` (4-step wizard) for the client flow.

**Key design decisions from mockups:**
- Step 1: Name + Email side-by-side, large description textarea, drag-and-drop file zone, link input
- Step 2: AI analysis loading with progress checklist animation
- Step 3: One question per screen with progress counter ("Question 2 of 5"), choices as checkboxes
- Step 4: Checklist with progress bar, required vs optional tags, inline file upload

**UI Stack:** shadcn/ui components (Button, Input, Card, Label, Progress), Tailwind CSS, Inter font, lucide-react icons.

- [ ] **Step 1: Create public layout**

Create `src/app/intake/[token]/layout.tsx` — minimal layout without sidebar or auth. Simple centered container with "Powered by Just Ship" footer.

- [ ] **Step 2: Create Step 1 page (Welcome + Description)**

Create `src/app/intake/[token]/page.tsx` — Server Component that fetches intake data and renders `IntakeDescriptionForm`. If intake already has description and items, redirect to `/intake/[token]/checklist`.

- [ ] **Step 3: Create IntakeDescriptionForm component**

Create `src/components/intake/intake-description-form.tsx`:
- Client component with react-hook-form
- Fields: client_name (required), client_email (required), description (textarea, required)
- Drag-and-drop file upload zone (reusable `IntakeFileUpload`)
- Optional link input (add multiple)
- "Next" button → calls PATCH /api/intake/[token] then POST /api/intake/[token]/analyze then navigates to /questions

- [ ] **Step 4: Create IntakeFileUpload component**

Create `src/components/intake/intake-file-upload.tsx`:
- Drag-and-drop zone with dashed border
- Shows uploaded files with name + size + remove button
- Calls POST /api/intake/[token]/files for each file
- Accept: images, PDFs, docs, spreadsheets, zip (matching bucket allowed types)

- [ ] **Step 5: Create IntakeAnalyzing component**

Create `src/components/intake/intake-analyzing.tsx`:
- Shows spinner + "Analyzing your project..." message
- Animated checklist: "Description read", "Files analyzed", "Questions being prepared"
- Used as loading state between step 1 and step 3

- [ ] **Step 6: Create Questions page + flow**

Create `src/app/intake/[token]/questions/page.tsx` + `src/components/intake/intake-questions-flow.tsx`:
- Fetches intake items from GET /api/intake/[token]
- One question per screen
- Progress indicator ("Question 2 of 5")
- Supports: text input, multiple choice (from choices array), file upload, link input
- Skip button for non-required items
- "Next" saves answer via PATCH, navigates to next or to /checklist

- [ ] **Step 7: Create Checklist page**

Create `src/app/intake/[token]/checklist/page.tsx` + `src/components/intake/intake-checklist.tsx`:
- Shows all items with completion state
- Progress bar at top (completion_percent)
- Required vs Optional tags
- Inline edit/answer for incomplete items
- Completed items collapsed
- "All done" message when 100%

- [ ] **Step 8: Commit**

```bash
git add src/app/intake/ src/components/intake/
git commit -m "feat: add client-facing intake pages (description, questions, checklist)"
```

---

## Task 7: Developer Dashboard Pages

**Files:**
- Create: `src/app/(main)/[slug]/intakes/page.tsx`
- Create: `src/app/(main)/[slug]/intakes/new/page.tsx`
- Create: `src/app/(main)/[slug]/intakes/[id]/page.tsx`
- Create: `src/components/intake/intakes-list.tsx`
- Create: `src/components/intake/intake-detail-view.tsx`
- Create: `src/components/intake/create-intake-dialog.tsx`
- Create: `src/components/intake/start-building-dialog.tsx`
- Modify: `src/components/layout/sidebar.tsx` (add Intakes nav item)

- [ ] **Step 1: Add Intakes to sidebar nav**

In `src/components/layout/sidebar.tsx`, add to `NAV_ITEMS`:

```typescript
import { FileInput } from "lucide-react";

// Add after the Board item:
{ label: "Intakes", icon: FileInput, href: (slug: string) => `/${slug}/intakes` },
```

- [ ] **Step 2: Create Intakes overview page**

Create `src/app/(main)/[slug]/intakes/page.tsx` — Server Component shell that renders `IntakesList` client component.

- [ ] **Step 3: Create IntakesList component**

Create `src/components/intake/intakes-list.tsx`:
- Table with columns: Project, Status, Completion %, Last Activity, Actions
- Status badges using `INTAKE_STATUS_COLORS`
- "New Intake" button → opens CreateIntakeDialog
- Click row → navigate to `/[slug]/intakes/[id]`
- Copy link button per intake
- Empty state when no intakes

- [ ] **Step 4: Create CreateIntakeDialog**

Create `src/components/intake/create-intake-dialog.tsx`:
- Dialog with title, client_name (optional), client_email (optional) fields
- On create: POST /api/intakes, show generated link with copy button
- Link format: `{window.location.origin}/intake/{token}`

- [ ] **Step 5: Create Intake Detail page**

Create `src/app/(main)/[slug]/intakes/[id]/page.tsx` — Server Component shell that renders `IntakeDetailView`.

- [ ] **Step 6: Create IntakeDetailView component**

Create `src/components/intake/intake-detail-view.tsx`:
- AI analysis summary card (project type, complexity, tags, gaps)
- Client info (name, email)
- All provided materials: files (with download links), links, description
- Items checklist with completion state
- "Add Question" button → adds developer-authored question
- "Copy Link" button for sharing
- "Start Building" button → opens StartBuildingDialog (only when status is "ready")

- [ ] **Step 7: Create StartBuildingDialog**

Create `src/components/intake/start-building-dialog.tsx`:
- Confirmation dialog: "This will create a new project from this intake."
- Calls POST /api/intakes/[id]/start-building
- On success: navigate to the new project in the Board

- [ ] **Step 8: Commit**

```bash
git add src/app/(main)/[slug]/intakes/ src/components/intake/intakes-list.tsx src/components/intake/intake-detail-view.tsx src/components/intake/create-intake-dialog.tsx src/components/intake/start-building-dialog.tsx src/components/layout/sidebar.tsx
git commit -m "feat: add developer intake dashboard (overview, detail, create, start building)"
```

---

## Task 8: Build Check + Integration Verification

- [ ] **Step 1: Run build**

```bash
cd /path/to/just-ship-board
npm run build
```

Fix any TypeScript errors or import issues.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Fix any lint warnings/errors.

- [ ] **Step 3: Verify all routes are accessible**

Manual checklist:
- `/intake/[token]` loads without auth redirect
- `/[slug]/intakes` loads with auth
- `/[slug]/intakes/new` loads with auth
- `/api/intake/[token]` returns 404 for invalid token
- `/api/intakes?workspace_id=...` requires auth

- [ ] **Step 4: Commit fixes if any**

```bash
git add <fixed-files>
git commit -m "fix: resolve build and lint errors in intake feature"
```
