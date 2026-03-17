"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Project, Workspace } from "@/lib/types";

interface MoveProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  currentWorkspaceId: string;
  onMoved: () => void;
}

export function MoveProjectDialog({
  open,
  onOpenChange,
  project,
  currentWorkspaceId,
  onMoved,
}: MoveProjectDialogProps) {
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string>("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;

    async function fetchWorkspaces() {
      setLoading(true);
      setError(null);

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: memberships, error: fetchError } = await supabase
        .from("workspace_members")
        .select("workspace:workspaces(id, name, slug)")
        .eq("user_id", user?.id ?? "");

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      const rawWorkspaces = (memberships ?? [])
        .map((m) => m.workspace)
        .flat()
        .filter(
          (w): w is NonNullable<typeof w> =>
            w !== null && w.id !== currentWorkspaceId
        );

      const otherWorkspaces: Workspace[] = rawWorkspaces.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        created_by: null,
        created_at: "",
        updated_at: "",
        vps_url: null,
      }));

      setWorkspaces(otherWorkspaces);
      setLoading(false);
    }

    fetchWorkspaces();
  }, [open, currentWorkspaceId]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setTargetWorkspaceId("");
      setError(null);
      setConfirming(false);
    }
    onOpenChange(next);
  }

  function handleRequestConfirm() {
    if (!targetWorkspaceId) return;
    setError(null);
    setConfirming(true);
  }

  async function handleMove() {
    if (!targetWorkspaceId || isMoving) return;

    setIsMoving(true);
    setError(null);

    try {
      const res = await fetch(`/api/projects/${project.id}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_workspace_id: targetWorkspaceId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message ?? "Failed to move project.");
        setIsMoving(false);
        return;
      }

      onMoved();
      handleOpenChange(false);
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setIsMoving(false);
    }
  }

  const hasNoOtherWorkspaces = !loading && workspaces.length === 0;
  const targetWorkspace = workspaces.find((ws) => ws.id === targetWorkspaceId);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move project</DialogTitle>
          <DialogDescription>
            {confirming
              ? `Move project "${project.name}" to workspace "${targetWorkspace?.name}"?`
              : `Select the target workspace for project \u201c${project.name}\u201d.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {!confirming && (
            <>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading workspaces…</p>
              ) : hasNoOtherWorkspaces ? (
                <p className="text-sm text-muted-foreground">
                  You are not a member of any other workspace.
                </p>
              ) : (
                <Select
                  value={targetWorkspaceId}
                  onValueChange={setTargetWorkspaceId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a workspace" />
                  </SelectTrigger>
                  <SelectContent>
                    {workspaces.map((ws) => (
                      <SelectItem key={ws.id} value={ws.id}>
                        {ws.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </>
          )}

          {confirming && (
            <p className="text-sm text-muted-foreground">
              All tickets in this project will be moved as well. This action cannot be undone.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              if (confirming) {
                setConfirming(false);
                setError(null);
              } else {
                handleOpenChange(false);
              }
            }}
            disabled={isMoving}
          >
            {confirming ? "Back" : "Cancel"}
          </Button>
          <Button
            type="button"
            onClick={confirming ? handleMove : handleRequestConfirm}
            disabled={
              confirming
                ? isMoving
                : !targetWorkspaceId || hasNoOtherWorkspaces
            }
          >
            {confirming
              ? isMoving
                ? "Moving…"
                : "Confirm move"
              : "Move project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
