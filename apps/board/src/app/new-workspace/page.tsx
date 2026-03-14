"use client";

import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, AlertCircle, Loader2, LogOut } from "lucide-react";
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
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

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

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
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
    router.push(`/${workspace.slug}/board`);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4">
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
                <span className="text-muted-foreground shrink-0">board.just-ship.io/</span>
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
      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <LogOut className="h-3 w-3" />
        {signingOut ? "Signing out…" : "Sign in with a different account"}
      </button>
    </div>
  );
}
