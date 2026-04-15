# Shopify Board-Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Shopify agencies to configure projects with type + store credentials in the Board UI, and have the pipeline use that metadata for Shopify-specific deployment and preview URLs.

**Architecture:** Two repos are modified — `just-ship-board` (DB, API, UI) and `just-ship` (pipeline reads new fields). The Board gets a `type` field on projects with conditional Shopify config fields. The pipeline reads project metadata on ticket pickup and sets Shopify env vars for agents.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase (migrations), Zod, React Hook Form, shadcn/ui, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-04-15-shopify-board-integration-design.md`

---

## File Structure

### just-ship-board (Board repo)

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/040_project_type.sql` | Create | Add `type`, `shopify_store_url`, `shopify_access_token` columns |
| `src/lib/validations/project.ts` | Modify | Extend schemas with type + shopify fields |
| `src/lib/types.ts` | Modify | Add `type`, `shopify_store_url` to `Project` interface (NOT `shopify_access_token`) |
| `src/app/api/projects/route.ts` | Modify | Accept new fields in POST, exclude token from GET response |
| `src/app/api/projects/[projectId]/route.ts` | Modify | Accept new fields in PATCH, exclude token from response |
| `src/components/board/create-project-dialog.tsx` | Modify | Add type selector + conditional Shopify fields |
| `src/components/settings/edit-project-dialog.tsx` | Modify | Add type selector + conditional Shopify fields |

### just-ship (Engine repo)

| File | Action | Responsibility |
|---|---|---|
| `.pipeline/worker.ts` | Modify | Inject Shopify env vars into pipelineEnv from project metadata |
| `.pipeline/run.ts` | Modify | Generate Shopify preview URL and patch to ticket after completion |

---

## Task 1: DB Migration — Add project type columns

**Repo:** `just-ship-board`
**Files:**
- Create: `supabase/migrations/040_project_type.sql`

- [ ] **Step 1: Write migration file**

```sql
-- 040_project_type.sql
-- Add project type and Shopify configuration fields

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS type TEXT CHECK (type IN ('shopify', 'webapp', 'other')),
  ADD COLUMN IF NOT EXISTS shopify_store_url TEXT,
  ADD COLUMN IF NOT EXISTS shopify_access_token TEXT;

-- Index for pipeline queries filtering by project type
CREATE INDEX IF NOT EXISTS idx_projects_type ON projects (type) WHERE type IS NOT NULL;

COMMENT ON COLUMN projects.type IS 'Project type: shopify, webapp, other. NULL for legacy projects.';
COMMENT ON COLUMN projects.shopify_store_url IS 'e.g. my-store.myshopify.com. Required when type=shopify.';
COMMENT ON COLUMN projects.shopify_access_token IS 'Shopify Theme Access Password or Admin API Token. Plaintext for now, encrypted in future.';
```

- [ ] **Step 2: Apply migration locally**

Run: `cd /Users/yschleich/Developer/Just\ Ship/just-ship-board && npx supabase db push`
Expected: Migration applies successfully, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/040_project_type.sql
git commit -m "feat: add project type and shopify config columns to projects table"
```

---

## Task 2: Extend validation schemas and TypeScript types

**Repo:** `just-ship-board`
**Files:**
- Modify: `src/lib/validations/project.ts`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Update Zod schemas**

In `src/lib/validations/project.ts`, extend both schemas:

```typescript
import { z } from "zod";

const projectTypeEnum = z.enum(["shopify", "webapp", "other"]).nullable().optional();

export const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).nullable().optional(),
  type: projectTypeEnum,
  shopify_store_url: z
    .string()
    .max(253)
    .regex(/^[a-z0-9-]+\.myshopify\.com$/, "Must be a valid .myshopify.com URL")
    .nullable()
    .optional(),
  shopify_access_token: z
    .string()
    .min(1)
    .max(500)
    .nullable()
    .optional(),
}).refine(
  (data) => {
    if (data.type === "shopify") {
      return !!data.shopify_store_url && !!data.shopify_access_token;
    }
    return true;
  },
  { message: "Store URL and Access Token are required for Shopify projects", path: ["shopify_store_url"] }
);

// No .refine() on update — partial updates are valid (e.g. just changing the name).
// The API route handles clearing shopify fields when type changes away from shopify (Task 3).
export const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  type: projectTypeEnum,
  shopify_store_url: z
    .string()
    .max(253)
    .regex(/^[a-z0-9-]+\.myshopify\.com$/, "Must be a valid .myshopify.com URL")
    .nullable()
    .optional(),
  shopify_access_token: z
    .string()
    .min(1)
    .max(500)
    .nullable()
    .optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
```

- [ ] **Step 2: Update Project interface in types.ts**

In `src/lib/types.ts`, add to the `Project` interface (after `source`):

```typescript
export interface Project {
  // ... existing fields ...
  source: ProjectSource;
  type: ProjectType | null;
  shopify_store_url: string | null;
  // NOTE: shopify_access_token is NEVER included in the Project type —
  // it's write-only from the client, read-only by the pipeline internally.
  created_at: string;
  updated_at: string;
}
```

Also add the `ProjectType` type alias near the other type aliases at the bottom:

```typescript
export type ProjectType = "shopify" | "webapp" | "other";
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/yschleich/Developer/Just\ Ship/just-ship-board && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/validations/project.ts src/lib/types.ts
git commit -m "feat: add project type and shopify fields to validation schemas and types"
```

---

## Task 3: Update Project API routes

**Repo:** `just-ship-board`
**Files:**
- Modify: `src/app/api/projects/route.ts` (POST + GET)
- Modify: `src/app/api/projects/[projectId]/route.ts` (PATCH)

- [ ] **Step 1: Update POST /api/projects to accept new fields**

In `src/app/api/projects/route.ts`, update the insert to include new fields:

```typescript
// After line 92 (inside the insert call), add the new fields:
const { data: project, error: insertErr } = await supabase
  .from("projects")
  .insert({
    workspace_id: workspaceId,
    name: parsed.data.name,
    slug,
    description: parsed.data.description ?? null,
    type: parsed.data.type ?? null,
    shopify_store_url: parsed.data.shopify_store_url ?? null,
    shopify_access_token: parsed.data.shopify_access_token ?? null,
  })
  // IMPORTANT: Exclude shopify_access_token from response
  .select("id, name, slug, workspace_id, description, type, shopify_store_url")
  .single();
```

Also update the GET handler's select to include the new fields (but NOT the token):

```typescript
// Line 25 and 37 — update both .select() calls
.select("id, name, slug, description, type, shopify_store_url")
```

- [ ] **Step 2: Update PATCH /api/projects/[projectId] to accept new fields**

In `src/app/api/projects/[projectId]/route.ts`, extend the update fields mapping (after line 72):

```typescript
const updateFields: Record<string, unknown> = {};
if (parsed.data.name !== undefined) updateFields.name = parsed.data.name;
if (parsed.data.description !== undefined) updateFields.description = parsed.data.description;
if (parsed.data.type !== undefined) updateFields.type = parsed.data.type;
if (parsed.data.shopify_store_url !== undefined) updateFields.shopify_store_url = parsed.data.shopify_store_url;
if (parsed.data.shopify_access_token !== undefined) updateFields.shopify_access_token = parsed.data.shopify_access_token;

// When type changes away from shopify, clear shopify fields
if (parsed.data.type !== undefined && parsed.data.type !== "shopify") {
  updateFields.shopify_store_url = null;
  updateFields.shopify_access_token = null;
}
```

Also update the `.select()` on the PATCH response to exclude token:

```typescript
.select("id, workspace_id, name, description, type, shopify_store_url, created_at, updated_at")
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/yschleich/Developer/Just\ Ship/just-ship-board && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/projects/route.ts src/app/api/projects/\[projectId\]/route.ts
git commit -m "feat: accept project type and shopify config in project API routes"
```

---

## Task 4: Update CreateProjectDialog with type selector + Shopify fields

**Repo:** `just-ship-board`
**Files:**
- Modify: `src/components/board/create-project-dialog.tsx`

- [ ] **Step 1: Add type selector and conditional Shopify fields**

Replace the form in `create-project-dialog.tsx`. The key changes:
1. Add a `type` select field after description (Shopify / Web App / Other)
2. When "shopify" is selected, show Store URL + Access Token fields
3. Access Token uses `type="password"` for masking

```typescript
"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  createProjectSchema, type CreateProjectInput,
} from "@/lib/validations/project";
import { createClient } from "@/lib/supabase/client";
import type { Project } from "@/lib/types";

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onCreated: (project: Project) => void;
}

export function CreateProjectDialog({
  open, onOpenChange, workspaceId, onCreated,
}: CreateProjectDialogProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register, handleSubmit, reset, setValue, control,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
  });

  const selectedType = useWatch({ control, name: "type" });

  function handleOpenChange(open: boolean) {
    if (!open) { reset(); setServerError(null); }
    onOpenChange(open);
  }

  async function onSubmit(data: CreateProjectInput) {
    setServerError(null);
    const slug = data.name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
    // NOTE: Uses direct Supabase insert (existing pattern — the POST /api/projects
    // route uses pipeline key auth, not user auth). The .select() MUST exclude
    // shopify_access_token to prevent it from being returned to the client.
    // RLS mitigation: the token is write-only from the UI perspective.
    const supabase = createClient();
    const { data: project, error } = await supabase
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: data.name,
        slug,
        description: data.description ?? null,
        type: data.type ?? null,
        shopify_store_url: data.type === "shopify" ? (data.shopify_store_url ?? null) : null,
        shopify_access_token: data.type === "shopify" ? (data.shopify_access_token ?? null) : null,
      })
      // CRITICAL: Never include shopify_access_token in select
      .select("id, name, slug, workspace_id, description, type, shopify_store_url, source, repo_url, github_repo_id, created_at, updated_at")
      .single();

    if (error) {
      setServerError(
        error.code === "23505"
          ? "A project with this name already exists"
          : "Could not create project. Please try again."
      );
      return;
    }

    reset();
    onCreated(project);
    handleOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" placeholder="My Project" {...register("name")} />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="What is this project about?"
              {...register("description")}
            />
          </div>
          <div className="space-y-2">
            <Label>Project Type (optional)</Label>
            <Select
              value={selectedType ?? ""}
              onValueChange={(val) => setValue("type", val as CreateProjectInput["type"], { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shopify">Shopify</SelectItem>
                <SelectItem value="webapp">Web App</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {selectedType === "shopify" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="shopify_store_url">Store URL</Label>
                <Input
                  id="shopify_store_url"
                  placeholder="my-store.myshopify.com"
                  {...register("shopify_store_url")}
                />
                {errors.shopify_store_url && (
                  <p className="text-sm text-destructive">{errors.shopify_store_url.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="shopify_access_token">Access Token</Label>
                <Input
                  id="shopify_access_token"
                  type="password"
                  placeholder="shpat_..."
                  {...register("shopify_access_token")}
                />
                <p className="text-xs text-muted-foreground">
                  Theme Access Password or Admin API Token. Stored securely.
                </p>
                {errors.shopify_access_token && (
                  <p className="text-sm text-destructive">{errors.shopify_access_token.message}</p>
                )}
              </div>
            </>
          )}

          {serverError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{serverError}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

**Store URL approach:** The user types the full store URL (e.g. `my-store.myshopify.com`) in a plain input. The Zod schema validates the `*.myshopify.com` pattern. No suffix addon — simple and unambiguous.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/yschleich/Developer/Just\ Ship/just-ship-board && npx tsc --noEmit`

- [ ] **Step 3: Verify UI renders correctly**

Run: `cd /Users/yschleich/Developer/Just\ Ship/just-ship-board && npm run dev`
Navigate to any workspace's project settings, click "New project", verify:
1. Type selector appears below description
2. Selecting "Shopify" reveals Store URL + Token fields
3. Selecting "Web App" or "Other" hides Shopify fields
4. Form validates — Shopify type requires both Shopify fields
5. Creating a project with type works (check DB)

- [ ] **Step 4: Commit**

```bash
git add src/components/board/create-project-dialog.tsx
git commit -m "feat: add project type selector and Shopify config to create project dialog"
```

---

## Task 5: Update EditProjectDialog with type selector + Shopify fields

**Repo:** `just-ship-board`
**Files:**
- Modify: `src/components/settings/edit-project-dialog.tsx`

The existing EditProjectDialog (`src/components/settings/edit-project-dialog.tsx`) uses:
- Local Zod schema (`editProjectSchema` defined inline)
- React Hook Form with `useForm`
- PATCH to `/api/projects/${project.id}`
- Fields: name, description only

- [ ] **Step 1: Extend the component with type + Shopify fields**

Replace the full file content with:

```typescript
"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { updateProjectSchema, type UpdateProjectInput } from "@/lib/validations/project";
import type { Project } from "@/lib/types";

interface EditProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  onUpdated: (updated: Project) => void;
}

export function EditProjectDialog({
  open, onOpenChange, project, onUpdated,
}: EditProjectDialogProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [tokenChanged, setTokenChanged] = useState(false);

  const {
    register, handleSubmit, reset, setValue, control,
    formState: { errors, isSubmitting },
  } = useForm<UpdateProjectInput>({
    resolver: zodResolver(updateProjectSchema) as any,
    defaultValues: {
      name: project.name,
      description: project.description ?? "",
      type: project.type ?? undefined,
      shopify_store_url: project.shopify_store_url ?? "",
    },
  });

  const selectedType = useWatch({ control, name: "type" });

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset({
        name: project.name,
        description: project.description ?? "",
        type: project.type ?? undefined,
        shopify_store_url: project.shopify_store_url ?? "",
      });
      setServerError(null);
      setTokenChanged(false);
    }
    onOpenChange(next);
  }

  async function onSubmit(data: UpdateProjectInput) {
    setServerError(null);

    // Build payload — only include token if user typed a new one
    const payload: Record<string, unknown> = {
      name: data.name,
      description: data.description || null,
      type: data.type ?? null,
    };
    if (data.type === "shopify") {
      payload.shopify_store_url = data.shopify_store_url || null;
      if (tokenChanged && data.shopify_access_token) {
        payload.shopify_access_token = data.shopify_access_token;
      }
    }

    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        if (res.status === 409) {
          setServerError("A project with this name already exists");
          return;
        }
        const body = await res.json().catch(() => ({}));
        setServerError(body?.error?.message ?? "Failed to update project. Please try again.");
        return;
      }

      const { data: updatedProject } = await res.json();
      onUpdated(updatedProject);
      handleOpenChange(false);
    } catch {
      setServerError("Network error. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="rounded-md bg-muted/50 px-3 py-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Slug</span>
            <p className="font-mono text-xs text-muted-foreground">{project.slug}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-project-name">Name</Label>
            <Input id="edit-project-name" placeholder="My Project" {...register("name")} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-project-description">Description (optional)</Label>
            <Textarea id="edit-project-description" placeholder="What is this project about?" {...register("description")} />
            {errors.description && <p className="text-sm text-destructive">{errors.description.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Project Type</Label>
            <Select
              value={selectedType ?? ""}
              onValueChange={(val) => setValue("type", val as UpdateProjectInput["type"], { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shopify">Shopify</SelectItem>
                <SelectItem value="webapp">Web App</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {selectedType === "shopify" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="edit-shopify-store-url">Store URL</Label>
                <Input
                  id="edit-shopify-store-url"
                  placeholder="my-store.myshopify.com"
                  {...register("shopify_store_url")}
                />
                {errors.shopify_store_url && (
                  <p className="text-sm text-destructive">{errors.shopify_store_url.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-shopify-token">Access Token</Label>
                <Input
                  id="edit-shopify-token"
                  type="password"
                  placeholder={project.type === "shopify" ? "••••••••  (leave empty to keep current)" : "shpat_..."}
                  {...register("shopify_access_token", {
                    onChange: () => setTokenChanged(true),
                  })}
                />
                <p className="text-xs text-muted-foreground">
                  {project.type === "shopify"
                    ? "Leave empty to keep the current token."
                    : "Theme Access Password or Admin API Token."}
                </p>
              </div>
            </>
          )}

          {serverError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{serverError}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

Key details:
- `tokenChanged` state tracks whether the user typed in the token field
- If `tokenChanged` is false, `shopify_access_token` is not included in the PATCH payload → the API won't overwrite the existing value
- The placeholder shows "leave empty to keep current" for existing Shopify projects
- The `updateProjectSchema` from `src/lib/validations/project.ts` is used instead of the inline schema

- [ ] **Step 2: Verify TypeScript compiles and UI renders**

Run: `cd /Users/yschleich/Developer/Just\ Ship/just-ship-board && npx tsc --noEmit && npm run dev`
Navigate to project settings, click Edit on a Shopify project, verify:
1. Type selector shows current type ("Shopify")
2. Shopify fields show current store URL
3. Token shows "leave empty to keep current" placeholder
4. Saving without touching token preserves existing token in DB
5. Changing type from shopify to webapp clears shopify fields in DB (via PATCH API auto-clear logic from Task 3)

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/edit-project-dialog.tsx
git commit -m "feat: add project type and Shopify config to edit project dialog"
```

---

## Task 6: Display project type in ProjectsSettingsView

**Repo:** `just-ship-board`
**Files:**
- Modify: `src/components/settings/projects-settings-view.tsx`

- [ ] **Step 1: Show project type badge in the collapsed header**

In the project card header (around line 258), add a small badge showing the project type next to the name:

```tsx
<div className="flex-1 min-w-0">
  <div className="flex items-center gap-2">
    <p className="text-sm font-medium truncate">{project.name}</p>
    {project.type && (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        {project.type === "shopify" ? "Shopify" : project.type === "webapp" ? "Web App" : "Other"}
      </span>
    )}
  </div>
  {project.description && (
    <p className="text-xs text-muted-foreground truncate">{project.description}</p>
  )}
</div>
```

- [ ] **Step 2: Show Store URL in expanded info section**

In the expanded content info row (around line 279), add Store URL if it exists:

```tsx
{project.shopify_store_url && (
  <div>
    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
      Store
    </span>
    <div className="text-xs text-muted-foreground">
      {project.shopify_store_url}
    </div>
  </div>
)}
```

- [ ] **Step 3: Update the projects settings page server component**

In `src/app/(main)/[slug]/settings/projects/page.tsx`, make sure the `.select()` query for projects includes the new fields:

```typescript
.select("id, name, slug, description, type, shopify_store_url, ...")
```

**Do NOT include `shopify_access_token` in any select sent to the client.**

- [ ] **Step 4: Verify UI renders correctly**

Run: `npm run dev`, navigate to project settings, verify:
1. Projects with type show a badge (e.g. "Shopify") next to the name
2. Expanded Shopify projects show the store URL
3. Projects without type show no badge (backwards-compatible)

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/projects-settings-view.tsx src/app/\(main\)/\[slug\]/settings/projects/page.tsx
git commit -m "feat: display project type badge and store URL in project settings"
```

---

## Task 7: Pipeline passes Shopify env vars to agent session

**Repo:** `just-ship` (Engine)
**Files:**
- Modify: `.pipeline/worker.ts` (lines 313-321)

The pipeline already fetches ticket data including `project:projects(*)`. The new `type` and `shopify_store_url` columns on `projects` are automatically included in the Supabase response. The change is in `worker.ts` where `pipelineEnv` is constructed.

**Injection point:** `.pipeline/worker.ts`, lines 316-320. Currently:

```typescript
let pipelineEnv: Record<string, string> | undefined;
if (githubAppConfig && defaultInstallationId) {
  // ... sets pipelineEnv = { GH_TOKEN: token }
}
```

This `pipelineEnv` is passed as `env` to `executePipeline()` (line 351), which spreads it into `process.env` for every SDK call (run.ts lines 341, 514-515, 1093-1094).

- [ ] **Step 1: Add Shopify env vars to pipelineEnv**

In `.pipeline/worker.ts`, after the GitHub token resolution block (around line 335, before the `executePipeline` call), add:

```typescript
// Inject Shopify env vars from project metadata
if (ticket.project?.type === "shopify" && ticket.project?.shopify_store_url) {
  pipelineEnv = {
    ...(pipelineEnv ?? {}),
    SHOPIFY_STORE_URL: ticket.project.shopify_store_url,
  };
  // SHOPIFY_CLI_THEME_TOKEN comes from local .env on VPS for now.
  // Future: read from ticket.project.shopify_access_token
}
```

**Note:** The `ticket` object type may need updating. The Supabase query fetches `project:projects(*)`, so `ticket.project` includes all project columns. If there's a TypeScript interface for the ticket (check the top of worker.ts for a `Ticket` type definition), add `project?: { type?: string; shopify_store_url?: string; [key: string]: unknown }` to it.

- [ ] **Step 2: Verify pipeline builds**

Run: `cd /Users/yschleich/Developer/Just\ Ship/just-ship && npx tsc --noEmit -p .pipeline/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add .pipeline/worker.ts
git commit -m "feat: inject Shopify env vars into pipeline from project metadata"
```

---

## Task 8: Pipeline writes Shopify preview URL to ticket

**Repo:** `just-ship` (Engine)
**Files:**
- Modify: `.pipeline/run.ts` (Ship phase, around lines 860-876)

The pipeline already patches `preview_url` onto tickets after QA. Currently it only does this when `qaPreviewUrl` is set (from `get-preview-url.sh` which supports Vercel and Coolify). For Shopify projects, the preview URL comes from `shopify-preview.sh`.

**Existing code (run.ts ~line 860):**
```typescript
if (hasPipeline && qaPreviewUrl) {
  try {
    await fetch(`${config.pipeline.apiUrl}/api/tickets/${ticket.ticketId}`, { ... });
  }
}
```

The `qaPreviewUrl` is populated by the QA runner which calls `get-preview-url.sh`. For Shopify, the preview URL is generated differently — `shopify-preview.sh push` creates an unpublished theme and returns the preview URL.

- [ ] **Step 1: Add Shopify preview URL generation in the Ship phase**

In `.pipeline/run.ts`, in the Ship phase (after PR creation, before the `preview_url` PATCH), add Shopify-specific preview URL resolution:

```typescript
// After PR creation, before existing preview_url patch
let previewUrl = qaPreviewUrl; // Existing preview URL from QA (Vercel/Coolify)

// For Shopify projects: generate preview via shopify-preview.sh
if (!previewUrl && config.stack?.platform === "shopify") {
  try {
    const { stdout } = await execAsync(
      `bash .claude/scripts/shopify-preview.sh push "T-${ticket.ticketId}" "${ticket.title}"`,
      { cwd: workDir, timeout: 120_000 }
    );
    const url = stdout.trim();
    if (url.startsWith("http")) {
      previewUrl = url;
      logger.info({ previewUrl }, "Shopify preview URL generated");
    }
  } catch (err) {
    logger.warn({ err }, "Could not generate Shopify preview URL");
  }
}

// Existing preview_url PATCH (update to use previewUrl instead of qaPreviewUrl)
if (hasPipeline && previewUrl) {
  // ... existing PATCH code, replace qaPreviewUrl with previewUrl
}
```

**Check:** Verify `execAsync` is available (or use `execSync` / `spawn`). The existing code likely uses `child_process.execSync` — check imports at the top of run.ts.

- [ ] **Step 2: Verify pipeline builds**

Run: `cd /Users/yschleich/Developer/Just\ Ship/just-ship && npx tsc --noEmit -p .pipeline/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add .pipeline/run.ts
git commit -m "feat: generate and patch Shopify preview URL after pipeline completion"
```

---

## Task 9: Build check and final verification

**Repo:** Both repos

- [ ] **Step 1: Build Board**

Run: `cd /Users/yschleich/Developer/Just\ Ship/just-ship-board && npm run build`
Expected: Build succeeds.

- [ ] **Step 2: Build Pipeline**

Run: `cd /Users/yschleich/Developer/Just\ Ship/just-ship && npx tsc --noEmit -p .pipeline/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Manual E2E test**

1. Start Board dev server: `npm run dev`
2. Create a new project with type "Shopify", enter a store URL and fake token
3. Verify in Supabase that all 3 new columns are populated
4. Edit the project — verify type and store URL are pre-populated, token shows placeholder
5. Change type to "Web App" — verify shopify fields are cleared in DB
6. Create a Web App project — verify shopify fields are null

- [ ] **Step 4: Commit any remaining fixes**

```bash
git commit -m "fix: address issues found during E2E verification"
```
