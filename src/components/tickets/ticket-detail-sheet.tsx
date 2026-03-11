"use client";

import { useState, useRef, useEffect } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import {
  CalendarDays,
  Tag,
  GitBranch,
  ExternalLink,
  Trash2,
  Share2,
  Check,
  Copy,
  Activity,
  Flag,
  CircleDot,
  FolderOpen,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { TICKET_STATUSES, TICKET_PRIORITIES } from "@/lib/constants";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { StatusBadge, PriorityBadge } from "@/components/shared/status-badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";
import { MarkdownRenderer } from "@/components/shared/markdown-renderer";
import type { Ticket, Project } from "@/lib/types";

interface TicketDetailSheetProps {
  ticket: Ticket | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (ticket: Ticket) => void;
  onDeleted: (id: string) => void;
}

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

function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function PropertyRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center min-h-[34px] rounded-md hover:bg-muted/40 transition-colors -mx-2 px-2">
      <div className="flex items-center gap-2 w-40 shrink-0 py-1">
        <span className="text-muted-foreground/60">{icon}</span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="flex-1 py-1">{children}</div>
    </div>
  );
}

export function TicketDetailSheet({
  ticket,
  open,
  onOpenChange,
  onUpdated,
  onDeleted,
}: TicketDetailSheetProps) {
  const workspace = useWorkspace();
  const [current, setCurrent] = useState<Ticket | null>(ticket);
  const currentRef = useRef<Ticket | null>(ticket);
  currentRef.current = current;
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedNumber, setCopiedNumber] = useState(false);
  const [editingBody, setEditingBody] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setCurrent(ticket);
    setConfirmDelete(false);
    setSaveError(null);
    setEditingBody(false);
  }, [ticket]);

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    supabase
      .from("projects")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("name")
      .then(({ data }) => setProjects(data ?? []));
  }, [open, workspace.id]);

  useEffect(() => {
    autoResize(titleRef.current);
    autoResize(bodyRef.current);
  }, [current?.id]);

  useEffect(() => {
    if (editingBody && bodyRef.current) {
      autoResize(bodyRef.current);
      bodyRef.current.focus();
      // Move cursor to end
      const len = bodyRef.current.value.length;
      bodyRef.current.setSelectionRange(len, len);
    }
  }, [editingBody]);

  async function saveField(field: string, value: unknown) {
    if (!current) return;
    setSaving(field);
    setSaveError(null);
    const supabase = createClient();
    const { data: updated, error } = await supabase
      .from("tickets")
      .update({ [field]: value })
      .eq("id", current.id)
      .select()
      .single();
    setSaving(null);
    if (error) {
      setSaveError(error.message);
      return;
    }
    const updatedTicket = { ...updated, project: currentRef.current?.project ?? null } as Ticket;
    setCurrent(updatedTicket);
    onUpdated(updatedTicket);
  }

  function handleTitleBlur(e: React.FocusEvent<HTMLTextAreaElement>) {
    const newTitle = e.target.value.trim();
    if (newTitle && newTitle !== current?.title) {
      saveField("title", newTitle);
    }
  }

  function handleBodyBlur(e: React.FocusEvent<HTMLTextAreaElement>) {
    const newBody = e.target.value || null;
    if (newBody !== (current?.body ?? null)) {
      saveField("body", newBody);
    }
    setEditingBody(false);
  }

  async function handleDelete() {
    if (!current) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("tickets")
      .delete()
      .eq("id", current.id);
    setDeleting(false);
    if (error) {
      setSaveError(error.message);
      setConfirmDelete(false);
      return;
    }
    onDeleted(current.id);
    onOpenChange(false);
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      setConfirmDelete(false);
      setSaveError(null);
    }
    onOpenChange(isOpen);
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleCopyNumber() {
    navigator.clipboard.writeText(`T-${current?.number}`).then(() => {
      setCopiedNumber(true);
      setTimeout(() => setCopiedNumber(false), 1500);
    });
  }

  if (!current) return null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col p-0 gap-0 overflow-hidden"
      >
        <SheetTitle className="sr-only">{current.title}</SheetTitle>

        {/* Header strip — T-number aligned with X close button */}
        <div className="flex items-center px-8 h-12 shrink-0 pr-14">
          <Tooltip open={copiedNumber ? true : undefined}>
            <TooltipTrigger asChild>
              <button
                onClick={handleCopyNumber}
                className="font-mono text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors group"
              >
                T-{current.number}
                {copiedNumber ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {copiedNumber ? "Kopiert!" : "Kopieren"}
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          {/* Title */}
          <div className="px-8 pb-3">
            <textarea
              ref={titleRef}
              key={current.id}
              defaultValue={current.title}
              onInput={(e) => autoResize(e.currentTarget)}
              onBlur={handleTitleBlur}
              placeholder="Untitled"
              rows={1}
              className="w-full resize-none bg-transparent text-2xl font-bold text-foreground placeholder:text-muted-foreground/40 outline-none overflow-hidden leading-snug"
            />
          </div>

          {/* Properties */}
          <div className="px-8 py-1">
            <PropertyRow
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              label="Project"
            >
              <SelectPrimitive.Root
                value={current.project_id ?? "__none__"}
                onValueChange={(val) => {
                  const newProjectId = val === "__none__" ? null : val;
                  const newProject = projects.find((p) => p.id === newProjectId) ?? null;
                  setCurrent((c) =>
                    c ? { ...c, project_id: newProjectId, project: newProject } : c
                  );
                  saveField("project_id", newProjectId);
                }}
              >
                <SelectPrimitive.Trigger className="outline-none flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted/60 focus:bg-muted/60 transition-colors text-sm">
                  <SelectPrimitive.Value>
                    {current.project ? (
                      <span className="text-foreground">{current.project.name}</span>
                    ) : (
                      <span className="text-muted-foreground/50">No project</span>
                    )}
                  </SelectPrimitive.Value>
                </SelectPrimitive.Trigger>
                <SelectPrimitive.Portal>
                  <SelectPrimitive.Content
                    position="popper"
                    sideOffset={4}
                    className="bg-popover border rounded-lg shadow-lg p-1 z-[100] min-w-[200px]"
                  >
                    <SelectPrimitive.Viewport>
                      <SelectPrimitive.Item
                        value="__none__"
                        className="flex items-center px-2 py-1.5 rounded-md cursor-default outline-none focus:bg-accent select-none text-sm text-muted-foreground"
                      >
                        <SelectPrimitive.ItemText>No project</SelectPrimitive.ItemText>
                      </SelectPrimitive.Item>
                      {projects.map((p) => (
                        <SelectPrimitive.Item
                          key={p.id}
                          value={p.id}
                          className="flex items-center px-2 py-1.5 rounded-md cursor-default outline-none focus:bg-accent select-none text-sm"
                        >
                          <SelectPrimitive.ItemText>{p.name}</SelectPrimitive.ItemText>
                        </SelectPrimitive.Item>
                      ))}
                    </SelectPrimitive.Viewport>
                  </SelectPrimitive.Content>
                </SelectPrimitive.Portal>
              </SelectPrimitive.Root>
            </PropertyRow>

            <PropertyRow
              icon={<CircleDot className="h-3.5 w-3.5" />}
              label="Status"
            >
              <SelectPrimitive.Root
                value={current.status}
                onValueChange={(val) => {
                  setCurrent((c) =>
                    c ? { ...c, status: val as Ticket["status"] } : c
                  );
                  saveField("status", val);
                }}
              >
                <SelectPrimitive.Trigger className="outline-none flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted/60 focus:bg-muted/60 transition-colors">
                  <StatusBadge status={current.status} />
                </SelectPrimitive.Trigger>
                <SelectPrimitive.Portal>
                  <SelectPrimitive.Content
                    position="popper"
                    sideOffset={4}
                    className="bg-popover border rounded-lg shadow-lg p-1 z-[100] min-w-[160px]"
                  >
                    <SelectPrimitive.Viewport>
                      {TICKET_STATUSES.map((s) => (
                        <SelectPrimitive.Item
                          key={s}
                          value={s}
                          className="flex items-center px-2 py-1.5 rounded-md cursor-default outline-none focus:bg-accent select-none"
                        >
                          <SelectPrimitive.ItemText>
                            <StatusBadge status={s} />
                          </SelectPrimitive.ItemText>
                        </SelectPrimitive.Item>
                      ))}
                    </SelectPrimitive.Viewport>
                  </SelectPrimitive.Content>
                </SelectPrimitive.Portal>
              </SelectPrimitive.Root>
            </PropertyRow>

            <PropertyRow
              icon={<Flag className="h-3.5 w-3.5" />}
              label="Priority"
            >
              <SelectPrimitive.Root
                value={current.priority}
                onValueChange={(val) => {
                  setCurrent((c) =>
                    c ? { ...c, priority: val as Ticket["priority"] } : c
                  );
                  saveField("priority", val);
                }}
              >
                <SelectPrimitive.Trigger className="outline-none flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted/60 focus:bg-muted/60 transition-colors">
                  <PriorityBadge priority={current.priority} />
                </SelectPrimitive.Trigger>
                <SelectPrimitive.Portal>
                  <SelectPrimitive.Content
                    position="popper"
                    sideOffset={4}
                    className="bg-popover border rounded-lg shadow-lg p-1 z-[100] min-w-[120px]"
                  >
                    <SelectPrimitive.Viewport>
                      {TICKET_PRIORITIES.map((p) => (
                        <SelectPrimitive.Item
                          key={p}
                          value={p}
                          className="flex items-center px-2 py-1.5 rounded-md cursor-default outline-none focus:bg-accent select-none"
                        >
                          <SelectPrimitive.ItemText>
                            <PriorityBadge priority={p} />
                          </SelectPrimitive.ItemText>
                        </SelectPrimitive.Item>
                      ))}
                    </SelectPrimitive.Viewport>
                  </SelectPrimitive.Content>
                </SelectPrimitive.Portal>
              </SelectPrimitive.Root>
            </PropertyRow>

            <PropertyRow
              icon={<CalendarDays className="h-3.5 w-3.5" />}
              label="Due date"
            >
              <input
                type="date"
                key={current.id + "-date"}
                defaultValue={current.due_date ?? ""}
                onBlur={(e) => {
                  const val = e.target.value || null;
                  if (val !== (current.due_date ?? null)) {
                    saveField("due_date", val);
                  }
                }}
                className="bg-transparent text-sm text-foreground outline-none rounded px-1 py-0.5 hover:bg-muted/60 focus:bg-muted/60 cursor-pointer transition-colors"
              />
            </PropertyRow>

            {current.pipeline_status && (
              <PropertyRow
                icon={<Activity className="h-3.5 w-3.5" />}
                label="Pipeline"
              >
                <span
                  className={cn(
                    "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                    PIPELINE_STATUS_COLORS[current.pipeline_status] ??
                      "bg-slate-100 text-slate-600"
                  )}
                >
                  {PIPELINE_STATUS_LABELS[current.pipeline_status] ??
                    current.pipeline_status}
                </span>
              </PropertyRow>
            )}

            {current.branch && (
              <PropertyRow
                icon={<GitBranch className="h-3.5 w-3.5" />}
                label="Branch"
              >
                <code className="font-mono text-xs text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                  {current.branch}
                </code>
              </PropertyRow>
            )}

            {current.preview_url && (
              <PropertyRow
                icon={<ExternalLink className="h-3.5 w-3.5" />}
                label="Preview"
              >
                <a
                  href={current.preview_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline truncate max-w-[300px] inline-block"
                >
                  {current.preview_url}
                </a>
              </PropertyRow>
            )}

            {current.tags && current.tags.length > 0 && (
              <PropertyRow
                icon={<Tag className="h-3.5 w-3.5" />}
                label="Tags"
              >
                <div className="flex flex-wrap gap-1">
                  {current.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </PropertyRow>
            )}
          </div>

          {/* Divider */}
          <div className="h-px bg-border mx-6 my-3" />

          {/* Description */}
          <div className="px-8 pb-4">
            {editingBody ? (
              <textarea
                ref={bodyRef}
                key={current.id + "-body"}
                defaultValue={current.body ?? ""}
                onInput={(e) => autoResize(e.currentTarget)}
                onBlur={handleBodyBlur}
                placeholder="Add a description…"
                rows={4}
                className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none overflow-hidden leading-relaxed"
              />
            ) : current.body ? (
              <div
                onClick={() => setEditingBody(true)}
                className="cursor-text rounded-md hover:bg-muted/30 transition-colors -mx-2 px-2 py-1"
              >
                <MarkdownRenderer content={current.body} />
              </div>
            ) : (
              <div
                onClick={() => setEditingBody(true)}
                className="cursor-text text-sm text-muted-foreground/40 rounded-md hover:bg-muted/30 transition-colors -mx-2 px-2 py-1"
              >
                Add a description…
              </div>
            )}
          </div>

          {current.summary && (
            <>
              <div className="h-px bg-border mx-6 my-2" />
              <div className="px-8 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">
                  Summary
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {current.summary}
                </p>
              </div>
            </>
          )}

          {current.test_results && (
            <>
              <div className="h-px bg-border mx-6 my-2" />
              <div className="px-8 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">
                  Test results
                </div>
                <pre className="rounded-md bg-muted px-3 py-2 text-xs font-mono overflow-auto whitespace-pre-wrap">
                  {current.test_results}
                </pre>
              </div>
            </>
          )}

          <div className="h-6" />
        </div>

        {/* Bottom action bar */}
        <div className="flex items-center gap-3 px-6 py-3 border-t shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyLink}
            className="gap-2"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-500" />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
            {copied ? "Copied!" : "Copy link"}
          </Button>

          <div className="flex-1" />

          {saving && (
            <span className="text-xs text-muted-foreground animate-pulse">
              Saving…
            </span>
          )}

          {saveError && (
            <span className="text-xs text-destructive">{saveError}</span>
          )}

          <Button
            type="button"
            variant={confirmDelete ? "destructive" : "outline"}
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
            {confirmDelete ? "Confirm delete" : "Delete"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
