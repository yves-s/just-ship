"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GitBranch, CalendarDays, Copy, Check, Zap, Play, Loader2 } from "lucide-react";
import { formatTokenCount } from "@/lib/utils/format-tokens";
import { cn } from "@/lib/utils";
import { PriorityBadge } from "@/components/shared/status-badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useWorkspace } from "@/lib/workspace-context";
import type { Ticket } from "@/lib/types";

interface TicketCardProps {
  ticket: Ticket;
  onClick: (ticket: Ticket) => void;
  isDragOverlay?: boolean;
  agentActive?: boolean;
  agentActivity?: { agent_type: string; event_type: string } | null;
}

const PRIORITY_BORDER: Record<string, string> = {
  high: "border-l-red-400",
  medium: "border-l-amber-400",
  low: "border-l-slate-300",
};

const PIPELINE_PILL: Record<string, string> = {
  queued: "bg-slate-100 text-slate-600",
  running: "bg-amber-100 text-amber-700",
  done: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function TicketCard({
  ticket,
  onClick,
  isDragOverlay = false,
  agentActive = false,
  agentActivity = null,
}: TicketCardProps) {
  const [copiedNumber, setCopiedNumber] = useState(false);
  const [launching, setLaunching] = useState(false);

  const workspace = useWorkspace();
  const vpsConfigured = !!workspace.vps_url;
  const canLaunch =
    ticket.status === "ready_to_develop" && !ticket.pipeline_status;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: ticket.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const hasFooter = ticket.branch || ticket.pipeline_status || ticket.due_date || ticket.total_tokens > 0;

  async function handleLaunchPipeline(e: React.MouseEvent) {
    e.stopPropagation();
    if (launching || !canLaunch) return;
    setLaunching(true);
    try {
      const res = await fetch("/api/pipeline/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket_number: ticket.number,
          action: "launch",
          workspace_id: workspace.id,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        console.error("Launch failed:", (data as Record<string, unknown>).error);
      }
    } catch (err) {
      console.error("Launch error:", err);
    } finally {
      setLaunching(false);
    }
  }

  function handleCopyNumber(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(`T-${ticket.number}`).then(() => {
      setCopiedNumber(true);
      setTimeout(() => setCopiedNumber(false), 1500);
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={isDragOverlay ? undefined : style}
      {...(!isDragOverlay ? attributes : {})}
      {...(!isDragOverlay ? listeners : {})}
      onClick={() => onClick(ticket)}
      className={cn(
        "group rounded-lg border bg-white shadow-sm cursor-pointer select-none",
        "border-l-4 transition-shadow",
        PRIORITY_BORDER[ticket.priority] ?? "border-l-slate-300",
        isDragging && !isDragOverlay && "opacity-40",
        isDragOverlay && "shadow-lg rotate-1",
        "hover:shadow-md"
      )}
    >
      <div className="p-3 flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Tooltip open={copiedNumber ? true : undefined}>
              <TooltipTrigger asChild>
                <button
                  onClick={handleCopyNumber}
                  className="font-mono text-[10px] text-muted-foreground flex items-center gap-0.5 hover:text-foreground transition-colors"
                >
                  {copiedNumber ? (
                    <Check className="h-2.5 w-2.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                  )}
                  T-{ticket.number}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {copiedNumber ? "Kopiert!" : "Kopieren"}
              </TooltipContent>
            </Tooltip>
            {(agentActive || ticket.status === "in_progress") && (
              <span
                className="relative flex h-2 w-2"
                title={
                  agentActivity
                    ? `${agentActivity.agent_type}: ${agentActivity.event_type}`
                    : ticket.pipeline_status === "running"
                      ? "Pipeline läuft..."
                      : ticket.pipeline_status === "queued"
                        ? "Pipeline wird gestartet..."
                        : "In Bearbeitung"
                }
              >
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
            )}
            {canLaunch && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={vpsConfigured ? handleLaunchPipeline : (e: React.MouseEvent) => e.stopPropagation()}
                    disabled={!vpsConfigured || launching}
                    className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-400 text-emerald-600 cursor-pointer hover:bg-emerald-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {launching ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <Play className="h-2.5 w-2.5 fill-emerald-600" />
                    )}
                  </button>
                </TooltipTrigger>
                {!vpsConfigured && (
                  <TooltipContent side="top">
                    VPS nicht konfiguriert
                  </TooltipContent>
                )}
              </Tooltip>
            )}
          </div>
          <p className="text-sm font-medium leading-snug line-clamp-3">
            {ticket.title}
          </p>
        </div>

        {ticket.tags && ticket.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {ticket.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <PriorityBadge priority={ticket.priority} />
        </div>

        {hasFooter && (
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t">
            {ticket.branch && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <GitBranch className="h-3 w-3 shrink-0" />
                <span className="font-mono truncate max-w-[100px]">
                  {ticket.branch}
                </span>
              </div>
            )}
            {ticket.pipeline_status && (
              <span
                className={cn(
                  "inline-flex items-center rounded px-1.5 py-0 text-[10px] font-medium",
                  PIPELINE_PILL[ticket.pipeline_status] ??
                    "bg-slate-100 text-slate-600"
                )}
              >
                {ticket.pipeline_status}
              </span>
            )}
            {ticket.total_tokens > 0 && (
              <div className="flex items-center gap-1 text-[10px] text-amber-600">
                <Zap className="h-3 w-3 shrink-0" />
                <span>{formatTokenCount(ticket.total_tokens)}</span>
              </div>
            )}
            {ticket.due_date && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground ml-auto">
                <CalendarDays className="h-3 w-3 shrink-0" />
                {formatDate(ticket.due_date)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
