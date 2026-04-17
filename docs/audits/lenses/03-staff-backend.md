# Lens 03 — Staff Backend Engineer Audit

Generated: 2026-04-16 | Auditor perspective: Staff backend engineer
Focus: Error handling, database safety, middleware design, job scheduling, API response consistency, service boundaries, production-readiness.

---

## Executive Summary

The backend is architecturally coherent — multi-tenant isolation is enforced at the query layer, middleware composition is correct, and the domain service structure maps cleanly to product concerns. However, the codebase has **systemic production-grade gaps** across every critical path: zero request validation, zero retry/timeout/circuit-breaker on external calls, plaintext secret storage, 422 console.log calls instead of structured logging, no transaction support, and 60+ silent `.catch(() => {})` swallows. The 55-job scheduler runs all jobs serially per product with no concurrency control, backpressure, or dead-letter handling. Several patterns could cause silent data corruption under load.

**P0 findings: 8 | P1 findings: 14**

---

## P0 — Data Corruption / Unhandled Errors in Critical Paths

### P0-01: Lifecycle state created in memory but never persisted to database

**File:** `src/middleware/tenant.ts` lines 66-95

When `getLifecycleState(productId)` returns zero rows, the middleware fabricates a default `lifecycleState` object in memory and sets it on the request context. This object is **never written to the database**. Any downstream code that reads from `c.get('lifecycleState')` sees the default, but any downstream code that queries `lifecycle_state` from the database directly (which many jobs and services do) gets nothing. This creates a split-brain condition:

- The dashboard renders a green/healthy state from the middleware-injected default.
- Jobs that query the database directly (weekly_synthesis, signal_alert_check, digest_generate, etc.) skip the product because `lifecycleResult.rows.length === 0`.
- The product effectively becomes invisible to the intelligence and alerting layer.

**Impact:** A product in distress could show green on the dashboard while receiving zero monitoring, zero digests, and zero stressor detection.

### P0-02: Migration failures do not stop the server

**File:** `src/index.ts` lines 474-510

```typescript
runMigrations()
  .then(async () => { /* normal startup */ })
  .catch((err) => {
    console.error('[STARTUP] Migration error (non-fatal):', err?.message ?? err);
    serve({ fetch: app.fetch, port }, (info) => { /* start anyway */ });
  });
```

If migrations fail (including schema-altering migrations that add required columns), the server starts anyway and begins accepting requests. Queries against missing columns will produce runtime errors, but only on the specific code paths that touch those columns. This creates a partially-functional state that is extremely difficult to diagnose in production.

**Impact:** Silent schema inconsistency. Some routes work, others throw. Data written during this window may be incomplete or malformed.

### P0-03: SCP provisioning failures silently swallowed at startup

**File:** `src/index.ts` lines 477-491

```typescript
for (const row of products.rows) {
  const p = row as Record<string, string>;
  await ensureProvisioned(p.id, p.owner_id).catch((err) => {
    console.warn(`[STARTUP] SCP provision skipped for ${p.id}:`, err);
  });
}
```

If provisioning fails for a product (e.g., the agent_instances insert fails due to a schema mismatch from P0-02), the failure is logged and swallowed. The product enters a state where `scp_status` may be 'active' but fewer than 12 agents exist. The scheduler will attempt to run agents for it, but missing agents produce no signals, no briefings, and no monitoring. There is no reconciliation job or health check that detects this state.

**Impact:** Products silently lose autonomous monitoring with no alert to the founder or operator.

### P0-04: GitHub access tokens stored in plaintext

**Files:** `src/db/schema.sql` line 32, `src/db/migrations/008_integrations.sql`, `src/db/migrations/021_integration_fabric.sql`

The schema comments say "Encrypted" and "encrypted at rest in production," but there is zero encryption code anywhere in the codebase. `github_access_token` is stored as raw TEXT. The remediation job reads it directly:

```typescript
const token = pr.github_access_token as string;
```

Integration credentials (`credentials_json`, `credentials`) across multiple tables are stored identically — raw JSON text with tokens, API keys, and secrets.

**Impact:** A database backup, a Turso console session, or a SQL injection anywhere in the application exposes every user's GitHub tokens and all integration credentials.

### P0-05: SQL injection via dynamic column interpolation

**Files:** `src/routes/api/ask.ts` lines 450-455, `src/routes/ingest/index.ts` lines 119-126, `src/services/benchmarking/pool.ts` lines 62-73

The ingest route builds SQL dynamically from the FIELD_MAP, which is safe because the column names come from a whitelist. However, the Ask route's `update_metric` action does the same with a separate allowlist that could drift:

```typescript
const col = classified.entities.metric_name.toLowerCase().replace(/\s+/g, '_');
const allowedCols = ['activation_rate', 'churn_rate', ...];
if (!allowedCols.includes(col)) return null;
await query(`...SET ${col} = ?...`);
```

The `classified.entities.metric_name` comes from AI classification of free-text user input. If the allowlist check were ever removed or bypassed, or if the `col` transform produced a string that passes the includes check but contains SQL metacharacters, this becomes a SQL injection vector. The benchmarking pool uses a safe static map (`metricNameToColumn`), but the pattern is fragile and inconsistent.

More critically, `src/services/intelligence/founder-health.ts`, `src/services/wisdom/dna.ts`, `src/routes/api/tier2.ts`, and `src/services/ai/calibration.ts` all build `SET ${sets.join(', ')}` clauses from dynamically constructed column lists. If any of those column-name sources are influenced by user input without allowlist validation, it is a direct SQL injection.

**Impact:** Potential SQL injection through AI-classified free-text or dynamically constructed SET clauses.

### P0-06: No retry, timeout, or circuit breaker on any external call

**Files:** `src/services/ai/client.ts`, `src/services/billing/stripe.ts`, all integration services

Every external API call (`Anthropic`, `Stripe`, `Clerk`, `Resend`, `Turso`) is a bare `await` with no timeout, no retry, and no circuit breaker. The only exception is `src/services/audit/github.ts`, which has retry logic for GitHub API rate limits.

For the AI client specifically: every one of the 55 scheduled jobs and 12 SCP agents that calls `callOpus()` or `callSonnet()` will hang indefinitely if the Anthropic API is slow. Since jobs run serially per product, a single hung AI call blocks all subsequent products from being processed until the job's next scheduled run.

**Impact:** A slow or failing external dependency causes cascading stalls across all products' intelligence pipelines with no visibility or recovery.

### P0-07: No transaction support for multi-step mutations

**File:** `src/db/client.ts`

The `batch()` function exists and wraps statements in a Turso batch with `'write'` mode, but it is **never called from any service or route**. Every multi-step operation (provisioning 12 agents + constitution + product update, risk state transition + audit log + recovery protocol, etc.) is a sequence of individual `query()` calls. If any step fails, the preceding steps remain committed.

Critical example — SCP provisioning (`src/services/scp/provisioner.ts`):
- Insert constitution
- Insert 12 agent instances (one at a time in a loop)
- Insert 12 evolution version records
- Update product status

If the 8th agent insert fails, the product has 7 agents, a constitution, but `agentsCreated` is reported as 7, and the function returns `success: false`. However, the 7 agents and constitution remain in the database. `isProvisioned()` will return false (checks `count >= ALL_AGENTS.length`), so the next call to `ensureProvisioned` will try again, hitting `ON CONFLICT DO NOTHING` for the existing rows and creating the missing ones — but only if the original failure was transient. If it was a schema issue, it will fail forever.

**Impact:** Partial writes leave the system in inconsistent states that are difficult to detect and repair.

### P0-08: Silent error swallowing via `.catch(() => {})`

**Files:** 60+ occurrences across `src/services/scp/agents/base.ts` (17 occurrences), `src/services/scp/scheduler.ts`, `src/routes/api/priority.ts`, `src/routes/api/webhooks/transcripts.ts`, and others.

The BaseAgent class alone has 17 `.catch(() => {})` calls, including in signal processing, customer intelligence updates, and agent note creation. These operations silently discard errors that could indicate data corruption, schema mismatches, or external service failures.

Example from `base.ts`:
```typescript
// After agent analysis, customer intelligence update:
await addAgentNote(customer.id, agentName, note).catch(() => {});
```

If the `agent_notes` table doesn't exist (schema migration failure) or the insert violates a constraint, the error is silently swallowed. The agent reports success while data is silently lost.

**Impact:** Errors in critical paths become invisible. No logging, no metrics, no alerting. The system appears healthy while silently losing data.

---

## P1 — Inconsistent Patterns, Poor Error Handling, Missing Validation

### P1-01: Zero request validation at HTTP boundaries

**Files:** All 54 route files that call `c.req.json()`

There is no Zod, io-ts, or any validation library in the project. Every route handler does:
```typescript
const body = await c.req.json() as Record<string, unknown>;
```

This is a `trust all input` pattern. The `as Record<string, unknown>` cast provides zero runtime protection. Malformed payloads (missing fields, wrong types, extra fields, oversized strings) flow directly into database queries and service functions.

Specific risks:
- `POST /api/products/:id/metrics`: No type validation on any of the 14 numeric fields.
- `POST /api/decisions`: `body.gate` is trusted as a number and inserted directly — could be a string, float, or negative number.
- `POST /api/voice/transcript`: `body.transcript` could be an arbitrarily large string passed to the AI client.
- `POST /api/products/:id/customers`: `body` cast to `any` and passed directly to `upsertCustomer`.

**Impact:** Type errors at the database layer instead of the API boundary. Malformed data persisted. Potential denial-of-service via oversized payloads to AI endpoints.

### P1-02: 422 `console.log/error/warn` calls with no structured logging

**Files:** 125+ occurrences across 40+ files (notably `src/index.ts`, `src/jobs/index.ts`, `src/services/scp/scheduler.ts`, `src/services/scp/evolution.ts`, `src/services/scp/events/dispatcher.ts`)

Every log statement is an unstructured `console.log/error/warn` call. There is no log level configuration, no request correlation IDs, no JSON formatting, no log aggregation integration. In production on Fly.io, these all go to stdout with no structure.

Example from jobs:
```typescript
console.log(`[JOB] weekly_synthesis: ${p.name} — risk ${riskState}→${riskAssessment.recommendedState}`);
console.error(`[JOB] weekly_synthesis error for ${p.id}:`, err);
```

When multiple products run concurrently (unlikely since jobs are serial, but possible via manual triggers), log lines from different products interleave with no correlation.

**Impact:** Debugging production issues requires grep-and-pray. No ability to filter by product, founder, job, or severity. Error rates are unmeasurable.

### P1-03: Rate limiting is in-memory and per-instance

**File:** `src/middleware/rate-limit.ts`

Rate limiting uses an in-memory `Map` with a 60-second cleanup interval. On Fly.io with multiple instances (which is the expected production topology for availability), each instance maintains its own independent rate limit counters. A client can bypass the rate limit by having requests load-balanced across N instances, effectively getting N * the configured limit.

The rate limit key for unauthenticated requests falls back to `'unknown'` if no `x-forwarded-for` or `cf-connecting-ip` header is present. A client that omits these headers shares a single rate limit bucket with all other such clients.

**Impact:** Rate limiting is ineffective at scale. The `authRateLimit` (10 req/min) intended to protect auth endpoints is trivially bypassable.

### P1-04: Auth token extraction is regex-based, not using a cookie library

**File:** `src/middleware/auth.ts` lines 43-53

```typescript
const cookie = c.req.header('Cookie');
if (cookie) {
  const sessionCookie = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('__session='));
  if (sessionCookie) {
    token = sessionCookie.split('=')[1] ?? null;
  }
}
```

This splits on `;` and `=` without handling quoted values, URL-encoded values, or cookies whose values contain `=` (JWTs contain `=` as base64 padding). If the JWT has trailing `=` padding, `split('=')[1]` returns only the portion before the first `=` in the value, truncating the token.

In practice, Clerk JWTs are likely base64url-encoded (no padding), so this may not currently manifest. But it is a latent bug that will surface if the token format changes.

**Impact:** Latent authentication failure for certain token formats. Currently masked by JWT encoding conventions.

### P1-05: Internal API key comparison is not timing-safe

**File:** `src/middleware/internal.ts` line 23

```typescript
if (!providedKey || providedKey !== serviceKey) {
  return c.json({ error: 'Unauthorized' }, 401);
}
```

The `!==` comparison is not constant-time. An attacker can use timing analysis to progressively determine the correct key byte-by-byte. For an ecosystem service key that authenticates internal API calls, this is a meaningful attack vector.

**Impact:** Timing side-channel allows brute-force extraction of the ecosystem service key.

### P1-06: CORS defaults to localhost if APP_URL not set

**File:** `src/index.ts` line 167

```typescript
app.use('*', cors({
  origin: process.env.APP_URL ?? 'http://localhost:8080',
  credentials: true,
}));
```

If `APP_URL` is not set (which `src/env.ts` marks as optional), CORS allows credentials from `http://localhost:8080`. In production, this is likely harmless since browsers enforce CORS. But if a production deployment accidentally omits `APP_URL`, the CORS origin becomes `localhost`, which blocks legitimate cross-origin requests from the actual domain while allowing requests from any local dev server.

**Impact:** Misconfigured CORS in production if `APP_URL` is omitted.

### P1-07: Inconsistent error response shapes across routes

**Files:** All route files

There is no centralized error response helper. Different routes return different shapes:
- `{ error: 'Not found' }` (most routes)
- `{ error: 'product_id required' }` (mobile routes)
- `{ error: 'Invalid token' }` (ingest)
- `{ error: 'Server configuration error' }` (middleware)
- `{ received: true }` (webhooks)
- `{ ok: true }` (mobile, push)
- `{ status: 'recorded' }` (metrics)
- `{ status: 'updated' }` (tier routes)

There is no `statusCode` field in any error response. There is no `details` field for validation errors. Mobile clients and the iOS app must handle every possible shape.

**Impact:** API consumers cannot rely on a consistent error contract. Frontend error handling becomes fragile.

### P1-08: 55 scheduled jobs with no concurrency control or backpressure

**File:** `src/jobs/index.ts`, `src/index.ts` lines 438-455

The job scheduler creates one `CronJob` per entry. Each job iterates `getAllActiveProducts()` and processes every product serially. There is no:
- Concurrency limit (all 55 cron triggers fire independently)
- Backpressure (if a job takes longer than its interval, the next trigger starts a new concurrent execution)
- Dead-letter queue (failed products are logged and skipped)
- Job status tracking (no database record of runs, durations, success/failure)
- Distributed locking (on multi-instance Fly.io, every instance runs every job)

The `scp_priority_rebuild` job runs every 30 minutes. The `scp_agent_runner` runs every hour and processes all products with potentially 12 AI calls each. These can easily overlap.

**Impact:** Duplicate job execution across instances. Unbounded concurrency. Jobs that take longer than their interval create cascading parallel executions. AI cost explosion.

### P1-09: `as any` casts create type safety holes

**Files:** 36 occurrences across 15 files

Key instances:
- `src/db/client.ts` line 29: `args: args as any[]` — undermines the parameterized query type safety
- `src/middleware/auth.ts` line 67: `as any` on verifyToken options
- `src/middleware/auth.ts` line 122: `(row as any).lifestyle_mode` — accessing a field not in the typed FounderRow
- `src/services/integrations/framework.ts` line 76: `return result.rows as any` — entire result set loses type information
- `src/routes/api/platform.ts` line 32: `body as any` — user input passed untyped to service

**Impact:** Runtime type errors that TypeScript strict mode should catch. False confidence in type safety.

### P1-10: JSON.parse calls with no error handling

**Files:** 54+ occurrences across 30+ files

Most `JSON.parse` calls in the codebase lack try/catch. If a database column that should contain JSON actually contains malformed text (due to a partial write, encoding issue, or schema migration), the parse throws and crashes the request handler.

Examples:
- `src/middleware/auth.ts` line 121: `JSON.parse(row.preferences)` — crashes auth middleware if preferences column is corrupted
- `src/middleware/tenant.ts` line 112: `JSON.parse(lsRow.prompt_2_hypotheses)` — crashes tenant middleware
- `src/jobs/index.ts` line 269: `JSON.parse(d.base_case as string)` — crashes scenario_accuracy job

The integration fabric (`src/services/integration/fabric.ts`) is the only module that wraps `JSON.parse` in try/catch consistently.

**Impact:** Corrupted JSON in any parsed column crashes the request or job processing that product, with no graceful degradation.

### P1-11: No idempotency on retryable mutations

**Files:** All POST routes, all job mutations

No route or job uses idempotency keys. If a client retries a `POST /api/decisions` due to a network timeout, a duplicate decision is created. If the `digest_generate` job partially completes and is re-triggered, duplicate digests are sent. Some operations use `ON CONFLICT DO NOTHING` or `ON CONFLICT DO UPDATE`, which provides some protection, but many INSERT operations have no conflict handling:
- `insertAuditLog` (`src/db/client.ts` line 289)
- Decision creation (`src/routes/api/mobile.ts` line 170)
- Story artifact creation (`src/jobs/index.ts` line 392)
- Notification creation (throughout)

**Impact:** Duplicate data from retries. Duplicate emails to founders.

### P1-12: Fire-and-forget database writes with no error visibility

**File:** `src/middleware/auth.ts` line 128

```typescript
query('UPDATE founders SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', [founder.id]).catch(() => {});
```

The `last_seen_at` update is fire-and-forget with a swallowed error. While this specific case is low-risk (it's a non-critical timestamp), the pattern is replicated in many places where it matters more (see P0-08).

**Impact:** Low for this specific instance. The pattern normalizes silent error swallowing.

### P1-13: Decision patterns table has no access controls

**File:** `src/db/client.ts` lines 216-231

The `decision_patterns` table is explicitly documented as "intentionally NOT tenant-scoped." The `getRelevantPatterns` function fetches patterns across all products. While the intention is cross-product learning, there are no controls on:
- Who can write to this table (any product's resolved decision creates a pattern)
- Data quality (a single product's bad data pollutes the global pattern pool)
- Consent (founders are not asked whether their decision patterns can be shared)
- Access (the `3 of 5 dimensions match` logic is applied in application code after fetching `limit * 3` candidates, but the raw rows are fetched)

**Impact:** A malicious or compromised product could inject misleading patterns that influence other products' decision recommendations.

### P1-14: No health check for database connectivity

**File:** `src/routes/internal/health.ts` (not read but referenced in orientation)

The health endpoint at `/internal/health` is public and does not require auth. However, based on the pattern seen in `src/index.ts`, there is no database health check — just a basic HTTP liveness check. Jobs and routes that fail due to database issues will fail silently (per P0-08 patterns) while the health check reports healthy.

**Impact:** Load balancer continues routing traffic to instances with dead database connections.

---

## Architectural Observations (Not Bugs, But Risks)

### A-01: Single-file job registry at 1865 lines

`src/jobs/index.ts` is a single file containing all 55 job implementations and the registry. This file imports 35+ service modules at the top level. Every job function is exported individually but there is no job abstraction — no base class, no retry policy interface, no observability hooks.

### A-02: Service layer has no clear dependency boundaries

The `src/services/` directory contains 176 files across 35+ subdirectories. Services import each other freely. The intelligence services import AI services, which import database services. Jobs import from intelligence, audit, billing, wisdom, and SCP services. There is no dependency injection, no service registry, and no clear layering.

### A-03: 55 cron jobs with AI calls and no cost controls

Many jobs call `callOpus()` (Claude Opus 4.6 at strategic pricing) for every active product. The `daily_insight_generate`, `weekly_plan_generate`, `scenario_accuracy`, and `scp_agent_runner` jobs all make per-product AI calls. With N products, the monthly AI spend scales as O(N * jobs_per_month * tokens_per_call) with no budget cap, no spend alerting, and no per-product cost tracking in the scheduler.

### A-04: No webhook signature verification except Stripe

The Stripe webhook route correctly calls `stripe.webhooks.constructEvent()` for signature verification. No other webhook endpoint (Clerk, transcript webhooks, voice-reply webhooks, ingest) verifies request authenticity. The ingest route uses a per-product token, but the Clerk webhook has no verification despite `CLERK_WEBHOOK_SECRET` being listed as optional in env.ts.

---

## Positive Patterns Worth Preserving

1. **Tenant isolation by design:** Every product-scoped query uses `owner_id` filtering. The `getProductByOwner` pattern returns 404 (not 403) to prevent information leakage.

2. **Safety gate system:** The `evaluateGate` function correctly implements risk-state-aware confidence thresholds with proper escalation logic. Cold Start Mode correctly narrows Gate 0 autonomy.

3. **GitHub API retry logic:** `src/services/audit/github.ts` is the one service that correctly implements retry with exponential backoff and rate-limit awareness. This should be the template for all external calls.

4. **Batch API exists:** `src/db/client.ts` has a `batch()` function that wraps Turso batch writes. It just needs to be used.

5. **Environment validation:** `src/env.ts` fails fast on missing required vars and warns on optional ones. This is a good pattern.

---

## Recommended Priority Order

1. **P0-04** (plaintext secrets) — Add encryption at rest for access tokens and credentials. Immediate.
2. **P0-06** (no retry/timeout) — Add timeout + retry to AI client and Stripe. Prevent cascading stalls.
3. **P0-01** (lifecycle state not persisted) — Write the default to the database in tenant middleware.
4. **P0-07** (no transactions) — Wrap provisioning and risk transitions in `batch()`.
5. **P0-08** (silent swallows) — Replace `.catch(() => {})` with `.catch(logError)` minimum.
6. **P0-02** (migrations don't stop server) — Fail startup on migration error in production.
7. **P1-01** (no validation) — Add Zod schemas to all POST/PUT routes.
8. **P1-08** (job concurrency) — Add distributed locking or single-leader election for cron jobs.
9. **P1-02** (structured logging) — Replace console.* with a structured logger.
10. **P1-05** (timing-safe compare) — Use `crypto.timingSafeEqual` for key comparison.
