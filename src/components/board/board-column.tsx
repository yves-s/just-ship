"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { TicketCard } from "./ticket-card";
import type { Ticket } from "@/lib/types";
import type { TicketStatus } from "@/lib/constants";

interface BoardColumnProps {
  status: TicketStatus;
  label: string;
  tickets: Ticket[];
  onTicketClick: (ticket: Ticket) => void;
}

const COLUMN_DOT: Record<TicketStatus, string> = {
  backlog: "bg-slate-400",
  ready_to_develop: "bg-sky-500",
  in_progress: "bg-amber-500",
  in_review: "bg-violet-500",
  done: "bg-emerald-500",
  cancelled: "bg-red-400",
};

export function BoardColumn({
  status,
  label,
  tickets,
  onTicketClick,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex w-72 shrink-0 flex-col gap-3">
      {/* Column header */}
      <div className="flex items-center gap-2 px-1">
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full shrink-0",
            COLUMN_DOT[status] ?? "bg-slate-400"
          )}
        />
        <span className="text-sm font-medium">{label}</span>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground font-medium">
          {tickets.length}
        </span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-1 flex-col gap-2 rounded-xl p-2 min-h-[200px] transition-colors",
          isOver
            ? "bg-primary/5 ring-1 ring-primary/20"
            : "bg-muted/50"
        )}
      >
        <SortableContext
          items={tickets.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              onClick={onTicketClick}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
