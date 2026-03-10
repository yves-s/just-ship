"use client";

import { cn } from "@/lib/utils";
import type { TicketStatus, TicketPriority } from "@/lib/constants";

const STATUS_CONFIG: Record<
  TicketStatus,
  { label: string; className: string }
> = {
  backlog: {
    label: "Backlog",
    className: "bg-slate-100 text-slate-700 border-slate-200",
  },
  ready_to_develop: {
    label: "Ready",
    className: "bg-sky-50 text-sky-700 border-sky-200",
  },
  in_progress: {
    label: "In Progress",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  in_review: {
    label: "In Review",
    className: "bg-violet-50 text-violet-700 border-violet-200",
  },
  done: {
    label: "Done",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-red-50 text-red-600 border-red-200",
  },
};

const PRIORITY_CONFIG: Record<
  TicketPriority,
  { label: string; dotClass: string; textClass: string }
> = {
  high: {
    label: "High",
    dotClass: "bg-red-500",
    textClass: "text-red-600",
  },
  medium: {
    label: "Medium",
    dotClass: "bg-amber-500",
    textClass: "text-amber-600",
  },
  low: {
    label: "Low",
    dotClass: "bg-slate-400",
    textClass: "text-slate-500",
  },
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  const c = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        c.className
      )}
    >
      {c.label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const c = PRIORITY_CONFIG[priority];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        c.textClass
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", c.dotClass)} />
      {c.label}
    </span>
  );
}
