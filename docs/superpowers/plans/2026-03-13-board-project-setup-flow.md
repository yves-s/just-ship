# Board Project Setup Flow — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-service flow for workspace creation → project setup → pipeline connection, without requiring Supabase access.

**Architecture:** Board gets new API endpoints (GET/POST /api/projects, POST regenerate key) and UI components (Create Project Dialog, Setup Dialog, Empty State). Pipeline's `/setup-just-ship` command switches from Supabase MCP to Board API. Ticket commands (`/develop`, `/ship`, `/merge`) migrate from `execute_sql` to Board REST API.

**Tech Stack:** Next.js 15 (App Router), Supabase, shadcn/radix-ui, react-hook-form + zod, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-13-board-project-setup-flow-design.md`

**Multi-repo:** This plan spans two repos:
- **Board:** `/Users/yschleich/Developer/just-ship-board`
- **Pipeline:** `/Users/yschleich/Developer/just-ship`

All file paths are relative to the respective repo root unless stated otherwise.

---

## File Map

### Board (just-ship-board) — New Files

| File | Responsibility |
|---|---|
| `src/lib/validations/project.ts` | Zod schema for project creation |
| `src/app/api/projects/route.ts` | GET/POST projects (pipeline key auth) |
| `src/app/api/workspace/[workspaceId]/api-keys/regenerate/route.ts` | Key regeneration (session auth) |
| `src/components/board/create-project-dialog.tsx` | Inline project creation dialog |
| `src/components/board/project-setup-dialog.tsx` | Setup dialog with CLI command + manual config |

### Board (just-ship-board) — Modified Files

| File | Change |
|---|---|
| `src/components/board/board.tsx` | Add empty state, dialog state, API key lifecycle |
| `src/app/[slug]/board/page.tsx` | Pass boardUrl to BoardClient |
| `src/components/board/board-toolbar.tsx` | Add "+" button and setup icon for projects |
| `src/app/new-workspace/page.tsx` | Remove API key generation/display |

### Pipeline (just-ship) — Modified Files

| File | Change |
|---|---|
| `commands/setup-just-ship.md` | Rewrite: Board API instead of Supabase MCP |
| `commands/develop.md` | Replace `execute_sql` with Board API calls |
| `commands/ship.md` | Replace `execute_sql` with Board API calls |
| `commands/merge.md` | Replace `execute_sql` with Board API calls |
| `skills/ticket-writer.md` | Replace `execute_sql` with Board API calls |
| `templates/project.json` | Add `api_url` and `api_key` to pipeline section |
| `templates/CLAUDE.md` | Update `execute_sql` documentation to Board API |

---

## Chunk 1: Board API Layer

### Task 1: Project Validation Schema

**Repo:** just-ship-board
**Files:**
- Create: `src/lib/validations/project.ts`

- [ ] **Step 1: Create project validation schema**

```typescript
// src/lib/validations/project.ts
import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).nullable().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/validations/project.ts
git commit -m "feat: add project validation schema"
```

---

### Task 2: GET /api/projects Endpoint

**Repo:** just-ship-board
**Files:**
- Create: `src/app/api/projects/route.ts`
- Reference: `src/lib/api/pipeline-key-auth.ts` (existing auth pattern)
- Reference: `src/lib/api/error-response.ts` (existing response helpers)

- [ ] **Step 1: Create GET endpoint**

```typescript
// src/app/api/projects/route.ts
import { validatePipelineKey } from "@/lib/api/pipeline-key-auth";
import { success, error, unauthorized } from "@/lib/api/error-response";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(request: Request) {
  try {
    const auth = await validatePipelineKey(request);
    if (auth.error) return unauthorized(auth.error);

    const workspaceId = auth.workspace_id!;
    const supabase = createServiceClient();

    const { data: workspace } = await supabase
      .from("workspaces")
      .select("id, name")
      .eq("id", workspaceId)
      .single();

    const { data: projects } = await supabase
      .from("projects")
      .select("id, name, description")
      .eq("workspace_id", workspaceId)
      .order("name");

    return success({
      workspace_id: workspace?.id,
      workspace_name: workspace?.name,
      projects: projects ?? [],
    });
  } catch (err) {
    return error("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
}
```

**Note:** The `success()` helper wraps the response as `{ data: { ... }, error: null }`. This is the established codebase convention used by all API routes.

- [ ] **Step 2: Verify with curl**

```bash
curl -s -H "X-Pipeline-Key: adp_YOUR_KEY" https://board.just-ship.io/api/projects | jq .
```

Expected: 200 with `{ data: { workspace_id, workspace_name, projects: [...] }, error: null }`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/projects/route.ts
git commit -m "feat: add GET /api/projects endpoint with pipeline key auth"
```

---

### Task 3: POST /api/projects Endpoint

**Repo:** just-ship-board
**Files:**
- Modify: `src/app/api/projects/route.ts`
- Reference: `src/lib/validations/project.ts`

- [ ] **Step 1: Add POST handler to the same route file**

Add the POST handler and merge imports with the existing GET handler. The combined import block at the top of the file should be:

```typescript
import { validatePipelineKey } from "@/lib/api/pipeline-key-auth";
import { success, error, unauthorized, validationError } from "@/lib/api/error-response";
import { createServiceClient } from "@/lib/supabase/service";
import { createProjectSchema } from "@/lib/validations/project";
```

Then add the POST handler:

```typescript
export async function POST(request: Request) {
  try {
    const auth = await validatePipelineKey(request);
    if (auth.error) return unauthorized(auth.error);

    const workspaceId = auth.workspace_id!;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return error("INVALID_JSON", "Request body must be valid JSON", 400);
    }

    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createServiceClient();

    // Quota: max 50 projects per workspace
    const { count } = await supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);

    if (count !== null && count >= 50) {
      return error("QUOTA_EXCEEDED", "Maximum 50 projects per workspace", 422);
    }

    const { data: project, error: dbError } = await supabase
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
      })
      .select("id, name, workspace_id, description")
      .single();

    if (dbError) {
      if (dbError.code === "23505") {
        return error("CONFLICT", "Project name already exists", 409);
      }
      return error("DB_ERROR", dbError.message, 500);
    }

    return success(project, 201);
  } catch (err) {
    return error("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
}
```

**Prerequisite:** Verify that the `projects` table has a unique constraint on `(workspace_id, name)`. Check migrations or run:
```sql
SELECT conname FROM pg_constraint WHERE conrelid = 'projects'::regclass AND contype = 'u';
```
If no unique constraint exists, add one before implementing:
```sql
ALTER TABLE projects ADD CONSTRAINT projects_workspace_name_unique UNIQUE (workspace_id, name);
```

- [ ] **Step 2: Verify with curl**

```bash
curl -s -X POST -H "X-Pipeline-Key: adp_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Project"}' \
  https://board.just-ship.io/api/projects | jq .
```

Expected: 201 with `{ data: { id, name, workspace_id }, error: null }`

Test duplicate name:
```bash
curl -s -X POST -H "X-Pipeline-Key: adp_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Project"}' \
  https://board.just-ship.io/api/projects | jq .
```

Expected: 409 with `{ data: null, error: { code: "CONFLICT", message: "Project name already exists" } }`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/projects/route.ts
git commit -m "feat: add POST /api/projects endpoint with rate limiting"
```

---

### Task 4: Key Regeneration Endpoint

**Repo:** just-ship-board
**Files:**
- Create: `src/app/api/workspace/[workspaceId]/api-keys/regenerate/route.ts`
- Reference: `src/app/api/workspace/[workspaceId]/api-keys/route.ts` (existing key creation pattern)

- [ ] **Step 1: Create regenerate endpoint**

```typescript
// src/app/api/workspace/[workspaceId]/api-keys/regenerate/route.ts
import { createHash, randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { success, error, unauthorized } from "@/lib/api/error-response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
  const { workspaceId } = await params;

  // Session auth (Board UI only)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  // Verify workspace membership
  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();
  if (!member) return unauthorized("Not a workspace member");

  const serviceClient = createServiceClient();

  // Generate new key FIRST (so user never has zero valid keys)
  const rawKey = "adp_" + randomBytes(32).toString("hex");
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 12);

  const { error: insertError } = await serviceClient
    .from("api_keys")
    .insert({
      workspace_id: workspaceId,
      name: "Pipeline",
      key_hash: keyHash,
      key_prefix: keyPrefix,
      created_by: user.id,
    });

  if (insertError) {
    return error("DB_ERROR", "Failed to create new key", 500);
  }

  // THEN revoke all OTHER active keys (the new one stays active)
  const { error: revokeError } = await serviceClient
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .neq("key_hash", keyHash);

  if (revokeError) {
    // New key is already created, revocation failed — log but don't fail
    console.error("Failed to revoke old keys:", revokeError);
  }

  return success({ api_key: rawKey, prefix: keyPrefix });
  } catch (err) {
    return error("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/workspace/\[workspaceId\]/api-keys/regenerate/route.ts
git commit -m "feat: add key regeneration endpoint"
```

---

## Chunk 2: Board UI Components

### Task 5: Create Project Dialog

**Repo:** just-ship-board
**Files:**
- Create: `src/components/board/create-project-dialog.tsx`
- Reference: `src/components/tickets/create-ticket-dialog.tsx` (pattern)

- [ ] **Step 1: Create dialog component**

Follow the existing `CreateTicketDialog` pattern: radix Dialog + react-hook-form + zod.

```tsx
// src/components/board/create-project-dialog.tsx
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createProjectSchema,
  type CreateProjectInput,
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
  open,
  onOpenChange,
  workspaceId,
  onCreated,
}: CreateProjectDialogProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
  });

  function handleOpenChange(open: boolean) {
    if (!open) {
      reset();
      setServerError(null);
    }
    onOpenChange(open);
  }

  async function onSubmit(data: CreateProjectInput) {
    setServerError(null);
    const supabase = createClient();
    const { data: project, error } = await supabase
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: data.name,
        description: data.description ?? null,
      })
      .select()
      .single();

    if (error) {
      setServerError(
        error.code === "23505"
          ? "A project with this name already exists"
          : error.message
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
            <Input
              id="name"
              placeholder="My Project"
              {...register("name")}
            />
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

- [ ] **Step 2: Commit**

```bash
git add src/components/board/create-project-dialog.tsx
git commit -m "feat: add create project dialog component"
```

---

### Task 6: Project Setup Dialog

**Repo:** just-ship-board
**Files:**
- Create: `src/components/board/project-setup-dialog.tsx`
- Reference: `src/components/settings/create-api-key-dialog.tsx` (copy button pattern)

This is the dialog that shows after project creation and is re-openable via "Setup" icon. It shows the CLI command and manual config.

- [ ] **Step 0: Install missing shadcn/ui components**

```bash
npx shadcn@latest add collapsible alert-dialog
```

This creates `src/components/ui/collapsible.tsx` and `src/components/ui/alert-dialog.tsx`.

- [ ] **Step 1: Create setup dialog component**

```tsx
// src/components/board/project-setup-dialog.tsx
"use client";

import { useState } from "react";
import { Copy, Check, RefreshCw, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Project, ApiKey } from "@/lib/types";

interface ProjectSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  workspaceId: string;
  boardUrl: string;
  apiKey: ApiKey | null;
  plaintextKey: string | null;
  onRegenerateKey: () => Promise<string | null>;
}

export function ProjectSetupDialog({
  open,
  onOpenChange,
  project,
  workspaceId,
  boardUrl,
  apiKey,
  plaintextKey,
  onRegenerateKey,
}: ProjectSetupDialogProps) {
  const [copied, setCopied] = useState<"cli" | "json" | null>(null);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [currentPlaintextKey, setCurrentPlaintextKey] = useState(plaintextKey);
  const [manualOpen, setManualOpen] = useState(false);

  const displayKey = currentPlaintextKey
    ? currentPlaintextKey
    : apiKey
      ? `${apiKey.key_prefix}...****`
      : "Generating...";

  const cliCommand = `/setup-just-ship \\
  --board ${boardUrl} \\
  --key ${displayKey} \\
  --project ${project.id}`;

  const jsonConfig = JSON.stringify(
    {
      pipeline: {
        project_id: project.id,
        project_name: project.name,
        workspace_id: workspaceId,
        api_url: boardUrl,
        api_key: displayKey,
      },
    },
    null,
    2
  );

  async function copyToClipboard(text: string, type: "cli" | "json") {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleRegenerate() {
    setRegenerating(true);
    const newKey = await onRegenerateKey();
    if (newKey) setCurrentPlaintextKey(newKey);
    setRegenerating(false);
    setShowRegenConfirm(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect &ldquo;{project.name}&rdquo;</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Option 1: CLI Command */}
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
              <p className="text-sm font-medium">
                Run this in your project terminal:
              </p>
              <div className="relative">
                <pre className="text-xs bg-background rounded p-3 overflow-x-auto">
                  {cliCommand}
                </pre>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-1 right-1 h-7 w-7"
                  onClick={() => copyToClipboard(cliCommand, "cli")}
                >
                  {copied === "cli" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>

            {/* Option 2: Manual JSON (collapsible) */}
            <Collapsible open={manualOpen} onOpenChange={setManualOpen}>
              <CollapsibleTrigger className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                {manualOpen ? "▾" : "▸"} Manual: add to project.json
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <div className="relative">
                  <pre className="text-xs bg-muted rounded p-3 overflow-x-auto">
                    {jsonConfig}
                  </pre>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-1 right-1 h-7 w-7"
                    onClick={() => copyToClipboard(jsonConfig, "json")}
                  >
                    {copied === "json" ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* API Key management */}
            <div className="border-t pt-3 flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                API Key: <code className="text-xs">{apiKey?.key_prefix ?? "—"}...****</code>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowRegenConfirm(true)}
                disabled={regenerating}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${regenerating ? "animate-spin" : ""}`} />
                Regenerate Key
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Later
            </Button>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Regenerate Confirmation */}
      <AlertDialog open={showRegenConfirm} onOpenChange={setShowRegenConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Regenerate API Key?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>The current key will be revoked immediately. After regenerating:</p>
                <ul className="list-disc pl-4 space-y-1 text-sm">
                  <li>All connected projects need the new key</li>
                  <li>
                    Run{" "}
                    <code className="text-xs">/setup-just-ship --board ... --key &lt;new-key&gt;</code>{" "}
                    in each project
                  </li>
                  <li>
                    Or replace <code className="text-xs">api_key</code> in{" "}
                    <code className="text-xs">project.json</code> manually
                  </li>
                  <li>Restart VPS worker if active</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRegenerate}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Regenerate Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/board/project-setup-dialog.tsx
git commit -m "feat: add project setup dialog with CLI command and key management"
```

---

### Task 7: Add "+" Button to Board Toolbar

**Repo:** just-ship-board
**Files:**
- Modify: `src/components/board/board-toolbar.tsx`

- [ ] **Step 1: Add "+" button to toolbar**

The project filter is **inside** the main filter DropdownMenu (not a standalone dropdown). Add the "+" button as a **standalone button** in the toolbar's flex container, after the existing filter/sort buttons.

Add to imports:
```tsx
import { Plus } from "lucide-react";
```

Add to component props interface:
```tsx
onCreateProject?: () => void;
onSetupProject?: (project: Project) => void;
```

Add the button in the toolbar's button row (the `flex items-center gap-2` container), after existing buttons:
```tsx
{onCreateProject && (
  <Button
    variant="ghost"
    size="icon"
    className="h-8 w-8"
    onClick={onCreateProject}
    title="Create project"
  >
    <Plus className="h-4 w-4" />
  </Button>
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/board/board-toolbar.tsx
git commit -m "feat: add create project button to board toolbar"
```

---

### Task 8: Board Empty State + Dialog Wiring

**Repo:** just-ship-board
**Files:**
- Modify: `src/components/board/board.tsx` (the client component where all board state lives)
- Modify: `src/components/board/board-client.tsx` (add `boardUrl` to `BoardClientProps` interface and forward to `Board`)
- Modify: `src/app/[slug]/board/page.tsx` (pass `boardUrl` prop to `BoardClient`)
- Reference: `src/components/board/create-project-dialog.tsx`
- Reference: `src/components/board/project-setup-dialog.tsx`

**Important:** The board page (`page.tsx`) is a server component that delegates to `BoardClient`, which dynamically imports the `Board` component. All client-side state (dialogs, project list) must live in the `Board` component, NOT in the server page.

- [ ] **Step 1: Pass boardUrl from server page**

In `src/app/[slug]/board/page.tsx`, pass the board URL to the client component:

```tsx
// In src/app/[slug]/board/page.tsx (server component):
const boardUrl = process.env.NEXT_PUBLIC_APP_URL || "";
// Pass to BoardClient: <BoardClient ... boardUrl={boardUrl} />
```

Also update `src/components/board/board-client.tsx`:
- Add `boardUrl: string` to the `BoardClientProps` interface
- Forward it to the dynamically imported `Board` component: `<Board ... boardUrl={boardUrl} />`

And update `src/components/board/board.tsx`:
- Add `boardUrl: string` to the `BoardProps` interface

- [ ] **Step 2: Add dialog state and API key lifecycle to Board component**

In `src/components/board/board.tsx`, add the following state and logic:

```tsx
import { useState, useCallback } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateProjectDialog } from "./create-project-dialog";
import { ProjectSetupDialog } from "./project-setup-dialog";
import { createClient } from "@/lib/supabase/client";
import type { Project, ApiKey } from "@/lib/types";

// Inside the Board component:

// Convert projects prop to local state (so we can add new ones)
const [localProjects, setLocalProjects] = useState<Project[]>(projects);

// Dialog state
const [createProjectOpen, setCreateProjectOpen] = useState(false);
const [setupProject, setSetupProject] = useState<Project | null>(null);

// API key state
const [apiKey, setApiKey] = useState<ApiKey | null>(null);
const [plaintextKey, setPlaintextKey] = useState<string | null>(null);

// Auto-fetch or generate API key when setup dialog opens
const ensureApiKey = useCallback(async () => {
  if (apiKey) return;
  const supabase = createClient();
  // Try to fetch existing key
  const { data: keys } = await supabase
    .from("api_keys")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .limit(1);

  if (keys && keys.length > 0) {
    setApiKey(keys[0]);
    return;
  }

  // No key exists — create one
  const res = await fetch(`/api/workspace/${workspaceId}/api-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Pipeline" }),
  });
  if (res.ok) {
    const { data } = await res.json();
    setApiKey(data.key);
    setPlaintextKey(data.plaintext);
  }
}, [apiKey, workspaceId]);

// Handle project creation → open setup dialog
function handleProjectCreated(project: Project) {
  setLocalProjects((prev) => [...prev, project]);
  setSetupProject(project);
  ensureApiKey();
}

// Handle setup icon click on existing project
function handleSetupProject(project: Project) {
  setSetupProject(project);
  ensureApiKey();
}

// Handle key regeneration
async function handleRegenerateKey(): Promise<string | null> {
  const res = await fetch(`/api/workspace/${workspaceId}/api-keys/regenerate`, {
    method: "POST",
  });
  if (!res.ok) return null;
  const { data } = await res.json();
  setApiKey({ ...apiKey!, key_prefix: data.prefix, revoked_at: null });
  setPlaintextKey(data.api_key);
  return data.api_key;
}
```

- [ ] **Step 3: Add empty state and dialogs to Board JSX**

In the Board component's return, add the empty state before the `DndContext` and the dialogs at the end:

```tsx
{/* Empty state — shown when no projects exist */}
{localProjects.length === 0 && (
  <div className="flex flex-col items-center justify-center py-24 text-center">
    <h2 className="text-xl font-semibold mb-2">Welcome to your workspace!</h2>
    <p className="text-muted-foreground mb-6 max-w-md">
      Projects group your tickets and connect to your codebase.
    </p>
    <Button onClick={() => setCreateProjectOpen(true)}>
      <Plus className="h-4 w-4 mr-2" />
      Create your first project
    </Button>
  </div>
)}

{/* Board columns — shown always (tickets can exist without projects) */}
{/* ... existing DndContext and columns ... */}

{/* Dialogs */}
<CreateProjectDialog
  open={createProjectOpen}
  onOpenChange={setCreateProjectOpen}
  workspaceId={workspaceId}
  onCreated={handleProjectCreated}
/>
{setupProject && (
  <ProjectSetupDialog
    open={!!setupProject}
    onOpenChange={(open) => !open && setSetupProject(null)}
    project={setupProject}
    workspaceId={workspaceId}
    boardUrl={boardUrl}
    apiKey={apiKey}
    plaintextKey={plaintextKey}
    onRegenerateKey={handleRegenerateKey}
  />
)}
```

- [ ] **Step 4: Wire toolbar callbacks**

Pass the new callbacks to `BoardToolbar`:

```tsx
<BoardToolbar
  // ... existing props ...
  onCreateProject={() => setCreateProjectOpen(true)}
  onSetupProject={handleSetupProject}
/>
```

- [ ] **Step 5: Commit**

```bash
git add src/components/board/board.tsx src/app/[slug]/board/page.tsx
git commit -m "feat: add empty state, dialog wiring, and API key lifecycle to board"
```

---

### Task 9: "Setup" Icon on Projects

**Repo:** just-ship-board
**Files:**
- Modify: `src/components/board/board-toolbar.tsx`

- [ ] **Step 1: Add setup icon to project items in the filter dropdown**

The project items are currently `DropdownMenuCheckboxItem` components. Replace each project's checkbox item with a custom layout using `DropdownMenuItem` that includes both a checkbox and a Terminal icon. This avoids Radix event handling conflicts.

Add to imports:
```tsx
import { Terminal, Check } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
```

Replace the existing project filter items (the `projects.map(...)` block) with:
```tsx
{projects.map((p) => (
  <DropdownMenuItem
    key={p.id}
    className="flex items-center gap-2"
    onSelect={(e) => e.preventDefault()} // keep dropdown open
  >
    <button
      className="flex items-center gap-2 flex-1"
      onClick={() => toggleProject(p.id)}
    >
      <div className="h-4 w-4 border rounded flex items-center justify-center">
        {filters.projectIds.includes(p.id) && <Check className="h-3 w-3" />}
      </div>
      <span>{p.name}</span>
    </button>
    <button
      className="p-1 hover:bg-accent rounded"
      onClick={(e) => {
        e.stopPropagation();
        onSetupProject?.(p);
      }}
      title="Setup instructions"
    >
      <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  </DropdownMenuItem>
))}
```

`onSetupProject` was already added to props in Task 7.

Also update the "No project" checkbox item (currently a `DropdownMenuCheckboxItem`) to use the same `DropdownMenuItem` + manual checkbox layout for visual consistency. The "No project" item does not need a Terminal icon.

- [ ] **Step 2: Commit**

```bash
git add src/components/board/board-toolbar.tsx
git commit -m "feat: add setup icon to project filter for re-opening setup dialog"
```

---

### Task 10: Simplify Workspace Creation

**Repo:** just-ship-board
**Files:**
- Modify: `src/app/new-workspace/page.tsx`

- [ ] **Step 1: Remove API key generation from workspace creation**

In `new-workspace/page.tsx`:

**Remove these state variables:**
- `apiKey`, `showApiKey`, `copied` — all API key display state

**Remove from `onSubmit` function:**
- The `POST /api/workspace/${workspaceId}/api-keys` fetch call (creates the key)
- The `setApiKey(...)` and related state updates

**Remove from JSX:**
- The entire API key display section (the card/section that shows the plaintext key with copy button)
- The "copy key" button and its handler

**Simplify `onSubmit` to:**
```tsx
async function onSubmit(data: WorkspaceFormData) {
  setLoading(true);
  setError(null);
  // ... existing workspace creation via create_workspace() RPC ...
  // After success: redirect immediately
  router.push(`/${slug}/board`);
}
```

The page should now: form → create workspace → redirect to board. No key step.

- [ ] **Step 2: Commit**

```bash
git add src/app/new-workspace/page.tsx
git commit -m "refactor: remove API key generation from workspace creation"
```

---

## Chunk 3: Pipeline Commands

### Task 11: Update project.json Template

**Repo:** just-ship
**Files:**
- Modify: `templates/project.json`

- [ ] **Step 1: Add `api_url` and `api_key` to pipeline template**

Update the `pipeline` section in `templates/project.json`. Note: `project_id` now stores the **Board project UUID** (not the Supabase hosting project ID). The `supabase` section remains for app-specific Supabase config (e.g., the app's own database), which is separate from the pipeline connection.

```json
"pipeline": {
  "project_id": "",
  "project_name": null,
  "workspace_id": "",
  "api_url": "",
  "api_key": ""
}
```

Only add `api_url` and `api_key` — don't change other fields.

- [ ] **Step 2: Commit**

```bash
git add templates/project.json
git commit -m "feat: add api_url and api_key to project.json pipeline template"
```

---

### Task 12: Rewrite `/setup-just-ship` Command

**Repo:** just-ship
**Files:**
- Modify: `commands/setup-just-ship.md`

- [ ] **Step 1: Rewrite the Board connection section (Step 4 in current command)**

The command is a Claude Code slash command (markdown instructions for Claude). The current Step 4 (lines ~125-203) has sub-steps 4a-4f that depend on Supabase MCP. Here's what to do with each:

**REMOVE entirely:**
- Step 4a: `mcp__claude_ai_Supabase__list_projects` (find Supabase project) — replaced by Board API
- Step 4b: Query Supabase for workspaces — workspace comes from API key validation
- Step 4c: Create workspace via SQL — workspaces are only created in Board UI
- Step 4e: Generate API key via SQL INSERT — keys come from Board UI
- Step 4f: Write config with only `project_id`, `project_name`, `workspace_id`

**KEEP (Steps 1-3):**
- Step 1: Stack detection (framework, language, etc.) — unchanged
- Step 2: project.json population (stack, build, paths) — unchanged
- Step 3: CLAUDE.md enrichment — unchanged

**REPLACE Step 4 with:**

```markdown
## Step 4: Connect to Just Ship Board (optional)

Parse command arguments for `--board`, `--key`, `--project` flags.

### If flags provided (Direct Connect mode):
1. Call `GET {--board}/api/projects` with header `X-Pipeline-Key: {--key}` using Bash curl
2. If `--project` is provided: find matching project in response, use it directly
3. If `--project` is not provided: show available projects, ask user to choose or create new
4. If creating new: `POST {--board}/api/projects` with `{ "name": "..." }`
5. Handle errors: 401 = invalid key, network error = Board unreachable

### If no flags (interactive mode):
1. Ask user: "Connect to Just Ship Board? (y/n)"
2. If yes: ask for Board URL and API Key conversationally
3. Then proceed as above

### Write pipeline config:
Write ALL 5 fields to project.json `pipeline` section:
- `project_id`: Board project UUID from API response `projects[].id`
- `project_name`: from API response `projects[].name`
- `workspace_id`: from API response `workspace_id`
- `api_url`: Board URL
- `api_key`: API key

### Security check:
Run `git ls-files project.json` — if tracked, warn:
"⚠️ project.json is tracked by git and now contains an API key.
Consider adding it to .gitignore."
```

- [ ] **Step 2: Commit**

```bash
git add commands/setup-just-ship.md
git commit -m "feat: rewrite setup-just-ship to use Board API instead of Supabase MCP"
```

---

### Task 13: Update `/develop` Command

**Repo:** just-ship
**Files:**
- Modify: `commands/develop.md`

- [ ] **Step 1: Replace `execute_sql` with Board API calls**

In `commands/develop.md`, replace the ticket fetching and status update SQL with Board API calls.

**Check config first:** At the start, read `project.json`. If `pipeline.api_url` and `pipeline.api_key` are set, use the Board API. Otherwise, fall back to existing `execute_sql` approach and log: "⚠️ No Board API configured. Using legacy Supabase MCP. Run /setup-just-ship to upgrade."

**Fetch next ticket:** Replace the `execute_sql` SELECT with:
```
curl -s -H "X-Pipeline-Key: {pipeline.api_key}" \
  "{pipeline.api_url}/api/tickets?status=ready_to_develop&project={pipeline.project_id}"
```
The Board API returns tickets ordered by default. Select the first ticket from the response. If the current command uses specific ticket number (e.g., user says "work on T-162"), use:
```
curl -s -H "X-Pipeline-Key: {pipeline.api_key}" \
  "{pipeline.api_url}/api/tickets/162"
```

**Update ticket status (claim):** Replace `execute_sql` UPDATE with:
```
curl -s -X PATCH -H "X-Pipeline-Key: {pipeline.api_key}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress", "branch": "{branch_name}", "project_id": "{pipeline.project_id}"}' \
  "{pipeline.api_url}/api/tickets/{number}"
```
Note: include `branch` (so Board UI shows which branch) and `project_id` (to assign ticket to project if not already assigned).

- [ ] **Step 2: Commit**

```bash
git add commands/develop.md
git commit -m "feat: update /develop to use Board API for ticket operations"
```

---

### Task 14: Update `/ship` Command

**Repo:** just-ship
**Files:**
- Modify: `commands/ship.md`

- [ ] **Step 1: Replace `execute_sql` with Board API call**

Replace the status update SQL with:
```
curl -s -X PATCH -H "X-Pipeline-Key: {pipeline.api_key}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_review"}' \
  "{pipeline.api_url}/api/tickets/{number}"
```

**Three-way backward compatibility check** (same for all commands):
1. If `pipeline.api_url` AND `pipeline.api_key` are set → use Board API
2. Else if `pipeline.project_id` is set (legacy format) → use `execute_sql` via Supabase MCP, log warning to re-run `/setup-just-ship`
3. Else → skip pipeline status updates entirely (standalone mode)

- [ ] **Step 2: Commit**

```bash
git add commands/ship.md
git commit -m "feat: update /ship to use Board API for ticket status update"
```

---

### Task 15: Update `/merge` Command

**Repo:** just-ship
**Files:**
- Modify: `commands/merge.md`

- [ ] **Step 1: Replace `execute_sql` with Board API call**

Replace the status update SQL with:
```
curl -s -X PATCH -H "X-Pipeline-Key: {pipeline.api_key}" \
  -H "Content-Type: application/json" \
  -d '{"status": "done", "summary": "{pr_summary}"}' \
  "{pipeline.api_url}/api/tickets/{number}"
```
Note: include `summary` so the Board shows a completion summary for the ticket.

**Three-way backward compatibility check** (same as Tasks 13-14):
1. If `pipeline.api_url` AND `pipeline.api_key` are set → use Board API
2. Else if `pipeline.project_id` is set (legacy format) → use `execute_sql`, log warning
3. Else → skip pipeline status updates

Also fix the existing inconsistency: `/merge` currently reads `supabase.project_id` instead of `pipeline.project_id` for its config check — normalize to check `pipeline.api_url`.

- [ ] **Step 2: Commit**

```bash
git add commands/merge.md
git commit -m "feat: update /merge to use Board API for ticket status update"
```

---

### Task 16: Update ticket-writer Skill and CLAUDE.md Template

**Repo:** just-ship
**Files:**
- Modify: `skills/ticket-writer.md`
- Modify: `templates/CLAUDE.md`

- [ ] **Step 1: Update ticket-writer.md**

The ticket-writer skill currently uses `execute_sql` with `pipeline.project_id` as the Supabase project ID to INSERT tickets. Replace with Board API:

```
curl -s -X POST -H "X-Pipeline-Key: {pipeline.api_key}" \
  -H "Content-Type: application/json" \
  -d '{"title": "...", "body": "...", "priority": "...", "tags": [...], "project_id": "{pipeline.project_id}"}' \
  "{pipeline.api_url}/api/tickets"
```

Same backward compatibility: if `pipeline.api_url` is empty, fall back to `execute_sql`.

- [ ] **Step 2: Update CLAUDE.md template**

In `templates/CLAUDE.md`, update the "Ticket-Workflow" section that documents `execute_sql` status update patterns. Replace the SQL examples with Board API curl examples matching the new pattern.

- [ ] **Step 3: Commit**

```bash
git add skills/ticket-writer.md templates/CLAUDE.md
git commit -m "feat: update ticket-writer and CLAUDE.md template to use Board API"
```

---

## Verification

### Task 17: End-to-End Smoke Test

- [ ] **Step 1: Test Board flow**

1. Navigate to Board → verify empty state appears for workspace with 0 projects
2. Click "Create your first project" → verify dialog opens
3. Create a project → verify Setup Dialog appears with CLI command
4. Click "Copy" → verify clipboard has correct command
5. Click "Later" → verify dialog closes
6. In toolbar, click "+" → verify Create Project Dialog opens
7. In toolbar, click Terminal icon on project → verify Setup Dialog reopens

- [ ] **Step 2: Test API endpoints**

```bash
# GET projects
curl -s -H "X-Pipeline-Key: YOUR_KEY" https://board.just-ship.io/api/projects | jq .

# POST project
curl -s -X POST -H "X-Pipeline-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "CLI Test"}' \
  https://board.just-ship.io/api/projects | jq .
```

- [ ] **Step 3: Test CLI flow**

In a project directory with the pipeline framework installed:
```
/setup-just-ship --board https://board.just-ship.io --key YOUR_KEY --project PROJECT_ID
```

Verify `project.json` has complete pipeline config with all 5 fields.

- [ ] **Step 4: Test /develop with new Board API**

1. Create a ticket in the Board with status `ready_to_develop`
2. In a project with new-format `project.json` (Board API configured), run `/develop`
3. Verify: ticket fetched via Board API, status updated to `in_progress`, branch field set

- [ ] **Step 5: Test backward compatibility**

Verify that `/develop`, `/ship`, `/merge` still work in projects with old-format `project.json` (Supabase project ID in `pipeline.project_id`, no `api_url`/`api_key`). They should fall back to `execute_sql` with a warning.
