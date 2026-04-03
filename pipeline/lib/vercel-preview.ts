/**
 * Vercel Preview URL Poller
 *
 * Polls the Vercel Deployments API until a preview deployment matching a given
 * branch reaches READY state. Used by the QA pipeline to obtain a testable URL.
 */

import type { QaConfig } from "./config.ts";
import { sleep } from "./utils.ts";

interface VercelDeploymentMeta {
  githubCommitRef?: string;
  [key: string]: unknown;
}

interface VercelDeployment {
  uid: string;
  url: string;
  readyState: "QUEUED" | "BUILDING" | "READY" | "ERROR" | "CANCELED";
  meta: VercelDeploymentMeta;
}

interface VercelDeploymentsResponse {
  deployments: VercelDeployment[];
}

/**
 * Wait for a Vercel preview deployment matching the given branch to become READY.
 *
 * Returns the preview URL (e.g. `https://<deployment-url>`) or null if:
 * - The provider is not "vercel" or the project ID is missing
 * - VERCEL_TOKEN is not set
 * - The deployment enters ERROR state
 * - The maximum wait time is exceeded
 */
export async function waitForVercelPreview(
  branchName: string,
  qaConfig: QaConfig,
): Promise<string | null> {
  // Guard: only proceed for Vercel provider with a valid project ID
  if (qaConfig.previewProvider !== "vercel" || !qaConfig.vercelProjectId) {
    return null;
  }

  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    console.error("[vercel-preview] VERCEL_TOKEN not set -- skipping preview poll");
    return null;
  }

  const {
    vercelProjectId,
    vercelTeamId,
    vercelPreviewPollIntervalMs,
    vercelPreviewMaxWaitMs,
  } = qaConfig;

  const startTime = Date.now();

  console.error(
    `[vercel-preview] Waiting for preview deployment (branch: ${branchName}, project: ${vercelProjectId})`,
  );

  while (Date.now() - startTime < vercelPreviewMaxWaitMs) {
    try {
      const params = new URLSearchParams({
        projectId: vercelProjectId,
        limit: "5",
      });
      if (vercelTeamId) {
        params.set("teamId", vercelTeamId);
      }

      const res = await fetch(
        `https://api.vercel.com/v6/deployments?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!res.ok) {
        console.error(
          `[vercel-preview] API returned ${res.status} -- retrying in ${vercelPreviewPollIntervalMs}ms`,
        );
        await sleep(vercelPreviewPollIntervalMs);
        continue;
      }

      const data = (await res.json()) as VercelDeploymentsResponse;
      const match = data.deployments.find(
        (d) => d.meta?.githubCommitRef === branchName,
      );

      if (match) {
        if (match.readyState === "READY") {
          const previewUrl = `https://${match.url}`;
          console.error(`[vercel-preview] Deployment ready: ${previewUrl}`);
          return previewUrl;
        }

        if (match.readyState === "ERROR") {
          console.error(
            `[vercel-preview] Deployment failed (uid: ${match.uid}) -- aborting`,
          );
          return null;
        }

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.error(
          `[vercel-preview] Deployment state: ${match.readyState} (${elapsed}s elapsed) -- polling`,
        );
      } else {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.error(
          `[vercel-preview] No deployment found for branch "${branchName}" (${elapsed}s elapsed) -- polling`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[vercel-preview] Poll error: ${message} -- retrying`);
    }

    await sleep(vercelPreviewPollIntervalMs);
  }

  console.error(
    `[vercel-preview] Timed out after ${vercelPreviewMaxWaitMs}ms waiting for preview`,
  );
  return null;
}
