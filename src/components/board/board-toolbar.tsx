"use client";

import { X, SlidersHorizontal, ArrowUpDown, Layers, Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRef, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { BOARD_COLUMNS } from "@/lib/constants";
import type { TicketStatus, TicketPriority } from "@/lib/constants";
import type { Project, WorkspaceMember } from "@/lib/types";
import type { BoardFilterState } from "@/lib/hooks/use-board-filters";
import { DEFAULT_FILTERS } from "@/lib/hooks/use-board-filters";

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const SORT_BY_LABELS: Record<BoardFilterState["sortBy"], string> = {
  created_at: "Created",
  priority: "Priority",
  number: "Ticket #",
  due_date: "Due date",
};

interface BoardToolbarProps {
  filters: BoardFilterState;
  onChange: (filters: BoardFilterState) => void;
  projects: Project[];
  members: WorkspaceMember[];
  onCreateProject?: () => void;
  onSetupProject?: (project: Project) => void;
}

export function BoardToolbar({
  filters,
  onChange,
  projects,
  members,
  onCreateProject,
  onSetupProject,
}: BoardToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const hasActiveFilters =
    filters.statuses.length > 0 ||
    filters.priorities.length > 0 ||
    filters.projectIds.length > 0 ||
    filters.assigneeIds.length > 0;

  function toggleStatus(status: TicketStatus) {
    const exists = filters.statuses.includes(status);
    onChange({
      ...filters,
      statuses: exists
        ? filters.statuses.filter((s) => s !== status)
        : [...filters.statuses, status],
    });
  }

  function togglePriority(priority: TicketPriority) {
    const exists = filters.priorities.includes(priority);
    onChange({
      ...filters,
      priorities: exists
        ? filters.priorities.filter((p) => p !== priority)
        : [...filters.priorities, priority],
    });
  }

  function toggleProject(projectId: string) {
    const exists = filters.projectIds.includes(projectId);
    onChange({
      ...filters,
      projectIds: exists
        ? filters.projectIds.filter((p) => p !== projectId)
        : [...filters.projectIds, projectId],
    });
  }

  function toggleAssignee(assigneeId: string) {
    const exists = filters.assigneeIds.includes(assigneeId);
    onChange({
      ...filters,
      assigneeIds: exists
        ? filters.assigneeIds.filter((a) => a !== assigneeId)
        : [...filters.assigneeIds, assigneeId],
    });
  }

  function removeChip(type: string, value: string) {
    switch (type) {
      case "status":
        onChange({ ...filters, statuses: filters.statuses.filter((s) => s !== value) });
        break;
      case "priority":
        onChange({ ...filters, priorities: filters.priorities.filter((p) => p !== value) });
        break;
      case "project":
        onChange({ ...filters, projectIds: filters.projectIds.filter((p) => p !== value) });
        break;
      case "assignee":
        onChange({ ...filters, assigneeIds: filters.assigneeIds.filter((a) => a !== value) });
        break;
    }
  }

  const chips: { type: string; value: string; label: string }[] = [
    ...filters.statuses.map((s) => ({
      type: "status",
      value: s,
      label: BOARD_COLUMNS.find((c) => c.status === s)?.label ?? s,
    })),
    ...filters.priorities.map((p) => ({
      type: "priority",
      value: p,
      label: PRIORITY_LABELS[p],
    })),
    ...filters.projectIds.map((id) => ({
      type: "project",
      value: id,
      label:
        id === "none"
          ? "No project"
          : (projects.find((p) => p.id === id)?.name ?? id),
    })),
    ...filters.assigneeIds.map((id) => ({
      type: "assignee",
      value: id,
      label:
        id === "none"
          ? "Unassigned"
          : (members.find((m) => m.user_id === id)?.user_email ?? id.slice(0, 8)),
    })),
  ];

  const sortLabel = `${SORT_BY_LABELS[filters.sortBy]} ${filters.sortDir === "asc" ? "↑" : "↓"}`;

  return (
    <div className="flex flex-col gap-2 border-b px-6 py-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Board quickfilter */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onChange({ ...filters, search: "" });
                searchRef.current?.blur();
              }
            }}
            placeholder="Filter tickets..."
            className="h-7 w-44 pl-7 pr-7 text-xs"
          />
          {filters.search && (
            <button
              onClick={() => {
                onChange({ ...filters, search: "" });
                searchRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Filter dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-7 text-xs",
                hasActiveFilters && "border-primary/50 text-primary"
              )}
            >
              <SlidersHorizontal className="h-3 w-3" />
              Filter
              {hasActiveFilters && (
                <span className="ml-0.5 rounded-full bg-primary text-primary-foreground text-[10px] px-1.5 leading-5">
                  {chips.length}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-52" align="start">
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            {BOARD_COLUMNS.map((col) => (
              <DropdownMenuCheckboxItem
                key={col.status}
                checked={filters.statuses.includes(col.status)}
                onCheckedChange={() => toggleStatus(col.status)}
              >
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Priority</DropdownMenuLabel>
            {(["high", "medium", "low"] as TicketPriority[]).map((p) => (
              <DropdownMenuCheckboxItem
                key={p}
                checked={filters.priorities.includes(p)}
                onCheckedChange={() => togglePriority(p)}
              >
                {PRIORITY_LABELS[p]}
              </DropdownMenuCheckboxItem>
            ))}

            {projects.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Project</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={filters.projectIds.includes("none")}
                  onCheckedChange={() => toggleProject("none")}
                >
                  No project
                </DropdownMenuCheckboxItem>
                {projects.map((p) => (
                  <DropdownMenuCheckboxItem
                    key={p.id}
                    checked={filters.projectIds.includes(p.id)}
                    onCheckedChange={() => toggleProject(p.id)}
                  >
                    {p.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </>
            )}

            {members.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Assignee</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={filters.assigneeIds.includes("none")}
                  onCheckedChange={() => toggleAssignee("none")}
                >
                  Unassigned
                </DropdownMenuCheckboxItem>
                {members.map((m) => (
                  <DropdownMenuCheckboxItem
                    key={m.user_id}
                    checked={filters.assigneeIds.includes(m.user_id)}
                    onCheckedChange={() => toggleAssignee(m.user_id)}
                  >
                    {m.user_email ?? m.user_id.slice(0, 8)}
                  </DropdownMenuCheckboxItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sort dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs">
              <ArrowUpDown className="h-3 w-3" />
              {sortLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-44" align="start">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={filters.sortBy}
              onValueChange={(v) =>
                onChange({ ...filters, sortBy: v as BoardFilterState["sortBy"] })
              }
            >
              {(
                Object.entries(SORT_BY_LABELS) as [
                  BoardFilterState["sortBy"],
                  string,
                ][]
              ).map(([v, label]) => (
                <DropdownMenuRadioItem key={v} value={v}>
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Direction</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={filters.sortDir}
              onValueChange={(v) =>
                onChange({ ...filters, sortDir: v as "asc" | "desc" })
              }
            >
              <DropdownMenuRadioItem value="asc">
                Ascending ↑
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="desc">
                Descending ↓
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Group by project toggle */}
        <Button
          variant={filters.groupByProject ? "secondary" : "outline"}
          size="sm"
          className="h-7 text-xs"
          onClick={() =>
            onChange({ ...filters, groupByProject: !filters.groupByProject })
          }
        >
          <Layers className="h-3 w-3" />
          Group by project
        </Button>

        {/* Reset filters button */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() =>
              onChange({
                ...DEFAULT_FILTERS,
                sortBy: filters.sortBy,
                sortDir: filters.sortDir,
                groupByProject: filters.groupByProject,
              })
            }
          >
            <X className="h-3 w-3" />
            Reset
          </Button>
        )}

        {/* Create project button */}
        {onCreateProject && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onCreateProject}
            title="Create project"
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={`${chip.type}-${chip.value}`}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
            >
              <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
                {chip.type}:
              </span>
              <span className="text-muted-foreground">{chip.label}</span>
              <button
                onClick={() => removeChip(chip.type, chip.value)}
                className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5 leading-none"
              >
                <X className="h-2.5 w-2.5 text-muted-foreground" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
