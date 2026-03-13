"use client";

import { useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Terminal, Pencil, Trash2, Plus, ArrowRightLeft, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MoveProjectDialog } from "./move-project-dialog";
import { EditProjectDialog } from "./edit-project-dialog";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { ProjectSetupDialog } from "@/components/board/project-setup-dialog";
import { CreateProjectDialog } from "@/components/board/create-project-dialog";
import { createClient } from "@/lib/supabase/client";
import type { Project, ApiKey } from "@/lib/types";

interface ProjectsSettingsViewProps {
  projects: Project[];
  workspaceId: string;
  workspaceSlug: string;
  boardUrl: string;
}

export function ProjectsSettingsView({
  projects,
  workspaceId,
  workspaceSlug: _workspaceSlug,
  boardUrl,
}: ProjectsSettingsViewProps) {
  const [projectsList, setProjectsList] = useState<Project[]>(projects);
  const [moveDialogProject, setMoveDialogProject] = useState<Project | null>(null);
  const [setupProject, setSetupProject] = useState<Project | null>(null);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);
  const [apiKey, setApiKey] = useState<ApiKey | null>(null);
  const [plaintextKey, setPlaintextKey] = useState<string | null>(null);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  function handleMoved() {
    if (!moveDialogProject) return;
    setProjectsList((prev) => prev.filter((p) => p.id !== moveDialogProject.id));
    setMoveDialogProject(null);
  }

  function handleUpdated(updated: Project) {
    setProjectsList((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );
    setEditProject(null);
  }

  function handleDeleted() {
    if (!deleteProject) return;
    setProjectsList((prev) => prev.filter((p) => p.id !== deleteProject.id));
    setDeleteProject(null);
  }

  function handleCreated(project: Project) {
    setProjectsList((prev) => [...prev, project]);
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
          <Button variant="outline" size="sm" onClick={() => setCreateProjectOpen(true)}>
            <Plus className="h-4 w-4" />
            New project
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {projectsList.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted-foreground">
              No projects found.
            </p>
          ) : (
            <ul className="divide-y">
              {projectsList.map((project) => (
                <li
                  key={project.id}
                  className="flex items-center gap-3 px-6 py-4"
                >
                  <div className="flex flex-1 flex-col min-w-0">
                    <span className="text-sm font-medium truncate">{project.name}</span>
                    {project.description && (
                      <span className="text-xs text-muted-foreground truncate">
                        {project.description}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSetupProject(project)}
                  >
                    <Terminal className="h-3.5 w-3.5 mr-1.5" />
                    Connect
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditProject(project)}>
                        <Pencil />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setMoveDialogProject(project)}>
                        <ArrowRightLeft />
                        Move to workspace
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => setDeleteProject(project)}>
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
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
    </>
  );
}
