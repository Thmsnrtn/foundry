# Lens 124 — Query N+1 Hunter (Deep)

**Auditor perspective:** Edge-case hunter / domain adversary — trace specific N+1 query patterns
**Distinct-value declaration:** Goes beyond general "sequential loops" to identify the exact code paths where iterating N items generates N additional queries, with per-path query counts and database evidence. Prior lenses (05, 01) noted the pattern generically; this lens traces each instance.
**Tenancy-critical:** Yes. Every N+1 pattern multiplies by company count. At 25 companies with 12 agents each, a single N+1 in the agent pipeline generates 300 extra queries per cycle.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P0 | 1 |
| P1 | 4 |
| P2 | 3 |

---

## NP-01. SCP Agent Runner: N products x 12 agents x 15 queries (O(N*12*15))

**Severity: P0**
**Files:** `src/services/scp/scheduler.ts:29-58`, `src/services/scp/instance.ts:143-179`, `src/services/scp/agents/base.ts:36-150`

The hourly agent runner is a triple-nested sequential loop:

```
for product in products:                    # N products
  for agent in due_agents(product):         # up to 12 agents
    agent.run(product_id)                   # 15-25 queries + 1 AI call
```

**Inner-loop queries per agent (base.ts:36-150):**
1. `getOrCreateInstance` -- SELECT agent_instances WHERE product_id AND agent_name
2. INSERT agent_sessions
3. SELECT name FROM products WHERE id (redundant -- same product every agent)
4. SELECT golden_suite WHERE product_id AND agent_name
5. SELECT scp_constitutions WHERE product_id (redundant -- same constitution every agent)
6. SELECT agent_config WHERE product_id AND agent_name
7. SELECT integration_events WHERE product_id AND created_at > last_run
8. SELECT agent_messages WHERE target_agent AND product_id AND read_at IS NULL
9. _processInitiatives (1+ queries)
10. getScratchpadContext (1 query)
11. analyzeAndAct -- 3-10 subclass queries + 1 AI call
12-15. Post-run: UPDATE agent_sessions, UPDATE agent_instances, INSERT agent_cost_log, scratchpad write

**Queries 3 and 5 are pure N+1 anti-patterns:** Product name and constitution are identical for all 12 agents of the same product but fetched 12 times. At 25 products: 25 x 12 x 2 = 600 redundant queries.

**Query 4 (golden lessons) could be batched:** Load all golden lessons for all agents of a product in one query with `WHERE product_id=?` and partition in memory.

**At 25 products:** ~6,000-7,500 total queries per hourly cycle. With shared context: ~4,500-5,500.

---

## NP-02. `weeklySynthesis`: 12+ sequential queries per product, 2 are N+1 across products

**Severity: P1**
**Files:** `src/jobs/index.ts:75-154`

For each product in the active products list:

```
lifecycle_state = SELECT * WHERE product_id
mrr = getMRRDecomposition(product_id)        # 1-2 queries
metrics = getLatestMetrics(product_id)       # 1 query
prior_metrics = SELECT ... OFFSET 1          # 1 query
cohort = getLatestCohortSummary(product_id)  # 1 query
historical_avg = getHistoricalAverage(...)   # 1 query
comp_signals = SELECT ... WHERE product_id   # 1 query
founder = SELECT lifestyle_mode FROM founders WHERE id = owner_id  # 1 query (N+1: same founder for all their products)
identifyStressors(...)                       # AI call
activeStressors = getActiveStressors(...)    # 1 query
pendingGate3Age = getOldestPendingGate3Age(...)  # 1 query
assessRiskState(...)                         # pure function
transitionRiskState(...)                     # 1-2 writes
generateRecoveryProtocol(...)               # conditional AI call
```

**The `SELECT lifestyle_mode FROM founders WHERE id=?` at line 100 is an N+1:** If a founder has 5 products, this query runs 5 times with the same founder ID. Should be fetched once per founder, not per product.

**At 25 products:** ~300 queries + 25-50 AI calls. The founder lookup is redundant for multi-product founders.

---

## NP-03. `navBadgeRefresh`: 7 queries per product, runs every 6 hours

**Severity: P1**
**Files:** `src/jobs/index.ts:559-597`

```
for product in products:
  pendingDecisions = SELECT COUNT(*) FROM decisions WHERE product_id AND status='pending'
  lastAudit = SELECT created_at FROM audit_scores WHERE product_id ORDER BY ... LIMIT 1
  unreadSignals = SELECT COUNT(*) FROM competitive_signals WHERE product_id AND acknowledged=0
  openPRs = SELECT COUNT(*) FROM remediation_prs WHERE product_id AND status='pr_open'
  unseenMilestones = SELECT COUNT(*) FROM milestone_events WHERE product_id AND seen_at IS NULL
  dna = getProductDNA(product_id)  # 1 query
  UPDATE lifecycle_state SET ... WHERE product_id
```

7 queries per product. At 25 products: 175 queries every 6 hours.

**Fix:** All 5 COUNT queries could be a single query using subqueries or CTEs:
```sql
SELECT
  (SELECT COUNT(*) FROM decisions WHERE product_id=? AND status='pending') as pending,
  (SELECT COUNT(*) FROM audit_scores WHERE product_id=? ORDER BY created_at DESC LIMIT 1) as last_audit,
  ...
```

Or batch all 25 products in a single query with `GROUP BY product_id`.

---

## NP-04. `digestGenerate`: N founders x M products x 2 queries each

**Severity: P1**
**Files:** `src/jobs/index.ts:158-183`

```
for founder in founders_with_tier:
  products = SELECT id, name FROM products WHERE owner_id=? AND status='active'
  for product in products:
    lifecycle = SELECT risk_state FROM lifecycle_state WHERE product_id=?
    digest = generateDigest(product_id, riskState, type)  # AI call + queries
    sendDigestEmail(...)
```

The `SELECT risk_state FROM lifecycle_state WHERE product_id=?` inside the inner loop is an N+1. It could be joined into the product query:
```sql
SELECT p.id, p.name, ls.risk_state
FROM products p LEFT JOIN lifecycle_state ls ON p.id = ls.product_id
WHERE p.owner_id=? AND p.status='active'
```

At 10 founders x 2.5 products each: 25 redundant queries.

---

## NP-05. `approveDecision` / `denyDecision`: scans last 50 sessions

**Severity: P1**
**Files:** `src/services/scp/instance.ts:195-252`

```typescript
const sessionsResult = await query(
  `SELECT id, pending_decisions FROM agent_sessions
   WHERE product_id=? AND pending_decisions IS NOT NULL
   ORDER BY started_at DESC LIMIT 50`,
  [this.productId]
);
for (const row of sessionsResult.rows) {
  const decisions = JSON.parse(row.pending_decisions);
  const idx = decisions.findIndex(d => d.id === decisionId);
  if (idx === -1) continue;
  // Found -- update this row
  await query(`UPDATE agent_sessions SET pending_decisions=? WHERE id=?`, ...);
  await query(`UPDATE agent_instances SET total_decisions_approved=... WHERE product_id=? AND agent_name=?`, ...);
  return;
}
```

This is O(50) in DB fetches but O(50 * decisions_per_session) in JSON parsing. If each session has 3 pending decisions, that is 150 JSON parses to find one decision by ID.

A direct query would be O(1): store decisions in their own table with an indexed `id` column, or at minimum use a SQL JSON function: `WHERE pending_decisions LIKE '%"id":"' || ? || '"%'`.

---

## NP-06. `remediationOutcomeCheck`: 2 GitHub API calls per open PR

**Severity: P2**
**Files:** `src/jobs/index.ts:477-538`

```
for pr in open_prs:
  merged = isPRMerged(owner, repo, prNumber, token)   # GitHub API call
  if merged: ... continue
  open = isPROpen(owner, repo, prNumber, token)        # GitHub API call (if not merged)
```

Each open PR generates 1-2 GitHub API calls. At 25 products with 3 open PRs each: 75-150 GitHub API calls. GitHub's rate limit is 5000/hour per token. If all products share the same token (or a few tokens), this could consume 3% of the hourly budget just for PR checks.

**Fix:** Batch PR status checks using GraphQL or the list-PRs endpoint with filters.

---

## NP-07. `signalAlertCheck`: `computeSignal` re-queries data already in the job context

**Severity: P2**
**Files:** `src/jobs/index.ts:601-660`

```
for product in products:
  prev = SELECT score, tier FROM signal_history WHERE product_id=?   # 1 query
  signal = computeSignal(product_id)   # 4 parallel queries + possible AI call + UPSERT
```

`computeSignal` fetches stressors, metrics, decisions, and lifecycle -- but `signalAlertCheck` only uses the resulting `score` and `tier`. The job could use a lightweight `getLatestSignalScore` query instead of recomputing the full signal (which also triggers prose generation and history UPSERT).

At 25 products: 25 x 6 queries = 150 queries every 2 hours, mostly redundant.

---

## NP-08. `coldStartCheck` / `milestoneCheck` / `stageDetection`: identical patterns

**Severity: P2**
**Files:** `src/jobs/index.ts:220-252, 541-557, 1636-1653`

All three jobs follow the same pattern:
```
products = getAllActiveProducts()  # 1 query
for product in products:
  count/result = query(... WHERE product_id=?)  # 1+ queries per product
```

Each iterates all active products and does 1-3 queries per product. At 25 products each: 25-75 queries per job. Combined (3 jobs): 75-225 queries.

**Fix:** Batch queries that operate on all products into single queries with `GROUP BY product_id` or `WHERE product_id IN (...)`.

---

## Aggregate N+1 Query Impact (25 Products)

| Job / Path | Frequency | Extra Queries from N+1 | Fix |
|-----------|-----------|----------------------|-----|
| Agent runner (shared context) | Hourly | ~600/cycle | Load once per product |
| Weekly synthesis (founder lookup) | Weekly | ~25 | Join or pre-fetch |
| Nav badge refresh (7 per product) | Every 6h | ~100 (could be 1) | Single aggregation query |
| Digest generate (lifecycle join) | Weekly | ~25 | JOIN in product query |
| Approve/deny decision (session scan) | Per action | ~50 per approval | Decision table or JSON search |
| Signal alert (full recompute) | Every 2h | ~125 | Lightweight score query |
| **Total preventable queries/day** | | **~3,000-5,000** | |

---

## Recommendations

1. **Shared agent context** (NP-01) -- Load product, constitution, golden lessons once in `runAllDueAgents`, pass to each agent. Biggest single win: ~600 queries/hour saved.
2. **Batch navBadgeRefresh** (NP-03) -- Single aggregation query across all products with CTEs or subqueries.
3. **JOIN lifecycle into product queries** (NP-04) -- Wherever `SELECT ... FROM products` is followed by `SELECT ... FROM lifecycle_state WHERE product_id`, join them.
4. **Dedicated decision lookup** (NP-05) -- Either a `decisions` table with indexed ID or a SQL JSON path query.
5. **Lightweight signal score path** (NP-07) -- Add `getLatestSignalScore(productId)` that reads from `signal_history` without recomputing.
