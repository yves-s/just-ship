"use client";

import { useState, useCallback } from "react";
import { ChevronDown, Terminal, Pencil, Trash2, Plus, ArrowRightLeft, Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { CopyButton } from "@/components/ui/copy-button";
import { MoveProjectDialog } from "./move-project-dialog";
import { EditProjectDialog } from "./edit-project-dialog";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { ProjectSetupDialog } from "@/components/board/project-setup-dialog";
import { CreateProjectDialog } from "@/components/board/create-project-dialog";
import { ProjectMembersDialog } from "./project-members-dialog";
import { createClient } from "@/lib/supabase/client";
import type { Project, ApiKey, WorkspaceMember } from "@/lib/types";
import type { ProjectWithStats } from "@/app/[slug]/settings/projects/page";

const PROJECT_COLORS = [
  "bg-emerald-600",
  "bg-blue-600",
  "bg-amber-600",
  "bg-purple-600",
  "bg-rose-600",
  "bg-cyan-600",
  "bg-pink-600",
  "bg-indigo-600",
];

function hashToIndex(id: string, len: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % len;
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function truncateId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + "…" : id;
}

interface ProjectsSettingsViewProps {
  projects: ProjectWithStats[];
  workspaceId: string;
  workspaceSlug: string;
  boardUrl: string;
  hasApiKey: boolean;
  workspaceMembers: WorkspaceMember[];
  isAdmin: boolean;
}

export function ProjectsSettingsView({
  projects,
  workspaceId,
  workspaceSlug: _workspaceSlug,
  boardUrl,
  hasApiKey,
  workspaceMembers,
  isAdmin,
}: ProjectsSettingsViewProps) {
  const [projectsList, setProjectsList] = useState<ProjectWithStats[]>(projects);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [moveDialogProject, setMoveDialogProject] = useState<Project | null>(null);
  const [setupProject, setSetupProject] = useState<Project | null>(null);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);
  const [apiKey, setApiKey] = useState<ApiKey | null>(null);
  const [plaintextKey, setPlaintextKey] = useState<string | null>(null);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [membersProject, setMembersProject] = useState<Project | null>(null);

  function handleMoved() {
    if (!moveDialogProject) return;
    setProjectsList((prev) => prev.filter((p) => p.id !== moveDialogProject.id));
    setMoveDialogProject(null);
  }

  function handleUpdated(updated: Project) {
    setProjectsList((prev) =>
      prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p))
    );
    setEditProject(null);
  }

  function handleDeleted() {
    if (!deleteProject) return;
    setProjectsList((prev) => prev.filter((p) => p.id !== deleteProject.id));
    setDeleteProject(null);
  }

  function handleCreated(project: Project) {
    const withStats: ProjectWithStats = {
      ...project,
      ticketStats: { open: 0, done: 0, total: 0 },
    };
    setProjectsList((prev) => [...prev, withStats]);
    setCreateProjectOpen(false);
  }

  const ensureApiKey = useCallback(async () => {
    if (apiKey) return;
    setApiKeyError(null);
    try {
      const supabase = createClient();
      const { data: keys } = await supabase
        .from("api_keys")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("revoked_at", null)
        .limit(1);
      if (keys && keys.length > 0) {
        setApiKey(keys[0]);
        return;
      }
      const res = await fetch(`/api/workspace/${workspaceId}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Pipeline" }),
      });
      if (res.ok) {
        const { data } = await res.json();
        setApiKey(data.key);
        setPlaintextKey(data.plaintext);
      } else {
        setApiKeyError("Failed to generate API key. Please try again.");
      }
    } catch {
      setApiKeyError("Network error generating API key. Please try again.");
    }
  }, [apiKey, workspaceId]);

  async function handleRegenerateKey(): Promise<string | null> {
    const res = await fetch(`/api/workspace/${workspaceId}/api-keys/regenerate`, {
      method: "POST",
    });
    if (!res.ok) return null;
    const { data } = await res.json();
    setApiKey({ ...apiKey!, key_prefix: data.prefix, revoked_at: null });
    setPlaintextKey(data.api_key);
    return data.api_key;
  }

  async function handleSetupProject(project: Project) {
    setSetupProject(project);
    await ensureApiKey();
  }

  function toggleProject(projectId: string) {
    setExpandedProjectId((prev) => (prev === projectId ? null : projectId));
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Projects</CardTitle>
            <CardDescription>
              Manage projects in this workspace.
            </CardDescription>
          </div>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setCreateProjectOpen(true)}>
              <Plus className="h-4 w-4" />
              New project
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {projectsList.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No projects found.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {projectsList.map((project) => {
                const isExpanded = expandedProjectId === project.id;
                const colorClass = PROJECT_COLORS[hashToIndex(project.id, PROJECT_COLORS.length)];

                return (
                  <Collapsible
                    key={project.id}
                    open={isExpanded}
                    onOpenChange={() => toggleProject(project.id)}
                  >
                    <div
                      className={`rounded-lg border transition-colors ${
                        isExpanded ? "border-primary" : "border-border"
                      }`}
                    >
                      {/* Collapsed header — always visible */}
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors rounded-lg"
                        >
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white ${colorClass}`}
                          >
                            {(project.name?.[0] ?? "?").toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {project.name}
                            </p>
                            {project.description && (
                              <p className="text-xs text-muted-foreground truncate">
                                {project.description}
                              </p>
                            )}
                          </div>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              hasApiKey
                                ? "bg-emerald-500/10 text-emerald-500"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {hasApiKey ? "Connected" : "Not connected"}
                          </span>
                          <ChevronDown
                            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                          />
                        </button>
                      </CollapsibleTrigger>

                      {/* Expanded content */}
                      <CollapsibleContent>
                        <div className="border-t px-4 pb-4">
                          {/* Info Row */}
                          <div className="flex flex-wrap gap-x-6 gap-y-1 py-3">
                            <div>
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Project ID
                              </span>
                              <div className="flex items-center gap-1">
                                <span
                                  className="font-mono text-xs text-muted-foreground"
                                  title={project.id}
                                >
                                  {truncateId(project.id)}
                                </span>
                                <CopyButton value={project.id} />
                              </div>
                            </div>
                            <div>
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Created
                              </span>
                              <div className="text-xs text-muted-foreground">
                                {formatDate(project.created_at)}
                              </div>
                            </div>
                            <div>
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Pipeline
                              </span>
                              <div
                                className={`text-xs ${
                                  hasApiKey ? "text-emerald-500" : "text-muted-foreground"
                                }`}
                              >
                                {hasApiKey ? "Connected" : "Not connected"}
                              </div>
                            </div>
                          </div>

                          {/* Stats Row */}
                          <div className="flex gap-2 mb-3">
                            <div className="flex-1 rounded-md bg-muted/40 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Open
                              </p>
                              <p className="text-lg font-bold text-amber-500">
                                {project.ticketStats.open}
                              </p>
                            </div>
                            <div className="flex-1 rounded-md bg-muted/40 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Done
                              </p>
                              <p className="text-lg font-bold text-emerald-500">
                                {project.ticketStats.done}
                              </p>
                            </div>
                            <div className="flex-1 rounded-md bg-muted/40 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Total
                              </p>
                              <p className="text-lg font-bold">
                                {project.ticketStats.total}
                              </p>
                            </div>
                          </div>

                          {/* Actions Row */}
                          <div className="flex justify-end gap-1.5">
                            {isAdmin && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMembersProject(project);
                                }}
                              >
                                <Users className="h-3.5 w-3.5" />
                                Members
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSetupProject(project);
                              }}
                            >
                              <Terminal className="h-3.5 w-3.5" />
                              Setup
                            </Button>
                            {isAdmin && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditProject(project);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Edit
                              </Button>
                            )}
                            {isAdmin && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMoveDialogProject(project);
                                }}
                              >
                                <ArrowRightLeft className="h-3.5 w-3.5" />
                                Move
                              </Button>
                            )}
                            {isAdmin && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteProject(project);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </Button>
                            )}
                          </div>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {moveDialogProject && (
        <MoveProjectDialog
          open={moveDialogProject !== null}
          onOpenChange={(open) => {
            if (!open) setMoveDialogProject(null);
          }}
          project={moveDialogProject}
          currentWorkspaceId={workspaceId}
          onMoved={handleMoved}
        />
      )}

      {setupProject && (
        <ProjectSetupDialog
          open={!!setupProject}
          onOpenChange={(open) => !open && setSetupProject(null)}
          project={setupProject}
          workspaceId={workspaceId}
          boardUrl={boardUrl}
          apiKey={apiKey}
          plaintextKey={plaintextKey}
          apiKeyError={apiKeyError}
          onRetryApiKey={ensureApiKey}
          onRegenerateKey={handleRegenerateKey}
        />
      )}

      {editProject && (
        <EditProjectDialog
          open={editProject !== null}
          onOpenChange={(open) => {
            if (!open) setEditProject(null);
          }}
          project={editProject}
          onUpdated={handleUpdated}
        />
      )}

      {deleteProject && (
        <DeleteProjectDialog
          open={deleteProject !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteProject(null);
          }}
          project={deleteProject}
          workspaceId={workspaceId}
          onDeleted={handleDeleted}
        />
      )}

      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        workspaceId={workspaceId}
        onCreated={handleCreated}
      />

      {membersProject && (
        <ProjectMembersDialog
          open={membersProject !== null}
          onOpenChange={(open) => !open && setMembersProject(null)}
          projectId={membersProject.id}
          projectName={membersProject.name}
          workspaceMembers={workspaceMembers}
        />
      )}
    </>
  );
}
