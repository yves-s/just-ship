# Proposal Prototype Embed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admin to upload an HTML prototype file that displays as an interactive iframe on the public proposal page, with a fullscreen toggle.

**Architecture:** Two new columns on `project_intakes` for the prototype file path and filename. Admin uploads HTML via the Proposal Panel using Supabase Storage. The proposal page renders the prototype as a sandboxed iframe with a fullscreen modal.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Supabase Storage, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-04-02-proposal-prototype-embed-design.md`

**Target Repo:** `/Users/yschleich/Developer/just-ship-board/`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `supabase/migrations/022_prototype_columns.sql` | DB migration — two new columns on `project_intakes` |

### Modified Files
| File | Change |
|------|--------|
| `src/lib/types/intake.ts` | Add `prototype_file_path` and `prototype_filename` to `ProjectIntake` |
| `src/lib/validations/intake.ts` | Add prototype fields to `updateIntakeSchema` |
| `src/components/intake/proposal-panel.tsx` | Add prototype upload/delete UI |
| `src/app/proposal/[token]/page.tsx` | Select and pass prototype fields to client |
| `src/app/proposal/[token]/proposal-page-client.tsx` | Render prototype iframe + fullscreen modal |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/022_prototype_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 022_prototype_columns.sql
-- Add prototype file columns to project_intakes

ALTER TABLE project_intakes
  ADD COLUMN prototype_file_path TEXT DEFAULT NULL,
  ADD COLUMN prototype_filename TEXT DEFAULT NULL;
```

- [ ] **Step 2: Apply migration**

Apply via Supabase MCP tool `apply_migration` on project `wsmnutkobalfrceavpxs` with name `prototype_columns`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/022_prototype_columns.sql
git commit -m "feat: add prototype columns to project_intakes (migration 022)"
```

---

## Task 2: Types & Validations

**Files:**
- Modify: `src/lib/types/intake.ts`
- Modify: `src/lib/validations/intake.ts`

- [ ] **Step 1: Add fields to ProjectIntake type**

In `src/lib/types/intake.ts`, add after the existing proposal fields on `ProjectIntake` (after `proposal_viewed_at: string | null;`):

```typescript
  // Prototype fields
  prototype_file_path: string | null;
  prototype_filename: string | null;
```

- [ ] **Step 2: Add fields to validation schema**

In `src/lib/validations/intake.ts`, add to `updateIntakeSchema` (before the closing `}).strict()`):

```typescript
  prototype_file_path: z.string().nullable().optional(),
  prototype_filename: z.string().max(500).nullable().optional(),
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/types/intake.ts src/lib/validations/intake.ts
git commit -m "feat: add prototype type fields and validation schema"
```

---

## Task 3: Admin Prototype Upload in Proposal Panel

**Files:**
- Modify: `src/components/intake/proposal-panel.tsx`

- [ ] **Step 1: Add prototype upload section**

In `src/components/intake/proposal-panel.tsx`, add the prototype upload UI inside the existing `<Card>` component, after the "Angebotslink kopieren" button (the last element in the card's `space-y-4` div).

Add these imports at the top:

```typescript
import { Upload, Trash2, ExternalLink } from "lucide-react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
```

Add a ref and state after the existing state declarations:

```typescript
  const prototypeInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPrototype, setUploadingPrototype] = useState(false);
```

Also add `useRef` to the React import at the top (it already imports `useState`).

Add the upload handler function after `handleCopyLink`:

```typescript
  async function handlePrototypeUpload(file: File) {
    if (!file.name.endsWith(".html")) return;
    if (file.size > 5 * 1024 * 1024) {
      console.error("Prototype file too large (max 5 MB)");
      return;
    }
    setUploadingPrototype(true);
    try {
      const supabase = createBrowserClient();
      const path = `prototypes/${intakeId}/${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("intake-files")
        .upload(path, file, { upsert: true, contentType: "text/html" });
      if (uploadError) throw uploadError;
      await updateMutation.mutateAsync({
        prototype_file_path: path,
        prototype_filename: file.name,
      });
    } catch (err) {
      console.error("Prototype upload failed:", err);
    } finally {
      setUploadingPrototype(false);
    }
  }

  async function handlePrototypeDelete() {
    try {
      if (intake.prototype_file_path) {
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
        await supabase.storage
          .from("intake-files")
          .remove([intake.prototype_file_path]);
      }
      await updateMutation.mutateAsync({
        prototype_file_path: null,
        prototype_filename: null,
      });
    } catch (err) {
      console.error("Prototype delete failed:", err);
    }
  }
```

Add the UI section after the "Angebotslink kopieren" button, still inside the `space-y-4` div:

```typescript
        {/* Prototype */}
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Prototyp</div>
          {intake.prototype_file_path ? (
            <div className="flex items-center gap-2 rounded-md border px-3 py-2">
              <span className="flex-1 truncate text-sm">
                {intake.prototype_filename || "prototype.html"}
              </span>
              <a
                href={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/intake-files/${intake.prototype_file_path}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="size-3.5" />
              </a>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={handlePrototypeDelete}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full flex-col items-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-4 text-center text-muted-foreground transition-colors hover:border-muted-foreground/50"
              onClick={() => prototypeInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const file = e.dataTransfer.files[0];
                if (file) handlePrototypeUpload(file);
              }}
              disabled={uploadingPrototype}
            >
              <Upload className="size-4" />
              <span className="text-xs font-medium">
                {uploadingPrototype ? "Uploading..." : "HTML-Prototyp hochladen"}
              </span>
            </button>
          )}
          <input
            ref={prototypeInputRef}
            type="file"
            accept=".html,text/html"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handlePrototypeUpload(file);
              e.target.value = "";
            }}
            className="hidden"
          />
        </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/intake/proposal-panel.tsx
git commit -m "feat: add prototype upload UI to admin proposal panel"
```

---

## Task 4: Pass Prototype Data to Proposal Page

**Files:**
- Modify: `src/app/proposal/[token]/page.tsx`
- Modify: `src/app/proposal/[token]/proposal-page-client.tsx`

- [ ] **Step 1: Add fields to server component select**

In `src/app/proposal/[token]/page.tsx`, extend the select string (currently at line 16-17) to include the prototype fields. Add `prototype_file_path` to the select:

Find the select string and add `, prototype_file_path` before the closing quote. (Only `prototype_file_path` is needed on the public page — `prototype_filename` is admin-only.)

Then pass them to the client component. Add after `acceptedAt={intake.proposal_accepted_at}`:

```typescript
      prototypeFilePath={intake.prototype_file_path}
```

- [ ] **Step 2: Add props and prototype section to client component**

In `src/app/proposal/[token]/proposal-page-client.tsx`:

Add `prototypeFilePath` to the props interface (after `acceptedAt`):

```typescript
  prototypeFilePath: string | null;
```

Add it to the destructured props:

```typescript
  prototypeFilePath,
```

Add fullscreen modal state after the existing state declarations:

```typescript
  const [prototypeFullscreen, setPrototypeFullscreen] = useState(false);
```

Add the prototype section JSX. Place it **between** the Advantages section and the CTA section. Find the `{/* CTA */}` comment and add this block before it:

```typescript
      {/* Prototype */}
      {prototypeFilePath && (
        <>
          <div className="mx-auto max-w-[800px] px-6 py-8 sm:px-8">
            <div className="mb-5 text-center">
              <div className="mb-2 text-xs uppercase tracking-[1.5px] text-[#666]">
                Ein erster Einblick
              </div>
              <div className="text-xl font-bold text-white">
                Dein Produkt als Prototyp
              </div>
              <div className="mt-1 text-sm text-[#888]">
                Interaktiver Prototyp — klick dich durch
              </div>
            </div>

            <div className="mx-auto max-w-[600px]">
              <div className="relative overflow-hidden rounded-2xl border-2 border-[#222]">
                <iframe
                  src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/intake-files/${prototypeFilePath}`}
                  className="h-[600px] w-full bg-white"
                  sandbox="allow-scripts allow-same-origin"
                  title="Prototyp"
                />
                <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-[#141414] to-transparent" />
              </div>

              <div className="mt-4 text-center">
                <button
                  onClick={() => setPrototypeFullscreen(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#333] bg-[#222] px-6 py-2.5 text-sm font-semibold text-[#e5e5e5] transition-colors hover:bg-[#2a2a2a]"
                >
                  <span className="text-base">⛶</span> Vollbild anzeigen
                </button>
              </div>
            </div>
          </div>

          {/* Fullscreen Modal */}
          {prototypeFullscreen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
              onClick={() => setPrototypeFullscreen(false)}
            >
              <button
                onClick={() => setPrototypeFullscreen(false)}
                className="absolute top-4 right-4 z-10 flex size-10 items-center justify-center rounded-full bg-[#222] text-lg text-white hover:bg-[#333]"
              >
                ✕
              </button>
              <iframe
                src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/intake-files/${prototypeFilePath}`}
                className="h-full w-full"
                sandbox="allow-scripts allow-same-origin"
                title="Prototyp — Vollbild"
              />
            </div>
          )}
        </>
      )}
```

Also add an effect to handle ESC key for the modal. Add after the state declarations:

```typescript
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setPrototypeFullscreen(false);
    }
    if (prototypeFullscreen) {
      document.addEventListener("keydown", handleEsc);
      return () => document.removeEventListener("keydown", handleEsc);
    }
  }, [prototypeFullscreen]);
```

Add `useEffect` to the React import at the top (currently only imports `useState`).

- [ ] **Step 3: Commit**

```bash
git add "src/app/proposal/[token]/page.tsx" "src/app/proposal/[token]/proposal-page-client.tsx"
git commit -m "feat: render prototype iframe on proposal page with fullscreen modal"
```

---

## Task 5: Build & Verify

- [ ] **Step 1: Run build**

```bash
cd /Users/yschleich/Developer/just-ship-board && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Manual verification**

1. Open an intake in the admin panel → verify prototype upload area appears in proposal panel
2. Upload an HTML file → verify it shows filename + preview link + delete button
3. Open the proposal page → verify prototype iframe renders between advantages and CTA
4. Click "Vollbild anzeigen" → verify fullscreen modal opens
5. Press ESC → verify modal closes
6. Delete prototype in admin → verify proposal page no longer shows prototype section
