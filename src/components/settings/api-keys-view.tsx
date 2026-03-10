"use client";

import { useState } from "react";
import { Plus, Key } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { CreateApiKeyDialog } from "./create-api-key-dialog";
import type { ApiKey } from "@/lib/types";

interface ApiKeysViewProps {
  apiKeys: ApiKey[];
  workspaceId: string;
}

function formatDate(date: string | null | undefined): string {
  if (!date) return "Never";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ApiKeysView({ apiKeys: initialKeys, workspaceId }: ApiKeysViewProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [keys, setKeys] = useState<ApiKey[]>(initialKeys);

  function handleCreated() {
    // The new key list will be fetched on next page load (router.refresh from parent)
    // For now, just close the dialog — parent can refresh
  }

  const activeKeys = keys.filter((k) => !k.revoked_at);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>API keys</CardTitle>
            <CardDescription>
              Keys for authenticating the pipeline API. Prefix:{" "}
              <code className="font-mono text-xs">adp_</code>
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New key
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {activeKeys.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState
                icon={<Key className="h-8 w-8" />}
                title="No API keys"
                description="Create an API key to authenticate pipeline requests."
                action={
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4" />
                    New key
                  </Button>
                }
              />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-6 py-3 text-left font-medium">Name</th>
                  <th className="px-3 py-3 text-left font-medium">Prefix</th>
                  <th className="px-3 py-3 text-left font-medium">Created</th>
                  <th className="px-3 py-3 text-left font-medium">Last used</th>
                </tr>
              </thead>
              <tbody>
                {activeKeys.map((key) => (
                  <tr key={key.id} className="border-b last:border-0">
                    <td className="px-6 py-3 font-medium">{key.name}</td>
                    <td className="px-3 py-3">
                      <code className="font-mono text-xs text-muted-foreground">
                        {key.key_prefix}…
                      </code>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground text-xs">
                      {formatDate(key.created_at)}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground text-xs">
                      {formatDate(key.last_used_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <CreateApiKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
        onCreated={handleCreated}
      />
    </div>
  );
}
