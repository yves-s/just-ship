/**
 * Coolify Preview URL Poller
 *
 * Polls the Coolify v4 Deployments API until a deployment matching a given
 * application reaches "finished" state. Used by the QA pipeline to obtain a testable URL.
 *
 * Coolify v4 Beta does NOT support `GET /api/v1/applications/{uuid}/deployments`.
 * Instead we use:
 *   - `GET /api/v1/applications/{uuid}` for app details (fqdn, name, preview_url_template)
 *   - `GET /api/v1/deployments` for all recent deployments, filtered by application_name
 */

import { sleep } from "./utils.ts";

export interface CoolifyConfig {
  coolifyUrl: string;
  coolifyAppUuid: string;
  coolifyPollIntervalMs: number;
  coolifyMaxWaitMs: number;
}

/** Shape returned by GET /api/v1/applications/{uuid} */
interface CoolifyApp {
  uuid: string;
  name: string;
  fqdn?: string;
  preview_url_template?: string;
}

/** Shape returned by GET /api/v1/deployments (array items) */
interface CoolifyDeployment {
  id: number;
  application_id: string;
  application_name: string;
  deployment_uuid: string;
  status: string; // "queued" | "in_progress" | "finished" | "failed" | "cancelled"
  pull_request_id: number;
  created_at: string;
}

/**
 * Build the preview URL for a deployment.
 *
 * For PR deployments (pull_request_id > 0), uses Coolify's preview_url_template
 * to construct the URL. The template uses `{{pr_id}}` and `{{domain}}` placeholders.
 * Example: template "board-{{pr_id}}.preview.just-ship.io" with PR 126 and
 * fqdn "https://board.just-ship.io" → "https://board-126.preview.just-ship.io"
 *
 * For non-PR deployments, returns the production FQDN as-is.
 */
function buildPreviewUrl(
  fqdn: string,
  pullRequestId: number,
  previewUrlTemplate?: string,
): string {
  if (pullRequestId > 0 && previewUrlTemplate) {
    const domain = fqdn.replace(/^https?:\/\//, "");
    const previewDomain = previewUrlTemplate
      .replace(/\{\{pr_id\}\}/g, String(pullRequestId))
      .replace(/\{\{domain\}\}/g, domain);
    return `https://${previewDomain}`;
  }
  return fqdn;
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
      // Step 1: Get application details for FQDN, name, and preview_url_template
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

      const app = (await appRes.json()) as CoolifyApp;

      if (!app.name) {
        console.error("[coolify-preview] App has no name field -- retrying");
        await sleep(config.coolifyPollIntervalMs);
        continue;
      }

      // Step 2: Fetch all deployments and filter by application_name
      const deploymentsRes = await fetch(
        `${baseUrl}/api/v1/deployments`,
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

      const allDeployments = (await deploymentsRes.json()) as CoolifyDeployment[];

      // Filter to deployments for our application
      const appDeployments = allDeployments.filter(
        (d) => d.application_name === app.name,
      );

      // Take the most recent deployment (API returns newest first)
      const latest = appDeployments[0];

      if (latest) {
        if (latest.status === "finished") {
          const fqdn = app.fqdn || null;
          if (fqdn) {
            const previewUrl = buildPreviewUrl(fqdn, latest.pull_request_id, app.preview_url_template);
            console.error(`[coolify-preview] Deployment ready: ${previewUrl}`);
            return previewUrl;
          }
          console.error("[coolify-preview] Deployment finished but no FQDN set");
          return null;
        }

        if (latest.status === "failed" || latest.status === "cancelled") {
          console.error(
            `[coolify-preview] Deployment ${latest.status} (uuid: ${latest.deployment_uuid}) -- aborting`,
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
          `[coolify-preview] No deployments found for "${app.name}" (${elapsed}s elapsed) -- polling`,
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
