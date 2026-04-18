# Lens 123 — Memory Budget Under Fleet Load

**Auditor perspective:** Edge-case hunter / domain adversary — will 25 products x 12 agents fit in 1GB?
**Distinct-value declaration:** Inventories every in-memory data structure (caches, Maps, rate-limit stores, module state) and projects aggregate memory consumption at fleet scale. No prior lens quantified total in-process memory.
**Tenancy-critical:** Yes. All in-memory state is shared across companies in a single process. A noisy neighbor's cache entries consume memory from all other tenants.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P1 | 2 |
| P2 | 3 |

---

## In-Memory Data Structures Inventory

### 1. Signal Prose Cache (`src/services/signal.ts:45-46`)

```typescript
const proseCache = new Map<string, CacheEntry>();
```

- **Key:** `productId` (string, ~21 bytes nanoid)
- **Value:** `{ prose: string, score: number, expires: number }` -- prose is ~200-500 chars
- **Size per entry:** ~600 bytes
- **At 25 products:** ~15 KB
- **TTL:** 30 minutes, no max-size bound
- **Risk:** Low. Even at 100 products this is under 100 KB.

### 2. AI Daily Spend Tracker (`src/services/ai/client.ts:20-34`)

```typescript
const dailySpend = new Map<string, { cents: number; date: string }>();
```

- **Key:** `productId` (string)
- **Value:** `{ cents: number, date: string }` -- ~40 bytes
- **At 25 products:** ~1.5 KB
- **Cleanup:** Entries are replaced daily (keyed by date), never explicitly deleted
- **Risk:** Negligible. Old entries accumulate but at 40 bytes each, even 1000 entries = 40 KB.

### 3. Rate Limit Store (`src/middleware/rate-limit.ts:13`)

```typescript
const store = new Map<string, RateLimitEntry>();
```

- **Key:** IP address or founder ID (string, ~15-40 bytes)
- **Value:** `{ count: number, resetAt: number }` -- ~20 bytes
- **Cleanup:** `setInterval` every 60s removes expired entries
- **At 25 concurrent users + bots:** ~50-200 entries = ~3-12 KB
- **Risk:** Low under normal use. Under DDoS with unique IPs, could grow unbounded until the 60s cleanup fires. At 10K unique IPs/minute: ~600 KB before cleanup.

### 4. Node.js Module Cache (V8 heap)

All 288 TypeScript source files are compiled to JS and loaded into memory at startup. The jobs file alone is 1866 lines. The views components file is 1277 lines. The types barrel is 1528 lines.

- **Estimated module heap:** ~20-40 MB for the full import tree
- **Third-party packages:** `@anthropic-ai/sdk`, `stripe`, `hono`, `cron`, `nanoid`, etc.
- **Estimated total package heap:** ~30-60 MB

### 5. CronJob Instances (`src/index.ts:469`)

72 `CronJob` objects live in memory for the lifetime of the process. Each holds a reference to an async function, schedule metadata, and internal timers.

- **Per CronJob:** ~1-2 KB
- **72 jobs:** ~100-150 KB
- **Risk:** Negligible.

### 6. Dynamic Imports Within Jobs

Several jobs use `await import(...)` inside their execution function. Node.js caches dynamic imports after first resolution, so these add to the heap on first invocation but not on subsequent ones. There are approximately 20 dynamic imports across jobs.

- **Additional heap after first full job cycle:** ~5-10 MB (lazy-loaded service modules)

### 7. Hono App Route Table

The Hono app has 100+ registered routes and 60+ middleware bindings. Each is a function reference in the router trie.

- **Estimated:** ~2-5 MB for the router data structure

### 8. Agent Session Data (Transient)

During an agent run, `BaseAgent.run()` holds the full `AgentRunContext` in memory: product name, golden lessons array, constitution object, agent config, integration events, unread messages, and scratchpad context. Plus the Claude API response (up to 8192 tokens of output text).

- **Per active agent session:** ~50-200 KB (depending on context size)
- **Peak during hourly cycle (12 agents sequential):** Only 1 active at a time = ~200 KB peak
- **Risk:** Low, because agents run sequentially. If concurrency is added (recommended), this multiplies by the concurrency factor.

---

## Memory Budget Projection

| Component | At 1 Product | At 25 Products | At 100 Products |
|-----------|-------------|----------------|-----------------|
| Base heap (Node.js + packages) | 60 MB | 60 MB | 60 MB |
| Module cache (all services) | 35 MB | 35 MB | 35 MB |
| Hono router | 3 MB | 3 MB | 3 MB |
| Prose cache | 0.6 KB | 15 KB | 60 KB |
| AI spend tracker | 0.04 KB | 1 KB | 4 KB |
| Rate limit store | 3 KB | 12 KB | 50 KB |
| CronJob instances | 150 KB | 150 KB | 150 KB |
| Dynamic import overhead | 8 MB | 8 MB | 8 MB |
| Active agent session | 200 KB | 200 KB | 200 KB |
| V8 GC overhead (~30%) | 32 MB | 32 MB | 32 MB |
| **Total estimated** | **~140 MB** | **~140 MB** | **~140 MB** |

---

## MB-01. Memory scales with USERS, not with COMPANIES -- but no limit exists

**Severity: P2**

The in-memory data structures are keyed by product ID (prose cache, spend tracker) and by IP/founder (rate limiter). At 25 products, the per-company overhead is negligible (~16 KB). Memory is dominated by the static Node.js heap (~100 MB) and V8 garbage collection overhead.

**However:** The rate limit store has no maximum size. Under a distributed attack with unique source IPs, it could grow to tens of megabytes before the 60-second cleanup fires. The prose cache also has no max-size bound, though it is keyed by product ID (bounded at product count).

---

## MB-02. 1GB is sufficient for 25 products but leaves no room for response buffering

**Severity: P1**

At ~140 MB base + ~30-60 MB during peak job execution, the steady-state memory is ~200 MB. This leaves ~800 MB headroom in a 1GB container.

**But:** Hono's response handling buffers full HTML responses in memory before sending. Dashboard pages with full layout, sidebar, command palette, and inline JavaScript are ~30-80 KB each. Under concurrent requests from 25 founders, that is 25 x 80 KB = 2 MB of response buffers -- negligible.

The real risk is during AI calls: the Anthropic SDK buffers the full response in memory. A Claude Opus response with 8192 output tokens at ~4 bytes/token = ~32 KB per response. Even with 12 concurrent responses (if concurrency is added), that is only ~384 KB.

**The actual memory risk is Turso query results:** If a `SELECT *` query returns 100 rows with large JSON columns (e.g., `agent_sessions.pending_decisions`, `briefings.agent_contributions`), each result set could be 100-500 KB. The 302 `SELECT *` occurrences across 132 files mean large result sets are routinely loaded into memory and discarded after use, creating GC pressure.

---

## MB-03. No memory monitoring or OOM protection

**Severity: P1**

There is no `process.memoryUsage()` logging, no heap size alerting, and no `--max-old-space-size` flag in the Dockerfile CMD. Node.js defaults to ~1.5 GB heap limit on a 2GB+ system, but on a 1GB Fly.io machine, the OOM killer will terminate the process before V8's GC can reclaim memory.

**Evidence:**
- `Dockerfile:19`: `CMD ["node", "dist/index.js"]` -- no `--max-old-space-size` flag
- No `process.memoryUsage()` calls anywhere in the codebase
- No health check endpoint reports memory usage

---

## MB-04. In-memory caches are lost on every deploy

**Severity: P2**

The prose cache, AI spend tracker, and rate limit store are all in-memory Maps. Every Fly.io deploy kills the process and restarts a new one, resetting all caches.

**Impact:**
- **Prose cache:** First 25 dashboard loads after deploy each trigger a Sonnet AI call (~$0.01-0.05 each). Cost: ~$0.25-1.25 per deploy.
- **AI spend tracker:** Daily cost ceiling resets to zero. If a product was at $24.99 (just under the $25 ceiling), the deploy resets the counter and allows another $25 of spend. On a day with 3 deploys, the effective ceiling is $75.
- **Rate limiter:** All rate limit counters reset. An attacker timing requests around deploys gets unlimited requests during the restart window.

---

## MB-05. SELECT * with large JSON columns creates GC pressure spikes

**Severity: P2**

302 occurrences of `SELECT *` across 132 files. Tables with large JSON/text columns include:

| Table | Large Columns | Typical Row Size |
|-------|--------------|-----------------|
| `agent_sessions` | `observations` (JSON), `actions_taken` (JSON), `pending_decisions` (JSON), `briefing_contribution` (text) | 2-10 KB |
| `scp_briefings` | `agent_contributions` (JSON), `headline` (text), `html_content` (text) | 5-20 KB |
| `audit_scores` | 10 dimension columns (JSON each) | 3-8 KB |
| `competitive_signals` | `details` (JSON) | 1-3 KB |

The `approveDecision` path (instance.ts:198-224) fetches the last 50 `agent_sessions` rows with `SELECT *`, parses JSON from each, and searches for a matching decision. At 10 KB per row, this loads 500 KB into memory per decision approval.

---

## Verdict

**25 products x 12 agents will fit in 1GB.** The estimated steady-state is ~200 MB with ~800 MB headroom. The memory does not scale significantly with company count because in-memory caches are small (keyed by product ID, not by data volume) and agent runs are sequential (only one agent's context in memory at a time).

**Risks are:**
1. OOM from unbounded rate limit store under DDoS
2. GC pressure from `SELECT *` on large-row tables during concurrent requests
3. AI spend ceiling bypass on deploy (in-memory counter resets)
4. No visibility into memory usage (no monitoring)

---

## Recommendations

1. **Add `--max-old-space-size=768` to the Dockerfile CMD** -- Leave 256 MB for the OS and container overhead.
2. **Add a max-size bound to the rate limit store** -- Evict oldest entries when the Map exceeds 10,000 entries.
3. **Log `process.memoryUsage()` on the health check endpoint** -- Surface RSS, heap used, and heap total.
4. **Replace `SELECT *` on hot paths with column lists** -- Especially `agent_sessions`, `scp_briefings`, and `audit_scores`.
5. **Move the AI spend tracker to the database** -- `agent_cost_log` already exists. Query `SUM(cost_usd) WHERE logged_at >= today` instead of maintaining an in-memory counter that resets on deploy.
