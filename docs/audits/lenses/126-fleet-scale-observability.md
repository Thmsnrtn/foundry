# Lens 126 — Fleet-Scale Observability Adversary

**Auditor perspective:** Edge-case hunter / domain adversary — can you see what is wrong at a glance with 25 companies?
**Distinct-value declaration:** Evaluates whether the operator can diagnose fleet-wide issues (stalled agents, cost spikes, risk cascades) without per-company drill-down. No prior lens assessed the fleet observability surface.
**Tenancy-critical:** Yes. Fleet observability is fundamentally about cross-company visibility.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P1 | 3 |
| P2 | 2 |

---

## FO-01. No fleet dashboard exists

**Severity: P1**
**Files:** `src/routes/dashboard/`, `src/services/portfolio/manager.ts`

There is no route, page, or API endpoint that provides an at-a-glance view of all companies. The closest approximation is the portfolio overview (`getPortfolioOverview`), which aggregates MRR, risk states, and top performers -- but only for products explicitly added to a portfolio. There is no "all my companies" fleet view.

A founder with 5 products must click through each one individually to check:
- Agent health (12 agents x 5 products = 60 agent statuses)
- Risk states (5 separate lifecycle_state queries)
- Signal scores (5 separate signal computations)
- Pending decisions (5 separate decision counts)
- Cost (5 separate ai_cost_trailing_30d_usd values)

**Evidence:**
- No route file named `fleet.ts`, `overview.ts`, or `all-products.ts`
- `getPortfolioOverview` requires a portfolio to exist -- not automatic
- The product switcher (layout.ts:81) shows a dropdown of product names but no status indicators

---

## FO-02. Job execution has no fleet-level status dashboard

**Severity: P1**
**Files:** `src/jobs/index.ts`, `src/routes/internal/health.ts`

72 scheduled jobs run on a cron schedule with no visibility into:
- Which jobs are currently running
- How long each job took
- Which products failed within a job
- Whether the hourly agent cycle completed before the next one started

The health endpoint (`/internal/health`) returns basic process health but not job status. Job execution is logged via `logger.info/error` but there is no structured job execution table or API.

**Evidence:**
- `src/jobs/index.ts:1795-1866`: `JOB_REGISTRY` defines schedules but has no execution tracking
- `src/index.ts:469-476`: Jobs are fire-and-forget with `try/catch` error logging
- No `job_executions` table in the schema
- No `/internal/jobs/status` endpoint

**Impact:** When the hourly agent run takes 75 minutes (overflowing into the next cycle), there is no alert, no dashboard, and no way to detect the overlap without reading logs.

---

## FO-03. No cross-company risk correlation view

**Severity: P1**
**Files:** `src/services/intelligence/risk-state.ts`

Risk state transitions are per-company events. There is no mechanism to detect fleet-wide patterns:
- "3 of 5 companies transitioned to Yellow this week"
- "All companies in the SaaS sector are seeing churn spikes"
- "The average Signal score across the fleet dropped 12 points"

The `audit_log` table records risk transitions per product, but no job or service aggregates them across companies. The `decision_patterns` table exists for cross-product learning but does not track risk patterns.

**Evidence:**
- `src/services/intelligence/risk-state.ts`: All functions take a single `productId`
- No `fleet_health` or `fleet_signals` table
- No cross-company aggregation in any job

---

## FO-04. Logging lacks fleet context -- no company name/ID in structured fields consistently

**Severity: P2**
**Files:** `src/jobs/index.ts`

Jobs log product names and IDs but inconsistently. Some use `logger.info(message, { productId })` with structured fields; others embed the product name in the message string. There is no standardized `{ productId, productName, founderId, jobName }` context object.

This makes it impossible to filter logs by company across all jobs, or to build a log-based fleet dashboard.

**Evidence:**
- Line 49: `logger.info(\`lifecycle_check: ${p.name} activated: ...\`, { jobName: 'lifecycle_check' })` -- name in message, not in structured field
- Line 46: `logger.info('lifecycle_check starting', { jobName: 'lifecycle_check' })` -- no product context

---

## FO-05. AI cost visibility is per-product only

**Severity: P2**
**Files:** `src/services/ai/client.ts:20-44`, `src/jobs/index.ts:1082-1098`

The `dailySpend` Map tracks per-product daily AI spend in memory. The `scpCostReport` job writes 30-day trailing costs to `products.ai_cost_trailing_30d_usd`. But there is no:
- Fleet-level daily cost total
- Cost trend over time (only latest 30-day trailing)
- Alert when fleet-wide daily cost exceeds a threshold
- Cost breakdown by agent type across the fleet

At 25 products x $25/day ceiling = $625/day maximum. With no fleet-level cost monitoring, a billing surprise is possible.

---

## Recommendations

1. **Build a fleet status endpoint** (`/api/fleet/status`) that returns all products with their risk state, Signal score, agent health, pending decisions, and 30-day cost in a single query.
2. **Add a job execution log table** -- Record job name, start time, duration, products processed, errors, and completion status. Surface via `/internal/jobs/status`.
3. **Add fleet-level risk aggregation** -- After each `weeklySynthesis` run, compute fleet-level statistics (% green/yellow/red, average Signal, total cost) and persist them.
4. **Standardize structured logging context** -- Every job log entry should include `{ jobName, productId, productName, founderId }` as structured fields.
5. **Add fleet cost ceiling** -- A single environment variable `FLEET_DAILY_COST_CEILING_CENTS` that caps total AI spend across all products.
