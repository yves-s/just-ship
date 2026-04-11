---
name: backend
description: Use when implementing API endpoints, server-side business logic, webhook handlers, event pipelines, shared hooks, or backend integrations. Also triggers for queue-based processing, background jobs, third-party API integrations, or any server-side data flow. This skill builds production-grade backend code — not just working code, but code that handles failure, observes itself, and stays reliable at 3am. Use proactively on every backend task, even simple CRUD endpoints — because every endpoint eventually becomes critical.
triggers:
  - api
  - endpoint
  - webhook
  - backend
  - server
  - queue
  - integration
---

# Backend Engineering

You build backend systems like a senior engineer who has been woken up at 3am by their own code. Every handler you write must be debuggable without you being there. Every external call must handle failure. Every state change must be traceable.

## Core Philosophy

**Working is not shipping.** An endpoint that returns the right data in the happy path is a prototype. An endpoint that handles failure, logs context, validates input, and degrades gracefully is production code. Write production code from the start.

**Every external call will fail.** Databases go slow. APIs return 500s. Networks drop. Timeouts expire. The question is never "will this fail?" but "what happens to the user when it does?"

**Logs are your future self's only friend.** At 3am, the only context you have is what past-you logged. Make it count.

## Before You Write Code

Read the project first:
1. `CLAUDE.md` — backend stack, framework conventions, auth model
2. `project.json` — paths (backend, hooks, shared), build commands
3. Existing endpoints/handlers in the same area — match their patterns exactly

## API Design

### Request / Response Contract

Every endpoint validates input, returns consistent structure, and uses correct status codes:

```
200 OK          — success with data
201 Created     — resource created
204 No Content  — success, no body (DELETE)
400 Bad Request — client error (validation failed)
401 Unauthorized — not authenticated
403 Forbidden   — authenticated but not authorized
404 Not Found   — resource doesn't exist
409 Conflict    — idempotency conflict or state conflict
429 Too Many    — rate limited
500 Internal    — server error (log everything, expose nothing)
503 Unavailable — downstream dependency down (use for graceful degradation)
```

Use the project's existing response shape. Don't invent a new one.

### Input Validation

Validate at the boundary — before any business logic. Use Zod or equivalent for type-safe validation that generates both runtime checks and TypeScript types:

```typescript
const CreateOrderSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(100),
  couponCode: z.string().optional(),
});

// Validate early, fail fast
const parsed = CreateOrderSchema.safeParse(body);
if (!parsed.success) {
  return response(400, {
    error: "Validation failed",
    details: parsed.error.issues
  });
}
```

If invalid: return 400 immediately with specific field-level errors. Don't continue processing. Don't return generic "Invalid input".

## Structured Logging

`console.log` is not logging. Structured logging means every log entry is a queryable event with context.

### The Pattern

```typescript
// Use a logger that outputs structured JSON
logger.info("order.created", {
  orderId,
  customerId,
  amount,
  itemCount,
  durationMs: Date.now() - startTime,
});

logger.error("payment.failed", {
  orderId,
  customerId,
  provider: "stripe",
  errorCode: err.code,
  errorMessage: err.message,
  attempt: retryCount,
  willRetry: retryCount < MAX_RETRIES,
});
```

### What to Log

| Event | When | Context Fields |
|-------|------|---------------|
| `{domain}.{action}.started` | Before processing | requestId, userId, key input params |
| `{domain}.{action}.completed` | After success | requestId, result summary, durationMs |
| `{domain}.{action}.failed` | After failure | requestId, error details, attempt count, willRetry |
| `{domain}.external.called` | Every external API call | service, endpoint, durationMs, statusCode |
| `{domain}.external.failed` | External call failure | service, endpoint, error, attempt, willRetry |

### Correlation IDs

Every request gets a correlation ID that flows through the entire processing chain. If a webhook triggers an API call that triggers a DB write, all three logs share the same correlation ID.

```typescript
const correlationId = req.headers["x-correlation-id"] || crypto.randomUUID();
// Pass to all downstream calls and log entries
```

### What NOT to Log

- Passwords, tokens, API keys, session tokens
- Full credit card numbers (last 4 only)
- PII unless necessary (email → hash, name → initials)
- Full request/response bodies in production (too noisy, PII risk)

## Error Handling

```
NO HANDLER WITHOUT TRY/CATCH. NO CATCH WITHOUT CONTEXT.
```

```typescript
try {
  const startTime = Date.now();
  // business logic
  logger.info("order.created", { orderId, durationMs: Date.now() - startTime });
  return response(201, { data: order });
} catch (error) {
  logger.error("order.creation.failed", {
    customerId,
    error: error.message,
    stack: error.stack, // server-side only, never to client
  });

  // Distinguish client errors from server errors
  if (error instanceof ValidationError) {
    return response(400, { error: error.message });
  }
  if (error instanceof NotFoundError) {
    return response(404, { error: "Resource not found" });
  }
  // Default: server error — safe message to client
  return response(500, { error: "An unexpected error occurred" });
}
```

Never return stack traces, SQL errors, or internal details to the client. Log them server-side. Return a safe, descriptive message that helps the user ("Payment could not be processed — please try again") not the developer ("ECONNREFUSED 10.0.0.3:5432").

## Resilience Patterns

### External API Calls

Every call to an external service (Shopify, Klaviyo, Stripe, Strava, any third-party) must have:

**1. Timeouts** — Always set explicit timeouts. The default is usually "forever" which is never what you want.
```typescript
const response = await fetch(url, {
  signal: AbortSignal.timeout(5000) // 5s — adjust per service
});
```

**2. Retry with Exponential Backoff** — Transient failures (500, 503, network errors) should be retried. Client errors (400, 401, 404) should not.
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  { maxAttempts = 3, baseDelayMs = 1000 } = {}
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts || !isRetryable(error)) throw error;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
      await new Promise(r => setTimeout(r, delay));
      logger.warn("retry.attempt", { attempt, maxAttempts, delayMs: delay });
    }
  }
  throw new Error("Unreachable");
}
```

**3. Circuit Breaker** — If a service is consistently failing, stop calling it. Don't add load to an already-failing service.
- After N consecutive failures → open circuit → return fallback or 503
- After a cooldown period → half-open → try one request
- If it succeeds → close circuit → resume normal operation

**4. Graceful Degradation** — When a non-critical dependency fails, the core experience should still work.
- Recommendation service down → show popular items instead of personalized
- Analytics service down → process the request anyway, log the analytics failure
- Email service down → queue the email for later, don't fail the user action

### Idempotency

State-changing operations (create, update, delete) must handle duplicates gracefully. Network retries happen. Double-clicks happen. Webhook redelivery happens.

```typescript
// Client sends idempotency key in header
const idempotencyKey = req.headers["idempotency-key"];
if (idempotencyKey) {
  const existing = await db.idempotency_keys.findUnique({ key: idempotencyKey });
  if (existing) {
    logger.info("request.deduplicated", { idempotencyKey });
    return response(existing.statusCode, existing.responseBody);
  }
}

// Process the request...
// Store the result with the idempotency key
await db.idempotency_keys.create({
  key: idempotencyKey,
  statusCode: 201,
  responseBody: result,
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
});
```

## Webhook Handling

Webhooks are a specific pattern that requires special treatment:

**1. Validate signatures first** — Before parsing the body, verify the HMAC signature. No exceptions.
```typescript
const signature = req.headers["x-shopify-hmac-sha256"];
const isValid = verifyHmac(rawBody, signature, WEBHOOK_SECRET);
if (!isValid) {
  logger.warn("webhook.signature.invalid", { source: "shopify" });
  return response(401, { error: "Invalid signature" });
}
```

**2. Acknowledge fast, process async** — The sender expects 200 OK within 5 seconds. If processing takes longer, accept the webhook, queue it, and return 200 immediately.
```typescript
// Accept and queue
await queue.enqueue({ event: body, receivedAt: Date.now() });
return response(200, { status: "accepted" });

// Process in background worker
```

**3. Deduplication** — Webhooks are at-least-once. You will get duplicates. Use webhook ID + event type as deduplication key.

## Async Processing & Queues

For operations that don't need synchronous response (email sending, analytics, sync pipelines):

**Queue-based processing** decouples the request from the work:
- Sender doesn't wait for processing to complete
- Failed processing doesn't fail the user's request
- Retries happen automatically without user involvement
- Backpressure is handled (spike in events doesn't overwhelm downstream)

**Dead Letter Queue** — Events that fail after all retries go to a DLQ. Every event in the DLQ is a customer-impacting failure. Alert on DLQ size > 0.

**Reconciliation** — Queues lose messages. Webhooks get missed. Build a daily reconciliation job that compares source-of-truth with downstream state and corrects drift.

## Security

- [ ] Auth check before any data access — verify identity, then check permissions
- [ ] Ownership verification — users can only access their own resources
- [ ] Environment variables for all secrets — never in code, never in client bundles
- [ ] No PII in logs — hash emails, mask card numbers, redact tokens
- [ ] Parameterized queries only — never string concatenation for SQL
- [ ] Rate limiting on all public endpoints — not "considered" but implemented
- [ ] Webhook signature validation — on every incoming webhook, no exceptions
- [ ] CORS configured — only allow expected origins
- [ ] Input length limits — prevent oversized payloads from consuming resources

## Monitoring & Alerting

Define these for every service you build. Don't wait until something breaks.

| Metric | Alert Threshold | Why |
|--------|----------------|-----|
| Error rate (5xx) | > 1% over 5min | Something is broken |
| Latency p95 | > 2s (adjust per endpoint) | Users are waiting too long |
| External API error rate | > 5% over 15min | Downstream dependency degrading |
| Queue depth | > 100 unprocessed | Processing bottleneck |
| DLQ size | > 0 | Customer-impacting failures |
| Auth failure rate | > 10% over 5min | Possible attack or token issues |

## Code Organization

| Where | What |
|-------|------|
| `paths.hooks` (from project.json) | Shared data-fetching hooks |
| `paths.shared` (from project.json) | Types, utilities, constants |
| `paths.backend` (from project.json) | API handlers, server-only logic |

Never import server-only code in client components. Never import DB clients in shared code.

## Verify

- [ ] No TypeScript errors
- [ ] All edge cases handled (missing data, auth failure, DB error, external API down)
- [ ] Structured logging on every handler (not console.log)
- [ ] External calls have timeouts and retry logic
- [ ] Idempotency on state-changing operations
- [ ] No `any` types without justification
- [ ] No PII in logs
- [ ] Webhook handlers validate signatures

## Anti-Patterns

- `console.log("error")` — use structured logger with event name and context
- Returning 200 with error in body — use correct HTTP status codes
- Catching errors silently — always log with context and respond with safe message
- No timeout on external calls — always set explicit timeouts
- Synchronous webhook processing — acknowledge fast, process async
- "Retry later" without implementation — implement exponential backoff
- Rate limiting "considered" — either implement it or document why not
- `any` type — forbidden without comment explaining why
