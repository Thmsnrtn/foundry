# Lens 122 — Hot Path Profiling

**Auditor perspective:** Edge-case hunter / domain adversary — hot path query count and latency
**Distinct-value declaration:** Traces the exact DB query count and AI call count for the two hottest paths (dashboard page load, hourly agent run), identifying the 5 slowest operations with wall-clock estimates. No prior lens traced individual query chains to this granularity.
**Tenancy-critical:** Yes. Per-company query counts multiply across the fleet; at 25 companies the hourly agent run dominates server resources.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Hot Path 1: Dashboard Page Load

### Query Trace (single page load for one product)

**Phase A -- `getLayoutContext()` in `_shared.ts` (sequential + parallel):**

| # | Query | Source | Sequential? |
|---|-------|--------|-------------|
| 1 | `SELECT * FROM products WHERE owner_id=?` | `getProductsByOwner` | Sequential |
| 2 | `SELECT * FROM lifecycle_state WHERE product_id=?` | `getLifecycleState` | Sequential |
| 3 | `SELECT * FROM product_dna WHERE product_id=?` | `getProductDNA` | Sequential |
| 4 | `SELECT COUNT(*) FROM remediation_prs WHERE product_id=? AND status='pr_open'` | inline | Sequential |
| 5-14 | `getNextAction` cascade (up to 10 sequential queries) | `next-action.ts` | Parallel batch start |
| 15 | `SELECT * FROM notifications WHERE founder_id=? AND read_at IS NULL` | `getUnreadNotifications` | Parallel |
| 16 | `SELECT COUNT(*) FROM notifications WHERE founder_id=? AND read_at IS NULL` | `getUnreadCount` | Parallel |
| 17 | `SELECT * FROM milestone_events WHERE product_id=? AND seen_at IS NULL` | `getUnseenMilestones` | Parallel |
| 18 | `SELECT * FROM tour_state WHERE founder_id=?` | `getTourState` | Parallel |

Steps 5-18 run in a `Promise.all`, but step 5 internally does up to 10 sequential queries.

**Phase B -- Dashboard route handler (parallel):**

| # | Query | Source |
|---|-------|--------|
| 19-22 | 4 parallel queries in `computeSignal` | stressors, metrics, decisions, lifecycle |
| 23 | Conditional Claude Sonnet call (if prose cache miss) | `generateProse` |
| 24 | `INSERT/UPDATE signal_history` | UPSERT |
| 25 | `SELECT * FROM stressor_history WHERE product_id=? AND status='active'` | `getActiveStressors` |
| 26 | `SELECT * FROM signal_history WHERE product_id=? LIMIT 60` | signal sparkline |
| 27 | `SELECT * FROM daily_insights WHERE product_id=? ORDER BY ... LIMIT 1` | insight |
| 28 | `SELECT score FROM signal_history WHERE product_id=? ... OFFSET 1 LIMIT 1` | previous score |
| 29 | `SELECT * FROM scp_briefings WHERE product_id=? ORDER BY ... LIMIT 1` | briefing |

Steps 19-29 run in a `Promise.all`.

**Total: 18-28 DB queries + 0-1 AI call per dashboard load.**

### Latency Estimate

| Component | Optimistic | Pessimistic |
|-----------|-----------|-------------|
| Phase A sequential (4 queries) | 200ms | 400ms |
| Phase A parallel (14 queries max) | 100ms | 300ms |
| Phase B parallel (11 queries) | 100ms | 300ms |
| AI prose call (on cache miss) | 0ms (cached) | 3000ms |
| HTML rendering | 5ms | 15ms |
| **Total** | **~400ms** | **~4000ms** |

The ~4s worst case occurs on first visit after deploy (prose cache is empty, all queries cold).

---

## Hot Path 2: Hourly Agent Run (per product)

### Query Trace (one product, 12 agents due)

**Per-agent `BaseAgent.run()` query chain:**

| # | Query | Source |
|---|-------|--------|
| 1 | `SELECT * FROM agent_instances WHERE product_id=? AND agent_name=?` | `getOrCreateInstance` |
| 2 | `INSERT INTO agent_sessions (...)` | session creation |
| 3 | `SELECT name FROM products WHERE id=?` | company name |
| 4 | `SELECT * FROM golden_suite WHERE product_id=? AND agent_name=?` | golden lessons |
| 5 | `SELECT * FROM scp_constitutions WHERE product_id=?` | constitution |
| 6 | `SELECT * FROM agent_config WHERE product_id=? AND agent_name=?` | typed config |
| 7 | `SELECT * FROM integration_events WHERE product_id=? AND ... > last_run_at` | integration events |
| 8 | `SELECT * FROM agent_messages WHERE target_agent=? AND product_id=? AND read_at IS NULL` | unread messages |
| 9 | 1+ queries in `_processInitiatives` | initiatives check |
| 10 | `getScratchpadContext` (1 query) | coordination scratchpad |
| 11 | **Claude Sonnet/Opus API call** (2-60s) | `analyzeAndAct()` |
| 12-16 | 3-10 subclass-specific queries in `analyzeAndAct()` | varies by agent |
| 17 | `UPDATE agent_sessions SET status='completed' ...` | session update |
| 18 | `UPDATE agent_instances SET ... last_run_at=...` | instance update |
| 19 | `INSERT INTO agent_cost_log (...)` | cost tracking |
| 20 | Scratchpad write (1 query) | coordination |

**Per agent:** ~18-25 DB queries + 1 AI call
**Per product (12 agents):** ~216-300 DB queries + 12 AI calls
**All sequential** -- agents within a product run in a serial `for` loop.

### At Fleet Scale (25 Products)

| Metric | Per Product | 25 Products |
|--------|-----------|-------------|
| DB queries | ~250 | ~6,250 |
| AI calls | 12 | 300 |
| Wall-clock (5s/agent avg) | ~60s | ~1,500s (25 min) |
| Wall-clock (15s/agent avg) | ~180s | ~4,500s (75 min) |

Products are iterated sequentially (`for (const row of result.rows)`). At 25 products with Opus calls averaging 15s, the hourly cycle takes 75 minutes -- overflowing into the next hour.

---

## 5 Slowest Operations

### 1. `scp_evolution_cycle` -- 25 products x 12 agents x Opus call

**File:** `src/services/scp/scheduler.ts:92-114`
**Frequency:** Daily 4:00 UTC
**Cost:** `runEvolutionSynthesis` calls Claude Opus for each agent. At 25 products x 12 agents = 300 Opus calls. At 10-30s each = 50-150 minutes. All sequential (nested `for` loops with no concurrency).

### 2. `weekly_synthesis` -- 12+ sequential queries + 1-2 AI calls per product

**File:** `src/jobs/index.ts:75-154`
**Frequency:** Weekly (Friday 6:00 UTC)
**Cost:** Per product: ~12 sequential DB queries (MRR decomposition, metrics x2, cohort, historical avg, competitive signals, growth stage, founder lifestyle, stressor identification [AI call], active stressors, pending gate3, risk assessment, optional recovery protocol [AI call]). At 25 products: ~300 queries + 25-50 AI calls.

### 3. `daily_insight_generate` -- 1 Opus call per product

**File:** `src/jobs/index.ts:719-795`
**Frequency:** Daily 7:30 UTC
**Cost:** 25 sequential Opus calls at 5-15s each = 2-6 minutes. Plus 6 queries per product for context gathering.

### 4. `computeSignal` with prose cache miss -- 4 queries + 1 Sonnet call

**File:** `src/services/signal.ts:59-170`
**Frequency:** Every dashboard page load + every 2h via `signalAlertCheck`
**Cost:** The AI prose generation is gated by a 30-minute in-memory cache. After deploy (cache empty), the first 25 page loads each trigger a Sonnet call (~2-5s each). The `signalAlertCheck` job triggers `computeSignal` for all 25 products every 2 hours, potentially triggering 25 Sonnet calls if cache has expired.

### 5. `scp_debate_run` -- multi-agent AI debate per product

**File:** `src/jobs/index.ts:1456-1475`
**Frequency:** Daily 8:00 UTC
**Cost:** Calls `runDebateForProduct` which orchestrates challenger and synthesizer AI calls. At 25 products, this is 50+ AI calls (at minimum 2 per product) sequential.

---

## Shared Context Anti-Pattern

A critical inefficiency across all agent runs: queries 3, 4, and 5 (product name, golden lessons, constitution) return **identical data** for all 12 agents of the same product, but are executed 12 times. At 25 products: 25 x 12 x 3 = 900 redundant queries per hourly cycle.

**Files:** `src/services/scp/agents/base.ts:64-104` -- each agent independently fetches product name, golden lessons, and constitution.

**Fix:** Load shared context once per product in `SCPInstance.runAllDueAgents()` and inject it into each agent's `run()` call.

---

## Recommendations

1. **Share per-product context across agents** -- Load product, constitution, and golden lessons once; pass to all 12 agents. Eliminates ~900 queries/hour at 25 companies.
2. **Add concurrency to product iteration** -- Use `p-limit(5)` to run 5 products simultaneously in the scheduler and all jobs.
3. **Add wall-clock timeout to the hourly cycle** -- If the agent runner hasn't completed in 55 minutes, stop scheduling new products and let in-flight ones complete.
4. **Cache hot-path DB reads** -- `lifecycle_state`, `products`, `product_dna` change at most daily. A 60-second TTL cache would eliminate 50%+ of dashboard queries.
5. **Batch the per-agent post-run writes** -- Session update, instance update, cost log, and scratchpad write could be a single `db.batch()` call (4 queries -> 1 round-trip).
