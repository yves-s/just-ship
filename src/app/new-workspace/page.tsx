"use client";

import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Copy, Check, ArrowRight, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useSlugCheck } from "@/lib/hooks/use-slug-check";
import { createClient } from "@/lib/supabase/client";
import { createWorkspaceSchema, type CreateWorkspaceInput } from "@/lib/validations/workspace";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function NewWorkspacePage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<{ plaintext: string; slug: string } | null>(null);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateWorkspaceInput>({
    resolver: zodResolver(createWorkspaceSchema) as never,
  });

  const nameValue = watch("name") ?? "";
  const slugValue = watch("slug") ?? "";
  const { isChecking, isAvailable, suggestion } = useSlugCheck(slugValue);

  const handleApplySuggestion = useCallback(() => {
    if (suggestion) {
      setValue("slug", suggestion, { shouldValidate: true });
    }
  }, [suggestion, setValue]);

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const name = e.target.value;
    setValue("name", name);
    setValue("slug", slugify(name));
  }

  async function handleCopy() {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey.plaintext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function onSubmit(data: CreateWorkspaceInput) {
    setServerError(null);
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setServerError("Not authenticated. Please sign in again.");
      return;
    }

    const { data: workspace, error } = (await supabase
      .rpc("create_workspace", {
        ws_name: data.name,
        ws_slug: data.slug,
      })
      .single()) as { data: { id: string; slug: string } | null; error: { message: string } | null };

    if (error || !workspace) {
      setServerError(error?.message ?? "Workspace creation failed");
      return;
    }

    setCreatedSlug(workspace.slug);

    // Auto-create pipeline API key
    try {
      const res = await fetch(`/api/workspace/${workspace.id}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: "Pipeline" }),
      });

      if (res.ok) {
        const result = await res.json();
        setApiKey({ plaintext: result.data.plaintext, slug: workspace.slug });
        return; // Don't redirect yet — show the key first
      }

      const result = await res.json().catch(() => null);
      console.error("API key creation failed:", res.status, result);
      setServerError(
        result?.error?.message ?? `API key creation failed (${res.status}). You can create one later in Settings → API Keys.`
      );
    } catch (err) {
      console.error("API key creation error:", err);
      setServerError("API key creation failed. You can create one later in Settings → API Keys.");
    }
  }

  // Show API key after workspace creation
  if (apiKey) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Workspace created</CardTitle>
            <CardDescription>
              Your pipeline API key was auto-generated. Copy it now — it won&apos;t be shown again.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>API Key</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border bg-muted/50 px-3 py-2 text-xs font-mono break-all select-all">
                  {apiKey.plaintext}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={handleCopy}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use this key as <code className="text-[11px]">Authorization: Bearer {apiKey.plaintext.slice(0, 12)}…</code>
              </p>
            </div>
            <Button
              className="w-full"
              onClick={() => {
                router.push(`/${apiKey.slug}/board`);
                router.refresh();
              }}
            >
              Continue to board
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Create your workspace</CardTitle>
          <CardDescription>
            Give your workspace a name to get started.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            {serverError && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <p>{serverError}</p>
                {createdSlug && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 w-full"
                    onClick={() => {
                      router.push(`/${createdSlug}/board`);
                      router.refresh();
                    }}
                  >
                    Continue to board
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Workspace name</Label>
              <Input
                id="name"
                type="text"
                placeholder="Acme Inc."
                {...register("name")}
                onChange={handleNameChange}
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="slug">URL slug</Label>
              <div className="flex items-center rounded-md border bg-muted/30 px-3 text-sm">
                <span className="text-muted-foreground shrink-0">app.agentic-dev.xyz/</span>
                <Input
                  id="slug"
                  type="text"
                  placeholder="acme-inc"
                  className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                  {...register("slug")}
                />
                {slugValue.length >= 2 && (
                  <span className="shrink-0 ml-1">
                    {isChecking ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : isAvailable === true ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : isAvailable === false ? (
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    ) : null}
                  </span>
                )}
              </div>
              {errors.slug && (
                <p className="text-xs text-destructive">{errors.slug.message}</p>
              )}
              {isAvailable === false && suggestion && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-destructive">Slug already taken.</span>
                  <button
                    type="button"
                    className="text-primary underline underline-offset-2 hover:text-primary/80"
                    onClick={handleApplySuggestion}
                  >
                    Use &quot;{suggestion}&quot; instead?
                  </button>
                </div>
              )}
            </div>
            <Button
              type="submit"
              disabled={isSubmitting || !nameValue.trim() || isAvailable === false}
              className="w-full"
            >
              {isSubmitting ? "Creating…" : "Create workspace"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
