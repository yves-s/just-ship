"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import {
  updateWorkspaceSchema,
  type UpdateWorkspaceInput,
} from "@/lib/validations/workspace";
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
import { DeleteWorkspaceDialog } from "./delete-workspace-dialog";
import type { Workspace } from "@/lib/types";

interface SettingsGeneralProps {
  workspace: Workspace;
}

export function SettingsGeneral({ workspace }: SettingsGeneralProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateWorkspaceInput>({
    resolver: zodResolver(updateWorkspaceSchema),
    defaultValues: { name: workspace.name },
  });

  async function onSubmit(data: UpdateWorkspaceInput) {
    setServerError(null);
    setSuccess(false);
    const supabase = createClient();

    const { error } = await supabase
      .from("workspaces")
      .update({ name: data.name })
      .eq("id", workspace.id);

    if (error) {
      setServerError(error.message);
      return;
    }

    setSuccess(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Workspace name</CardTitle>
          <CardDescription>
            This is the display name of your workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 max-w-sm">
            {serverError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {serverError}
              </p>
            )}
            {success && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                Workspace name updated.
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" {...register("name")} />
              {errors.name && (
                <p className="text-xs text-destructive">
                  {errors.name.message}
                </p>
              )}
            </div>
            <Button
              type="submit"
              disabled={isSubmitting || !isDirty}
              className="self-start"
            >
              {isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace slug</CardTitle>
          <CardDescription>
            Your workspace URL slug. This cannot be changed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center rounded-md border bg-muted/30 px-3 py-2 text-sm max-w-sm">
            <span className="text-muted-foreground shrink-0 mr-0.5">
              board.app/
            </span>
            <span className="font-mono">{workspace.slug}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Permanently delete this workspace and all its data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 max-w-sm">
            <p className="text-sm text-muted-foreground">
              Deleting a workspace removes all projects, tickets, API keys, and
              members. This cannot be undone.
            </p>
            <Button
              variant="destructive"
              className="self-start"
              onClick={() => setDeleteOpen(true)}
            >
              Delete workspace
            </Button>
          </div>
        </CardContent>
      </Card>

      <DeleteWorkspaceDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        workspace={workspace}
      />
    </div>
  );
}
