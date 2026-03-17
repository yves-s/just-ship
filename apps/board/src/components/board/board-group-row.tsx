"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronRight, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { TicketCard } from "./ticket-card";
import type { Ticket } from "@/lib/types";
import type { TicketStatus } from "@/lib/constants";

const COLUMN_BG: Record<TicketStatus, string> = {
  backlog: "bg-slate-50",
  ready_to_develop: "bg-sky-50",
  in_progress: "bg-amber-50",
  in_review: "bg-violet-50",
  done: "bg-emerald-50",
  cancelled: "bg-red-50",
};

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
  hasMore,
  isLoadingMore,
  onLoadMore,
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
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const droppableId = `${status}__${projectId ?? "none"}`;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "w-72 shrink-0 flex flex-col gap-2 rounded-xl p-2 min-h-[60px] transition-colors",
        isOver ? "bg-primary/5 ring-1 ring-primary/20" : COLUMN_BG[status] ?? "bg-muted/30"
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
      {hasMore && onLoadMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="mt-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50"
        >
          {isLoadingMore ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Laden…
            </>
          ) : (
            "Mehr laden…"
          )}
        </button>
      )}
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
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Column-level pagination — passed through to cells that have tickets */
  columnTotalCounts?: Record<string, number>;
  allTicketsByStatus?: (status: TicketStatus) => Ticket[];
  loadingMore?: Record<string, boolean>;
  onLoadMore?: (status: TicketStatus) => void;
}

export function BoardGroupRow({
  group,
  columns,
  onTicketClick,
  isAgentActive,
  getAgentActivity,
  onAddTicket,
  collapsed: controlledCollapsed,
  onToggleCollapsed,
  columnTotalCounts,
  allTicketsByStatus,
  loadingMore,
  onLoadMore,
}: BoardGroupRowProps) {
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const collapsed = controlledCollapsed ?? localCollapsed;
  const toggleCollapsed = onToggleCollapsed ?? (() => setLocalCollapsed(!localCollapsed));
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

  const hasActiveAgent = isAgentActive
    ? group.tickets.some((t) => isAgentActive(t.id))
    : false;
  const hasInProgress = group.tickets.some((t) => t.status === "in_progress");

  return (
    <div className="mb-3">
      {/* Group header — spans full width */}
      <button
        onClick={toggleCollapsed}
        className="flex items-center gap-2 px-1 py-2 w-full text-left bg-background hover:bg-muted/40 rounded-md transition-colors sticky top-7 z-10"
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
        {(hasActiveAgent || hasInProgress) && (
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
        )}
      </button>

      {/* Columns row */}
      {!collapsed && (
        <div className="flex gap-4 mt-1">
          {columns.map((col) => {
            const cellTickets = ticketsByStatus.get(col.status) ?? [];
            // Only show load-more if this cell actually has tickets AND the
            // column globally has more tickets than what's loaded.
            const allLoaded = allTicketsByStatus?.(col.status);
            const total = columnTotalCounts?.[col.status];
            const columnHasMore = allLoaded && total ? allLoaded.length < total : false;
            const hasMore = cellTickets.length > 0 && columnHasMore;

            return (
              <GroupCell
                key={col.status}
                status={col.status}
                projectId={group.projectId}
                tickets={cellTickets}
                onTicketClick={onTicketClick}
                isAgentActive={isAgentActive}
                getAgentActivity={getAgentActivity}
                onAddTicket={onAddTicket}
                hasMore={hasMore}
                isLoadingMore={loadingMore?.[col.status] ?? false}
                onLoadMore={onLoadMore ? () => onLoadMore(col.status) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
