/**
 * Shared server-side Supabase REST helper for pipeline/server.ts and new store modules.
 * Does NOT replace the private helpers in worker.ts (out of scope — see ticket T-924).
 *
 * Config: SUPABASE_URL + SUPABASE_SERVICE_KEY from env. Timeout 10s.
 * Retry: POST/PATCH retry 3x on 5xx/network. No retry on 4xx. GET/DELETE no retry.
 *
 * Test seam: pass a `deps` object with a custom `fetchFn` to stub HTTP in tests.
 * The default falls back to global `fetch`.
 */

import { logger } from "./logger.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SupabaseRestOptions {
  /** When true, adds Accept: application/vnd.pgrst.object+json so PostgREST
   *  returns a single object rather than an array. */
  expectSingle?: boolean;
  /** Injected in tests to stub the HTTP layer. Defaults to global fetch. */
  fetchFn?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  }
  return { url, key };
}

// ---------------------------------------------------------------------------
// Internal fetch wrapper
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 10_000;
const MAX_RETRY_ATTEMPTS = 3;

function baseHeaders(key: string, opts: SupabaseRestOptions): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (opts.expectSingle) {
    headers.Accept = "application/vnd.pgrst.object+json";
  }
  return headers;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * GET a resource from Supabase REST.
 * Returns null on HTTP error or network failure (best-effort semantics).
 */
export async function supabaseGet<T>(
  path: string,
  opts: SupabaseRestOptions = {},
): Promise<T | null> {
  const { url, key } = getConfig();
  const fetchFn = opts.fetchFn ?? fetch;

  try {
    const res = await fetchFn(`${url}${path}`, {
      headers: baseHeaders(key, opts),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.debug({ path, status: res.status }, "supabaseGet non-ok response");
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.debug({ path, err: err instanceof Error ? err.message : String(err) }, "supabaseGet error");
    return null;
  }
}

/**
 * POST to Supabase REST with retry on 5xx/network errors.
 * Returns null after exhausting retries.
 */
export async function supabasePost<T>(
  path: string,
  body: unknown,
  opts: SupabaseRestOptions = {},
): Promise<T | null> {
  const { url, key } = getConfig();
  const fetchFn = opts.fetchFn ?? fetch;

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetchFn(`${url}${path}`, {
        method: "POST",
        headers: {
          ...baseHeaders(key, opts),
          Prefer: "return=representation",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.ok) return (await res.json()) as T;

      if (res.status >= 400 && res.status < 500) {
        const text = await res.text().catch(() => "");
        logger.debug({ path, status: res.status, body: text.slice(0, 200) }, "supabasePost 4xx — not retrying");
        return null;
      }

      // 5xx — retry
      if (attempt < MAX_RETRY_ATTEMPTS) {
        logger.debug({ path, status: res.status, attempt }, "supabasePost 5xx — retrying");
        await sleep(1000 * attempt);
      }
    } catch (err) {
      if (attempt < MAX_RETRY_ATTEMPTS) {
        logger.debug({ path, err: err instanceof Error ? err.message : String(err), attempt }, "supabasePost network error — retrying");
        await sleep(1000 * attempt);
      } else {
        logger.error({ path, err: err instanceof Error ? err.message : String(err) }, "supabasePost failed after max retries");
      }
    }
  }

  logger.error({ path }, `supabasePost FAILED after ${MAX_RETRY_ATTEMPTS} attempts`);
  return null;
}

/**
 * PATCH a resource in Supabase REST with retry on 5xx/network errors.
 * Returns null after exhausting retries.
 */
export async function supabasePatch<T>(
  path: string,
  body: unknown,
  opts: SupabaseRestOptions = {},
): Promise<T | null> {
  const { url, key } = getConfig();
  const fetchFn = opts.fetchFn ?? fetch;

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetchFn(`${url}${path}`, {
        method: "PATCH",
        headers: {
          ...baseHeaders(key, opts),
          Prefer: "return=representation",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.ok) return (await res.json()) as T;

      if (res.status >= 400 && res.status < 500) {
        const text = await res.text().catch(() => "");
        logger.debug({ path, status: res.status, body: text.slice(0, 200) }, "supabasePatch 4xx — not retrying");
        return null;
      }

      if (attempt < MAX_RETRY_ATTEMPTS) {
        logger.debug({ path, status: res.status, attempt }, "supabasePatch 5xx — retrying");
        await sleep(1000 * attempt);
      }
    } catch (err) {
      if (attempt < MAX_RETRY_ATTEMPTS) {
        logger.debug({ path, err: err instanceof Error ? err.message : String(err), attempt }, "supabasePatch network error — retrying");
        await sleep(1000 * attempt);
      } else {
        logger.error({ path, err: err instanceof Error ? err.message : String(err) }, "supabasePatch failed after max retries");
      }
    }
  }

  logger.error({ path }, `supabasePatch FAILED after ${MAX_RETRY_ATTEMPTS} attempts`);
  return null;
}

/**
 * DELETE a resource in Supabase REST.
 * Returns true on 2xx, false otherwise. No retry (deletes are idempotent;
 * retrying a 404 would mask a real bug in the caller).
 */
export async function supabaseDelete(
  path: string,
  opts: SupabaseRestOptions = {},
): Promise<boolean> {
  const { url, key } = getConfig();
  const fetchFn = opts.fetchFn ?? fetch;

  try {
    const res = await fetchFn(`${url}${path}`, {
      method: "DELETE",
      headers: baseHeaders(key, opts),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.debug({ path, status: res.status }, "supabaseDelete non-ok response");
      return false;
    }
    return true;
  } catch (err) {
    logger.debug({ path, err: err instanceof Error ? err.message : String(err) }, "supabaseDelete error");
    return false;
  }
}
