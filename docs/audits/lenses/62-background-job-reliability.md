# Lens 62 — Background Job Reliability

**Auditor perspective:** 72 registered jobs — execution tracking, failure recovery, dead letter, monitoring, overlap prevention, and operational visibility.

**Date:** 2026-04-16
**Codebase snapshot:** 72 jobs in `JOB_REGISTRY`, cron-based in-process scheduling, no external job queue

---

## Executive Summary

Foundry's 72 background jobs run in-process via the `cron` library with no execution tracking, no failure recovery, no dead letter mechanism, and no monitoring dashboard. When a job fails, it logs an error and moves on — there is no retry, no alert, and no record of the failure beyond the log stream. Jobs that iterate all products continue to the next product on failure, which is good, but the failed product is never retried. There is no execution history table to answer "when did this job last run successfully?" or "how long did it take?". The hourly `scp_agent_runner` (the most expensive job, calling Claude for each product's agents) has no overlap prevention, no cost tracking per run, and no mechanism to pause for a specific product. The entire scheduler is invisible to the operator — there is no admin page, no health endpoint, and no metric export for job status.

---

## Findings

### JOB-01. No Execution History — Cannot Answer "Did the Job Run?"

**Severity: P1**

None of the 72 jobs record their execution start time, end time, success/failure status, or duration. The only evidence of execution is `logger.info('job_name starting')` and `logger.info('job_name complete')` in the log stream. If logs are rotated or the log aggregator has an outage, execution evidence is lost.

**Evidence:**
- Every job follows the pattern: `logger.info('starting') ... logger.info('complete')` — log-only tracking
- No `job_executions` table in any of the 54 migrations
- No execution duration tracking
- The health endpoint (`src/routes/internal/health.ts`) checks service configuration but not job execution recency
- Operators cannot determine if `daily_insight_generate` ran yesterday without searching logs

**Remediation:** Create a `job_executions` table: `(id, job_name, started_at, completed_at, status, error_message, products_processed, duration_ms)`. Record execution at job start and completion. Add a health check that alerts if any daily job hasn't run in 48 hours.

**Target phase:** P1

---

### JOB-02. Failed Products Are Never Retried

**Severity: P1**

Every job that iterates products uses the pattern: `for (const row of products.rows) { try { ... } catch (err) { logger.error(...); } }`. When processing fails for a product, the error is logged and the loop continues to the next product. The failed product is never retried, and there is no mechanism to detect or address the gap.

**Evidence:**
- `src/jobs/index.ts:43-55` — `lifecycleCheck`: try/catch per product, no retry
- `src/jobs/index.ts:60-71` — `competitiveScan`: same pattern
- `src/jobs/index.ts:77-155` — `weeklySynthesis`: same pattern
- `src/jobs/index.ts:158-183` — `digestGenerate`: same pattern — a failed digest means the founder gets no email
- This pattern repeats in all 72 jobs
- A transient error (Anthropic API timeout, Turso connection hiccup) causes permanent data gaps

**Remediation:** After each job completes, collect failed product IDs and retry them once. Or, record failures in a `job_failures` table and have a `retry_failed_jobs` meta-job that processes them. For critical jobs (digest delivery), implement immediate retry with exponential backoff.

**Target phase:** P1

---

### JOB-03. No Overlap Prevention — Concurrent Runs of Expensive Jobs

**Severity: P1**

The `scp_agent_runner` fires every hour. If an agent run takes longer than 60 minutes (realistic for products with many active agents, each calling Claude), the next hourly tick starts a second run. Both runs process the same products, calling Claude twice and producing duplicate signals.

**Evidence:**
- `src/jobs/index.ts:1825` — `scp_agent_runner: { schedule: '0 * * * *' }` — hourly
- `src/services/scp/scheduler.ts:29-58` — `runDueAgentsForAllProducts()` — no "is already running" check
- Each agent session calls `callSonnet()` (4096 max tokens) — a product with 12 agents could take 20+ minutes
- With 50+ products, total run time could exceed 60 minutes
- The `scp_playbook_eval` job also runs every hour with no overlap guard

**Remediation:** Add a `job_locks` table with `(job_name TEXT PRIMARY KEY, locked_at DATETIME, locked_by TEXT)`. Before each job runs, attempt `INSERT INTO job_locks ... ON CONFLICT DO NOTHING`. Check if the insert succeeded (got the lock) or conflicted (another run is in progress). Release the lock on completion.

**Target phase:** P1

---

### JOB-04. No Cost Tracking Per Job Run

**Severity: P2**

At least 15 of the 72 jobs call Claude (Opus or Sonnet). The per-product daily cost ceiling (`src/services/ai/client.ts`) tracks cumulative spend but there is no per-job-run cost tracking. Operators cannot determine: "How much did today's `weekly_synthesis` cost?" or "Is `daily_insight_generate` consuming more API budget than `scp_agent_runner`?"

**Evidence:**
- `src/services/ai/client.ts:20` — `dailySpend` Map tracks per-product spend, not per-job
- Job functions call `callOpus()` and `callSonnet()` without passing a job identifier
- No aggregation of spend by job name
- The `scp_cost_report` job (`src/jobs/index.ts:1834`) generates monthly rollups but only for product-level spend

**Remediation:** Add a `jobName` parameter to `callClaude()` config. Track spend in a `job_cost_tracking` table: `(job_name, run_date, total_input_tokens, total_output_tokens, cost_cents)`. Report in the monthly cost summary.

**Target phase:** P2

---

### JOB-05. No Dead Letter or Alert on Consecutive Failures

**Severity: P1**

If a job fails for the same product on 3 consecutive runs, there is no alert, no escalation, and no circuit breaker. The product continues to be processed (and fail) on every run, wasting resources and never notifying the operator.

**Evidence:**
- No failure counter per product per job
- No alert mechanism when a job fails repeatedly
- The `stressor_cleanup` job at `src/jobs/index.ts:349-357` is the only job that doesn't iterate products (single UPDATE statement) — all others are vulnerable to per-product repeated failures
- Example: if a product's GitHub access token expires, `remediation_outcome_check` fails for that product every day, logging an error each time, with no escalation

**Remediation:** Track consecutive failures per (job_name, product_id) in the `job_executions` table. After 3 consecutive failures, create a notification for the founder and skip the product until manually re-enabled or the failure condition changes.

**Target phase:** P1

---

### JOB-06. No Admin Visibility into Scheduler Status

**Severity: P2**

There is no admin endpoint, dashboard page, or CLI command to view: which jobs are registered, their schedules, when each last ran, whether any are currently running, or their error rates.

**Evidence:**
- The `JOB_REGISTRY` object at `src/jobs/index.ts:1795` contains schedule and description metadata, but it is only used by the `CronJob` constructor
- The health endpoint (`src/routes/internal/health.ts`) does not include job status
- No `/admin/jobs` or `/internal/jobs` route
- The CLI (`src/cli/index.ts`) can run individual jobs but cannot list job status

**Remediation:** Add an `/internal/scheduler` endpoint that returns: `{ jobs: [{ name, schedule, description, last_run_at, last_status, next_run_at, avg_duration_ms }] }`. Requires the `job_executions` table from JOB-01.

**Target phase:** P2

---

### JOB-07. Stale Comment: "All 14 Scheduled Jobs" — Actually 72

**Severity: P3**

`src/jobs/index.ts:3` — Header comment says "All 14 Scheduled Jobs" but the `JOB_REGISTRY` contains 72 entries. This indicates the file has grown 5x without updating documentation, suggesting rapid accretion without review.

**Evidence:**
- `src/jobs/index.ts:3` — `// All 14 Scheduled Jobs`
- `src/jobs/index.ts:1795-1866` — 72 entries in `JOB_REGISTRY`
- The jobs are numbered 1-23 in comments, then unnumbered SCP jobs are added
- Two syntax issues at lines 1835 and 1852: `/ SCP v3` and `/ SCP v7` (missing leading `/` for comment)

**Remediation:** Update the comment to "72 Scheduled Jobs" or remove the count. Fix the comment syntax at lines 1835 and 1852 (`/` should be `//`).

**Target phase:** P3

---

## Embarrassment Test

1. **"72 background jobs run with zero execution tracking — operators cannot determine if a job ran, when it ran, how long it took, or whether it succeeded, without searching raw logs"** — Completely invisible background processing.

2. **"A product whose GitHub token expired causes `remediation_outcome_check` to fail and log an error every single day forever, with no alert, no escalation, and no circuit breaker"** — Silent repeated failures with no recovery path.

3. **"The hourly SCP agent runner can overlap with itself when runs exceed 60 minutes, producing duplicate Claude API calls and duplicate signals — with no mechanism to detect or prevent this"** — The most expensive job has no overlap guard.

## Pride Test

1. Every job wraps per-product processing in try/catch and continues to the next product on failure, ensuring one product's error doesn't block processing for all other products.

2. Several jobs have built-in idempotency: `metric_snapshot` checks for existing snapshots before inserting, `daily_insight_generate` uses `ON CONFLICT DO NOTHING`, and `weekly_plan_generate` skips products with existing plans.

3. The `JOB_REGISTRY` pattern provides a clean metadata registry with schedule, description, and function reference, making it easy to add new jobs and run them from the CLI.

## Distinct-Value Declaration

This lens analyzes the operational reliability of background job execution — not just "do the jobs exist" (covered by Tier 1 SRE/architecture) but "what happens when they fail, overlap, or slow down." The failure recovery gap, the overlap prevention gap, and the complete absence of execution tracking are operational concerns that only a background-job specialist would trace through all 72 jobs.

## Tenancy-Critical Flag

**JOB-02** is tenancy-critical: when a job fails for one product, that founder loses their digest, insight, briefing, or competitive scan with no notification or retry. Different tenants receive different levels of service depending on whether their product happened to trigger an error. **JOB-03** is tenancy-critical: overlapping agent runs for one product consume shared AI budget that affects all tenants.
