"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import {
  createTicketSchema,
  type CreateTicketInput,
} from "@/lib/validations/ticket";
import { TICKET_STATUSES, TICKET_PRIORITIES } from "@/lib/constants";
import type { TicketStatus } from "@/lib/constants";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Ticket, Project } from "@/lib/types";

interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onCreated: (ticket: Ticket) => void;
  projects?: Project[];
  defaultProjectId?: string | null;
  defaultStatus?: TicketStatus;
}

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  ready_to_develop: "Ready",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  cancelled: "Cancelled",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export function CreateTicketDialog({
  open,
  onOpenChange,
  workspaceId,
  onCreated,
  projects = [],
  defaultProjectId,
  defaultStatus,
}: CreateTicketDialogProps) {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateTicketInput>({
    resolver: zodResolver(createTicketSchema) as never,
    defaultValues: {
      status: "backlog",
      priority: "medium",
      tags: [],
      project_id: null,
    },
  });

  // Apply dynamic defaults when dialog opens
  useEffect(() => {
    if (open) {
      if (defaultStatus) {
        setValue("status", defaultStatus);
      }
      if (defaultProjectId !== undefined) {
        setValue("project_id", defaultProjectId ?? null);
      }
    }
  }, [open, defaultStatus, defaultProjectId, setValue]);

  const watchedStatus = watch("status") ?? defaultStatus ?? "backlog";
  const watchedProjectId = watch("project_id");

  async function onSubmit(data: CreateTicketInput) {
    setServerError(null);
    const supabase = createClient();

    const { data: ticket, error } = await supabase
      .from("tickets")
      .insert({
        ...data,
        workspace_id: workspaceId,
        tags: data.tags ?? [],
        assigned_agents: [],
      })
      .select("*, project:projects(id, name, description, workspace_id, created_at, updated_at)")
      .single();

    if (error) {
      setServerError(error.message);
      return;
    }

    reset();
    onCreated(ticket as Ticket);
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      reset();
      setServerError(null);
    }
    onOpenChange(open);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New ticket</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {serverError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title"
              placeholder="Short description of the ticket"
              {...register("title")}
            />
            {errors.title && (
              <p className="text-xs text-destructive">{errors.title.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="body">Description</Label>
            <Textarea
              id="body"
              placeholder="More details about this ticket…"
              rows={4}
              {...register("body")}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Status</Label>
              <Select
                value={watchedStatus}
                onValueChange={(val) =>
                  setValue("status", val as CreateTicketInput["status"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Priority</Label>
              <Select
                defaultValue="medium"
                onValueChange={(val) =>
                  setValue("priority", val as CreateTicketInput["priority"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {projects.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>Project</Label>
              <Select
                value={watchedProjectId ?? "none"}
                onValueChange={(val) =>
                  setValue("project_id", val === "none" ? null : val)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="due_date">Due date</Label>
            <Input id="due_date" type="date" {...register("due_date")} />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
