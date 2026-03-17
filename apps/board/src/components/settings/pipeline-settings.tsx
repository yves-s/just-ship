"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { Workspace } from "@/lib/types";

interface PipelineSettingsProps {
  workspace: Workspace;
  currentApiKey: string | null;
}

export function PipelineSettings({ workspace, currentApiKey }: PipelineSettingsProps) {
  const [vpsUrl, setVpsUrl] = useState(workspace.vps_url ?? "");
  const [vpsApiKey, setVpsApiKey] = useState(currentApiKey ?? "");
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSave() {
    setSaving(true);
    setServerError(null);
    setSuccess(false);

    const supabase = createClient();
    const { error } = await supabase
      .from("workspaces")
      .update({
        vps_url: vpsUrl.trim() || null,
        vps_api_key: vpsApiKey.trim() || null,
      })
      .eq("id", workspace.id);

    setSaving(false);

    if (error) {
      setServerError(error.message);
      return;
    }

    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  }

  async function handleTest() {
    if (!vpsUrl.trim()) {
      setTestResult({ ok: false, message: "Enter a VPS URL first" });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const res = await fetch(`${vpsUrl.replace(/\/$/, "")}/health`, {
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        setTestResult({
          ok: true,
          message: `Connected — ${(data as Record<string, unknown>).running_count ?? 0} pipelines running`,
        });
      } else {
        setTestResult({ ok: false, message: `Server responded with status ${res.status}` });
      }
    } catch {
      setTestResult({ ok: false, message: "Could not reach VPS server" });
    }

    setTesting(false);
  }

  const isDirty =
    vpsUrl !== (workspace.vps_url ?? "") ||
    vpsApiKey !== (currentApiKey ?? "");

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Pipeline Server (VPS)</CardTitle>
          <CardDescription>
            Configure the VPS server that runs your autonomous development pipeline.
            The Play button on tickets will send requests to this server.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 max-w-lg">
            {serverError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {serverError}
              </p>
            )}
            {success && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                Pipeline settings saved.
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vps-url">Server URL</Label>
              <div className="flex gap-2">
                <Input
                  id="vps-url"
                  value={vpsUrl}
                  onChange={(e) => setVpsUrl(e.target.value)}
                  placeholder="http://your-vps:3001"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={testing || !vpsUrl.trim()}
                  className="shrink-0"
                >
                  {testing ? "Testing…" : "Test"}
                </Button>
              </div>
              {testResult && (
                <p
                  className={`text-xs ${testResult.ok ? "text-emerald-600" : "text-destructive"}`}
                >
                  {testResult.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vps-key">Server API Key</Label>
              <Input
                id="vps-key"
                type="password"
                value={vpsApiKey}
                onChange={(e) => setVpsApiKey(e.target.value)}
                placeholder="PIPELINE_SERVER_KEY from VPS .env"
              />
              <p className="text-xs text-muted-foreground">
                The PIPELINE_SERVER_KEY configured on your VPS server.
              </p>
            </div>

            <Button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="self-start"
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
