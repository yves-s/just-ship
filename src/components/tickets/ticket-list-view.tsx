"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Search, Ticket as TicketIcon, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge, PriorityBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { TicketDetailSheet } from "./ticket-detail-sheet";
import { CreateTicketDialog } from "./create-ticket-dialog";
import type { Ticket } from "@/lib/types";
import type { TicketStatus } from "@/lib/constants";
import { TICKET_STATUSES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTicketRealtime } from "@/lib/hooks/use-ticket-realtime";

const PAGE_SIZE = 30;

interface TicketListViewProps {
  initialTickets: Ticket[];
  workspaceId: string;
}

const STATUS_LABELS: Record<TicketStatus, string> = {
  backlog: "Backlog",
  ready_to_develop: "Ready",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  cancelled: "Cancelled",
};

function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function TicketListView({
  initialTickets,
  workspaceId,
}: TicketListViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets);
  useTicketRealtime(workspaceId, setTickets);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "all">("all");
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, statusFilter]);

  // Infinite scroll via IntersectionObserver
  const loadMore = useCallback(() => {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    // Data is already in memory — defer to next frame for spinner visibility
    requestAnimationFrame(() => {
      setVisibleCount((c) => c + PAGE_SIZE);
      setIsLoadingMore(false);
    });
  }, [isLoadingMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  // Open ticket from URL deeplink on mount
  useEffect(() => {
    const ticketParam = searchParams.get("ticket");
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

  const filtered = useMemo(() => {
    return tickets.filter((t) => {
      const matchesSearch =
        !search ||
        t.title.toLowerCase().includes(search.toLowerCase()) ||
        String(t.number).includes(search);
      const matchesStatus =
        statusFilter === "all" || t.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [tickets, search, statusFilter]);

  const visibleTickets = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  function handleRowClick(ticket: Ticket) {
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
    setTickets((prev) =>
      prev.map((t) => (t.id === updated.id ? updated : t))
    );
    setSelectedTicket(updated);
  }

  function handleDeleted(id: string) {
    setTickets((prev) => prev.filter((t) => t.id !== id));
    const params = new URLSearchParams(searchParams.toString());
    params.delete("ticket");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function handleCreated(ticket: Ticket) {
    setTickets((prev) => [ticket, ...prev]);
    setCreateOpen(false);
    router.refresh();
  }

  const allStatuses: Array<TicketStatus | "all"> = ["all", ...TICKET_STATUSES];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h1 className="text-sm font-semibold">Tickets</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          New ticket
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 border-b px-6 py-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tickets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-1">
          {allStatuses.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                statusFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {s === "all" ? "All" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<TicketIcon className="h-8 w-8" />}
            title="No tickets found"
            description={
              search || statusFilter !== "all"
                ? "Try adjusting your filters."
                : "Create your first ticket to get started."
            }
            action={
              !search && statusFilter === "all" ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  New ticket
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-6 py-3 text-left font-medium w-16">#</th>
                <th className="px-3 py-3 text-left font-medium">Title</th>
                <th className="px-3 py-3 text-left font-medium w-32">Status</th>
                <th className="px-3 py-3 text-left font-medium w-28">Priority</th>
                <th className="px-3 py-3 text-left font-medium w-32">Due date</th>
                <th className="px-3 py-3 text-left font-medium w-32">Project</th>
              </tr>
            </thead>
            <tbody>
              {visibleTickets.map((ticket) => (
                <tr
                  key={ticket.id}
                  onClick={() => handleRowClick(ticket)}
                  className="border-b cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <td className="px-6 py-3 font-mono text-xs text-muted-foreground">
                    T-{ticket.number}
                  </td>
                  <td className="px-3 py-3 font-medium max-w-xs">
                    <div className="flex flex-col gap-1">
                      <span className="line-clamp-2">{ticket.title}</span>
                      {ticket.tags && ticket.tags.length > 0 && (
                        <div className="flex gap-1">
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
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={ticket.status} />
                  </td>
                  <td className="px-3 py-3">
                    <PriorityBadge priority={ticket.priority} />
                  </td>
                  <td className="px-3 py-3 text-muted-foreground text-xs">
                    {formatDate(ticket.due_date)}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground text-xs truncate">
                    {ticket.project?.name ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Sentinel + loading indicator */}
          {hasMore && (
            <div ref={sentinelRef} className="flex items-center justify-center py-4">
              {isLoadingMore && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          )}
          </>
        )}
      </div>

      <TicketDetailSheet
        ticket={selectedTicket}
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        onUpdated={handleUpdated}
        onDeleted={handleDeleted}
      />

      <CreateTicketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
        onCreated={handleCreated}
      />
    </div>
  );
}
