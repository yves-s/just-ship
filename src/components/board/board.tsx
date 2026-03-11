"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  closestCorners,
  type CollisionDetection,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { createClient } from "@/lib/supabase/client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { BOARD_COLUMNS, TICKETS_PER_COLUMN_PAGE } from "@/lib/constants";
import type { TicketStatus, TicketPriority } from "@/lib/constants";
import type { Ticket, Project, WorkspaceMember } from "@/lib/types";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { BoardColumn } from "./board-column";
import { BoardGroupRow, type ProjectGroup } from "./board-group-row";
import { TicketCard } from "./ticket-card";
import { TicketDetailSheet } from "@/components/tickets/ticket-detail-sheet";
import { CreateTicketDialog } from "@/components/tickets/create-ticket-dialog";
import { AgentPanel } from "./agent-panel";
import { useAgentActivity } from "@/lib/hooks/use-agent-activity";
import { BoardToolbar } from "./board-toolbar";
import { useBoardFilters } from "@/lib/hooks/use-board-filters";
import { useTicketRealtime } from "@/lib/hooks/use-ticket-realtime";

const COLUMN_DOT: Record<TicketStatus, string> = {
  backlog: "bg-slate-400",
  ready_to_develop: "bg-sky-500",
  in_progress: "bg-amber-500",
  in_review: "bg-violet-500",
  done: "bg-emerald-500",
  cancelled: "bg-red-400",
};

function buildProjectGroups(
  tickets: Ticket[],
  projects: Project[]
): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>();

  for (const ticket of tickets) {
    const key = ticket.project_id ?? "none";
    if (!map.has(key)) {
      const projectName =
        ticket.project?.name ??
        projects.find((p) => p.id === ticket.project_id)?.name ??
        null;
      map.set(key, {
        projectId: ticket.project_id,
        projectName,
        tickets: [],
      });
    }
    map.get(key)!.tickets.push(ticket);
  }

  const noProject = map.get("none");
  const withProject = Array.from(map.values())
    .filter((g) => g.projectId !== null)
    .sort((a, b) => (a.projectName ?? "").localeCompare(b.projectName ?? ""));

  const result: ProjectGroup[] = [];
  if (noProject) result.push(noProject);
  result.push(...withProject);
  return result;
}

const PRIORITY_ORDER: Record<TicketPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Custom collision detection: prioritises pointerWithin (detects empty columns
 * reliably) and falls back to closestCorners for reordering within columns.
 */
const columnAwareCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }
  return closestCorners(args);
};

interface BoardProps {
  initialTickets: Ticket[];
  initialColumnCounts: Record<string, number>;
  workspaceId: string;
  workspaceSlug: string;
  projects: Project[];
  members: WorkspaceMember[];
}

export function Board({
  initialTickets,
  initialColumnCounts,
  workspaceId,
  workspaceSlug,
  projects,
  members,
}: BoardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets);
  const [columnCounts, setColumnCounts] = useState<Record<string, number>>(initialColumnCounts);
  const [columnPages, setColumnPages] = useState<Record<string, number>>(
    () => Object.fromEntries(BOARD_COLUMNS.map((col) => [col.status, 1]))
  );
  const [loadingMore, setLoadingMore] = useState<Record<string, boolean>>({});

  const handleCountChange = useCallback(
    (changes: { status: string; delta: number }[]) => {
      setColumnCounts((prev) => {
        const next = { ...prev };
        for (const { status, delta } of changes) {
          next[status] = Math.max(0, (next[status] ?? 0) + delta);
        }
        return next;
      });
    },
    []
  );

  useTicketRealtime(workspaceId, setTickets, handleCountChange);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addTicketDialog, setAddTicketDialog] = useState<{
    open: boolean;
    status: TicketStatus;
    projectId: string | null;
  }>({ open: false, status: "backlog", projectId: null });

  const { filters, updateFilters, toggleGroupCollapsed } = useBoardFilters(workspaceSlug);

  const ticketIds = useMemo(() => initialTickets.map((t) => t.id), [initialTickets]);

  // Open ticket from URL deeplink on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const ticketParam = urlParams.get("ticket");
    if (ticketParam) {
      const num = parseInt(ticketParam.replace("T-", ""), 10);
      const ticket = tickets.find((t) => t.number === num);
      if (ticket) {
        setSelectedTicket(ticket);
        setSheetOpen(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for open-ticket events from the command palette
  useEffect(() => {
    function handleOpenTicket(e: Event) {
      const { number } = (e as CustomEvent<{ number: number }>).detail;
      const local = tickets.find((t) => t.number === number);
      if (local) {
        setSelectedTicket(local);
        setSheetOpen(true);
        const params = new URLSearchParams(searchParams.toString());
        params.set("ticket", `T-${local.number}`);
        router.replace(`${pathname}?${params.toString()}`);
        return;
      }
      // Ticket not loaded locally (paginated out) — fetch it
      const supabase = createClient();
      supabase
        .from("tickets")
        .select("*, project:projects(id, name, description, workspace_id, created_at, updated_at)")
        .eq("workspace_id", workspaceId)
        .eq("number", number)
        .single()
        .then(({ data }) => {
          if (data) {
            const ticket = data as Ticket;
            setSelectedTicket(ticket);
            setSheetOpen(true);
            const params = new URLSearchParams(searchParams.toString());
            params.set("ticket", `T-${ticket.number}`);
            router.replace(`${pathname}?${params.toString()}`);
          }
        });
    }
    window.addEventListener("open-ticket", handleOpenTicket);
    return () => window.removeEventListener("open-ticket", handleOpenTicket);
  }, [tickets, searchParams, pathname, router, workspaceId]);

  const { isActive, getActivity, activeAgents } = useAgentActivity(workspaceId, ticketIds);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // Apply filters + sort to the full ticket list
  const filteredTickets = useMemo(() => {
    let result = tickets;

    if (filters.statuses.length > 0) {
      result = result.filter((t) => filters.statuses.includes(t.status));
    }
    if (filters.priorities.length > 0) {
      result = result.filter((t) => filters.priorities.includes(t.priority));
    }
    if (filters.projectIds.length > 0) {
      result = result.filter((t) =>
        filters.projectIds.includes(t.project_id ?? "none")
      );
    }
    if (filters.assigneeIds.length > 0) {
      result = result.filter((t) =>
        filters.assigneeIds.includes(t.assignee_id ?? "none")
      );
    }

    // Board quickfilter — client-side search by title and number
    if (filters.search) {
      const term = filters.search.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(term) ||
          `t-${t.number}`.includes(term) ||
          `${t.number}`.includes(term)
      );
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (filters.sortBy) {
        case "created_at":
          cmp =
            new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime();
          break;
        case "priority":
          cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
          break;
        case "number":
          cmp = a.number - b.number;
          break;
        case "due_date":
          if (!a.due_date && !b.due_date) cmp = 0;
          else if (!a.due_date) cmp = 1;
          else if (!b.due_date) cmp = -1;
          else
            cmp =
              new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
          break;
      }
      return filters.sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [tickets, filters]);

  // When status filter is active, hide filtered-out columns
  const visibleColumns = useMemo(() => {
    if (filters.statuses.length === 0) return BOARD_COLUMNS;
    return BOARD_COLUMNS.filter((col) => filters.statuses.includes(col.status));
  }, [filters.statuses]);

  // Build project groups for grouped layout
  const projectGroups = useMemo(() => {
    if (!filters.groupByProject) return [];
    return buildProjectGroups(filteredTickets, projects);
  }, [filteredTickets, projects, filters.groupByProject]);

  // Helper to extract status from droppable id (handles compound ids like "backlog__project-123")
  function getStatusFromDroppableId(id: string): TicketStatus | undefined {
    if (id.includes("__")) {
      const status = id.split("__")[0] as TicketStatus;
      return BOARD_COLUMNS.find((col) => col.status === status)?.status;
    }
    return BOARD_COLUMNS.find((col) => col.status === id)?.status;
  }

  function getTicketsForColumn(status: TicketStatus): Ticket[] {
    return filteredTickets.filter((t) => t.status === status);
  }

  async function loadMore(status: TicketStatus) {
    const page = columnPages[status] ?? 1;
    const offset = page * TICKETS_PER_COLUMN_PAGE;
    setLoadingMore((prev) => ({ ...prev, [status]: true }));

    const supabase = createClient();
    const { data } = await supabase
      .from("tickets")
      .select(
        "*, project:projects(id, name, description, workspace_id, created_at, updated_at)"
      )
      .eq("workspace_id", workspaceId)
      .eq("status", status)
      .order("updated_at", { ascending: false })
      .range(offset, offset + TICKETS_PER_COLUMN_PAGE - 1);

    if (data) {
      setTickets((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const newTickets = (data as Ticket[]).filter(
          (t) => !existingIds.has(t.id)
        );
        return [...prev, ...newTickets];
      });
      setColumnPages((prev) => ({ ...prev, [status]: page + 1 }));
    }
    setLoadingMore((prev) => ({ ...prev, [status]: false }));
  }

  const [dragOriginStatus, setDragOriginStatus] = useState<TicketStatus | null>(null);

  function handleDragStart(event: DragStartEvent) {
    const ticket = tickets.find((t) => t.id === event.active.id);
    setActiveTicket(ticket ?? null);
    setDragOriginStatus(ticket?.status ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeTicket = tickets.find((t) => t.id === activeId);
    if (!activeTicket) return;

    // Determine the target column (supports compound ids like "backlog__project-123")
    const targetStatus = getStatusFromDroppableId(overId);
    const overTicket = tickets.find((t) => t.id === overId);
    const targetCol = targetStatus ?? overTicket?.status;

    if (!targetCol || targetCol === activeTicket.status) return;

    setTickets((prev) =>
      prev.map((t) =>
        t.id === activeId ? { ...t, status: targetCol as TicketStatus } : t
      )
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTicket(null);

    if (!over) {
      setDragOriginStatus(null);
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeTicket = tickets.find((t) => t.id === activeId);
    if (!activeTicket) {
      setDragOriginStatus(null);
      return;
    }

    // Adjust column counts if status changed
    if (dragOriginStatus && dragOriginStatus !== activeTicket.status) {
      setColumnCounts((prev) => ({
        ...prev,
        [dragOriginStatus]: Math.max(0, (prev[dragOriginStatus] ?? 0) - 1),
        [activeTicket.status]: (prev[activeTicket.status] ?? 0) + 1,
      }));
    }
    setDragOriginStatus(null);

    // Update in DB
    const supabase = createClient();
    supabase
      .from("tickets")
      .update({ status: activeTicket.status })
      .eq("id", activeId)
      .then(({ error }) => {
        if (error) {
          console.error("Failed to update ticket status:", error);
        }
      });

    // Handle reordering within same column
    if (activeId !== overId) {
      const overTicket = tickets.find((t) => t.id === overId);
      if (overTicket && overTicket.status === activeTicket.status) {
        setTickets((prev) => {
          const activeIndex = prev.findIndex((t) => t.id === activeId);
          const overIndex = prev.findIndex((t) => t.id === overId);
          return arrayMove(prev, activeIndex, overIndex);
        });
      }
    }
  }

  function handleTicketClick(ticket: Ticket) {
    setSelectedTicket(ticket);
    setSheetOpen(true);
    const params = new URLSearchParams(searchParams.toString());
    params.set("ticket", `T-${ticket.number}`);
    router.replace(`${pathname}?${params.toString()}`);
  }

  function handleSheetOpenChange(open: boolean) {
    setSheetOpen(open);
    if (!open) {
      setSelectedTicket(null);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("ticket");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }
  }

  function handleUpdated(updated: Ticket) {
    let oldStatus: TicketStatus | undefined;
    setTickets((prev) => {
      const existing = prev.find((t) => t.id === updated.id);
      if (existing) oldStatus = existing.status;
      return prev.map((t) => (t.id === updated.id ? updated : t));
    });
    if (oldStatus && oldStatus !== updated.status) {
      setColumnCounts((prev) => ({
        ...prev,
        [oldStatus!]: Math.max(0, (prev[oldStatus!] ?? 0) - 1),
        [updated.status]: (prev[updated.status] ?? 0) + 1,
      }));
    }
    setSelectedTicket(updated);
  }

  function handleAddTicket(status: TicketStatus, projectId: string | null) {
    setAddTicketDialog({ open: true, status, projectId });
  }

  function handleTicketAdded(ticket: Ticket) {
    setTickets((prev) => [ticket, ...prev]);
    setColumnCounts((prev) => ({
      ...prev,
      [ticket.status]: (prev[ticket.status] ?? 0) + 1,
    }));
    setAddTicketDialog((prev) => ({ ...prev, open: false }));
  }

  function handleDeleted(id: string) {
    const ticket = tickets.find((t) => t.id === id);
    if (ticket) {
      setColumnCounts((prev) => ({
        ...prev,
        [ticket.status]: Math.max(0, (prev[ticket.status] ?? 0) - 1),
      }));
    }
    setTickets((prev) => prev.filter((t) => t.id !== id));
    const params = new URLSearchParams(searchParams.toString());
    params.delete("ticket");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <>
      <AgentPanel
        activeAgents={activeAgents}
        tickets={tickets}
        onTicketClick={handleTicketClick}
      />
      <BoardToolbar
        filters={filters}
        onChange={updateFilters}
        projects={projects}
        members={members}
      />
      <div className="flex-1 overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={columnAwareCollision}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {filters.groupByProject ? (
            <div className="h-full p-6 min-w-fit">
              {/* Column headers — sticky top */}
              <div className="flex gap-4 mb-4 sticky top-0 z-10 bg-background pb-2">
                {visibleColumns.map((col) => {
                  const count = columnCounts[col.status] ?? filteredTickets.filter(
                    (t) => t.status === col.status
                  ).length;
                  return (
                    <div
                      key={col.status}
                      className="w-72 shrink-0 flex items-center gap-2 px-1"
                    >
                      <span
                        className={cn(
                          "h-2.5 w-2.5 rounded-full shrink-0",
                          COLUMN_DOT[col.status] ?? "bg-slate-400"
                        )}
                      />
                      <span className="text-sm font-medium">{col.label}</span>
                      <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground font-medium">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Project group rows */}
              {projectGroups.map((group) => {
                const groupKey = group.projectId ?? "none";
                return (
                  <BoardGroupRow
                    key={groupKey}
                    group={group}
                    columns={visibleColumns}
                    onTicketClick={handleTicketClick}
                    isAgentActive={isActive}
                    getAgentActivity={getActivity}
                    onAddTicket={handleAddTicket}
                    collapsed={filters.collapsedGroups.includes(groupKey)}
                    onToggleCollapsed={() => toggleGroupCollapsed(groupKey)}
                  />
                );
              })}

              {/* Load-more row for grouped view — one button per column */}
              <div className="flex gap-4 mt-2">
                {visibleColumns.map((col) => {
                  const colTickets = getTicketsForColumn(col.status);
                  const totalCount = columnCounts[col.status] ?? colTickets.length;
                  const hasMore = colTickets.length < totalCount;
                  const loading = loadingMore[col.status] ?? false;

                  return (
                    <div key={col.status} className="w-72 shrink-0 flex justify-center">
                      {hasMore && (
                        <button
                          type="button"
                          onClick={() => loadMore(col.status)}
                          disabled={loading}
                          className="flex items-center gap-1.5 rounded-lg py-2 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50"
                        >
                          {loading ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Laden…
                            </>
                          ) : (
                            `Mehr laden (${colTickets.length}/${totalCount})`
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex h-full gap-4 p-6">
              {visibleColumns.map((col) => {
                const colTickets = getTicketsForColumn(col.status);
                const totalCount = columnCounts[col.status] ?? colTickets.length;
                return (
                  <BoardColumn
                    key={col.status}
                    status={col.status}
                    label={col.label}
                    tickets={colTickets}
                    totalCount={totalCount}
                    hasMore={colTickets.length < totalCount}
                    isLoadingMore={loadingMore[col.status] ?? false}
                    onLoadMore={() => loadMore(col.status)}
                    onTicketClick={handleTicketClick}
                    isAgentActive={isActive}
                    getAgentActivity={getActivity}
                    onAddTicket={handleAddTicket}
                  />
                );
              })}
            </div>
          )}

          <DragOverlay>
            {activeTicket && (
              <TicketCard
                ticket={activeTicket}
                onClick={() => {}}
                isDragOverlay
              />
            )}
          </DragOverlay>
        </DndContext>
      </div>

      <TicketDetailSheet
        ticket={selectedTicket}
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        onUpdated={handleUpdated}
        onDeleted={handleDeleted}
      />

      <CreateTicketDialog
        open={addTicketDialog.open}
        onOpenChange={(open) =>
          setAddTicketDialog((prev) => ({ ...prev, open }))
        }
        workspaceId={workspaceId}
        onCreated={handleTicketAdded}
        projects={projects}
        defaultStatus={addTicketDialog.status}
        defaultProjectId={addTicketDialog.projectId}
      />
    </>
  );
}
