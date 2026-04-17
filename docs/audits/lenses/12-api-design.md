# Lens 12 — API Design Audit

**Auditor perspective:** API design expert — REST conventions, schemas, error formats, pagination, rate limiting, versioning, authentication, developer experience.

**Scope:** All files under `src/routes/api/`, `src/api/v1/`, `src/routes/ingest/`, `src/routes/internal/`, `src/routes/share/`, plus middleware (`auth.ts`, `rate-limit.ts`, `internal.ts`, `tier-gate.ts`) and the API key auth at `src/api/middleware/auth.ts`.

**Files reviewed:** 30+

---

## Architecture Overview

Foundry exposes three distinct API surfaces:

| Surface | Auth Mechanism | Path Prefix | Consumer |
|---------|---------------|-------------|----------|
| Session API | Clerk JWT (cookie/Bearer) | `/api/*` | Browser (HTMX), iOS app |
| REST API v1 | API key (Bearer) | `/api/v1/*` | External integrations, SDK |
| Internal API | Ecosystem service key | `/internal/*` | Koldly, Apex Micro |
| Ingest webhook | Per-product ingest token | `/ingest/:token` | Zapier, Stripe, cron |
| Transcript webhooks | Per-product API key | `/webhooks/transcripts/*` | Fathom, Fireflies |

There is also a public share route (`/share/:token`) that renders HTML for investor/advisor read-only views.

---

## Findings

### P0 — Critical / Auth Bypass via API

#### P0-01: Missing ownership checks on experiment and prediction mutations (platform.ts, supercharge.ts)

**Files:** `src/routes/api/platform.ts:125-139`, `src/routes/api/supercharge.ts:212-217`

Three endpoints accept a bare entity ID without verifying the entity belongs to the authenticated founder's product:

```
POST /api/experiments/:id/event      — any founder can inject events into any experiment
GET  /api/experiments/:id/results    — any founder can read any experiment's results
POST /api/experiments/:id/stop       — any founder can stop any experiment
POST /api/predictions/:id/outcome    — any founder can record outcome on any prediction
```

The handler at `platform.ts:125` does:
```ts
platformApiRoutes.post('/api/experiments/:id/event', async (c) => {
  const body = await c.req.json() as Record<string, unknown>;
  await recordExperimentEvent(c.req.param('id'), ...);
  return c.json({ status: 'recorded' });
});
```

No `getProductByOwner` check. No `founder.id` validation. These are behind `authMiddleware` (any logged-in founder can access them), making this a cross-tenant data manipulation vulnerability.

**Fix:** Add product ownership verification using the same pattern every other endpoint uses. Resolve `experiment.product_id`, then call `getProductByOwner(experiment.product_id, founder.id)`.

#### P0-02: Decision approve/reject in founder-intelligence has no ownership check (founder-intelligence.ts:108-124)

**File:** `src/routes/api/founder-intelligence.ts:108-124`

```
POST /api/founder/intelligence/decisions-inbox/:id/approve
POST /api/founder/intelligence/decisions-inbox/:id/reject
```

These endpoints accept any decision ID and update it directly:
```ts
await query("UPDATE decisions SET status = 'approved' ... WHERE id = ?", [id]);
```

The route is guarded by `isFounder(founder.email)` which checks if the email matches a hardcoded founder address. In a single-founder deployment this is safe, but the code is an authorization pattern violation — it does not verify the decision belongs to a product owned by this founder. If the system evolves to multi-founder, this becomes a cross-tenant write.

**Fix:** Join against `products` table to verify ownership: `WHERE id = ? AND product_id IN (SELECT id FROM products WHERE owner_id = ?)`.

#### P0-03: Internal ecosystem key compared with `!==` — timing side-channel (middleware/internal.ts:21)

**File:** `src/middleware/internal.ts:21`

```ts
if (!providedKey || providedKey !== serviceKey) {
  return c.json({ error: 'Unauthorized' }, 401);
}
```

String comparison via `!==` is vulnerable to timing attacks. The ecosystem service key is a static secret that protects the entire internal API surface. An attacker can measure response times to determine the key character by character.

**Fix:** Use `crypto.timingSafeEqual(Buffer.from(providedKey), Buffer.from(serviceKey))` with a length check to prevent short-circuit.

#### P0-04: Transcript webhook API key compared against raw hash without timing-safe comparison (webhooks/transcripts.ts:15-21)

**File:** `src/routes/api/webhooks/transcripts.ts:15-21`

```ts
async function getProductIdForApiKey(apiKey: string): Promise<string | null> {
  const rows = await query(
    `SELECT product_id FROM api_keys WHERE key_hash = ? AND is_active = 1 LIMIT 1`,
    [apiKey],  // <-- raw key compared against hash column
  );
```

The raw API key is compared against `key_hash` — either this is a plaintext comparison (the column is misleadingly named) or the query always returns zero rows because a raw key never equals its hash. If the former, keys are stored in plaintext. If the latter, the endpoint is broken.

**Fix:** Hash the incoming key (SHA-256, matching `hashKey()` in `rbac/permissions.ts`) before querying, and verify the system is actually hashing on insert.

---

### P1 — Inconsistent Patterns / Missing Validation / Poor DX

#### P1-01: Zero request body validation at HTTP boundary

**Files:** Every route file under `src/routes/api/`

Not a single route uses Zod, AJV, or any schema validation library. Every route casts the parsed body to `Record<string, unknown>` or a hand-written type assertion:

```ts
const body = await c.req.json() as Record<string, unknown>;
const sector = body.sector_profile as string;
```

This means:
- No type coercion (a string `"42"` is silently stored where a number is expected)
- No required-field enforcement beyond ad-hoc `if (!field)` checks
- No max-length, min/max value, or format validation
- Invalid fields silently ignored — no feedback to the caller
- No protection against over-posting (extra fields accepted)

The v1 API (`src/api/v1/`) is marginally better with try/catch on `c.req.json()` for parse errors, but still has no schema validation.

**Fix:** Adopt Hono's built-in Zod validator (`@hono/zod-validator`) or `zValidator` middleware. Define schemas per endpoint. This also enables OpenAPI spec generation.

#### P1-02: Inconsistent error response formats across API surfaces

Three different error shapes are used:

**Session API (most routes):**
```json
{ "error": "Not found" }
```

**REST API v1:**
```json
{ "error": "Customer not found" }
```

**Global error handler:**
```json
{ "error": "Internal server error" }
```

The `types/api.ts` defines `APIResponse<T>` with `success`, `data`, `error`, and `meta` fields, but **no route actually uses this type**. The v1 API wraps data in `{ data: ... }` (good), but the session API does not (each endpoint uses a different top-level key: `products`, `latest`, `transitions`, `cohorts`, etc.).

There is no `statusCode` in the error body, no `code` field for machine-readable error identification, no `details` array for validation errors, and no request ID for debugging.

**Fix:** Define a canonical error envelope: `{ error: { code: string, message: string, details?: unknown[] }, request_id?: string }`. Enforce it via a shared helper. The v1 API should use the `APIResponse<T>` type that already exists.

#### P1-03: No pagination on the majority of list endpoints

Endpoints that return unbounded lists without pagination:

| Endpoint | File | Issue |
|----------|------|-------|
| `GET /api/products` | products.ts | Returns all products, no limit |
| `GET /api/products/:id/competitive` | metrics.ts | No limit on competitors |
| `GET /api/products/:id/cohorts` | metrics.ts | No limit on cohorts |
| `GET /api/products/:id/risk-history` | metrics.ts | No limit on transitions |
| `GET /api/psychology-insights` | tier4.ts | Hardcoded LIMIT 5, no offset |
| `GET /api/founder/intelligence/*` | founder-intelligence.ts | 10+ list endpoints, none paginated |
| `GET /api/chat/sessions` | supercharge.ts | No limit |
| `GET /api/network/matches` | supercharge.ts | No limit |
| `GET /api/actions/pending` | supercharge.ts | No limit |
| `GET /api/portfolios/:id/overview` | platform.ts | No limit |
| `GET /api/products/:id/events` | platform.ts | Depends on service default |

The v1 API handles this correctly — `customers`, `briefings`, `experiments`, `metrics/snapshots` all accept `limit` and `offset` and return `meta: { total, limit, offset }`. This pattern should be replicated across the session API.

**Fix:** Add `limit`/`offset` query params with sane defaults (e.g., 50) and max caps (e.g., 500). Return `meta.total` for cursor-based or offset-based pagination.

#### P1-04: Inconsistent parameter naming — `:id` vs `:productId` vs `:competitorId`

URL parameter names are inconsistent:

- `GET /api/geopolitical-signals/:productId` — uses `:productId`
- `GET /api/voice/digest/:productId` — uses `:productId`
- `GET /api/products/:id/...` — uses `:id` (meaning product ID)
- `POST /api/products/:id/incumbent-response/:competitorId` — nested resource with different convention
- `GET /api/products/:id/graph/neighborhood/:entityId` — camelCase param

REST convention: use the resource name as the param (`:productId`, `:customerId`), or be consistent with `:id` when it is the leaf resource. Currently both styles coexist.

#### P1-05: HTTP method misuse — POST for idempotent reads, PUT for creates

| Endpoint | Method | Issue |
|----------|--------|-------|
| `POST /api/products/:id/web-audit` | POST | Idempotent audit run — should be POST (creates a new audit), but returns result immediately instead of 201 + Location |
| `POST /api/products/:id/customers/refresh-health` | POST | Triggers a recalculation — POST is acceptable as an action, but no 202 Accepted for long-running |
| `POST /api/products/:id/regulatory-scan` | POST | Creates a scan — no 201 status |
| `POST /api/products/:id/graph/build` | POST | Rebuilds the graph — no idempotency key |
| `POST /api/psychology-insights/generate` | POST | Triggers AI generation — no 202 for long-running |
| `POST /api/founder/intelligence/digest/generate` | POST | Triggers digest — no 202 |

More critically, several mutations return 200 instead of 201 for resource creation:

- `POST /api/products/:id/marketplace-metrics` returns `{ status: 'recorded' }` with 200
- `POST /api/products/:id/metrics` returns `{ status: 'recorded' }` with 200
- `POST /api/threads` returns 200 (should be 201)

The mobile `POST /api/decisions` correctly returns 201 — this pattern should be universal.

#### P1-06: Tier-gated features have no API-level enforcement

**File:** `src/middleware/tier-gate.ts`

The `requireTier()` middleware only renders an HTML gate page — it is designed for browser routes. None of the JSON API routes (`/api/*`) apply tier gating. A Solo-tier founder can access Tier 3/4 endpoints like `/api/products/:id/ethics` or `/api/products/:id/expansion` without restriction.

**Fix:** Create an API-specific tier gate middleware that returns `{ error: "Feature requires Growth tier or above", code: "tier_required", required_tier: "growth" }` with HTTP 403.

#### P1-07: AI-powered endpoints have no timeout or cost protection

**Files:** `src/routes/api/ask.ts`, `src/routes/api/platform.ts`, `src/routes/api/tier3.ts`, `src/routes/api/tier4.ts`

Endpoints that call Anthropic Claude (Opus/Sonnet) have no:
- Request timeout (Claude calls can hang for 60+ seconds)
- Per-founder daily/hourly AI call budget
- Cost tracking at the API layer
- 202 Accepted pattern for long-running AI operations

The `apiRateLimit` (120 req/min) is applied globally, but a determined caller could consume substantial AI credits within that limit (120 Opus calls/min at ~$0.15/call = ~$18/min = $1,080/hour).

**Fix:** Add a per-founder AI call budget middleware. Consider returning 202 + polling for AI-heavy endpoints. Add explicit `AbortController` timeouts to Anthropic calls.

#### P1-08: POST /api/webhooks/stripe/:productId has no Stripe signature verification (supercharge.ts:127-137)

**File:** `src/routes/api/supercharge.ts:127-137`

```ts
superchargeApiRoutes.post('/api/webhooks/stripe/:productId', async (c) => {
  const productId = c.req.param('productId');
  const body = await c.req.json() as Record<string, unknown>;
  ...
  await processStripeWebhookEvent(productId, eventId, eventType, body);
  return c.json({ received: true });
});
```

This Stripe webhook endpoint does NOT verify the Stripe signature. Compare with the properly verified webhook at `src/index.ts:225-236` which checks `stripe-signature` header. The supercharge route is behind auth middleware (Clerk JWT), which means Stripe cannot even call it — Stripe sends webhooks without authentication cookies. This endpoint appears broken: either it should use Stripe signature verification (not Clerk auth), or it is dead code.

**Fix:** Either remove this endpoint (use the verified one at `/webhooks/stripe`) or add Stripe signature verification and remove from the auth middleware scope.

#### P1-09: SQL injection vector in LIKE pattern (ask.ts:419)

**File:** `src/routes/api/ask.ts:419-421`

```ts
const result = await query(
  `SELECT id FROM stressor_history WHERE product_id = ? AND status = 'active'
   AND stressor_name LIKE ? LIMIT 1`,
  [productId, `%${classified.entities.stressor_name}%`],
);
```

The `stressor_name` is derived from AI-classified user input and is interpolated into a LIKE pattern without escaping `%` and `_` wildcards. While the parameterized query prevents SQL injection, the unescaped wildcards allow a user to craft queries that match unintended rows (e.g., `stressor_name = "%"` matches everything).

**Fix:** Escape `%` and `_` in the interpolated value: `stressor_name.replace(/%/g, '\\%').replace(/_/g, '\\_')`.

---

### P2 — Structural Improvements

#### P2-01: No API versioning strategy for the session API

The v1 API is cleanly versioned at `/api/v1/`. However, the session API (which serves both the browser and the iOS app) lives at `/api/` with no versioning. iOS app releases are slow to propagate — any breaking change to `/api/dashboard`, `/api/decisions`, `/api/voice/*`, or `/api/threads` will break deployed mobile clients.

**Fix:** Version the mobile-facing endpoints: `/api/v1/dashboard`, `/api/v1/voice/briefing`, `/api/v1/threads`, etc. Keep unversioned paths as aliases for the current version.

#### P2-02: No OpenAPI specification

There is no OpenAPI/Swagger spec, no machine-readable API documentation, and no generated client types. The `types/api.ts` file defines response interfaces that no route actually references. The SDK at `packages/foundry-sdk` is a data adapter, not an API client.

**Fix:** Use `@hono/zod-openapi` to define routes with Zod schemas. This provides validation, type safety, and auto-generated OpenAPI 3.1 spec. Host interactive docs at `/api/v1/docs`.

#### P2-03: Duplicate endpoint surfaces for the same data

Several resources are exposed through both the session API and the v1 API with different shapes:

| Resource | Session API | v1 API | Shape match? |
|----------|-------------|--------|-------------|
| Metrics | `GET /api/products/:id/metrics` | `GET /api/v1/metrics/snapshots` | No (different field selection) |
| Experiments | `GET /api/products/:id/experiments` | `GET /api/v1/experiments` | No (different wrapper) |
| Customers | `POST /api/products/:id/customers` | `POST /api/v1/customers` | No (different upsert logic) |

This creates maintenance burden and inconsistency. Changes to one surface may not propagate to the other.

**Fix:** Extract shared service functions and response mappers. Ideally, the session API should call through to the v1 service layer.

#### P2-04: Inconsistent success response envelopes

The v1 API consistently wraps data in `{ data: ..., meta: { total, limit, offset } }`. The session API uses at least 12 different top-level key names:

```
{ products: [...] }
{ latest: {...} }
{ transitions: [...] }
{ cohorts: [...], historical_average: {...} }
{ competitors: [...], recent_signals: [...] }
{ threads: [...] }
{ status: 'recorded' }
{ ok: true }
{ health: {...} }
{ decisions: [...], count: N }
```

This forces API consumers to handle each endpoint's response shape individually.

**Fix:** Standardize on `{ data: T, meta?: { ... } }` for all endpoints.

#### P2-05: Rate limiting is in-memory — not shared across instances

**File:** `src/middleware/rate-limit.ts`

Rate limit state is stored in a process-local `Map`. On Fly.io with multiple instances, each instance maintains its own counter. A client can get `N * instance_count` requests per window by distributing across instances.

**Fix:** Use a shared store (Redis, or Turso-backed rate limit table) for production. Alternatively, rely on Fly.io's built-in request routing affinity + Cloudflare rate limiting.

#### P2-06: No CORS configuration for the v1 API

**File:** `src/index.ts:166-169`

CORS is configured globally with:
```ts
origin: process.env.APP_URL ?? 'http://localhost:8080'
```

The v1 API is consumed by external integrations (not browsers), but if a browser-based SDK consumer tries to call it, CORS will block unless their origin matches `APP_URL`. The v1 API should either have permissive CORS (it is API-key-authenticated) or explicit CORS configuration.

#### P2-07: Priority API returns HTML from JSON API routes (priority.ts)

**File:** `src/routes/api/priority.ts`

`GET /api/priority/one-thing` and `POST /api/priority/:id/dismiss` return `c.html(...)` — raw HTML fragments for HTMX injection. This is a content-type mismatch: endpoints under `/api/` conventionally return JSON. A mobile client or external consumer would receive unexpected HTML.

**Fix:** Move HTMX fragment endpoints to `/dashboard/fragments/` or `/htmx/`. Provide a parallel JSON endpoint at `/api/priority/one-thing` for the mobile client.

#### P2-08: Tour/UX endpoints return redirects, not JSON (ux.ts)

**File:** `src/routes/api/ux.ts`

```ts
apiUXRoutes.post('/api/tour/advance', async (c) => {
  ...
  return c.redirect('/dashboard?tour=1');
});
```

API endpoints should not return HTTP redirects (302). These are HTMX form submissions masquerading as API calls. They should be under a dashboard/HTMX route.

---

### P3 — Style / Best Practices

#### P3-01: Inconsistent resource naming conventions

- Snake_case in paths: `/api/products/:id/growth-stage` (kebab) vs `/api/products/:id/marketplace-metrics` (kebab) vs `/api/founder/intelligence/activity-timeline` (kebab) -- these are fine
- But `/api/products/:id/cofounder-dna` vs `/api/products/:id/alignment-score` vs `/api/products/:id/competitive-strategy` -- all consistent kebab-case -- this is good
- Response fields mix snake_case (`snapshot_date`, `risk_state`) and camelCase (`healthRatio` in the signal computation) -- pick one

#### P3-02: No Content-Type enforcement on POST/PUT endpoints

No route verifies that the incoming `Content-Type` is `application/json`. A client sending `text/plain` or `multipart/form-data` will get cryptic errors from `c.req.json()`.

#### P3-03: No `Location` header on 201 responses

When the v1 API returns 201, it does not include a `Location` header pointing to the created resource. This is a REST convention that helps clients discover the canonical URL.

#### P3-04: `DELETE` endpoints return inconsistent responses

- `DELETE /api/threads/:id` returns `{ ok: true }` with 200
- `DELETE /api/v1/webhooks/:webhookId` returns `{ data: { deleted: true, id } }` with 200

Both should return 204 No Content, or at minimum use a consistent shape.

#### P3-05: Webhook scope mismatch in v1 API (webhooks.ts)

All webhook CRUD operations require `agents:read` scope:
```ts
webhooksApi.post('/', requireScope('agents:read'), ...)
webhooksApi.delete('/:webhookId', requireScope('agents:read'), ...)
```

Creating and deleting webhooks are write operations. They should require a write-level scope (e.g., `webhooks:manage` or `agents:manage`).

#### P3-06: Experiment creation requires `agents:read` scope (experiments.ts:79)

```ts
experimentsApi.post('/', requireScope('agents:read'), ...)
```

Creating experiments is a write operation but requires only a read scope. This should be `experiments:manage`.

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| P0 | 4 | Cross-tenant access (experiments, decisions, predictions); timing-safe auth comparison; broken API key hash lookup |
| P1 | 9 | No input validation anywhere; inconsistent error formats; missing pagination on most list endpoints; no tier gating on API; AI cost exposure; broken Stripe webhook; LIKE injection |
| P2 | 8 | No API versioning for mobile; no OpenAPI spec; duplicate surfaces; inconsistent envelopes; in-memory rate limiting; HTML in JSON routes |
| P3 | 6 | Naming consistency; no Content-Type checks; no Location headers; scope mismatches |

**Top 3 recommendations:**
1. **Fix P0 ownership checks immediately** — the experiment/prediction/decision endpoints allow cross-tenant data access.
2. **Adopt Zod validation + `@hono/zod-openapi`** — this solves P1-01 (no validation), P2-02 (no OpenAPI spec), and P2-04 (inconsistent shapes) in one move.
3. **Standardize on the v1 API patterns** — `{ data, meta }` envelope, `limit`/`offset` pagination, proper scoping, 201 for creates. Back-port to session API endpoints consumed by the iOS app.
