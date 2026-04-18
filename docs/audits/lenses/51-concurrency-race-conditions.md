# Lens 51 — Concurrency / Race Condition Hunter

**Auditor perspective:** TOCTOU bugs, double-submit on forms, concurrent SCP agent execution conflicts, job scheduler double-fire, read-modify-write hazards across a single-process Hono server with 72 cron jobs and SQLite.

**Date:** 2026-04-16
**Codebase snapshot:** ~288 TypeScript files, 72 registered cron jobs, single-process Fly.io deployment, Turso/SQLite backend

---

## Executive Summary

The Foundry codebase is rife with concurrency hazards masquerading as correct code due to the accidental serialization of a single-process deployment. The scheduler runs 72 jobs with no distributed locking, so any Fly.io scaling event (including blue-green deploys) double-fires every job. Multiple form-submit endpoints lack idempotency guards, and the SCP agent runner iterates all products sequentially with no per-product lock, meaning a slow agent run that overlaps the next hourly cron tick produces concurrent analyses for the same product. The in-memory rate limiter and AI cost ceiling are per-process only, so horizontal scaling bypasses both controls entirely. These are not theoretical: Fly.io's default deploy strategy runs old and new instances concurrently during rollout.

---

## Findings

### CONC-01. Job Scheduler Double-Fire on Deploy

**Severity: P0**

Every Fly.io deploy runs old and new instances concurrently for the `kill_timeout` window (5 seconds, `src/index.ts:551`). All 72 `CronJob` instances in `JOB_REGISTRY` (`src/jobs/index.ts:1795-1866`) fire on both the dying and starting process. Jobs that call `callOpus`/`callSonnet` (at least 15 jobs: `dailyInsightGenerate`, `weeklyPlanGenerate`, `scenarioAccuracy`, `scpAgentRunner`, etc.) will double Anthropic API spend. Jobs that INSERT records without `ON CONFLICT` guards create duplicates.

**Evidence:**
- `src/index.ts:465-481` — `startScheduler()` creates `CronJob` instances in-process with no leader election
- `src/index.ts:514` — scheduler starts unconditionally in production
- No advisory lock, distributed lock, or "am I leader?" mechanism exists anywhere in the codebase

**Remediation:** Add a `job_locks` table with `SELECT ... WHERE lock_key = ? AND acquired_at > datetime('now', '-N minutes')` check before each job. The lock holder writes its instance ID. Alternatively, use Fly.io's Machine API to designate one machine as the scheduler.

**Target phase:** Immediate (P0 — ships broken during every deploy)

---

### CONC-02. SCP Agent Runner Has No Per-Product Execution Lock

**Severity: P1**

`scp_agent_runner` fires every hour (`src/jobs/index.ts:1825`). `runDueAgentsForAllProducts` (`src/services/scp/scheduler.ts:29-58`) iterates all products serially, calling `instance.runAllDueAgents()` per product. If one product's agent run takes >60 minutes (likely for products with many active agents, each calling Claude Opus), the next hourly tick starts a second overlapping run. Both runs will call `analyzeAndAct()` for the same agents with the same context, producing duplicate signals, briefings, and audit log entries.

**Evidence:**
- `src/services/scp/scheduler.ts:29-58` — no mutex or "is_running" flag
- Agent sessions write to `agent_sessions` table with no UNIQUE constraint on (product_id, agent_name, date)
- `getDueAgents()` at line 77-88 checks `next_run_at <= CURRENT_TIMESTAMP` — both concurrent runs see the same due agents since `scheduleNextRun` hasn't been called yet

**Remediation:** Use `UPDATE agent_instances SET status='running' WHERE status='active' AND next_run_at <= CURRENT_TIMESTAMP` as an atomic claim. Only process agents that were successfully claimed. After completion, set `status='active'` and update `next_run_at`.

**Target phase:** P1

---

### CONC-03. Decision Resolution TOCTOU — Double-Submit Produces Duplicate Outcomes

**Severity: P1**

`resolveDecision` is called from the decision form POST handler (`src/routes/dashboard/decisions.ts`). The pattern is: read decision -> check status is 'pending' -> update to 'approved'/'rejected'. If a founder double-clicks the submit button (common UX issue), two concurrent requests both read status='pending' and both succeed in updating. This creates two audit log entries and potentially two action draft generations.

**Evidence:**
- `src/routes/dashboard/decisions.ts:180-260` — POST handler with no idempotency key
- The form uses a standard `<form>` POST with no client-side double-submit prevention
- No database-level optimistic locking (no `WHERE status = 'pending'` in the UPDATE)

**Remediation:** Add `WHERE status = 'pending'` to the UPDATE statement and check `changes` count. If 0 rows affected, the decision was already resolved. Additionally, add `disabled` attribute to submit button on click via client-side JavaScript.

**Target phase:** P1

---

### CONC-04. In-Memory Rate Limiter Bypassed by Multi-Instance

**Severity: P1**

The rate limiter (`src/middleware/rate-limit.ts:13`) uses a `Map<string, RateLimitEntry>` in process memory. When Fly.io runs multiple instances (during deploys, or if configured for HA), each instance has its own map. An attacker can send 120 req/min to each instance, effectively multiplying the rate limit by the instance count.

**Evidence:**
- `src/middleware/rate-limit.ts:13` — `const store = new Map<string, RateLimitEntry>();`
- Auth endpoint rate limit is 10 req/min (`authRateLimit`, line 62) — with 2 instances this becomes 20
- No external rate limit store (Redis, Turso, etc.)

**Remediation:** For auth endpoints (where brute force is the risk), move rate limiting to Cloudflare WAF rules or implement a Turso-backed rate limiter. For API endpoints, the in-memory approach is acceptable if documented as approximate.

**Target phase:** P1

---

### CONC-05. AI Daily Cost Ceiling is Per-Process Only

**Severity: P1**

The AI cost ceiling (`src/services/ai/client.ts:20`) uses `const dailySpend = new Map<string, { cents: number; date: string }>()` in process memory. The $25/day/product cap is not enforced across instances. During deploys, spend tracking resets when the new process starts.

**Evidence:**
- `src/services/ai/client.ts:20-34` — in-memory Map for spend tracking
- `isCostCeilingReached()` at line 43 — reads from process-local map
- A deploy mid-day resets the counter, allowing double the spend

**Remediation:** Persist daily spend to the `products` table or a dedicated `ai_spend_tracking` table. Read from DB before each AI call (can cache for 60 seconds to avoid per-call DB read).

**Target phase:** P1

---

### CONC-06. Metric Ingest UPSERT Race — Concurrent Webhooks Lose Data

**Severity: P1**

The ingest endpoint (`src/routes/ingest/index.ts:117-127`) uses `ON CONFLICT(product_id, snapshot_date) DO UPDATE SET`. If two webhook deliveries arrive simultaneously (e.g., two Stripe events in the same second), the second's `ON CONFLICT DO UPDATE SET` overwrites fields set by the first, rather than incrementing them. For counters like `new_mrr_cents`, this means data loss.

**Evidence:**
- `src/routes/ingest/index.ts:119` — `ON CONFLICT DO UPDATE SET` with absolute values, not increments
- The Stripe webhook handler (`src/services/integrations/stripe-webhook.ts:187-188`) uses `SET new_mrr_cents = new_mrr_cents + ?` (correct for Stripe), but the generic ingest endpoint uses absolute assignment
- No locking or serialization at the ingest endpoint

**Remediation:** For counter fields (MRR, signups, support volume), use `SET col = col + ?` semantics. For rate fields (activation_rate, churn_rate), absolute assignment is correct. Document which fields are additive vs. absolute in the ingest API docs.

**Target phase:** P1

---

### CONC-07. Founder Auto-Provisioning Race Between Webhook and Auth Middleware

**Severity: P2**

`src/middleware/auth.ts:82-98` auto-provisions a founder if the Clerk webhook hasn't fired yet. It uses `ON CONFLICT (clerk_user_id) DO NOTHING` which prevents duplicate rows. However, if two requests arrive simultaneously for a new user, both hit the `result.rows.length === 0` branch, both call `clerk.users.getUser()` (doubling the Clerk API call), and both attempt the INSERT. The `DO NOTHING` prevents data corruption but wastes a Clerk API call and produces a confusing error log on the second attempt.

**Evidence:**
- `src/middleware/auth.ts:78-98` — read, check empty, provision pattern
- Line 99: `console.error('Auto-provision founder failed:', e)` — logged for the losing race

**Remediation:** Low priority since `DO NOTHING` prevents corruption. The error log should be downgraded to `logger.debug`. Consider wrapping in a `try/catch` that specifically catches unique constraint violations silently.

**Target phase:** P2

---

## Embarrassment Test

1. **"Fly deploys double-fire all 72 cron jobs, including jobs that call Claude Opus at $75/M output tokens"** — Every deploy causes duplicate AI spend and duplicate database writes. Embarrassing for a platform that manages SaaS finances.

2. **"A founder double-clicking 'Approve' on a critical decision creates two audit log entries and two action drafts"** — The decision system, which is positioned as the core value prop of the product, has no double-submit protection.

3. **"The $25/day AI cost ceiling resets to zero on every deploy"** — The cost control mechanism that prevents unbounded Anthropic bills is entirely decorative in a deployment scenario.

## Pride Test

1. The `batch()` function in `db/client.ts` correctly uses Turso's write transaction mode, providing atomicity for multi-statement writes that do use it.

2. The `ON CONFLICT` guards on signal history snapshots (`src/services/signal.ts:267-278`) correctly handle the "one per product per day" invariant idempotently.

3. The Stripe webhook handler (`src/services/integrations/stripe-webhook.ts`) uses additive `SET col = col + ?` for MRR counters, correctly handling concurrent event delivery.

## Distinct-Value Declaration

This lens identified 7 concurrency hazards that depend on understanding the interaction between Fly.io's deployment model, in-process state, and SQLite's concurrency semantics. No Tier 1 lens analyzes the temporal overlap between old and new instances during deploy, or the interaction between cron job scheduling and long-running agent AI calls.

## Tenancy-Critical Flag

**CONC-02** and **CONC-06** are tenancy-critical. Concurrent agent execution could produce signals attributed to one product that bleed into another product's briefing if the in-memory caches (proseCache, dailySpend) are read during a concurrent run. The metric ingest race could overwrite one product's data with another's if ingest tokens were ever confused (unlikely but the code has no defense).
