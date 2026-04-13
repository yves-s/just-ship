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

import { execSync } from "node:child_process";

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
 * Resolve the PR number for the current branch via `gh pr view`.
 * Returns 0 if no PR is found or gh is unavailable.
 */
async function resolvePrNumber(): Promise<number> {
  try {
    const output = execSync("gh pr view --json number -q .number", {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const num = parseInt(output, 10);
    return Number.isNaN(num) ? 0 : num;
  } catch {
    return 0;
  }
}

/**
 * Wait for a Coolify deployment matching the given branch to reach "finished" state.
 *
 * Returns the application's FQDN (the production or preview URL) or null if:
 * - COOLIFY_API_TOKEN is not set
 * - The deployment enters "failed" state
 * - The maximum wait time is exceeded
 *
 * Fallback: If the deployments API returns no data (known issue with some Coolify
 * v4 beta versions), constructs the preview URL directly from the app's
 * preview_url_template and the current PR number.
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

  // Step 1: Get application details (needed for both poll and fallback)
  let app: CoolifyApp | null = null;
  try {
    const appRes = await fetch(
      `${baseUrl}/api/v1/applications/${config.coolifyAppUuid}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (appRes.ok) {
      app = (await appRes.json()) as CoolifyApp;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[coolify-preview] App API error: ${message}`);
  }

  if (!app?.fqdn) {
    console.error("[coolify-preview] Could not fetch app details or no FQDN set");
    return null;
  }

  // Capture narrowed values after guard — avoids repeated non-null assertions below
  const fqdn = app.fqdn;
  const appName = app.name;

  // Step 2: Poll deployments API using the configured max wait time.
  // Resetting the timer here ensures the app fetch latency (up to 10s) does not eat
  // into the deployment poll window.
  const pollStart = Date.now();
  const deployPollMax = config.coolifyMaxWaitMs;

  while (Date.now() - pollStart < deployPollMax) {
    try {
      if (appName) {
        const deploymentsRes = await fetch(
          `${baseUrl}/api/v1/deployments`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
          },
        );

        if (deploymentsRes.ok) {
          const allDeployments = (await deploymentsRes.json()) as CoolifyDeployment[];
          const appDeployments = allDeployments.filter(
            (d) => d.application_name === appName,
          );
          const latest = appDeployments[0];

          if (latest) {
            if (latest.status === "finished") {
              const previewUrl = buildPreviewUrl(fqdn, latest.pull_request_id, app.preview_url_template);
              console.error(`[coolify-preview] Deployment ready: ${previewUrl}`);
              return previewUrl;
            }

            if (latest.status === "failed" || latest.status === "cancelled") {
              console.error(
                `[coolify-preview] Deployment ${latest.status} (uuid: ${latest.deployment_uuid}) -- aborting`,
              );
              return null;
            }

            const elapsed = Math.round((Date.now() - pollStart) / 1000);
            console.error(
              `[coolify-preview] Deployment status: ${latest.status} (${elapsed}s elapsed) -- polling`,
            );
          } else {
            const elapsed = Math.round((Date.now() - pollStart) / 1000);
            console.error(
              `[coolify-preview] No deployments found for "${appName}" (${elapsed}s elapsed) -- polling`,
            );
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[coolify-preview] Poll error: ${message} -- retrying`);
    }

    await sleep(config.coolifyPollIntervalMs);
  }

  // Step 3: Fallback — construct URL from template + PR number
  // Handles Coolify v4 betas where /api/v1/deployments returns empty arrays
  if (app.preview_url_template) {
    const prNumber = await resolvePrNumber();
    if (prNumber > 0) {
      const previewUrl = buildPreviewUrl(fqdn, prNumber, app.preview_url_template);
      console.error(`[coolify-preview] Deployments API empty -- constructed URL from template: ${previewUrl}`);
      return previewUrl;
    }
  }

  // No PR found or no template — return production FQDN
  console.error(`[coolify-preview] No PR deployment found -- returning production FQDN`);
  return fqdn;
}
