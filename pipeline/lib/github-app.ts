/**
 * GitHub App authentication for the just-ship pipeline.
 *
 * Generates short-lived Installation Tokens from a registered GitHub App,
 * replacing static PATs. Falls back gracefully to GH_TOKEN when not configured.
 *
 * Token lifecycle:
 *   1. loadGitHubAppConfig() — reads env vars at startup
 *   2. getInstallationToken() — generates JWT, requests token, caches with TTL
 *   3. resolveGitHubToken() — priority chain: installation > explicit > GH_TOKEN env
 */

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { logger } from "./logger.ts";

export interface GitHubAppConfig {
  appId: string;
  privateKey: string; // PEM content (not file path)
}

export interface InstallationToken {
  token: string;
  expiresAt: Date;
}

// In-memory token cache keyed by installation_id
const tokenCache = new Map<number, InstallationToken>();

// Margin before expiry to refresh (5 minutes)
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Generate a JWT for GitHub App authentication.
 * The JWT is signed with RS256 using the app's private key.
 * Valid for 10 minutes (GitHub max).
 */
export function generateAppJwt(config: GitHubAppConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 60,    // Issued 60s ago (clock skew)
    exp: now + 600,   // Expires in 10 min
    iss: config.appId,
  };

  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encHeader}.${encPayload}`;

  const sign = createSign("RSA-SHA256");
  sign.update(signingInput);
  sign.end();
  const signature = sign.sign(config.privateKey, "base64url");

  return `${signingInput}.${signature}`;
}

function base64url(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Fetch an installation access token from GitHub.
 * Caches tokens and refreshes when < 5min TTL remaining.
 */
export async function getInstallationToken(
  config: GitHubAppConfig,
  installationId: number,
): Promise<string> {
  // Check cache
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
    return cached.token;
  }

  // Generate JWT and request new token
  const jwt = generateAppJwt(config);
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const msg = `GitHub installation token request failed: HTTP ${res.status} — ${body}`;
    logger.error({ installationId, status: res.status }, msg);
    throw new Error(msg);
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  const token: InstallationToken = {
    token: data.token,
    expiresAt: new Date(data.expires_at),
  };

  tokenCache.set(installationId, token);
  logger.info(
    { installationId, expiresAt: data.expires_at },
    "GitHub installation token generated",
  );

  return token.token;
}

/**
 * Load GitHub App config from environment variables.
 * Returns null if not configured (PAT mode).
 */
export function loadGitHubAppConfig(): GitHubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  const privateKeyEnv = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId) return null;

  let privateKey: string;
  if (privateKeyEnv) {
    // Key passed directly (e.g. in Docker secrets, base64-decoded)
    privateKey = privateKeyEnv;
  } else if (privateKeyPath) {
    try {
      privateKey = readFileSync(privateKeyPath, "utf-8");
    } catch (err) {
      logger.error(
        { path: privateKeyPath, err: err instanceof Error ? err.message : String(err) },
        "Failed to read GitHub App private key",
      );
      return null;
    }
  } else {
    logger.warn(
      "GITHUB_APP_ID set but no private key provided (GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH)",
    );
    return null;
  }

  return { appId, privateKey };
}

/**
 * Resolve a GitHub token for pipeline use.
 * Priority: 1) installation_id -> generate token, 2) explicit github_token, 3) GH_TOKEN env
 *
 * Returns the token string or null if no auth available.
 */
export async function resolveGitHubToken(opts: {
  installationId?: number;
  githubToken?: string;
  appConfig?: GitHubAppConfig | null;
}): Promise<string | null> {
  const { installationId, githubToken, appConfig } = opts;

  // Priority 1: Installation token from GitHub App
  if (installationId && appConfig) {
    try {
      return await getInstallationToken(appConfig, installationId);
    } catch (err) {
      logger.error(
        { installationId, err: err instanceof Error ? err.message : String(err) },
        "Failed to generate installation token, falling back to PAT",
      );
      // Fall through to PAT
    }
  }

  // Priority 2: Explicit token (from launch payload or env override)
  if (githubToken) return githubToken;

  // Priority 3: Environment PAT
  return process.env.GH_TOKEN ?? null;
}

/**
 * Clear the token cache (useful for testing or when installations are revoked).
 */
export function clearTokenCache(): void {
  tokenCache.clear();
}
