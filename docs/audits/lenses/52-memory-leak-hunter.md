# Lens 52 — Memory Leak Hunter

**Auditor perspective:** Long-running Node.js process with 72 cron jobs, in-memory caches, event listeners, closure captures, and growing Maps. The process runs indefinitely on Fly.io with no restart schedule.

**Date:** 2026-04-16
**Codebase snapshot:** ~288 TypeScript files, single long-running process, 72 cron jobs

---

## Executive Summary

Foundry runs as a single Node.js process that never restarts except during deploys. It maintains at least 5 unbounded in-memory Maps, 72 CronJob instances that are never cleaned up, and multiple fire-and-forget promises that capture closures over request-scoped data. The most critical leak is the rate limiter's `store` Map which grows with every unique IP and only purges on a 60-second interval — under sustained load, this Map grows faster than it purges. The `dailySpend` Map in the AI client grows by one entry per product per day and is never cleaned. The `proseCache` has a TTL but no size bound, so it grows linearly with the number of products. None of these will crash the server in the first week, but on a long-running production instance serving hundreds of products, memory will steadily climb until Fly.io's OOM killer terminates the process ungracefully.

---

## Findings

### MEM-01. Rate Limiter Map Grows Unbounded Under DDoS or Scan Traffic

**Severity: P1**

The rate limiter (`src/middleware/rate-limit.ts:13`) uses `const store = new Map<string, RateLimitEntry>()`. Every unique IP address creates an entry. The cleanup interval at line 16 runs every 60 seconds and deletes expired entries, but under a DDoS or bot scan (thousands of unique IPs per second), the Map grows far faster than the 60-second cleanup can purge it.

**Evidence:**
- `src/middleware/rate-limit.ts:13` — `const store = new Map<string, RateLimitEntry>()`
- Line 16-19: cleanup runs `setInterval(() => { ... }, 60000)` — 60-second sweep
- Line 33-34: `store.set(key, entry)` on every request from an unknown IP
- No `store.size` check, no max entries cap
- Window is 60 seconds (`windowMs`), so entries have a 60-second lifetime, but under 10K unique IPs/second, the Map reaches 600K entries before cleanup runs

**Remediation:** Add a max size guard: `if (store.size > 100_000) { /* purge oldest or reject */ }`. Better: use an LRU cache with a hard cap (e.g., `lru-cache` package). For production, move rate limiting to Cloudflare or Fly.io's proxy layer.

**Target phase:** P1

---

### MEM-02. AI Daily Spend Map Never Purges Old Entries

**Severity: P1**

`src/services/ai/client.ts:20` — `const dailySpend = new Map<string, { cents: number; date: string }>()`. Each product gets one entry. When the date rolls over, the entry is replaced (not deleted) — but only if that product makes an AI call on the new day. Products that stop making AI calls (paused, archived) leave stale entries in the Map forever.

**Evidence:**
- `src/services/ai/client.ts:20` — `const dailySpend = new Map<...>()`
- `recordSpend()` at line 22-34: replaces entry if date differs, but never deletes old entries
- `getDailySpend()` at line 36-40: reads but doesn't purge
- Over months of operation with product churn, the Map accumulates entries for every product that ever existed

**Remediation:** Add a daily cleanup sweep (e.g., in the `metric_snapshot` cron job) that calls a new `purgeStaleDailySpend()` function. Or simpler: use a `WeakRef`-based approach, or check `dailySpend.size` and purge entries with stale dates if size exceeds a threshold.

**Target phase:** P1

---

### MEM-03. Signal Prose Cache Has No Size Bound

**Severity: P1**

`src/services/signal.ts:45` — `const proseCache = new Map<string, CacheEntry>()`. Each product gets one entry with a 30-minute TTL. The TTL-based expiry works correctly for individual entries, but the Map never deletes entries for products that are no longer queried. Over time, the cache grows to hold one entry per product that was ever accessed.

**Evidence:**
- `src/services/signal.ts:45` — `const proseCache = new Map<string, CacheEntry>()`
- `CACHE_TTL_MS = 30 * 60 * 1000` at line 46 — entries expire after 30 minutes
- `getOrGenerateProse()` at line 156-173: checks TTL and replaces, but never deletes expired entries it doesn't access
- `invalidateSignalCache()` at line 337 deletes one entry at a time, only when explicitly called
- No periodic sweep of expired entries

**Remediation:** Add a sweep that runs every N minutes: `for (const [key, entry] of proseCache) { if (entry.expires < now) proseCache.delete(key); }`. Or use `lru-cache` with `maxSize` and `ttl` options.

**Target phase:** P2

---

### MEM-04. CronJob Instances Are Never Stopped on Shutdown

**Severity: P2**

`src/index.ts:465-481` creates 72+ `CronJob` instances via `new CronJob(...)`. The graceful shutdown handler at line 542-555 notes "The CronJob instances will be garbage-collected" but does not call `.stop()` on them. CronJob instances register internal `setTimeout` handles that prevent garbage collection until stopped.

**Evidence:**
- `src/index.ts:468` — `new CronJob(job.schedule, async () => { ... }, null, true, 'UTC')`
- Line 548-549: Comment says "Stop accepting new cron jobs / The CronJob instances will be garbage-collected" — but no `.stop()` is called
- The `cron` library's `CronJob` holds internal timer references that prevent GC
- During the 4-second drain window (`setTimeout(() => process.exit(0), 4000)`), cron jobs can still fire

**Remediation:** Store CronJob instances in an array and call `.stop()` on each during `gracefulShutdown()`. This also prevents jobs from firing during the drain window.

**Target phase:** P2

---

### MEM-05. Fire-and-Forget Promises Capture Closures Over Large Objects

**Severity: P2**

Multiple locations use the `void somePromise()` pattern (fire-and-forget), which captures closures over potentially large objects that cannot be GC'd until the promise settles.

**Evidence:**
- `src/services/signal.ts:130` — `void recordSignalSnapshot(productId, score, tier, ...)` — captures `stressors`, `metrics`, `decisions` arrays in the outer scope
- `src/middleware/auth.ts:128` — `query('UPDATE founders...').catch(() => {})` — captures the entire `founder` object
- `src/services/api/webhooks.ts:155` — `void deliverToWebhook(...)` — captures the full `payload` object until all 3 retry attempts complete (up to 7 seconds)
- Each of these individually is small, but under load (100 concurrent requests, each with 3 fire-and-forget promises), the accumulated closures can hold megabytes of unreclaimable data

**Remediation:** For simple DB updates (auth.ts:128), the pattern is fine. For webhook delivery (up to 3 retries with exponential backoff), consider adding the delivery to a queue table and processing asynchronously. For signal snapshots, extract only the needed fields before the async call.

**Target phase:** P2

---

### MEM-06. `setInterval` for Rate Limiter Cleanup Prevents Graceful Module Unloading

**Severity: P3**

`src/middleware/rate-limit.ts:16` — `setInterval(() => { ... }, 60000)` runs forever and is never cleared. This prevents the module from being unloaded in test environments and keeps the process alive even after the HTTP server stops.

**Evidence:**
- `src/middleware/rate-limit.ts:16-19` — `setInterval` with no handle storage
- No `clearInterval()` in any shutdown path
- In test environments, this interval keeps the Node.js process from exiting naturally

**Remediation:** Store the interval handle (`const cleanupInterval = setInterval(...)`) and export a `cleanup()` function that calls `clearInterval(cleanupInterval)`. Call this from `gracefulShutdown()`.

**Target phase:** P3

---

### MEM-07. In-Memory Maps in Integration Services Accumulate Per-Sync

**Severity: P2**

Several integration sync services create `new Map()` instances during each sync cycle that are not explicitly cleared:

**Evidence:**
- `src/services/integrations/job-signals.ts:121` — `const competitorMap = new Map<string, {...}>()` — created per sync, should be GC'd after function returns, but if the sync is long-running and the outer scope captures it, it persists
- `src/services/integrations/calendar-intel.ts:75` — `const weekMap = new Map<...>()` per analysis
- `src/services/scp/temporal.ts:102,108,114` — three Maps per temporal analysis
- These are function-scoped and should be GC'd correctly, but combined with the fire-and-forget patterns from MEM-05, they may be retained longer than expected

**Remediation:** These are lower risk since they are function-scoped. Monitor heap usage over time. If leaks are detected, add explicit `.clear()` at function end.

**Target phase:** P3

---

## Embarrassment Test

1. **"The rate limiter Map can grow to millions of entries during a bot scan and OOM-kill the production process"** — The cleanup interval cannot keep up with sustained high-cardinality traffic.

2. **"Cron jobs keep firing during the 4-second graceful shutdown drain, including AI-calling jobs that may start a 2-minute Claude call right before process death"** — `CronJob.stop()` is never called.

3. **"The AI cost ceiling resets to $0 on every deploy, and stale product entries accumulate in the dailySpend Map forever"** — The cost control mechanism is both unreliable and leaky.

## Pride Test

1. The prose cache has a TTL mechanism (`CACHE_TTL_MS = 30 * 60 * 1000`) with score-drift-based invalidation (`SCORE_DRIFT_THRESHOLD = 5`), which is a thoughtful cache invalidation strategy even if the size is unbounded.

2. The `invalidateSignalCache()` function is correctly called from integration sync services (Intercom, Stripe, PostHog) when data changes, ensuring cache coherence on write paths.

3. The `batch()` function in `db/client.ts` correctly uses Turso's `'write'` mode for transactional multi-statement operations, avoiding the need for application-level transaction management.

## Distinct-Value Declaration

This lens analyzes the runtime memory profile of a long-running Node.js process — the interaction between in-memory Maps, setInterval handles, closure captures, and fire-and-forget promises. No Tier 1 lens examines the growth characteristics of runtime data structures or the GC-prevention effects of timer handles. The SRE lens may note "no memory monitoring" but cannot identify which specific data structures leak.

## Tenancy-Critical Flag

**MEM-02** (dailySpend Map) is tenancy-critical: the AI cost ceiling is per-product, and if the Map's size impacts performance (hash table rehashing under millions of entries), AI calls for all products slow down. **MEM-03** (proseCache) could theoretically serve one product's cached prose to another if a cache key collision occurred (unlikely since keys are nanoid product IDs, but the cache has no tenant isolation validation on read).
