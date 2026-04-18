# Lens 56 — Caching Strategy Reviewer

**Auditor perspective:** In-memory caches (signalCache, prose cache, dailySpend), invalidation correctness, TTL settings, size bounds, cross-request contamination, and cache coherence in a multi-product SaaS.

**Date:** 2026-04-16
**Codebase snapshot:** 5+ in-memory Maps serving as caches, no external cache layer (no Redis)

---

## Executive Summary

Foundry uses four in-memory Maps as caches: the Signal prose cache, the AI daily spend tracker, the rate limiter store, and the Turso client singleton. None have size bounds. Only the prose cache has a TTL mechanism, and it does not proactively evict expired entries. Cache invalidation exists for the prose cache (called from 4 integration sync paths) but is missing for scenarios where stressor resolution, decision approval, or risk state transitions should trigger re-computation. The caches are keyed by product ID, which provides tenant isolation, but there is no validation that the requesting user owns the product whose cached data they receive. The absence of any external cache layer means all cached state is lost on deploy, creating a "cold start storm" where every product's Signal triggers a Claude Sonnet call simultaneously.

---

## Findings

### CACHE-01. Prose Cache Cold Start Storm After Deploy

**Severity: P1**

The prose cache (`src/services/signal.ts:45`) is emptied on every deploy (process restart). When the first N founders log in simultaneously after a deploy, each triggers `computeSignal()` which calls `callSonnet()` to generate prose. With 50 active products, this is 50 concurrent Sonnet API calls in the first minutes after deploy.

**Evidence:**
- `src/services/signal.ts:45` — `const proseCache = new Map<string, CacheEntry>()` — in-memory, lost on restart
- `getOrGenerateProse()` at line 156-173 — cache miss triggers `callSonnet()` with 256 max tokens
- No warm-up mechanism after deploy
- No staggering or debounce on cache misses
- At $3/M input tokens + $15/M output tokens, 50 concurrent calls cost roughly $0.50 but create a latency spike

**Remediation:** Add a cache warm-up step after server start that pre-generates prose for the most recently active products. Or, persist the cache to the database (a `signal_prose_cache` table) and read from DB on cache miss before falling back to AI generation. Add a debounce: if a prose generation is already in-flight for a product, wait for it rather than starting a duplicate.

**Target phase:** P1

---

### CACHE-02. Prose Cache Does Not Invalidate on State-Changing Events

**Severity: P1**

`invalidateSignalCache()` is called from 4 integration sync paths (Intercom, Stripe, PostHog, and the ingest endpoint). However, it is NOT called when:
- A decision is approved/rejected (changes backlog penalty)
- A stressor is resolved (changes stressor penalty)
- A risk state transition occurs (changes risk ceiling)
- A lifecycle stage advances (changes lifecycle bonus)

This means the Signal prose displayed to the founder can be stale for up to 30 minutes (the TTL) after a significant state change.

**Evidence:**
- `src/services/signal.ts:337-339` — `invalidateSignalCache(productId)` — deletes cache entry
- Called from: `src/services/integrations/intercom.ts:94`, `stripe.ts:152,185,199`, `posthog.ts:88`, `src/routes/ingest/index.ts:130`
- NOT called from: `src/services/decisions/queue.ts`, `src/services/intelligence/risk-state.ts`, `src/services/lifecycle/monitor.ts`
- The `SCORE_DRIFT_THRESHOLD = 5` at line 47 provides some protection: if the score changes by 5+ points, the cache is bypassed. But stressor resolution or decision approval might change the score by only 3 points — within the drift threshold — so the stale prose is served.

**Remediation:** Call `invalidateSignalCache(productId)` in `resolveDecision()`, `transitionRiskState()`, and `evaluateConditions()` (lifecycle advancement). Or, reduce the TTL from 30 minutes to 5 minutes (the cost of regeneration is low: one Sonnet call at ~256 tokens).

**Target phase:** P1

---

### CACHE-03. No Size Bound on Any In-Memory Cache

**Severity: P1**

None of the 4+ in-memory Maps have a maximum size:

**Evidence:**
- `src/services/signal.ts:45` — `proseCache` — grows by 1 entry per product
- `src/services/ai/client.ts:20` — `dailySpend` — grows by 1 entry per product
- `src/middleware/rate-limit.ts:13` — `store` — grows by 1 entry per unique IP
- All use `new Map()` with no size limit
- Node.js Maps can grow until OOM, with no graceful degradation

**Remediation:** For all caches, add a max size check before inserting: `if (cache.size > MAX_SIZE) { evictOldest(); }`. Or use `lru-cache` which provides `max` and `ttl` options. For the rate limiter, a max of 50K-100K entries is reasonable. For prose and spend caches, max of 10K entries (matching max expected products).

**Target phase:** P1

---

### CACHE-04. Rate Limiter Cache Has No Consistent Eviction Under Memory Pressure

**Severity: P2**

The rate limiter cleanup (`src/middleware/rate-limit.ts:16-19`) runs every 60 seconds and deletes entries where `resetAt < now`. This works for normal traffic but provides no defense against memory pressure from high-cardinality keys. If the process is under memory pressure from other sources (large AI responses, webhook payloads), the rate limiter Map may be a significant contributor but has no mechanism to shed entries.

**Evidence:**
- `src/middleware/rate-limit.ts:16-19` — `setInterval(() => { ... }, 60000)` — fixed 60-second interval
- No `store.size` monitoring
- No emergency eviction path (e.g., "if size > 50K, delete all expired + oldest 10%")
- The cleanup runs even when `store.size === 0`, wasting a small amount of CPU

**Remediation:** Add a size check before inserting: `if (store.size > 50_000) { /* purge all expired, then oldest 20% */ }`. Monitor `store.size` in the health check endpoint.

**Target phase:** P2

---

### CACHE-05. AI Daily Spend Cache Produces Incorrect Readings After Date Rollover

**Severity: P2**

`src/services/ai/client.ts:28-33` — `recordSpend()` replaces the entry if the date differs. But `isCostCeilingReached()` at line 43-45 reads the entry and checks if `cents >= DAILY_COST_CEILING_CENTS`. If the date has rolled over but the product hasn't made an AI call yet today, the stale entry from yesterday is read, and if yesterday's spend was high, the ceiling check incorrectly blocks today's calls.

**Evidence:**
- `src/services/ai/client.ts:36-40` — `getDailySpend()` checks `entry.date !== today` and returns 0 if dates differ — this is correct
- `isCostCeilingReached()` at line 43-45 calls `getDailySpend()` which correctly returns 0 for stale dates
- Actually, on closer inspection, the date check in `getDailySpend` is correct. The real issue is that the Map retains entries for every product that ever made an AI call, which is a memory concern (see MEM-02 in Lens 52) rather than a correctness concern.

**Remediation:** The correctness is fine. Address the memory growth issue per Lens 52 MEM-02 recommendations.

**Target phase:** P3 (correctness OK, memory issue covered in Lens 52)

---

### CACHE-06. No Cache Metrics or Observability

**Severity: P2**

None of the caches expose hit/miss rates, size, or eviction counts. Without these metrics, it is impossible to tune TTLs, detect cache poisoning, or diagnose performance regressions caused by cache misses.

**Evidence:**
- No cache hit/miss counters anywhere in the codebase
- The health endpoint (`src/routes/internal/health.ts`) does not report cache sizes
- No logging of cache misses that trigger AI calls
- Without observability, the 30-minute prose cache TTL is a guess — it could be too long (stale data) or too short (excessive AI calls)

**Remediation:** Add cache size and hit rate to the health endpoint: `{ prose_cache_size, prose_cache_hit_rate, rate_limit_store_size, daily_spend_entries }`. Log cache misses that trigger AI calls at `debug` level.

**Target phase:** P2

---

## Embarrassment Test

1. **"A deploy causes a cold start storm: all active products simultaneously call Claude Sonnet to regenerate cached prose, creating a latency spike and a burst of API costs"** — No warm-up, no debounce, no persistence.

2. **"A founder approves a critical decision, but the Signal prose still shows the old stale briefing for up to 30 minutes because `invalidateSignalCache` is not called from the decision resolution path"** — The cache invalidation is incomplete for the most important user-facing feature.

3. **"None of the 4+ in-memory caches have a size bound, so a bot scan or large fleet of products can grow the Maps until the process OOMs"** — No defense against unbounded growth.

## Pride Test

1. The prose cache invalidation is correctly called from all 4 integration sync paths (Intercom, Stripe, PostHog, ingest), showing awareness of write-through invalidation.

2. The `SCORE_DRIFT_THRESHOLD = 5` provides a content-aware invalidation heuristic: the cache is bypassed when the underlying score changes significantly, reducing stale reads even when TTL hasn't expired.

3. The `buildFallbackProse()` function (`src/services/signal.ts:220-250`) provides a deterministic fallback when AI prose generation fails, ensuring the Signal page always renders even during API outages.

## Distinct-Value Declaration

This lens analyzes cache coherence semantics across distributed state changes — specifically, which state mutations should trigger cache invalidation but don't. No Tier 1 lens traces the data flow from "decision approved" through "Signal score changes" to "cached prose is now stale." This lens also identifies the cold-start storm pattern specific to in-memory caches in a deploy-on-every-push deployment model.

## Tenancy-Critical Flag

**CACHE-02** is tenancy-critical: one tenant's state change (decision approval) may not invalidate their cache, causing them to see stale data. However, there is no cross-tenant cache contamination risk since all caches are keyed by product ID.
