import * as Sentry from "@sentry/node";

/**
 * Initialize Sentry/Bugsink error tracking.
 * Only activates if BUGSINK_DSN environment variable is set.
 */
export function initSentry(): void {
  const dsn = process.env.BUGSINK_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "production",
    // Low sample rate — we only care about errors, not performance
    tracesSampleRate: 0,
  });
}

export { Sentry };
