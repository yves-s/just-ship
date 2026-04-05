/**
 * Vercel Preview URL Poller
 *
 * Polls the Vercel Deployments API until a preview deployment matching a given
 * branch reaches READY state. Used by the QA pipeline to obtain a testable URL.
 */

// Defined locally until config.ts is updated with QA support
export interface QaConfig {
  maxFixIterations: number;
  playwrightTimeoutMs: number;
  previewProvider: "vercel" | "none";
  vercelProjectId: string;
  vercelTeamId: string;
  vercelPreviewPollIntervalMs: number;
  vercelPreviewMaxWaitMs: number;
}

interface VercelDeploymentMeta {
  githubCommitRef?: string;
  [key: string]: unknown;
}

import { sleep } from "./utils.ts";
import { logger } from "./logger.ts";

interface VercelDeployment {
  uid: string;
  url: string;
  readyState: "QUEUED" | "BUILDING" | "READY" | "ERROR" | "CANCELED";
  meta: VercelDeploymentMeta;
}

interface VercelDeploymentsResponse {
  deployments: VercelDeployment[];
}

// sleep() imported from ./utils.ts

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
    logger.warn("VERCEL_TOKEN not set -- skipping preview poll");
    return null;
  }

  const {
    vercelProjectId,
    vercelTeamId,
    vercelPreviewPollIntervalMs,
    vercelPreviewMaxWaitMs,
  } = qaConfig;

  const startTime = Date.now();

  logger.info({ branch: branchName, vercelProjectId }, "Waiting for Vercel preview deployment");

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
        logger.debug({ status: res.status, retryMs: vercelPreviewPollIntervalMs }, "Vercel API returned non-OK status, retrying");
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
          logger.info({ previewUrl }, "Vercel deployment ready");
          return previewUrl;
        }

        if (match.readyState === "ERROR") {
          logger.warn({ uid: match.uid }, "Vercel deployment failed -- aborting");
          return null;
        }

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        logger.debug({ readyState: match.readyState, elapsedSeconds: elapsed }, "Vercel deployment polling");
      } else {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        logger.debug({ branch: branchName, elapsedSeconds: elapsed }, "No Vercel deployment found for branch, polling");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.debug({ message }, "Vercel poll error -- retrying");
    }

    await sleep(vercelPreviewPollIntervalMs);
  }

  logger.warn({ timeoutMs: vercelPreviewMaxWaitMs }, "Timed out waiting for Vercel preview deployment");
  return null;
}
