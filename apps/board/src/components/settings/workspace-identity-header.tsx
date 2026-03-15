"use client";

import { useWorkspace } from "@/lib/workspace-context";
import { CopyButton } from "@/components/ui/copy-button";

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function truncateId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + "\u2026" : id;
}

export function WorkspaceIdentityHeader() {
  const workspace = useWorkspace();

  return (
    <div className="flex items-start gap-4 px-6 pt-6 pb-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">
        {(workspace.name?.[0] ?? "?").toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <h1 className="text-xl font-bold truncate">{workspace.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Workspace ID
            </span>
            <div className="flex items-center gap-1">
              <span
                className="font-mono text-xs text-muted-foreground"
                title={workspace.id}
              >
                {truncateId(workspace.id)}
              </span>
              <CopyButton value={workspace.id} />
            </div>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Slug
            </span>
            <div className="font-mono text-xs text-muted-foreground">
              {workspace.slug}
            </div>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Created
            </span>
            <div className="text-xs text-muted-foreground">
              {formatDate(workspace.created_at)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
