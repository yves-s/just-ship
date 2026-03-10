"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink, GitBranch, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  updateTicketSchema,
  type UpdateTicketInput,
} from "@/lib/validations/ticket";
import { TICKET_STATUSES, TICKET_PRIORITIES } from "@/lib/constants";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge, PriorityBadge } from "@/components/shared/status-badge";
import type { Ticket } from "@/lib/types";

interface TicketDetailSheetProps {
  ticket: Ticket | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (ticket: Ticket) => void;
  onDeleted: (id: string) => void;
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

const PIPELINE_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
};

const PIPELINE_STATUS_COLORS: Record<string, string> = {
  queued: "bg-slate-100 text-slate-600",
  running: "bg-amber-100 text-amber-700",
  done: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

export function TicketDetailSheet({
  ticket,
  open,
  onOpenChange,
  onUpdated,
  onDeleted,
}: TicketDetailSheetProps) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { register, handleSubmit, setValue, watch, reset } =
    useForm<UpdateTicketInput>({
      resolver: zodResolver(updateTicketSchema) as never,
      values: ticket
        ? {
            title: ticket.title,
            body: ticket.body ?? undefined,
            status: ticket.status,
            priority: ticket.priority,
            due_date: ticket.due_date ?? undefined,
          }
        : undefined,
    });

  async function onSubmit(data: UpdateTicketInput) {
    if (!ticket) return;
    setSaving(true);
    setSaveError(null);

    const supabase = createClient();
    const { data: updated, error } = await supabase
      .from("tickets")
      .update(data)
      .eq("id", ticket.id)
      .select()
      .single();

    setSaving(false);

    if (error) {
      setSaveError(error.message);
      return;
    }

    onUpdated(updated as Ticket);
  }

  async function handleDelete() {
    if (!ticket) return;

    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("tickets")
      .delete()
      .eq("id", ticket.id);

    setDeleting(false);

    if (error) {
      setSaveError(error.message);
      setConfirmDelete(false);
      return;
    }

    onDeleted(ticket.id);
    onOpenChange(false);
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setConfirmDelete(false);
      setSaveError(null);
      reset();
    }
    onOpenChange(open);
  }

  if (!ticket) return null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto"
      >
        <SheetHeader className="pb-0">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs text-muted-foreground">
                T-{ticket.number}
              </span>
              <SheetTitle className="text-base leading-snug">
                {ticket.title}
              </SheetTitle>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            {ticket.pipeline_status && (
              <span
                className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                  PIPELINE_STATUS_COLORS[ticket.pipeline_status] ??
                  "bg-slate-100 text-slate-600"
                }`}
              >
                Pipeline:{" "}
                {PIPELINE_STATUS_LABELS[ticket.pipeline_status] ??
                  ticket.pipeline_status}
              </span>
            )}
          </div>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5 px-6 pb-6">
          {saveError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {saveError}
            </p>
          )}

          {/* Branch / Preview URL */}
          {(ticket.branch || ticket.preview_url) && (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
              {ticket.branch && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <GitBranch className="h-3.5 w-3.5 shrink-0" />
                  <code className="font-mono">{ticket.branch}</code>
                </div>
              )}
              {ticket.preview_url && (
                <a
                  href={ticket.preview_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  {ticket.preview_url}
                </a>
              )}
            </div>
          )}

          {/* Edit fields */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sheet-title">Title</Label>
            <Input id="sheet-title" {...register("title")} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sheet-body">Description</Label>
            <Textarea
              id="sheet-body"
              rows={5}
              placeholder="Add a description…"
              {...register("body")}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Status</Label>
              <Select
                value={watch("status")}
                onValueChange={(val) =>
                  setValue("status", val as UpdateTicketInput["status"])
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
                value={watch("priority")}
                onValueChange={(val) =>
                  setValue("priority", val as UpdateTicketInput["priority"])
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sheet-due">Due date</Label>
            <Input
              id="sheet-due"
              type="date"
              {...register("due_date")}
            />
          </div>

          {/* Summary */}
          {ticket.summary && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Summary
              </Label>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {ticket.summary}
              </p>
            </div>
          )}

          {/* Test results */}
          {ticket.test_results && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Test results
              </Label>
              <pre className="rounded-md bg-muted px-3 py-2 text-xs font-mono overflow-auto whitespace-pre-wrap">
                {ticket.test_results}
              </pre>
            </div>
          )}

          {/* Tags */}
          {ticket.tags && ticket.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {ticket.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button
              type="button"
              variant={confirmDelete ? "destructive" : "ghost"}
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
              className="gap-1.5 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmDelete ? "Confirm delete" : "Delete ticket"}
            </Button>

            <Button type="submit" disabled={saving} size="sm">
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
