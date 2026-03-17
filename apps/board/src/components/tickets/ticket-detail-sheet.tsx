"use client";

import { useState, useRef, useEffect, useMemo } from "react";
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
  FileText,
  Play,
  CheckCircle2,
  XCircle,
  Zap,
  Wrench,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { TICKET_STATUSES, TICKET_PRIORITIES } from "@/lib/constants";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { StatusBadge, PriorityBadge } from "@/components/shared/status-badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatTokenCount } from "@/lib/utils/format-tokens";
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

function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std.`;
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function EventIcon({ eventType }: { eventType: string }) {
  switch (eventType) {
    case "agent_started":
      return <Play className="h-3.5 w-3.5 mt-0.5 text-blue-500 shrink-0" />;
    case "agent_completed":
      return <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-500 shrink-0" />;
    case "agent_spawned":
      return <Zap className="h-3.5 w-3.5 mt-0.5 text-violet-500 shrink-0" />;
    case "tool_use":
      return <Wrench className="h-3.5 w-3.5 mt-0.5 text-amber-500 shrink-0" />;
    case "log":
      return <FileText className="h-3.5 w-3.5 mt-0.5 text-slate-400 shrink-0" />;
    default:
      return <XCircle className="h-3.5 w-3.5 mt-0.5 text-red-500 shrink-0" />;
  }
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
  const [launching, setLaunching] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const canLaunch =
    current?.status === "ready_to_develop" && !current?.pipeline_status;
  const canShip = current?.status === "in_review";

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

  const [events, setEvents] = useState<{ id: string; event_type: string; message: string; agent_type: string; created_at: string; tokens_used: number }[]>([]);
  const [logsCollapsed, setLogsCollapsed] = useState(true);

  const tokensByAgent = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of events) {
      if (event.tokens_used > 0) {
        map.set(event.agent_type, (map.get(event.agent_type) ?? 0) + event.tokens_used);
      }
    }
    return map;
  }, [events]);

  useEffect(() => {
    if (!open || !current) return;
    const supabase = createClient();

    // Load existing events
    supabase
      .from("task_events")
      .select("*")
      .eq("ticket_id", current.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) {
          setEvents(data.map((e: Record<string, unknown>) => ({
            id: e.id as string,
            event_type: e.event_type as string,
            message: ((e.metadata as Record<string, unknown>)?.message as string) ?? "",
            agent_type: e.agent_type as string,
            created_at: e.created_at as string,
            tokens_used: typeof (e.metadata as Record<string, unknown>)?.tokens_used === 'number'
              ? ((e.metadata as Record<string, unknown>).tokens_used as number)
              : 0,
          })));
        }
      });

    // Subscribe to new events for this ticket
    const channel = supabase
      .channel(`task-events-${current.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "task_events",
          filter: `ticket_id=eq.${current.id}`,
        },
        (payload) => {
          const event = payload.new as Record<string, unknown>;
          setEvents((prev) => [
            ...prev,
            {
              id: event.id as string,
              event_type: event.event_type as string,
              message: ((event.metadata as Record<string, unknown>)?.message as string) ?? "",
              agent_type: event.agent_type as string,
              created_at: event.created_at as string,
              tokens_used: typeof (event.metadata as Record<string, unknown>)?.tokens_used === 'number'
                ? ((event.metadata as Record<string, unknown>).tokens_used as number)
                : 0,
            },
          ]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, current?.id]);

  useEffect(() => {
    autoResize(bodyRef.current);
  }, [current?.id, open]);

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

  async function handleLaunchPipeline() {
    if (!current || launching) return;
    setLaunching(true);
    setActionError(null);
    try {
      const res = await fetch("/api/pipeline/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket_number: current.number,
          action: "launch",
          workspace_id: workspace.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(
          (((data as Record<string, unknown>).error as Record<string, unknown>)
            ?.message as string) ?? "Pipeline start failed"
        );
      } else {
        setActionError(null);
      }
    } catch {
      setActionError("Could not reach pipeline server");
    } finally {
      setLaunching(false);
    }
  }

  async function handleShip() {
    if (!current || shipping) return;
    setShipping(true);
    setActionError(null);
    try {
      const res = await fetch("/api/pipeline/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket_number: current.number,
          action: "ship",
          workspace_id: workspace.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(
          (((data as Record<string, unknown>).error as Record<string, unknown>)
            ?.message as string) ?? "Ship failed"
        );
      } else {
        setActionError(null);
      }
    } catch {
      setActionError("Could not reach pipeline server");
    } finally {
      setShipping(false);
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      setConfirmDelete(false);
      setSaveError(null);
      setActionError(null);
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

        {/* Header strip — T-number + action buttons aligned with X close button */}
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

          <div className="flex items-center gap-2 ml-auto">
            {actionError && (
              <span className="text-xs text-destructive max-w-[200px] truncate">{actionError}</span>
            )}
            {canLaunch && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleLaunchPipeline}
                    disabled={launching}
                    className="flex items-center gap-1.5 rounded-md border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 transition-colors disabled:opacity-50"
                  >
                    {launching ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3 fill-emerald-700" />
                    )}
                    {launching ? "Starting…" : "Develop"}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Pipeline für dieses Ticket starten</TooltipContent>
              </Tooltip>
            )}
            {canShip && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleShip}
                    disabled={shipping}
                    className="flex items-center gap-1.5 rounded-md bg-foreground text-background px-2.5 py-1 text-xs font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50"
                  >
                    {shipping ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <svg viewBox="0 0 256 256" className="h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg">
                        <path d="M 28.54 75.12 L 31.35 71.16 L 35.22 67.82 L 40.10 65.13 L 45.94 63.14 L 52.69 61.86 L 60.25 61.30 L 68.57 61.48 L 77.53 62.38 L 87.04 64.00 L 97.01 66.32 L 107.31 69.32 L 117.84 72.96 L 128.48 77.21 L 139.12 82.01 L 149.63 87.31 L 159.91 93.06 L 169.84 99.20 L 179.31 105.65 L 188.22 112.34 L 196.46 119.21 L 203.96 126.17 L 210.63 133.15 L 216.39 140.07 L 221.18 146.87 L 224.95 153.45 L 227.66 159.76 L 229.27 165.72 L 229.78 171.27 L 229.17 176.34 L 227.46 180.88" fill="none" stroke="currentColor" strokeWidth="14.08" strokeLinecap="round"/>
                        <circle cx="128" cy="128" r="28.16" fill="currentColor"/>
                        <path d="M 227.46 180.88 L 224.65 184.84 L 220.78 188.18 L 215.90 190.87 L 210.06 192.86 L 203.31 194.14 L 195.75 194.70 L 187.43 194.52 L 178.47 193.62 L 168.96 192.00 L 158.99 189.68 L 148.69 186.68 L 138.16 183.04 L 127.52 178.79 L 116.88 173.99 L 106.37 168.69 L 96.09 162.94 L 86.16 156.80 L 76.69 150.35 L 67.78 143.66 L 59.54 136.79 L 52.04 129.83 L 45.37 122.85 L 39.61 115.93 L 34.82 109.13 L 31.05 102.55 L 28.34 96.24 L 26.73 90.28 L 26.22 84.73 L 26.83 79.66 L 28.54 75.12" fill="none" stroke="currentColor" strokeWidth="14.08" strokeLinecap="round"/>
                        <circle cx="37.91" cy="113.64" r="16.64" fill="currentColor"/>
                      </svg>
                    )}
                    {shipping ? "Shipping…" : "Just Ship"}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">PR mergen & Ticket abschließen</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          {/* Title */}
          <div className="px-8 pb-3">
            <textarea
              key={current.id}
              defaultValue={current.title}
              onBlur={handleTitleBlur}
              placeholder="Untitled"
              rows={1}
              className="w-full resize-none bg-transparent text-2xl font-bold text-foreground placeholder:text-muted-foreground/40 outline-none overflow-hidden leading-snug [field-sizing:content]"
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
          <div className="px-8 pb-4 flex-1">
            {editingBody ? (
              <textarea
                ref={bodyRef}
                key={current.id + "-body"}
                defaultValue={current.body ?? ""}
                onInput={(e) => autoResize(e.currentTarget)}
                onBlur={handleBodyBlur}
                placeholder="Add a description…"
                rows={8}
                className="w-full min-h-[240px] resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none overflow-hidden leading-relaxed"
              />
            ) : current.body ? (
              <div
                onClick={() => setEditingBody(true)}
                className="cursor-text rounded-md hover:bg-muted/30 transition-colors -mx-2 px-2 py-1 min-h-[240px]"
              >
                <MarkdownRenderer content={current.body} />
              </div>
            ) : (
              <div
                onClick={() => setEditingBody(true)}
                className="cursor-text text-sm text-muted-foreground/40 rounded-md hover:bg-muted/30 transition-colors -mx-2 px-2 py-1 min-h-[240px]"
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

          {(current.total_tokens > 0 || tokensByAgent.size > 0) && (
            <>
              <div className="h-px bg-border mx-6 my-2" />
              <div className="px-8 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">
                  Token Usage
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <span className="text-lg font-semibold text-foreground">
                    {formatTokenCount(current.total_tokens)}
                  </span>
                  <span className="text-sm text-muted-foreground">tokens gesamt</span>
                </div>
                {tokensByAgent.size > 0 && (
                  <div className="space-y-1.5">
                    {Array.from(tokensByAgent.entries())
                      .sort(([, a], [, b]) => b - a)
                      .map(([agentType, tokens]) => (
                        <div key={agentType} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-24 shrink-0">
                            {agentType}
                          </span>
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-400 rounded-full"
                              style={{
                                width: `${Math.round((tokens / current.total_tokens) * 100)}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs font-mono text-muted-foreground w-16 text-right shrink-0">
                            {formatTokenCount(tokens)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Activity / Event Timeline */}
          <>
            <div className="h-px bg-border mx-6 my-2" />
            <div className="px-8 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">
                Agent Logs
              </div>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground/40">Keine Agent-Logs vorhanden</p>
              ) : (
                <>
                  {(() => {
                    const LOGS_LIMIT = 10;
                    const visibleEvents = logsCollapsed && events.length > LOGS_LIMIT ? events.slice(-LOGS_LIMIT) : events;
                    return (
                      <>
                        <div className="space-y-2">
                          {visibleEvents.map((event) => (
                            <div
                              key={event.id}
                              className="flex items-start gap-2.5 text-sm"
                            >
                              <EventIcon eventType={event.event_type} />
                              <div className="flex-1 min-w-0">
                                <p className="font-mono text-xs text-foreground">
                                  {event.message || (
                                    <span className="text-muted-foreground">
                                      {event.agent_type} — {event.event_type.replace(/_/g, " ")}
                                    </span>
                                  )}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span
                                    className="text-[10px] text-muted-foreground/60 cursor-default"
                                    title={new Date(event.created_at).toLocaleString("de-DE", {
                                      day: "2-digit",
                                      month: "2-digit",
                                      year: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  >
                                    {formatRelativeTime(event.created_at)}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground/40">{event.agent_type}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        {events.length > LOGS_LIMIT && (
                          <button
                            onClick={() => setLogsCollapsed(!logsCollapsed)}
                            className="mt-2 text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
                          >
                            {logsCollapsed ? `${events.length - LOGS_LIMIT} ältere Einträge anzeigen` : "Weniger anzeigen"}
                          </button>
                        )}
                      </>
                    );
                  })()}
                </>
              )}
            </div>
          </>

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
