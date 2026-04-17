# Lens 44 — Multi-Tenancy Isolation Expert

## Executive Summary

Foundry's core tenant isolation model is sound at the database query layer: the `client.ts` helper functions consistently scope by `product_id` or `owner_id`, and the `tenantMiddleware` validates product ownership before loading context. However, I found **seven critical or high-severity isolation failures** in the platform API, internal ecosystem routes, cron jobs, caching, and logging layers. The worst: any authenticated founder can read/write any portfolio's data, any experiment's data, and any voice session's data with zero ownership checks. The internal ecosystem endpoint exposes full product data to anyone holding the single shared service key with no per-product authorization. Multiple cron jobs operate on global tables without tenant scoping, and logs leak product names and IDs to shared stdout.

## Findings

### MTI-01 Portfolio API Routes Have Zero Ownership Validation
- **Severity:** P0
- **Description:** Five portfolio endpoints in `src/routes/api/platform.ts` (lines 305-337) accept portfolio IDs directly from the URL/body and perform operations without verifying the authenticated founder owns or has access to that portfolio. Any authenticated user can:
  - Add any product to any portfolio (`POST /api/portfolios/:id/companies`)
  - Read any portfolio's full overview including MRR, risk states, and company names (`GET /api/portfolios/:id/overview`)
  - Benchmark any product against any portfolio (`GET /api/portfolios/:id/benchmark/:productId`)
  - Generate snapshots for any portfolio (`POST /api/portfolios/:id/snapshot`)
- **Evidence:**
  - `src/routes/api/platform.ts` lines 315-337 — none of these handlers call `getProductByOwner()` or check portfolio ownership
  - `src/services/portfolio/manager.ts` lines 78-131 — `getPortfolioOverview()` joins `products`, `lifecycle_state`, and `metric_snapshots` across all member products with no caller-side ownership check
  - `authenticatePortfolioKey()` exists (line 236) but is never called in any route handler
- **Remediation:** Add portfolio ownership middleware. Every `/api/portfolios/:id/*` route must verify `portfolios.owner_email = founder.email` OR that the founder has an explicit portfolio membership. Alternatively, implement the `authenticatePortfolioKey()` function that already exists but is unused.
- **Target Phase:** Phase 2

### MTI-02 Experiment and Voice Session Routes Lack Tenant Scoping
- **Severity:** P0
- **Description:** Three platform API endpoints operate on resource IDs without verifying the authenticated founder owns the parent product:
  1. `POST /api/experiments/:id/event` (line 125) — records events to any experiment by ID
  2. `GET /api/experiments/:id/results` (line 131) — reads results of any experiment by ID
  3. `POST /api/experiments/:id/stop` (line 136) — stops any experiment by ID
  4. `POST /api/voice/session/:id/end` (line 260) — ends any voice session by ID, injecting arbitrary transcript
  5. `POST /api/voice/memo` (line 232) — accepts `product_id` from body with no ownership verification
- **Evidence:**
  - `src/routes/api/platform.ts` lines 125-139, 232-264
  - These routes extract `c.req.param('id')` and pass it directly to service functions without any `getProductByOwner()` call
  - Compare to the product-scoped routes on lines 25-87 which all correctly call `getProductByOwner(productId, founder.id)`
- **Remediation:** For every resource-ID route, look up the parent `product_id` from the resource row, then verify ownership via `getProductByOwner(product_id, founder.id)`. Alternatively, restructure as `/api/products/:productId/experiments/:id/...` and enforce product ownership at the path level.
- **Target Phase:** Phase 2

### MTI-03 Internal Ecosystem Endpoint Exposes Full Product Data Without Per-Product Authorization
- **Severity:** P1
- **Description:** The `GET /internal/operator/dashboard-data` endpoint (line 42) accepts any `product_id` as a query parameter and returns the complete product record, lifecycle state, stressors, MRR decomposition, metrics, and cohort data. Authorization is the single shared `ECOSYSTEM_SERVICE_KEY`. Any service holding this key can read any product's complete data. The `POST /internal/conversion-signal` endpoint (line 26) accepts any `product_id` and writes to its audit log.
- **Evidence:**
  - `src/routes/internal/ecosystem.ts` lines 42-77 — queries `products WHERE id = ?` with no ownership filter
  - `src/middleware/internal.ts` — validates a single shared key, not per-product authorization
  - Returns: product record, full lifecycle state, all active stressors, latest metrics, MRR decomposition, cohort data, pending decision count
- **Remediation:** Either (a) scope the ecosystem key to specific product IDs (e.g., a signed JWT containing allowed product_ids), or (b) add a `product_id` allowlist per ecosystem service, or (c) add a `portfolio_id` claim to the service key and verify the product belongs to that portfolio.
- **Target Phase:** Phase 2

### MTI-04 Scenario Accuracy Job Queries Cross-Tenant Without Product Scoping
- **Severity:** P1
- **Description:** The `scenarioAccuracy()` job (line 254) queries `decisions d JOIN scenario_models sm ON d.id = sm.decision_id WHERE d.outcome IS NOT NULL AND sm.outcome_accuracy IS NULL LIMIT 20` — this is a global query across ALL products. It then accesses `d.product_id` to load lifecycle state, but the initial query fetches decisions from any tenant. If a product is deleted or a founder is removed, their decision data is still processed and fed into the global `decision_patterns` table via `generatePatternFromOutcome()`.
- **Evidence:**
  - `src/jobs/index.ts` lines 257-262 — no `product_id` filter in the query
  - The job then calls `generatePatternFromOutcome()` (line 286-298), which writes to the global `decision_patterns` table
  - While this data is intentionally cross-product, the *processing* should still respect tenant boundaries (e.g., paused/archived products)
- **Remediation:** Add `JOIN products p ON d.product_id = p.id WHERE p.status = 'active'` to the scenario accuracy query to ensure only active tenants' data is processed.
- **Target Phase:** Phase 2

### MTI-05 In-Memory Prose Cache Keyed by Product ID Without Eviction on Ownership Change
- **Severity:** P2
- **Description:** The Signal prose cache in `src/services/signal.ts` (line 45) is a global `Map<string, CacheEntry>` keyed by `productId`. The cache has a 30-minute TTL. While this doesn't directly leak data across tenants (the product ID is validated before `computeSignal` is called), there are two concerns:
  1. If a product is transferred between founders (not currently supported but inevitable for a multi-company platform), cached prose from the previous owner would be served to the new owner.
  2. The cache has no maximum size bound — an attacker could trigger cache growth by creating many products (if provisioning is unrestricted).
  3. The `invalidateSignalCache()` function exists but is only called from the ingest route, not from lifecycle transitions, risk state changes, or decision resolutions.
- **Evidence:**
  - `src/services/signal.ts` lines 45-46, 164-172 — unbounded `Map`, TTL only
  - `src/services/signal.ts` line 337 — `invalidateSignalCache` only called from ingest
- **Remediation:** (a) Add a max-size LRU bound to the cache. (b) Call `invalidateSignalCache` on all state-changing events. (c) If product ownership transfer is ever implemented, clear the cache for that product.
- **Target Phase:** Phase 3

### MTI-06 Console Logs Leak Product Names, Founder IDs, and Product IDs Across Tenants
- **Severity:** P2
- **Description:** All 26+ cron jobs in `src/jobs/index.ts` use `console.log` and `console.error` extensively, logging product names (`p.name`), product IDs (`p.id`), founder IDs (`f.id`), Signal scores, risk state transitions, insight headlines, and error stack traces to shared stdout. In any shared logging infrastructure (Fly.io log drain, Datadog, etc.), these logs are visible to anyone with log access — there is no tenant-scoped log partitioning. Specific concerns:
  1. Product names are business-identifying: `[JOB] competitive_scan: AcmeApp — 4 signals` reveals that AcmeApp is a Foundry customer
  2. Risk state transitions: `[JOB] weekly_synthesis: AcmeApp — risk green→red` reveals confidential business health
  3. Daily insight headlines: `[JOB] daily_insight_generate: generated for AcmeApp — "Revenue concentration risk is..."` leaks AI analysis
  4. Error logs include full `err` objects which may contain request data
- **Evidence:**
  - `src/jobs/index.ts` — 46+ log lines containing `p.name`, `p.id`, or `f.id` (see grep results)
  - No structured logging — raw `console.log/error` without log level, trace ID, or tenant isolation
  - 422 total `console.*` occurrences across 40 files (per orientation doc)
- **Remediation:** (a) Replace all `console.*` with a structured logger that redacts or hashes tenant-identifying fields. (b) Use product IDs (not names) in logs. (c) Implement log partitioning or tenant-scoped log access.
- **Target Phase:** Phase 2

### MTI-07 Decision Patterns Table Accepts Non-Anonymized Metric Ranges
- **Severity:** P2
- **Description:** The `decision_patterns` table is documented as "intentionally cross-product and anonymized" but the `key_metrics_context` column stores raw JSON metric ranges (e.g., `{"mrr_range": "10k-50k", "retention_range": "60-70"}`). While these are ranges rather than exact values, combined with `market_category`, `product_lifecycle_stage`, and `decision_type`, a small-n attack is feasible: if only 2-3 products exist in a given market category at a given lifecycle stage, the metric ranges can identify specific companies. The `getRelevantPatterns()` function returns `SELECT * FROM decision_patterns` — all columns including `key_metrics_context` — to any product that queries for patterns.
- **Evidence:**
  - `src/db/schema.sql` lines 265-287 — table schema shows no product/founder reference (good) but `key_metrics_context` and `market_category` together can de-anonymize
  - `src/db/client.ts` lines 216-231 — `getRelevantPatterns()` returns `SELECT *` including all fields
  - `src/services/decisions/patterns.ts` lines 9-32 — `generatePatternFromOutcome()` writes raw metric context
  - `src/db/seed.ts` line 250 — seed data shows `{"mrr_range": "10k-50k"}` format
- **Remediation:** (a) Add a minimum k-anonymity check: refuse to return patterns from cohorts with fewer than 5 contributing products. (b) Strip or further generalize `key_metrics_context` before writing — use quintile labels ("Q1", "Q2") instead of ranges. (c) Never return `key_metrics_context` to callers — only use it internally for matching.
- **Target Phase:** Phase 3

### MTI-08 Stressor Cleanup Job Operates Globally Without Status Verification
- **Severity:** P3
- **Description:** The `stressorCleanup()` job (line 349) runs a global `UPDATE stressor_history SET status = 'escalated' WHERE status = 'active' AND ...` across all products. While this is functionally correct (stressors are product-scoped by their `product_id` column), it does not filter by `p.status = 'active'`, meaning stressors for archived or paused products are still being escalated, potentially triggering downstream effects.
- **Evidence:**
  - `src/jobs/index.ts` lines 352-354 — no product status filter
- **Remediation:** Add `AND product_id IN (SELECT id FROM products WHERE status = 'active')` to the query.
- **Target Phase:** Phase 3

### MTI-09 Benchmark Contributions Table Contains Product IDs (Not Truly Anonymized)
- **Severity:** P2
- **Description:** The `benchmark_contributions` table includes a `product_id` column. While the benchmarks displayed to users are aggregated percentiles, the raw contribution table links specific metric values to specific products. Any code path that queries `benchmark_contributions` by `product_id` can retrieve a specific product's submitted metrics, potentially bypassing the tenant isolation of the `metric_snapshots` table.
- **Evidence:**
  - `src/services/benchmarking/pool.ts` lines 36-48 — `submitBenchmark()` writes `product_id`
  - `src/services/benchmarking/pool.ts` lines 96-99 — `getBenchmarkSummary()` queries by `product_id` to get "your value"
  - The `product_id` is needed for the "your value vs. percentile" comparison, but it means the raw data table is not anonymous
- **Remediation:** Either (a) hash the `product_id` in the contributions table so it cannot be joined back to the products table from SQL alone, or (b) ensure no route or service exposes raw `benchmark_contributions` rows — only pre-computed percentiles.
- **Target Phase:** Phase 3

### MTI-10 Benchmarks Route Reads Global `benchmark_percentiles` Table Without Sector/Stage Filtering
- **Severity:** P3
- **Description:** The `GET /benchmarks` route (line 58-68) queries `benchmark_percentiles` with only `metric_name IN (...)` — no `lifecycle_state` or `company_category` filter. This means the percentiles shown include data from all lifecycle stages and all company categories mixed together, rather than comparing the product against its actual cohort. This is a data quality issue more than a direct leak, but it means a growth-stage company sees percentiles polluted by pre-revenue companies.
- **Evidence:**
  - `src/routes/dashboard/benchmarks.ts` lines 64-68 — no `lifecycle_state` or `company_category` filter
  - Compare to `src/services/benchmarking/pool.ts` `refreshPercentiles()` which computes per-segment percentiles
- **Remediation:** Filter `benchmark_percentiles` by the product's `lifecycle_state` and `company_category` when displaying.
- **Target Phase:** Phase 3

### MTI-11 Rate Limiter Uses Shared In-Memory Store Across All Tenants
- **Severity:** P3
- **Description:** The rate limiter (`src/middleware/rate-limit.ts`) uses a single global `Map<string, RateLimitEntry>`. For authenticated routes, the key function is not specified, so it falls back to IP address (`x-forwarded-for`). This means: (a) multiple founders behind the same corporate NAT/VPN share rate limit budgets, and (b) a targeted attacker could exhaust another founder's rate limit by spoofing the same IP in the `x-forwarded-for` header (if the proxy chain doesn't strip it).
- **Evidence:**
  - `src/middleware/rate-limit.ts` lines 9, 30-33 — global `Map`, IP-based key for all routes
  - `src/index.ts` line 333 — `apiRateLimit` applied globally, no founder-scoped key
- **Remediation:** For authenticated routes, use the founder ID as the rate limit key: `rateLimit(120, 60000, (c) => c.get('founder')?.id ?? 'unknown')`.
- **Target Phase:** Phase 3

### MTI-12 Cookie-Based Product Switcher Trusts Cookie Value
- **Severity:** P3
- **Description:** The product switcher in `_shared.ts` reads the `foundry_product` cookie to select which product's data to display. While the `getProductsByOwner()` call filters products to those owned by the authenticated founder (line 57), and the cookie value is matched against this filtered list (line 99), the cookie itself is set from a POST handler that correctly validates ownership (`switch-product` handler at index.ts:103-116). This is properly implemented.
- **Evidence:**
  - `src/routes/dashboard/_shared.ts` lines 94-100 — cookie read, matched against owned products
  - `src/routes/dashboard/index.ts` lines 103-116 — validates ownership before setting cookie
- **Remediation:** None required. This is correctly implemented. Noted for completeness.
- **Target Phase:** N/A (no action needed)

### MTI-13 Portfolio API Key Stored in Plaintext
- **Severity:** P1
- **Description:** Portfolio API keys (`pfk_*` format) are stored as plaintext in the `portfolios.api_key` column. Unlike the product-level API keys (`fnd_*`) which are SHA-256 hashed before storage, portfolio keys can be read directly from the database. Anyone with database read access (including SQL injection, backup leaks, or compromised Turso credentials) gains full portfolio API access.
- **Evidence:**
  - `src/services/portfolio/manager.ts` line 29 — `pfk_${nanoid(32)}` stored directly
  - `src/services/portfolio/manager.ts` line 237 — `WHERE api_key = ?` — plaintext comparison
  - Compare to `src/services/rbac/permissions.ts` lines 42-48, 135 — product API keys use SHA-256 hashing
  - `src/db/migrations/033_portfolio_mode.sql` line 59 — `CREATE INDEX ... ON portfolios(api_key)` — index on plaintext key
- **Remediation:** Hash portfolio API keys the same way product keys are hashed: SHA-256 on write, compare hashes on read. Store only the key prefix for display.
- **Target Phase:** Phase 2

## Embarrassment Test

1. **Founder A reads Founder B's full MRR, risk state, and stressor data** by calling `GET /api/portfolios/{any_id}/overview` with a valid auth token. The endpoint has zero ownership checks. This is reachable today by any authenticated user.
2. **Founder A stops Founder B's running experiment** by calling `POST /api/experiments/{guessable_nanoid}/stop`. The experiment ID is the only authorization. If nanoid output is ever exposed (in logs, share links, or API responses), this is trivially exploitable.
3. **Any holder of the ecosystem service key** (which is a single shared secret) can call `GET /internal/operator/dashboard-data?product_id=ANY_ID` and receive the complete operational state of any product — MRR decomposition, churn rate, stressor list, decision count, lifecycle stage — all in one JSON response.

## Pride Test

1. **The tenant middleware pattern is well-designed.** The `tenantMiddleware` in `src/middleware/tenant.ts` correctly validates product ownership via `getProductByOwner(productId, founder.id)` and returns 404 (not 403) to prevent information leakage about product existence. This is the right pattern — it just needs to be applied consistently.
2. **The product switcher is correctly isolated.** The `foundry_product` cookie flows through `getProductsByOwner(founder.id)` which filters to owned products only, and the `switch-product` handler validates ownership before setting the cookie. No cross-tenant access via cookie manipulation.
3. **The product-level API key system uses proper cryptographic practices.** Keys are SHA-256 hashed before storage, prefix is stored for display, expiry and revocation are supported, and `validateApiKey` returns the scoped `productId` for downstream enforcement. The API v1 routes consistently use `productId` from the middleware context, not from user input.
4. **The `decision_patterns` table is architecturally correct.** It genuinely contains no product_id or founder_id columns. The anonymization intent is real, even if the metric context granularity needs tightening (see MTI-07).
5. **Core dashboard routes consistently use the `_shared.ts` context helper.** The `getLayoutContext()` function always calls `getProductsByOwner(founder.id)` first, ensuring the product list is scoped to the authenticated founder. This is a solid "secure by default" pattern for the majority of dashboard pages.
