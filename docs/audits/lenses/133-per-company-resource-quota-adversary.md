# Lens 133 — Per-Company Resource Quota Adversary

**Auditor perspective:** Edge-case hunter / domain adversary — noisy neighbor protection
**Distinct-value declaration:** Tests whether one company with excessive data (1000 decisions, 500 agent sessions, 200 stressors) can degrade performance for all other companies. Maps resource boundaries that exist vs. those missing.
**Tenancy-critical:** Yes. This is the core noisy-neighbor problem in multi-tenant systems.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P1 | 2 |
| P2 | 3 |

---

## Existing Resource Limits

| Resource | Limit | Enforcement |
|----------|-------|-------------|
| AI spend per product per day | $25 (2500 cents) | In-memory check in `isCostCeilingReached()` |
| Products per tier | Solo: 1, Growth: 1, IR: 5 | Only at creation time (`select-repo` handler) |
| API rate limit | 120 req/min | In-memory per-instance |
| Auth rate limit | 10 req/min | In-memory per-instance |

## Missing Resource Limits

| Resource | Current Limit | Risk |
|----------|--------------|------|
| Decisions per product | Unlimited | DB growth, `approveDecision` scans last 50 sessions |
| Agent sessions per product | Unlimited | DB growth, `SELECT *` on sessions table |
| Stressors per product | Unlimited | Signal score computation scans all active stressors |
| Competitive signals per product | Unlimited | Scan queries have no LIMIT |
| Transcript ingestion per product | Unlimited | Each triggers an AI analysis call |
| Metric snapshots per product | 1/day (job ensures this) | Accumulates forever, no retention policy |
| Audit scores per product | Unlimited | Remediation PR check iterates all open PRs |
| Notifications per founder | Unlimited | Unread notification query scans all |
| Voice sessions per product | Unlimited | Each can trigger AI analysis |

---

## RQ-01. `approveDecision` scans 50 sessions regardless of total session count

**Severity: P1**
**Files:** `src/services/scp/instance.ts:195-224`

The `approveDecision` method fetches the last 50 agent sessions with `pending_decisions IS NOT NULL`, then iterates each row, parsing JSON and searching for the decision by ID. With a noisy product that has thousands of sessions, the LIMIT 50 caps the scan, but the JSON parsing of 50 rows (each potentially 2-10 KB) is still expensive.

More critically: if the target decision is older than the 50th session, it will never be found. The decision becomes permanently unapproved.

**Evidence:**
- `src/services/scp/instance.ts:198-203`: `ORDER BY started_at DESC LIMIT 50`
- No index on `pending_decisions` content (it is a JSON text column)
- If a product generates 50+ sessions between decision proposal and founder action, the decision is lost

**Impact at scale:** A product running 12 agents hourly generates 12 sessions/hour = 288 sessions/day. The LIMIT 50 window covers only ~4 hours. Any decision not approved within 4 hours becomes unreachable.

---

## RQ-02. `getNextAction()` cascade queries all active stressors, all pending decisions, all PRs

**Severity: P1**
**Files:** `src/services/ux/next-action.ts`

The "Your Move" engine runs on every authenticated page load and queries up to 10 tables sequentially to find the highest-priority action. For a product with 200 active stressors, 100 pending decisions, and 50 open PRs, each query scans the full table (filtered by product_id).

There are no per-product row count limits on these tables. A noisy product with thousands of rows will slow down every page load for that founder, and since the Node.js process is shared, it will also delay responses to other founders' requests.

**Evidence:**
- `src/services/ux/next-action.ts`: Sequential cascade of 10 queries with no LIMIT on row counts
- `src/services/signal.ts:79-82`: `stressors.filter(s => s.severity === 'critical').length` -- loads ALL stressors into memory then filters in JS

---

## RQ-03. No data retention policy -- tables grow unbounded

**Severity: P2**
**Files:** `src/jobs/index.ts`, schema

The only cleanup job is `scpWebhookDeliveryCleanup` (deletes webhook deliveries older than 30 days) and `stressorCleanup` (escalates expired stressors). All other tables grow without bound:

| Table | Growth Rate (per product) | Retention |
|-------|--------------------------|-----------|
| `agent_sessions` | ~288 rows/day (12 agents x 24 hours) | Forever |
| `agent_cost_log` | ~288 rows/day | Forever |
| `metric_snapshots` | 1 row/day | Forever |
| `signal_history` | 1 row/day | Forever |
| `audit_log` | Variable (5-20 rows/day) | Forever |
| `competitive_signals` | Variable (weekly scan) | Forever |
| `notifications` | Variable (5-20 rows/day) | Forever |
| `decisions` | Variable | Forever |

At 25 products running for 1 year: `agent_sessions` alone accumulates 25 x 288 x 365 = 2.6 million rows.

---

## RQ-04. Transcript ingestion has no rate limit

**Severity: P2**
**Files:** `src/routes/api/webhooks/transcripts.ts`

The transcript webhook endpoints authenticate via API key but have no per-product rate limit. A misconfigured Fathom/Fireflies integration could send hundreds of transcripts per day, each triggering an `analyzeTranscript` AI call (fire-and-forget).

At ~$0.02 per analysis: 100 transcripts/day = $2/day. Not catastrophic but uncontrolled.

---

## RQ-05. `computeSignal` loads all stressors into memory

**Severity: P2**
**Files:** `src/services/signal.ts:60-82`

`computeSignal` calls `getActiveStressors(productId)` which returns `SELECT * FROM stressor_history WHERE product_id=? AND status='active'`. For a product with 200 active stressors, this loads all 200 rows (with full JSON columns) into memory. The code then iterates in JavaScript to count by severity.

A SQL `GROUP BY severity, COUNT(*)` would be far more efficient and avoid loading row data.

---

## Recommendations

1. **Move decisions to their own table** -- Instead of embedding in `agent_sessions.pending_decisions` JSON, create a `pending_decisions` table with indexed `id` and `product_id`. Eliminates the 50-session scan problem.
2. **Add per-product row limits** -- Cap `agent_sessions` at 1000 (rolling window), `notifications` at 500 (auto-archive old), `competitive_signals` at 200.
3. **Add data retention jobs** -- Delete `agent_sessions` older than 90 days, `agent_cost_log` older than 180 days, `signal_history` older than 365 days.
4. **Add LIMIT to all aggregation queries** -- `getActiveStressors` should use `SELECT severity, COUNT(*) GROUP BY severity` instead of loading all rows.
5. **Rate-limit transcript ingestion** -- Max 10 transcripts per product per day.
