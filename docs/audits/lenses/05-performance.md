# Lens 05 — Performance Audit

**Perspective:** Performance Engineer  
**Auditor focus:** Response times, database query efficiency, bundle size, caching strategy, N+1 queries, unnecessary re-computation, and whether the system can handle 100+ products with 12 agents each without degrading.

---

## P0 — System Unusable at Scale

### P0-01: 26+ cron jobs iterate ALL products sequentially — O(N) AI calls with no concurrency control

**Files:** `src/jobs/index.ts` (1865 lines), `src/services/scp/scheduler.ts`

Every scheduled job calls `getAllActiveProducts()` then loops `for (const row of products.rows)`. With 100 products:

- `scp_agent_runner` (hourly): iterates all products, each product runs up to 12 agents sequentially. Each agent makes 10+ DB queries and 1 Claude API call (seconds each). At 100 products x 12 agents x ~5s per agent = **~100 minutes per hourly cycle** — the job cannot complete before the next invocation.
- `scp_evolution_cycle` (daily): iterates ALL products x ALL 12 agents = 1,200 sequential AI calls.
- `daily_insight_generate` (daily): 1 Claude Opus call per product — 100 Opus calls sequentially.
- `weekly_plan_generate` (weekly): 1 Claude Opus call per product.
- `morning_briefings` (daily): voice briefing generation per product.
- `scp_daily_briefing` (daily): briefing generation per product.

There are **57 sequential product loops** across the job file and **4 uses of Promise.all** (only in data-fetching within a single product, never across products). No concurrency limiter (p-limit, p-queue, worker threads) is used anywhere. Jobs running on the same single-threaded Node process as HTTP serving will starve request handling.

**Impact:** At 100 products, hourly agent runs cannot complete in an hour. Daily jobs will stack up. The system becomes a perpetual backlog machine.

### P0-02: BaseAgent loads 10+ sequential queries per agent run — 120+ queries per product per cycle

**File:** `src/services/scp/agents/base.ts`

Each agent `run()` call executes at minimum:
1. `getOrCreateInstance` (1 query)
2. `INSERT INTO agent_sessions` (1 query)
3. `SELECT name FROM products` (1 query)
4. `getGoldenLessons` (1 query)
5. `SELECT * FROM scp_constitutions` (1 query)
6. `_loadAgentConfig` (1 query)
7. `_loadIntegrationEvents` (1 query)
8. `_loadUnreadMessages` (1 query)
9. `_processInitiatives` (1+ queries)
10. `getScratchpadContext` (1 query)
11. Then `analyzeAndAct()` — subclass-specific, typically 3-10 more queries
12. Post-run updates: 3-5 more queries (session update, instance update, cost log, scratchpad write)

**Per product per hour:** 12 agents x ~15 queries = **~180 DB queries**. At 100 products: **~18,000 DB queries per hourly cycle**, all sequential. Many of these queries (constitution, golden lessons, product name) are identical across agents for the same product but are re-fetched every time.

### P0-03: `getNextAction()` executes up to 10 sequential queries — called on every authenticated page load

**File:** `src/services/ux/next-action.ts`

The "Your Move" engine performs a cascade of up to 10 `await query()` calls in sequence, short-circuiting only when a match is found. In the best case (red risk state): 1 query. In the common "all clear" case: **10 sequential queries**. This runs on every single dashboard page because `_shared.ts` calls it as part of `getLayoutContext()`.

Combined with the layout context queries (see P1-01), this means every page load is gated behind a waterfall of sequential DB round-trips.

---

## P1 — Noticeable Slowness

### P1-01: Dashboard page load requires 15+ database queries with sequential waterfalls

**Files:** `src/routes/dashboard/index.ts`, `src/routes/dashboard/_shared.ts`

A single `/dashboard` page load executes:

**Phase 1 — `getLayoutContext()` in `_shared.ts`:**
1. `getProductsByOwner(founder.id)` — 1 query
2. `getLifecycleState(productId)` — 1 query
3. `getProductDNA(productId)` — 1 query (inside `wisdom/dna.ts` does `SELECT * FROM product_dna`)
4. `query("SELECT COUNT(*) ... FROM remediation_prs")` — 1 query
5. `getNextAction(founder, productId)` — **up to 10 queries** (sequential cascade)
6. `getUnreadNotifications(founder.id)` — 1 query
7. `getUnreadCount(founder.id)` — 1 query
8. `getUnseenMilestones(founder.id)` — 1 query
9. `getTourState(founder.id)` — 1 query

Steps 5-9 are parallelized via `Promise.all`, but step 5 alone can be 10 sequential queries. Steps 1-4 are sequential.

**Phase 2 — Dashboard route handler:**
10. `computeSignal(productId)` — 4 parallel queries + 1 AI call (Sonnet, with 30-min cache) + 1 write
11. `getActiveStressors(productId)` — 1 query
12. `getSignalHistory(productId, 60)` — 1 query
13. `getDailyInsight(productId)` — 1 query
14. `getPreviousSignalScore(productId)` — 1 query
15. `getLatestBriefing(productId)` — 1 query

Steps 10-15 are parallelized via `Promise.all`.

**Total: 20-30 DB queries per dashboard load.** With the AI prose call (when cache misses), the page can take 3-5+ seconds.

### P1-02: `SELECT *` used in 301 occurrences across 132 files — always fetching full rows

**Files:** All service and route files

301 `SELECT *` queries across the codebase. For tables like `audit_log`, `agent_sessions`, `metric_snapshots`, and `competitive_signals` that contain large text/JSON columns (reasoning, observations, actions_taken, etc.), this pulls potentially kilobytes of data per row when only an `id` or `count` is needed.

Examples:
- `getActiveStressors` returns `SELECT *` when the dashboard only uses `severity` and `stressor_name`
- `getLatestAudit` returns `SELECT *` from `audit_scores` which has 10-dimension JSON columns
- `getLifecycleState` returns `SELECT *` from a table with 20+ columns when callers typically use 2-3 fields

### P1-03: No HTTP response compression — 55KB CSS served uncompressed, full HTML pages uncompressed

**Files:** `src/index.ts`, `src/public/styles.css`

- `styles.css` is 55,692 bytes (1,444 lines), served without gzip/brotli. Would compress to ~8-10KB.
- No `compress` or `hono/compress` middleware is configured anywhere.
- No `ETag` or `If-None-Match` headers on any response — every page load re-sends the full HTML.
- No `Content-Encoding` header is set on any response.
- Full HTML pages (layout + sidebar + command palette + inline scripts) are sent on every navigation. The layout alone (`src/views/layout.ts`) includes an inline command palette with 27 routes and substantial inline JavaScript.

### P1-04: Static files read from disk on every request via `readFileSync`

**File:** `src/index.ts` (lines 179-210)

```typescript
app.get('/static/:file', (c) => {
  // ...
  try { readFileSync(filePath); } catch {
    filePath = resolve(__dirname, '../src/public', fileName);
  }
  const content = readFileSync(filePath, 'utf-8');
```

Every `/static/styles.css` request calls `readFileSync` twice — once to probe the path, once to read the content. There is no in-memory caching of file contents. The `Cache-Control: public, max-age=3600` header is set, but:
- No cache-busting hash in filenames, so the browser may use stale CSS after deployments
- The server still does filesystem I/O on every request that bypasses browser cache

### P1-05: HTMX barely used — full page reloads dominate navigation

**Files:** `src/views/layout.ts`, all route files

HTMX is loaded on every page (`<script src="https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js" defer>`) but only 3 files use any `hx-*` attributes (totaling 13 occurrences). The only real HTMX usage is:
- `hx-get="/api/priority/one-thing"` on the "One Thing" banner (loaded on every dashboard page)
- Onboarding chat
- Priority API

Every sidebar link triggers a full page reload, which means:
- Full HTML re-render on server
- Full `getLayoutContext()` execution (15+ queries)
- Full CSS/JS re-download (if not cached)
- Full DOM teardown and rebuild

For a dashboard product where users click through 5-10 pages per session, this means 100-300 redundant DB queries and 5-10 redundant full HTML renders per session.

### P1-06: HTMX loaded from unpkg CDN on every page — no local copy, no integrity hash

**File:** `src/views/layout.ts` (line 71)

```html
<script src="https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js" defer></script>
```

- External CDN dependency on every page load. If unpkg is slow or down, pages degrade.
- No `integrity` attribute — supply chain risk.
- No local fallback.
- The library is 14KB gzipped but adds a DNS lookup + TLS handshake to every first page load.

### P1-07: `navBadgeRefresh` job fires 7 queries per product every 6 hours — duplicates work done at page-load time

**File:** `src/jobs/index.ts` (lines 559-597)

This job fires 7 queries per product (pending decisions, last audit, unread signals, open PRs, unseen milestones, DNA completion, lifecycle_state update) to pre-cache nav badge counts. But `getLayoutContext()` also fetches this data on every page load from the `lifecycle_state` table. At 100 products: 700 queries every 6 hours just for nav badges.

The badge data could be updated incrementally (on decision create/resolve, PR open/merge, etc.) instead of via periodic full-scan.

### P1-08: `computeSignal()` called by both page loads AND the `signalAlertCheck` job — double computation

**Files:** `src/services/signal.ts`, `src/jobs/index.ts`

`signalAlertCheck` runs every 2 hours, iterating all products and calling `computeSignal()` for each. `computeSignal()` is also called on every `/dashboard` page load. The prose cache (in-memory `Map`) only has a 30-minute TTL, so:
- Job computes signal for all 100 products every 2 hours
- Page loads recompute signal (with possible AI call) if cache has expired
- Signal history is UPSERTed on every computation

The signal computation itself is 4 parallel queries + conditional AI call — not cheap.

### P1-09: In-memory rate limiter and prose cache do not survive deployments or scale to multiple instances

**Files:** `src/middleware/rate-limit.ts`, `src/services/signal.ts`

Rate limiting uses an in-memory `Map` (`store`). Signal prose uses an in-memory `Map` (`proseCache`). On Fly.io:
- Each deploy kills the process — all cached prose expires, triggering AI calls on next page loads
- If scaled to 2+ instances, each has independent rate limit and cache state
- Rate limits are per-instance, not per-customer — a user hitting different instances gets 2x the limit

### P1-10: `weeklySynthesis` job executes ~10 sequential queries per product before any intelligence work

**File:** `src/jobs/index.ts` (lines 74-154)

For each product, this job fetches: lifecycle_state, MRR decomposition, latest metrics, prior metrics, latest cohort, historical average retention, competitive signals, growth stage, founder lifestyle_mode, then runs stressor identification (AI call), fetches active stressors again, fetches oldest pending gate3 age, runs risk assessment, and potentially generates recovery protocol (another AI call).

That is ~12 sequential DB queries + 1-2 AI calls **per product**, and none of the DB queries are batched or parallelized within a single product iteration.

---

## P2 — Efficiency Improvements

### P2-01: `batch()` function exists in `db/client.ts` but is only used by seed files

**File:** `src/db/client.ts` (lines 35-44)

The Turso client supports `db.batch(statements, 'write')` for transactional batch execution, and a `batch()` helper is exported. However, `grep` shows it is only imported in `seed.ts` and `seed-demo.ts`. No production code uses it.

Many jobs perform multiple writes per product that could be batched: session inserts, instance updates, audit log writes, metric snapshots.

### P2-02: No database connection pooling or keep-alive configuration

**File:** `src/db/client.ts`

The Turso client is a singleton (`_client`), which is correct for SQLite. However, for Turso's HTTP-based remote connections, there is no configuration for:
- Connection keep-alive
- Request pipelining
- Timeout settings

Each query is an independent HTTP request to Turso's edge. Sequential queries suffer full round-trip latency each time.

### P2-03: `approveDecision` / `denyDecision` scan last 50 sessions to find a decision

**File:** `src/services/scp/instance.ts` (lines 195-252)

To approve/deny a decision, the code:
1. Fetches the last 50 `agent_sessions` rows (with all JSON columns via `SELECT *`)
2. Parses JSON `pending_decisions` from each row
3. Searches for the matching decision ID
4. Updates the session row

This is O(50 * sizeof(sessions)) per decision approval. A proper lookup index or dedicated decisions table with a foreign key would be O(1).

### P2-04: No query result caching for hot data (lifecycle_state, product records)

Product records and lifecycle_state are fetched on every page load and by every job iteration, but are only updated by scheduled jobs (typically once per day). A short-TTL in-memory cache (30-60 seconds) for these hot-path reads would eliminate the majority of DB round-trips during active user sessions.

### P2-05: Service worker caches only 2 assets

**File:** `src/public/sw.js`

```javascript
const SHELL_ASSETS = [
  '/static/styles.css',
  '/manifest.json',
];
```

Only CSS and manifest are pre-cached. The HTMX library (loaded from CDN) is not cached by the service worker. Icons are not pre-cached. No HTML shell caching strategy for offline-first dashboard loads.

---

## Summary: Query Count Analysis

### Single `/dashboard` page load
| Phase | Queries | Notes |
|-------|---------|-------|
| `getLayoutContext` (sequential) | 4 | products, lifecycle, DNA, PR count |
| `getLayoutContext` (parallel) | 5-14 | nextAction (1-10), notifications (2), milestones (1), tour (1) |
| Dashboard handler (parallel) | 6-7 | signal (4 parallel + upsert), stressors, history, insight, prev score, briefing |
| **Total** | **15-25** | Plus conditional AI call if prose cache miss |

### Hourly SCP agent cycle (100 products)
| Component | Queries | Notes |
|-----------|---------|-------|
| Product listing | 1 | `getAllActiveProducts` |
| Per-product agent setup | ~180 | 12 agents x 15 queries each |
| Per-product AI calls | 12 | One Claude call per agent |
| **Total** | **~18,000 queries + 1,200 AI calls** | All sequential, single-threaded |

### Scaling projection (100 products, 12 agents)
| Metric | Current | At 100 products |
|--------|---------|-----------------|
| Hourly agent queries | ~180 | ~18,000 |
| Hourly AI calls | ~12 | ~1,200 |
| Hourly agent cycle time | ~60s | **~100 min (overflow)** |
| Daily job queries | ~500 | ~50,000+ |
| Daily AI calls | ~30 | ~3,000+ |
| Dashboard page load queries | 15-25 | 15-25 (per-user, unchanged) |

---

## Recommended Priority Actions

1. **P0: Add concurrency control to job scheduler** — Use `p-limit` or similar to run N products in parallel (e.g., 5-10 concurrent). Add job-level mutex to prevent overlapping hourly runs.
2. **P0: Share context across agents within a product** — Load product, constitution, golden lessons once per product run, pass to all 12 agents. Cuts per-product queries from ~180 to ~60.
3. **P0: Move long-running jobs to background workers** — Separate the Hono HTTP process from the cron job process. Jobs currently compete with HTTP requests for the single-threaded event loop.
4. **P1: Add response compression** — `app.use('*', compress())` from `hono/compress`. Immediate 70-80% size reduction on HTML and CSS responses.
5. **P1: Adopt HTMX partial rendering** — The sidebar, header, and command palette are identical across pages. Use `hx-boost` for navigation to only swap `<main>` content, eliminating redundant layout rendering and DB queries.
6. **P1: Add in-memory cache for hot DB reads** — Cache `lifecycle_state`, `products`, and `product_dna` with 30-60s TTL. These change at most once per job cycle.
7. **P1: Replace `SELECT *` with column lists** — Especially on hot paths: `getActiveStressors`, `getLatestMetrics`, `getPendingDecisions`, `getLifecycleState`.
8. **P1: Self-host HTMX** — Copy to `/static/htmx.min.js` with content hash in filename. Eliminates CDN dependency and adds cache-busting.
9. **P1: Cache static file contents in memory** — Read files once at startup, serve from memory. Eliminates `readFileSync` on every request.
10. **P2: Use `batch()` for multi-write operations** — Agent session completion writes (session update + instance update + cost log + scratchpad) should be a single batch.
