/**
 * Coolify Preview URL Poller
 *
 * Polls the Coolify Deployments API until a deployment matching a given
 * branch reaches "finished" state. Used by the QA pipeline to obtain a testable URL.
 */

import { sleep } from "./utils.ts";

export interface CoolifyConfig {
  coolifyUrl: string;
  coolifyAppUuid: string;
  coolifyPollIntervalMs: number;
  coolifyMaxWaitMs: number;
}

interface CoolifyDeployment {
  id: number;
  uuid: string;
  status: string; // "queued" | "in_progress" | "finished" | "failed" | "cancelled"
  commit_sha?: string;
  commit_message?: string;
  branch?: string;
  created_at: string;
}

/**
 * Wait for a Coolify deployment matching the given branch to reach "finished" state.
 *
 * Returns the application's FQDN (the production or preview URL) or null if:
 * - COOLIFY_API_TOKEN is not set
 * - The deployment enters "failed" state
 * - The maximum wait time is exceeded
 */
export async function waitForCoolifyPreview(
  branchName: string,
  config: CoolifyConfig,
): Promise<string | null> {
  const token = process.env.COOLIFY_API_TOKEN;
  if (!token) {
    console.error("[coolify-preview] COOLIFY_API_TOKEN not set -- skipping preview poll");
    return null;
  }

  if (!config.coolifyUrl || !config.coolifyAppUuid) {
    console.error("[coolify-preview] Missing coolify_url or coolify_app_uuid in config");
    return null;
  }

  const baseUrl = config.coolifyUrl.replace(/\/$/, "");
  const startTime = Date.now();

  console.error(
    `[coolify-preview] Waiting for deployment (branch: ${branchName}, app: ${config.coolifyAppUuid})`,
  );

  while (Date.now() - startTime < config.coolifyMaxWaitMs) {
    try {
      // Get application details for the FQDN
      const appRes = await fetch(
        `${baseUrl}/api/v1/applications/${config.coolifyAppUuid}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!appRes.ok) {
        console.error(
          `[coolify-preview] App API returned ${appRes.status} -- retrying in ${config.coolifyPollIntervalMs}ms`,
        );
        await sleep(config.coolifyPollIntervalMs);
        continue;
      }

      const app = (await appRes.json()) as { fqdn?: string; uuid: string };

      // Get recent deployments
      const deploymentsRes = await fetch(
        `${baseUrl}/api/v1/applications/${config.coolifyAppUuid}/deployments`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!deploymentsRes.ok) {
        console.error(
          `[coolify-preview] Deployments API returned ${deploymentsRes.status} -- retrying`,
        );
        await sleep(config.coolifyPollIntervalMs);
        continue;
      }

      const deployments = (await deploymentsRes.json()) as CoolifyDeployment[];

      // Find the most recent deployment (Coolify deploys on push, so the latest is ours)
      const latest = deployments[0];

      if (latest) {
        if (latest.status === "finished") {
          const previewUrl = app.fqdn || null;
          if (previewUrl) {
            console.error(`[coolify-preview] Deployment ready: ${previewUrl}`);
            return previewUrl;
          }
          console.error("[coolify-preview] Deployment finished but no FQDN set");
          return null;
        }

        if (latest.status === "failed" || latest.status === "cancelled") {
          console.error(
            `[coolify-preview] Deployment ${latest.status} (uuid: ${latest.uuid}) -- aborting`,
          );
          return null;
        }

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.error(
          `[coolify-preview] Deployment status: ${latest.status} (${elapsed}s elapsed) -- polling`,
        );
      } else {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.error(
          `[coolify-preview] No deployments found (${elapsed}s elapsed) -- polling`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[coolify-preview] Poll error: ${message} -- retrying`);
    }

    await sleep(config.coolifyPollIntervalMs);
  }

  console.error(
    `[coolify-preview] Timed out after ${config.coolifyMaxWaitMs}ms waiting for deployment`,
  );
  return null;
}
