"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { TicketCard } from "./ticket-card";
import type { Ticket } from "@/lib/types";
import type { TicketStatus } from "@/lib/constants";

export interface ProjectGroup {
  projectId: string | null;
  projectName: string | null;
  tickets: Ticket[];
}

const PROJECT_DOT_COLORS = [
  "bg-blue-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-orange-500",
] as const;

function hashProjectColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff;
  }
  return PROJECT_DOT_COLORS[Math.abs(hash) % PROJECT_DOT_COLORS.length];
}

function GroupCell({
  status,
  projectId,
  tickets,
  onTicketClick,
  isAgentActive,
  getAgentActivity,
  onAddTicket,
}: {
  status: TicketStatus;
  projectId: string | null;
  tickets: Ticket[];
  onTicketClick: (ticket: Ticket) => void;
  isAgentActive?: (ticketId: string) => boolean;
  getAgentActivity?: (
    ticketId: string
  ) => { agent_type: string; event_type: string } | null;
  onAddTicket?: (status: TicketStatus, projectId: string | null) => void;
}) {
  const droppableId = `${status}__${projectId ?? "none"}`;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "w-72 shrink-0 flex flex-col gap-2 rounded-xl p-2 min-h-[60px] transition-colors",
        isOver ? "bg-primary/5 ring-1 ring-primary/20" : "bg-muted/30"
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
            agentActive={isAgentActive?.(ticket.id) ?? false}
            agentActivity={getAgentActivity?.(ticket.id) ?? null}
          />
        ))}
      </SortableContext>
      {onAddTicket && (
        <button
          onClick={() => onAddTicket(status, projectId)}
          className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-background/60 rounded-lg transition-colors"
        >
          <Plus className="h-3 w-3" />
          New task
        </button>
      )}
    </div>
  );
}

interface BoardGroupRowProps {
  group: ProjectGroup;
  columns: { status: TicketStatus; label: string }[];
  onTicketClick: (ticket: Ticket) => void;
  isAgentActive?: (ticketId: string) => boolean;
  getAgentActivity?: (
    ticketId: string
  ) => { agent_type: string; event_type: string } | null;
  onAddTicket?: (status: TicketStatus, projectId: string | null) => void;
}

export function BoardGroupRow({
  group,
  columns,
  onTicketClick,
  isAgentActive,
  getAgentActivity,
  onAddTicket,
}: BoardGroupRowProps) {
  const [collapsed, setCollapsed] = useState(false);
  const colorClass = group.projectId
    ? hashProjectColor(group.projectId)
    : "bg-slate-400";

  // Group tickets by status
  const ticketsByStatus = new Map<TicketStatus, Ticket[]>();
  for (const col of columns) {
    ticketsByStatus.set(
      col.status,
      group.tickets.filter((t) => t.status === col.status)
    );
  }

  return (
    <div className="mb-3">
      {/* Group header — spans full width */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 px-1 py-2 w-full text-left hover:bg-muted/40 rounded-md transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
            !collapsed && "rotate-90"
          )}
        />
        <span
          className={cn("h-2.5 w-2.5 rounded-full shrink-0", colorClass)}
        />
        <span className="text-sm font-medium">
          {group.projectName ?? "No project"}
        </span>
        <span className="text-xs text-muted-foreground">
          {group.tickets.length}
        </span>
      </button>

      {/* Columns row */}
      {!collapsed && (
        <div className="flex gap-4 mt-1">
          {columns.map((col) => (
            <GroupCell
              key={col.status}
              status={col.status}
              projectId={group.projectId}
              tickets={ticketsByStatus.get(col.status) ?? []}
              onTicketClick={onTicketClick}
              isAgentActive={isAgentActive}
              getAgentActivity={getAgentActivity}
              onAddTicket={onAddTicket}
            />
          ))}
        </div>
      )}
    </div>
  );
}
