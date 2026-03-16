"use client";

import { useState, useEffect } from "react";
import { Copy, Check, RefreshCw, AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Project, ApiKey } from "@/lib/types";

interface ProjectSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  workspaceId: string;
  boardUrl: string;
  apiKey: ApiKey | null;
  plaintextKey: string | null;
  apiKeyError: string | null;
  onRetryApiKey: () => Promise<void>;
  onRegenerateKey: () => Promise<string | null>;
}

type CopiedTarget = "cli" | "json" | "install" | "uuid" | null;

const INSTALL_COMMAND = `git clone https://github.com/yves-s/just-ship.git ~/.just-ship
cd /path/to/your/project
~/.just-ship/setup.sh`;

export function ProjectSetupDialog({
  open,
  onOpenChange,
  project,
  workspaceId,
  boardUrl,
  apiKey,
  plaintextKey,
  apiKeyError,
  onRetryApiKey,
  onRegenerateKey,
}: ProjectSetupDialogProps) {
  const [copied, setCopied] = useState<CopiedTarget>(null);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [currentPlaintextKey, setCurrentPlaintextKey] = useState(plaintextKey);
  const [manualOpen, setManualOpen] = useState(false);
  const [firstTimeOpen, setFirstTimeOpen] = useState(false);

  // Sync with prop when parent provides a new plaintext key (e.g. after ensureApiKey)
  useEffect(() => {
    if (plaintextKey) setCurrentPlaintextKey(plaintextKey);
  }, [plaintextKey]);

  const isKeyLoading = !currentPlaintextKey && !apiKey;

  const displayKey = currentPlaintextKey
    ? currentPlaintextKey
    : apiKey
      ? `${apiKey.key_prefix}...****`
      : "";

  const cliCommand = `/setup-just-ship \\
  --board ${boardUrl} \\
  --key ${displayKey || "<loading...>"} \\
  --project ${project.id}`;

  const jsonConfig = JSON.stringify(
    {
      pipeline: {
        project_id: project.id,
        project_name: project.name,
        workspace_id: workspaceId,
        api_url: boardUrl,
        api_key: displayKey,
      },
    },
    null,
    2
  );

  async function copyToClipboard(text: string, type: CopiedTarget) {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  }

  function CopyButton({ target, text }: { target: CopiedTarget; text: string }) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-1 right-1 h-7 w-7"
        onClick={() => copyToClipboard(text, target)}
      >
        {copied === target ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    );
  }

  async function handleRegenerate() {
    setRegenerating(true);
    const newKey = await onRegenerateKey();
    if (newKey) setCurrentPlaintextKey(newKey);
    setRegenerating(false);
    setShowRegenConfirm(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Connect &ldquo;{project.name}&rdquo;</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* API Key Error */}
            {apiKeyError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 flex items-center justify-between gap-3">
                <p className="text-sm text-destructive">{apiKeyError}</p>
                <Button variant="outline" size="sm" onClick={onRetryApiKey}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Retry
                </Button>
              </div>
            )}

            {/* First time setup (collapsible) */}
            <Collapsible open={firstTimeOpen} onOpenChange={setFirstTimeOpen}>
              <CollapsibleTrigger className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
                {firstTimeOpen ? "\u25BE" : "\u25B8"} First time? Install the pipeline first
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-3">
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">1. Prerequisites</p>
                    <p className="text-xs text-muted-foreground">
                      You need{" "}
                      <a
                        href="https://claude.com/claude-code"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-0.5"
                      >
                        Claude Code
                        <ExternalLink className="h-3 w-3" />
                      </a>{" "}
                      installed and running.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">2. Install pipeline in your project</p>
                    <div className="relative">
                      <pre className="text-xs bg-background rounded p-3 whitespace-pre-wrap break-all pr-9">
                        {INSTALL_COMMAND}
                      </pre>
                      <CopyButton target="install" text={INSTALL_COMMAND} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <a
                        href="https://github.com/yves-s/just-ship"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-0.5"
                      >
                        GitHub Repository
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">3. Then run the connect command below</p>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Connect command (CLI) */}
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
              <p className="text-sm font-medium">
                Run this in your project terminal (inside Claude Code):
              </p>
              {isKeyLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background rounded p-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Generating API key...
                </div>
              ) : (
                <div className="relative">
                  <pre className="text-xs bg-background rounded p-3 whitespace-pre-wrap break-all pr-9">
                    {cliCommand}
                  </pre>
                  <CopyButton target="cli" text={cliCommand} />
                </div>
              )}
            </div>

            {/* Manual JSON (collapsible) */}
            <Collapsible open={manualOpen} onOpenChange={setManualOpen}>
              <CollapsibleTrigger className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                {manualOpen ? "\u25BE" : "\u25B8"} Manual: add to project.json
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <div className="relative">
                  <pre className="text-xs bg-muted rounded p-3 whitespace-pre-wrap break-all pr-9">
                    {jsonConfig}
                  </pre>
                  <CopyButton target="json" text={jsonConfig} />
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Project UUID + API Key management */}
            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <span>Project ID:</span>
                  <code className="text-xs font-mono">{project.id}</code>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => copyToClipboard(project.id, "uuid")}
                  title="Copy project UUID"
                >
                  {copied === "uuid" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  API Key: <code className="text-xs">{apiKey?.key_prefix ?? "\u2014"}...****</code>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowRegenConfirm(true)}
                  disabled={regenerating}
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${regenerating ? "animate-spin" : ""}`} />
                  Regenerate Key
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Later
            </Button>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Regenerate Confirmation */}
      <AlertDialog open={showRegenConfirm} onOpenChange={setShowRegenConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Regenerate API Key?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>The current key will be revoked immediately. After regenerating:</p>
                <ul className="list-disc pl-4 space-y-1 text-sm">
                  <li>All connected projects need the new key</li>
                  <li>
                    Run{" "}
                    <code className="text-xs">/setup-just-ship --board ... --key &lt;new-key&gt;</code>{" "}
                    in each project
                  </li>
                  <li>
                    Or replace <code className="text-xs">api_key</code> in{" "}
                    <code className="text-xs">project.json</code> manually
                  </li>
                  <li>Restart VPS worker if active</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRegenerate}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Regenerate Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
