# Lens 06 — Reliability / SRE Audit

**Auditor perspective:** Reliability / SRE engineer
**Scope:** Uptime, graceful degradation, error handling, retry logic, circuit breakers, timeouts, health checks, observability, recovery from failures
**Date:** 2026-04-16

---

## Executive Summary

Foundry has **zero resilience infrastructure** on its most critical dependency (Anthropic Claude API) and its database layer (Turso). The GitHub audit service is the only external caller with retry logic. No circuit breakers exist anywhere. No graceful shutdown. The health check is a static JSON response that checks nothing. 55+ scheduled jobs run without concurrency control, dead-letter queues, or alerting. A single Anthropic outage would cascade into silent failures across SCP agent runs, daily insights, weekly plans, morning briefings, competitive scans, and every conversation thread -- with no user-facing degradation signal.

**P0 findings:** 2
**P1 findings:** 11
**P2 findings:** 6
**P3 findings:** 3

---

## Finding 01 — Anthropic API calls: no retry, no timeout, no circuit breaker

**Severity: P1**
**File:** `src/services/ai/client.ts`

Every Claude API call (`callClaude`, `callOpus`, `callSonnet`, `callClaudeMultiTurn`) goes through `client.messages.create()` with zero protective wrappers:

- **No timeout.** The Anthropic SDK defaults to no explicit timeout. An Opus call with 8192 max tokens can hang indefinitely if the Anthropic service is degraded. There is no `AbortSignal.timeout()` or SDK-level `timeout` option set.
- **No retry.** The Anthropic SDK has built-in retry for 5xx/429, but the code does not configure `maxRetries` or verify the defaults are appropriate. No jittered backoff on transient failures.
- **No circuit breaker.** If Anthropic returns 500 for 30 minutes, every SCP agent, every conversation, every digest, and every competitive scan will individually fail and log to console -- 50+ products times 12 agents = 600+ error log lines per hour with no short-circuit.
- **No budget/rate cap.** Nothing prevents cost runaway from hot retry loops if the SDK's built-in retry is active.
- **No fallback.** When Opus is down, there is no fallback to Sonnet (or vice versa), no cached response, no degraded-but-useful output.

The `callClaude` function is called from at least 15 files: all 12 SCP agents, `daily_insight_generate`, `weekly_plan_generate`, `competitive_scan`, `scenario_accuracy`, `morning_briefings`, `conversation/ask`, and the audit engine.

**Impact:** Anthropic outage = total platform intelligence failure with no user indication beyond "Unable to answer right now" on conversation threads. Background jobs silently fail. No alerts.

**Remediation:**
1. Set explicit `timeout` on the Anthropic client (e.g., 60s for Opus, 30s for Sonnet).
2. Configure `maxRetries: 3` with jittered exponential backoff.
3. Implement a circuit breaker: after N consecutive failures in M minutes, skip AI calls and return a cached/default response.
4. Add a model fallback: if Opus fails, try Sonnet; if Sonnet fails, return a graceful degradation message.
5. Emit structured error events (not console.error) with Anthropic-specific metadata (status code, model, token count requested).

---

## Finding 02 — Database (Turso) client: no retry, no connection pool health, no timeout

**Severity: P1**
**File:** `src/db/client.ts`

The `query()` function is a thin pass-through to `db.execute()` with no protective wrappers:

- **No timeout.** Turso calls can hang if the remote database is unreachable.
- **No retry.** Transient network errors (common with edge databases like Turso) are not retried.
- **No connection health check.** The singleton `_client` is created once and never validated. If the connection drops, subsequent calls will fail until the process restarts.
- **No pool management.** A single client instance serves all concurrent requests, cron jobs, and SCP agent runs.
- **No error classification.** Every DB error is treated identically -- transient network errors, constraint violations, and schema mismatches all bubble up as untyped exceptions.

The `batch()` function (transactional writes) has the same issues. `executeRaw()` (used for migrations) iterates statements sequentially with no transaction wrapping, meaning a migration can partially apply and leave the schema in an inconsistent state.

**Impact:** Turso blip = cascading failures across every route handler and all 55 cron jobs. No automatic recovery.

**Remediation:**
1. Wrap `query()` and `batch()` with retry logic (2-3 retries, 200ms base backoff) for transient errors (connection reset, timeout, 5xx from Turso edge).
2. Add an explicit timeout (e.g., 10s for queries, 30s for batch operations).
3. Implement a connection health probe that runs before critical operations or on a timer.
4. Classify errors: transient (retry) vs. permanent (throw immediately).

---

## Finding 03 — Stripe billing calls: no retry, no timeout, no idempotency keys

**Severity: P1**
**File:** `src/services/billing/stripe.ts`

Every Stripe SDK call (`customers.create`, `subscriptions.create`, `checkout.sessions.create`, `subscriptions.update`, `subscriptions.cancel`) has:

- **No timeout.** The Stripe SDK defaults are used with no explicit timeout.
- **No retry.** The Stripe Node SDK has built-in retry for network errors and 5xx, but `maxNetworkRetries` is not explicitly configured. The code does not verify or override defaults.
- **No idempotency keys.** `stripe.customers.create()` and `stripe.subscriptions.create()` are called without `idempotencyKey`. If a request times out and is retried (by SDK or user), duplicate customers/subscriptions can be created.
- **No error handling granularity.** Stripe-specific error types (card declined, rate limit, invalid request) are not distinguished. All errors bubble up as generic exceptions.

The `handleWebhook` function properly verifies signatures via `stripe.webhooks.constructEvent()`, which is good.

**Impact:** Stripe outage = checkout flow fails with generic 500. Duplicate subscriptions possible on network glitches. No degraded-mode billing.

**Remediation:**
1. Set `maxNetworkRetries: 3` on the Stripe client constructor.
2. Set `timeout: 10000` (10s) on the Stripe client.
3. Pass `idempotencyKey` to all mutating operations (`customers.create`, `subscriptions.create`, `checkout.sessions.create`).
4. Catch and classify Stripe errors: `StripeCardError` vs. `StripeRateLimitError` vs. `StripeConnectionError`.

---

## Finding 04 — Health check is a static lie

**Severity: P0**
**File:** `src/routes/internal/health.ts`

The health endpoint is:

```typescript
healthRoutes.get('/internal/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString(), version: '0.1.0' });
});
```

This checks **nothing**. It returns `ok` even if:
- Turso is unreachable
- Anthropic API key is invalid
- Stripe is misconfigured
- Migrations failed to apply
- All cron jobs are failing

Fly.io uses this endpoint for health checks to decide whether to route traffic to this instance. A "healthy" instance with a dead database will serve 500s on every authenticated request.

**Impact:** Load balancer routes traffic to broken instances. No observability into actual system health. Silent failures in production.

**Remediation:**
1. Probe Turso with a lightweight query (`SELECT 1`).
2. Check that critical env vars are present (Anthropic, Stripe, Clerk).
3. Check migration status (all applied? any pending?).
4. Report cron job health (last successful run times).
5. Return `503` with details if any critical check fails.
6. Add a `/internal/health/ready` (full dependency check) vs. `/internal/health/live` (process alive) split.

---

## Finding 05 — No graceful shutdown

**Severity: P0**
**File:** `src/index.ts`

There are zero `SIGTERM` or `SIGINT` handlers. When Fly.io sends SIGTERM during a deployment:

- In-flight HTTP requests are killed mid-response.
- Running cron jobs are terminated mid-execution (an SCP agent run that is partway through analyzing and writing signals will leave the product in an inconsistent state).
- Database connections are not drained.
- The `CronJob` instances are not stopped, meaning they may fire during shutdown and start new work.

The server starts with `serve()` from `@hono/node-server` but never stores the server reference, so there is no way to call `server.close()`.

**Impact:** Every deployment risks: partial cron job execution leaving inconsistent state, dropped requests, orphaned database connections.

**Remediation:**
1. Store the server reference from `serve()`.
2. Add `process.on('SIGTERM', ...)` handler that: (a) stops all CronJob instances, (b) calls `server.close()`, (c) waits for in-flight requests to complete (with a timeout), (d) closes the database client, (e) exits.
3. Set Fly.io `kill_timeout` to allow enough drain time (e.g., 30s).

---

## Finding 06 — Migration failures do not prevent startup

**Severity: P1**
**File:** `src/index.ts` lines 474-510

The startup sequence catches migration errors and continues:

```typescript
.catch((err) => {
  console.error('[STARTUP] Migration error (non-fatal):', err?.message ?? err);
  // Don't exit — migrations may have partially succeeded and app can still serve
  serve({ fetch: app.fetch, port }, ...);
});
```

This means the server can start and serve traffic with an **inconsistent schema**. Routes that reference columns from failed migrations will throw 500s. The health check will report `ok`.

**Impact:** Silent schema corruption. Users get 500 errors on routes that depend on un-applied migrations. Very difficult to debug in production because the error is logged once at startup and never surfaced again.

**Remediation:**
1. Fail fast: if migrations fail, do not start the HTTP server. Exit with code 1 so the orchestrator restarts or alerts.
2. At minimum, record migration status and expose it via the health endpoint.
3. Add a readiness check that gates traffic until migrations are complete.

---

## Finding 07 — SCP provisioning failures silently swallowed at startup

**Severity: P1**
**File:** `src/index.ts` lines 477-491

```typescript
await ensureProvisioned(p.id, p.owner_id).catch((err) => {
  console.warn(`[STARTUP] SCP provision skipped for ${p.id}:`, err);
});
```

Per-product SCP provisioning failures are silently swallowed. If Turso is slow at startup and provisioning fails for half the products, those products will have no SCP agents until the next restart. There is no retry, no alert, and no periodic re-check.

**Impact:** Products silently lose their SCP agent fleet. Founders see no briefings, no decisions, no intelligence -- with no explanation.

**Remediation:**
1. Track provisioning failures and retry them on a schedule (e.g., every 5 minutes until all products are provisioned).
2. Surface provisioning status in the health endpoint and product dashboard.
3. Emit an alert/notification when provisioning fails.

---

## Finding 08 — 55 cron jobs with no concurrency control, no dead letter, no alerting

**Severity: P1**
**Files:** `src/jobs/index.ts`, `src/index.ts` (startScheduler)

The cron scheduler has these problems:

1. **No concurrency control.** If a job runs longer than its interval, it fires again. The `scp_agent_runner` runs hourly and iterates all products calling AI -- if it takes >60 min (likely at scale), overlapping runs will double AI spend and risk conflicting writes.
2. **No dead letter queue.** Failed jobs are logged to console and forgotten. There is no retry, no backlog, no alerting.
3. **No execution tracking.** There is no record of when each job last ran successfully, how long it took, or whether it failed. The health endpoint cannot report job health.
4. **No timeout per job.** A hung Anthropic call inside `dailyInsightGenerate` will block that job indefinitely. With cron's `node-cron`, the job just stays running.
5. **No error aggregation.** Each product's per-job error is logged individually. If Anthropic is down, you get N*M log lines (products * jobs) with no summary.
6. **Console.log everywhere.** 205+ console.log/error/warn calls in the jobs file alone. No structured logging, no severity levels, no correlation IDs.

**Impact:** At scale (50+ products), jobs will overlap, duplicate work, exhaust AI budget, and leave no observable trace of health. A silent failure mode where jobs haven't run for days is undetectable.

**Remediation:**
1. Add a mutex/lock per job (e.g., a `job_runs` table with `started_at`, `completed_at`, `status`, `error`).
2. Skip execution if the previous run is still active (with a staleness threshold).
3. Set a timeout per job execution (kill and log after N minutes).
4. Track last-successful-run per job in the database; expose in health endpoint.
5. Alert (notification/email) if any critical job hasn't run successfully in 2x its interval.
6. Replace all console.log with structured logger.

---

## Finding 09 — Integration services: inconsistent error handling and no retry

**Severity: P1 (per-integration breakdown below)**
**Files:** `src/services/integration/*.ts`

**What works (partial credit):**
- **Timeouts:** All integration helpers (`ghFetch`, `slackGet`, `slackPost`, `sentryFetch`, `linearQuery`, `intercomFetch`, PostHog fetchers) use `AbortSignal.timeout(10000)`. This is good.
- **Error tracking:** Integrations record `last_error` and `error_count_trailing_7d` in the database. Reasonable.
- **GitHub audit service** (`src/services/audit/github.ts`): Has retry with exponential backoff on both read (`githubFetch`) and write (`githubFetchMutate`) operations, including rate-limit handling. This is the best-implemented external caller in the codebase.

**What is missing:**
- **No retry on any integration except GitHub audit.** Slack, Sentry, PostHog, Linear, Intercom, Resend -- all return `null` on failure with no retry attempt. A single transient 503 means the sync cycle produces zero data.
- **No circuit breaker.** If Sentry is down for a week, every hourly sync for every product will attempt the call, fail, and increment `error_count_trailing_7d` -- but never stop trying.
- **No jitter.** GitHub audit retry uses `Math.pow(2, attempt) * 1000` with no jitter. Under contention (multiple products auditing simultaneously), retries will thundering-herd.
- **Resend email delivery** (`src/services/integration/resend.ts`): The actual `fetch()` call to Resend API at line 155 has no timeout, no retry. The integration wrapper fetchers have timeouts, but the Resend email send path uses bare `fetch()`.
- **Push notifications** (`src/services/notifications/push.ts`): APNS calls have no timeout. Slack notification send at line 187 has no timeout. Web Push has no timeout. Outbound webhook delivery at line 248 has no timeout.

| Integration | Timeout | Retry | Circuit Breaker | Rate Limit Handling |
|-------------|---------|-------|-----------------|---------------------|
| GitHub (audit) | No (bare fetch) | Yes (3x backoff) | No | Yes (rate limit header) |
| GitHub (integration) | 10s | No | No | No |
| Slack | 10s | No | No | No |
| Sentry | 10s | No | No | No |
| PostHog | 8-10s | No | No | No |
| Linear | 10s | No | No | No |
| Intercom | 10s | No | No | No |
| Resend (email exec) | None | No | No | No |
| APNS | None | No | No | No |
| Outbound webhooks | None | No | No | No |

**Remediation:**
1. Create a shared `resilientFetch()` utility with configurable retry, timeout, and circuit breaker.
2. Apply to all integration fetchers.
3. Add jitter to GitHub audit retry backoff.
4. Add timeout to Resend, APNS, and outbound webhook calls.
5. Implement a circuit breaker per integration: after 3 consecutive failures, skip for 5 minutes.

---

## Finding 10 — Resend digest delivery: no retry, no timeout, no DLQ

**Severity: P1**
**File:** `src/services/digest/delivery.ts`

`sendDigestEmail` calls `resend.emails.send()` directly with no retry, no timeout, and no fallback. If Resend is down during the Monday morning digest window, all digests are silently lost. The `digestGenerate` job catches the error per-founder and continues to the next, but there is no re-queue mechanism.

Similarly, `sendTriggerEmail` has the same bare call.

**Impact:** Digest emails (the primary founder communication channel) are fire-and-forget. A Resend outage during the weekly digest window means founders get no weekly intelligence.

**Remediation:**
1. Add retry with backoff (3 attempts) around `resend.emails.send()`.
2. If all retries fail, queue the digest for later delivery (a `pending_emails` table with a retry job).
3. Add a timeout to the Resend SDK call.

---

## Finding 11 — Route handlers: inconsistent error boundaries

**Severity: P2**
**Files:** `src/routes/**/*.ts`

The global error handler in `src/index.ts` catches unhandled exceptions:

```typescript
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});
```

This is a reasonable last resort, but:

1. **Most route handlers do not have try-catch.** For example, `GET /api/threads` (line 132 of ask.ts) performs 2 DB queries with no error handling -- a Turso error will surface as a generic 500 via the global handler.
2. **Only a few handlers return 503.** The `/api/ask` POST handler correctly returns 503 when the AI call fails (line 65). Most other handlers that call AI or external services do not distinguish between client errors and service errors.
3. **No structured error responses.** The global handler returns `{ error: 'Internal server error' }` with no request ID, no error classification, no retry-after header.
4. **No error tracking/aggregation.** All errors go to `console.error` with no structured metadata.

**Impact:** Users get unhelpful 500 errors. Operations team has no way to distinguish between a bug and a dependency outage. No retry-after signals for clients.

**Remediation:**
1. Wrap route handlers that call external services in try-catch with appropriate status codes (503 for dependency failures, 500 for bugs).
2. Add a request ID to all responses and error logs.
3. Return `Retry-After` header on 503 responses.
4. Implement structured error logging with severity, service, and request context.

---

## Finding 12 — No request tracing or correlation IDs

**Severity: P2**
**Files:** Entire codebase

There are no request IDs, trace IDs, or correlation IDs anywhere. When a cron job triggers an SCP agent run that calls Anthropic that writes to the DB, there is no way to trace the chain of events. Error logs from different requests interleave in the console output with no correlation.

**Impact:** Incident investigation is nearly impossible. Cannot determine which user request triggered which error. Cannot correlate cron job errors with specific product or agent.

**Remediation:**
1. Generate a request ID in middleware (UUID or nanoid) and attach to all log output.
2. For cron jobs, generate a job-run ID at the start and thread it through all function calls.
3. Include the correlation ID in error responses.

---

## Finding 13 — Clerk auth: no timeout on token verification or user fetch

**Severity: P2**
**File:** `src/middleware/auth.ts`

The auth middleware calls `verifyToken()` and `clerk.users.getUser()` with no timeout. If Clerk is slow or down:

- Every authenticated request hangs.
- The auto-provisioning path (`clerk.users.getUser()` on line 85) makes an HTTP call to Clerk's API with no timeout.
- The Clerk SDK does not expose obvious timeout configuration.

**Impact:** Clerk outage = entire authenticated surface hangs (not fails -- hangs). This is worse than a fast failure because connections pile up.

**Remediation:**
1. Wrap the `verifyToken()` call with `Promise.race()` against a timeout (5s).
2. Wrap `clerk.users.getUser()` with a timeout (5s).
3. Return 503 immediately if Clerk is unreachable.

---

## Finding 14 — GitHub fetch calls in audit service have no timeout

**Severity: P2**
**File:** `src/services/audit/github.ts`

While the `githubFetch` and `githubFetchMutate` functions have retry logic (finding 09 gave partial credit), the individual `fetch()` calls at lines 43 and 402 have **no `AbortSignal.timeout()`**. If the GitHub API hangs (TCP-level, no response), each retry attempt will wait indefinitely before the retry loop can advance.

This contrasts with the integration-layer GitHub helper (`src/services/integration/github.ts`), which does use `AbortSignal.timeout(10000)`.

**Impact:** A hanging GitHub API can stall an entire audit run indefinitely, blocking the cron job.

**Remediation:**
Add `signal: AbortSignal.timeout(15000)` to both `githubFetch` and `githubFetchMutate` fetch calls.

---

## Finding 15 — `env.ts` treats critical vars as optional, startup treats them as warnings

**Severity: P2**
**File:** `src/env.ts`, `src/index.ts`

The `env.ts` validation marks `ANTHROPIC_API_KEY` and `STRIPE_SECRET_KEY` as `required: false`, treating them as optional. The `src/index.ts` startup also treats missing `REQUIRED_ENV_VARS` (which includes these keys) as a warning:

```typescript
console.warn(`[STARTUP] Optional env vars missing: ${missing.join(', ')} — some features disabled.`);
```

But the actual code in `getClient()` (AI), `getStripe()` (billing), and `getResend()` (email) throws synchronously when these keys are missing. This means the server starts up, reports "healthy", and then crashes on the first request that touches AI, billing, or email.

**Impact:** False-positive startup. Server appears healthy but throws on first real request.

**Remediation:**
1. Mark `ANTHROPIC_API_KEY` and `STRIPE_SECRET_KEY` as `required: true` in `env.ts` (or at least `required_for_production`).
2. The startup check in `index.ts` should either fail fast or record which features are disabled and gate routes accordingly.

---

## Finding 16 — Push notification delivery has no timeout on APNS and Slack

**Severity: P2**
**File:** `src/services/notifications/push.ts`

The `sendAPNS` function at line 332 calls `fetch()` to Apple's push servers with no timeout. The `sendSlackNotification` function at line 187 also uses bare `fetch()` with no timeout. Outbound webhook delivery at line 248 likewise has no timeout.

These are called from background jobs and can hang indefinitely.

**Impact:** A single unresponsive push endpoint can stall the notification delivery loop for all founders.

**Remediation:**
Add `signal: AbortSignal.timeout(10000)` to all three fetch calls.

---

## Finding 17 — Startup: SCP provisioning iterates all products sequentially

**Severity: P3**
**File:** `src/index.ts` lines 479-486

At startup, the server iterates all active products and calls `ensureProvisioned()` for each one sequentially. With 50+ products, each involving DB queries, this could take minutes -- during which the server is not yet listening for HTTP requests.

**Impact:** Slow startup, delayed readiness, potential Fly.io health check timeout.

**Remediation:**
1. Run provisioning in the background after the server starts listening.
2. Or batch provisioning with `Promise.allSettled()`.

---

## Finding 18 — No observability: 422 console.log calls, zero structured logging

**Severity: P1**
**Files:** 40+ files (see orientation doc)

The entire codebase uses `console.log`, `console.error`, and `console.warn` for all logging. There is no:
- Structured logging (JSON format)
- Log levels (debug/info/warn/error/fatal)
- Request context (user, product, job)
- Timestamp format consistency
- Log sampling/rate limiting
- Error aggregation service (Sentry, Datadog, etc.)

The jobs file alone has 205 console.log/error/warn calls. In production, these produce unstructured text that is nearly impossible to query, filter, or alert on.

**Impact:** Cannot build dashboards, alerts, or incident investigation workflows. Cannot distinguish "expected warning" from "critical failure" in log output. Cannot answer "how many AI calls failed in the last hour" without grep.

**Remediation:**
1. Adopt a structured logger (Pino is the standard for Node.js -- fast, JSON output, log levels).
2. Attach context (requestId, productId, jobName, agentName) to every log statement.
3. Replace all console.* with logger calls at appropriate levels.
4. Configure log output for Fly.io's log aggregation.

---

## Finding 19 — Webhook processing: non-idempotent event handling

**Severity: P1**
**File:** `src/services/billing/stripe.ts` (handleWebhook), `src/services/integration/stripe.ts` (handleStripeWebhook)

Stripe explicitly documents that webhooks may be delivered multiple times. The `handleWebhook` function in `billing/stripe.ts` updates the founder's tier on every `subscription.updated` event without checking if the tier already matches. The integration-layer `handleStripeWebhook` in `integration/stripe.ts` stores every event without deduplication (no check on `stripe_event_id`).

More critically, the Clerk webhook handler and metric ingest handler likely have similar issues (no idempotency check visible from the code scanned).

**Impact:** Duplicate webhook deliveries can cause duplicate events in the integration_events table, skewing metrics. Re-delivered subscription events are low-risk (UPDATE is idempotent for tier), but the integration events table will accumulate duplicates.

**Remediation:**
1. Check `stripe_event_id` before storing integration events; skip duplicates.
2. Add an idempotency column to `integration_events` and enforce uniqueness.
3. Apply the same pattern to all webhook handlers.

---

## Finding 20 — What happens when each dependency is down

### Anthropic down
- **SCP agent runner:** Fails for every product. Logged per-agent via console.error. No retry. No alert to founders.
- **Daily insight:** Fails per-product. No insight generated. No notification.
- **Weekly plan:** Fails per-product. No plan generated.
- **Conversation/Ask:** Returns 503 (good -- this is the only graceful handling).
- **Morning briefings:** Fails silently.
- **Competitive scan:** Fails per-product.
- **Scenario accuracy:** Fails per-decision.
- **Net effect:** Complete intelligence blackout with no user-facing indication except "Ask Foundry" 503s.

### Turso down
- **All routes:** Every authenticated request fails (auth middleware queries `founders` table).
- **Health check:** Returns `ok` (does not check DB).
- **All cron jobs:** Fail on first query.
- **Net effect:** Total outage disguised as healthy by the health check. Fly.io keeps routing traffic.

### Stripe down
- **Checkout:** Fails with 500 (no graceful error page).
- **Webhook processing:** Stripe retries on their end (good).
- **Tier queries:** `getSoloSlotCount()` goes through DB (unaffected by Stripe outage).
- **Net effect:** Billing flow breaks. Existing subscribers unaffected (tier stored in DB).

### Clerk down
- **All auth:** `verifyToken()` hangs (no timeout). Every authenticated request hangs indefinitely.
- **Auto-provisioning:** `clerk.users.getUser()` hangs.
- **Net effect:** Entire authenticated surface becomes unresponsive (worse than a fast failure).

### Resend down
- **Digest delivery:** Fails silently. Digests are lost.
- **Trigger emails:** Fail silently.
- **Net effect:** Communication channel goes dark with no alert.

---

## Finding 21 — No rate limiting on AI calls (cost attack vector)

**Severity: P1**
**File:** `src/services/ai/client.ts`, `src/routes/api/ask.ts`

There is `apiRateLimit` middleware applied to `/api/*` routes, but:
1. The rate limiter is token-bucket based (generic HTTP rate limiting). It does not account for AI call cost.
2. There is no per-product or per-founder AI call budget.
3. SCP agent runs are not rate-limited at all (they run via cron, not HTTP).
4. A malicious founder could hammer `/api/ask` within the generic rate limit and generate unbounded Anthropic costs.

**Impact:** Unbounded AI spend. A single founder's aggressive usage could exhaust the Anthropic budget.

**Remediation:**
1. Track AI token usage per product per day.
2. Enforce a daily token budget per tier (Solo: X tokens, Growth: Y tokens, etc.).
3. Return 429 with a clear message when the budget is exhausted.

---

## Finding 22 — No dead letter or retry for failed cron job iterations

**Severity: P2**
**File:** `src/jobs/index.ts`

Every job that iterates products follows this pattern:

```typescript
for (const row of products.rows) {
  try {
    await doWork(p.id);
  } catch (err) {
    console.error(`[JOB] job_name error for ${p.id}:`, err);
  }
}
```

When a product fails, it is skipped and never retried until the next scheduled run. For daily jobs, this means a product misses an entire day of intelligence. For weekly jobs, it misses a week.

**Impact:** Transient failures (e.g., a momentary Anthropic 503) cause permanent data gaps for affected products.

**Remediation:**
1. Track per-product-per-job failure in a `job_product_status` table.
2. On next job run, prioritize previously-failed products.
3. Or add a "retry failed products" sweep job that runs every 15 minutes.

---

## Summary Table

| # | Finding | Severity | File(s) |
|---|---------|----------|---------|
| 01 | Anthropic API: no retry/timeout/CB/fallback | P1 | `services/ai/client.ts` |
| 02 | Turso DB: no retry/timeout/health check | P1 | `db/client.ts` |
| 03 | Stripe: no retry/timeout/idempotency | P1 | `services/billing/stripe.ts` |
| 04 | Health check is static (checks no deps) | P0 | `routes/internal/health.ts` |
| 05 | No graceful shutdown (SIGTERM handler) | P0 | `index.ts` |
| 06 | Migrations don't block startup on failure | P1 | `index.ts` |
| 07 | SCP provisioning failures silently swallowed | P1 | `index.ts` |
| 08 | 55 cron jobs: no concurrency/tracking/alerting | P1 | `jobs/index.ts` |
| 09 | Integration services: inconsistent retry/timeout | P1 | `services/integration/*.ts` |
| 10 | Resend digest: no retry, fire-and-forget | P1 | `services/digest/delivery.ts` |
| 11 | Route handlers: inconsistent error boundaries | P2 | `routes/**/*.ts` |
| 12 | No request tracing / correlation IDs | P2 | Entire codebase |
| 13 | Clerk auth: no timeout on verify/fetch | P2 | `middleware/auth.ts` |
| 14 | GitHub audit fetch: no timeout on HTTP calls | P2 | `services/audit/github.ts` |
| 15 | Critical env vars treated as optional | P2 | `env.ts`, `index.ts` |
| 16 | Push/Slack/webhook: no timeout | P2 | `services/notifications/push.ts` |
| 17 | Sequential startup provisioning | P3 | `index.ts` |
| 18 | Zero structured logging (422 console.log) | P1 | 40+ files |
| 19 | Non-idempotent webhook processing | P1 | `services/billing/stripe.ts`, `services/integration/stripe.ts` |
| 20 | Dependency failure cascade analysis | -- | (cross-cutting) |
| 21 | No AI call rate/cost limiting | P1 | `services/ai/client.ts`, `routes/api/ask.ts` |
| 22 | No dead letter / retry for failed job iterations | P2 | `jobs/index.ts` |

---

## Priority Remediation Order

### Immediate (before launch)
1. **Finding 05** (P0): Add SIGTERM handler with graceful shutdown
2. **Finding 04** (P0): Make health check probe actual dependencies
3. **Finding 01** (P1): Add timeout + retry + circuit breaker to Anthropic calls
4. **Finding 02** (P1): Add timeout + retry to Turso calls
5. **Finding 06** (P1): Fail startup on migration failure (or gate readiness)
6. **Finding 03** (P1): Add idempotency keys + timeout to Stripe calls

### Before scale (week 1-2 post-launch)
7. **Finding 08** (P1): Add job execution tracking and concurrency control
8. **Finding 09** (P1): Unify integration retry/timeout with shared utility
9. **Finding 18** (P1): Replace console.log with structured logger
10. **Finding 10** (P1): Add retry + DLQ to digest email delivery
11. **Finding 19** (P1): Deduplicate webhook events
12. **Finding 21** (P1): Add per-product AI budget

### Post-launch improvements
13. **Findings 11-16** (P2): Error boundaries, tracing, Clerk timeout, push timeout, env validation
14. **Finding 22** (P2): Dead letter for failed job iterations
15. **Finding 17** (P3): Async startup provisioning

---

## Cross-References

- **Prior audit debt class 5** (Missing Retry Logic): Confirmed fully open. Only GitHub audit has retry. All other external calls lack retry.
- **Prior audit debt class 6** (console.log): Confirmed fully open. 422 occurrences across 40 files.
- **Orientation top-20 item #1** (No retry/timeout/CB on any external call): Confirmed with nuance -- GitHub audit has retry but no timeout; integration helpers have timeout but no retry; AI and DB have neither.
- **Orientation top-20 item #9** (Migration failures don't stop server): Confirmed. Finding 06.
- **Orientation top-20 item #10** (SCP provisioning failures silently swallowed): Confirmed. Finding 07.
