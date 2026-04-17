# Lens 11 — Observability Audit

**Auditor perspective:** Observability engineer
**Date:** 2026-04-16
**Scope:** Logging, metrics, tracing, error reporting, health checks, alerting, cost tracking, audit trail

---

## Executive Summary

Foundry has **no structured logging, no external error reporting service, no request tracing, no application metrics pipeline, and no alerting configuration**. The entire observability story is `console.log/error/warn` — 422 occurrences across 40 files — which produces unstructured, unparseable text on stdout. An operator investigating a production incident today would have to SSH into the Fly.io machine and grep raw text logs with no correlation IDs, no severity levels, and no machine-readable context. The sole bright spot is the `agent_run_details` table, which records per-agent-run cost, latency, and token usage — but this data is only visible through the product dashboard, not through any operational monitoring system.

---

## Findings

### F-11.01 No structured logging (P1)

**Evidence:** Every log statement in production code uses `console.log`, `console.error`, or `console.warn`. There is no logging library — no pino, winston, bunyan, or any other structured logger in `package.json`. The Hono `logger()` middleware (imported from `hono/logger` in `src/index.ts:15`) outputs a single line per request in Apache Common Log format to stdout. It does not produce JSON, does not include request IDs, and cannot be configured for log levels.

**Impact:**
- Logs are unparseable by Fly.io log aggregation, Datadog, Loki, or any log management tool expecting JSON
- No log levels — cannot filter errors from informational messages without text parsing
- No contextual fields (founder_id, product_id, agent_name, request_id) attached to log entries
- Cannot correlate a request's journey from middleware through service layer to external call
- The 422 occurrences are ad-hoc with inconsistent prefix conventions: `[JOB]`, `[CRON]`, `[scheduler]`, `[dispatcher]`, `[SCP EVOLUTION]`, `[MILESTONES]`, `[push]`, `[integrations]` — no standard taxonomy

**Key files:**
- `src/index.ts` — startup logging, error handler, cron scheduler (16 console calls)
- `src/jobs/index.ts` — 205 console calls across 26 jobs
- `src/services/scp/events/dispatcher.ts` — 9 console calls
- `src/services/scp/scheduler.ts` — 8 console calls
- `src/services/scp/evolution.ts` — 8 console calls

### F-11.02 No error reporting service (P1)

**Evidence:** No Sentry SDK, Bugsnag, Datadog APM, or any error reporting library is installed. There are zero dependencies in `package.json` related to error reporting. The file `src/services/integration/sentry.ts` exists but it is a **client for pulling errors from a customer's Sentry** (the monitored SaaS product), not for reporting Foundry's own errors.

The global error handler in `src/index.ts:431-434` catches unhandled errors and logs them to console, then returns a generic 500:
```typescript
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});
```

There is no `process.on('uncaughtException')` or `process.on('unhandledRejection')` handler, meaning unhandled promise rejections in fire-and-forget calls (there are many: `.catch(() => {})` patterns throughout the codebase) could crash the process silently.

**Impact:**
- Errors are invisible unless someone watches the log stream in real-time
- No error grouping, deduplication, or trend analysis
- No stack traces captured in a searchable system
- No alerting on error rate spikes
- No release tracking (error rate per deployment)

### F-11.03 No request tracing or correlation IDs (P1)

**Evidence:** A search for `request-id`, `correlation-id`, `trace-id`, `requestId`, and `x-request-id` across the entire `src/` directory returns zero results. No middleware generates or propagates a request identifier. The auth middleware (`src/middleware/auth.ts`) resolves a founder but does not attach a request ID to the context.

**Impact:**
- Impossible to trace a single request from ingress through the service layer to external API calls
- When a job runs 12 agents sequentially for a product, the interleaved console output from concurrent product runs cannot be disambiguated
- Cannot answer "what happened during this specific user's session?" without timestamp-based log grep
- Hono supports `c.set()` for request-scoped values, making this a straightforward fix — but it is not implemented

### F-11.04 No application metrics (P2)

**Evidence:** Zero Prometheus, StatsD, OpenTelemetry, or custom metrics dependencies. No `/metrics` endpoint for scraping. No counters for HTTP requests, error rates, response latencies, database query durations, or AI call costs.

The only "metrics" are product-facing business metrics stored in the `metric_snapshots` table (MRR, activation rate, churn) and the `agent_run_details` table (per-run cost/latency). These are business intelligence data, not operational metrics.

**Impact:**
- No SLI/SLO tracking (latency percentiles, error rates, availability)
- No dashboard showing system health trends over time
- Cannot detect gradual performance degradation
- Cannot set up alerting rules based on metric thresholds
- Fly.io provides basic machine-level metrics (CPU, memory) but no application-level insight

### F-11.05 Health check is a liveness-only stub (P2)

**Evidence:** `src/routes/internal/health.ts` is 7 lines:
```typescript
healthRoutes.get('/internal/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString(), version: '0.1.0' });
});
```

It checks **zero** dependencies. It does not verify:
- Database connectivity (Turso)
- Anthropic API key validity or reachability
- Clerk authentication service
- Stripe webhook secret configuration
- Resend email service
- Any cron job health (are jobs running? when was the last successful run?)

Fly.io is configured to poll this endpoint every 30 seconds (`fly.toml:27`), and the Docker HEALTHCHECK also uses it. Both will report "healthy" even if the database is unreachable.

**Impact:**
- A machine with a dead database connection will continue receiving traffic
- Fly.io auto-stop/auto-start decisions are based on a meaningless check
- No readiness vs. liveness distinction — new deployments are marked healthy before DB migrations complete

### F-11.06 No alerting or incident response configuration (P2)

**Evidence:** No PagerDuty, OpsGenie, or alerting configuration exists anywhere in the repository. No Fly.io alert rules in `fly.toml`. No runbook documents. No incident response procedures.

The operator dashboard at `/internal/operator/dashboard-data` provides a JSON snapshot of product health, but it has no alerting integration — it must be polled manually and has an empty `alerts: []` array hardcoded.

**Impact:**
- Production failures are discovered only when a founder reports them or the operator manually checks
- No escalation path for critical failures
- No on-call rotation
- No MTTR tracking

### F-11.07 AI cost tracking exists but is operationally invisible (P2)

**Evidence:** The `agent_run_details` table records `input_tokens`, `output_tokens`, `cost_usd`, and `latency_ms` per agent run. The `run-recorder.ts` service has `getAgentCostSummary()` aggregating cost by agent over the last N days. The ROI dashboard (`/roi`) displays AI cost to the founder.

However:
- Cost data is only visible in the product dashboard — no operational alerting on cost anomalies
- No budget limits or circuit breakers — a runaway agent loop could rack up unlimited Anthropic charges
- The AI client (`src/services/ai/client.ts`) returns token usage but does not log it
- The scheduler logs total cost to console (`Cost: $${totalCostUsd.toFixed(4)}`) but this is a single unstructured line
- No daily/hourly cost aggregation accessible to operators outside the app

**Impact:**
- A cost spike from a bug (infinite agent loop, oversized prompts) would be invisible until the Anthropic invoice arrives
- No way to set spending alerts per product or globally

### F-11.08 audit_log is product-scoped, not operator-scoped (P3)

**Evidence:** Two audit log tables exist:

1. **`audit_log`** (from core schema) — records product-level decisions with `action_type`, `gate`, `trigger`, `reasoning`, `confidence_score`, `risk_state_at_action`. Scoped by `product_id`. Used by the decision/intelligence system.

2. **`agent_audit_log`** (migration 025) — append-only event log with `event_type`, `actor_type`, `actor_id`, `target_type`, `target_id`, `metadata_json`, `ip_address`. Scoped by `product_id`. Queried through `src/services/audit/log.ts`.

Both tables are designed for founder-facing audit trails, not for operational debugging. Neither table records:
- HTTP request details (method, path, status code, response time)
- Authentication failures
- Rate limit hits
- Database query errors
- External API call failures/timeouts
- Background job execution details (only the SCP agents via `agent_run_details` are tracked)

**Impact:**
- Audit tables are useful for product governance but do not help diagnose operational issues
- No way to reconstruct what happened during a system outage from the database alone

### F-11.09 Job failures are logged and silently continued (P3)

**Evidence:** All 26 cron jobs follow this pattern in `src/jobs/index.ts`:
```typescript
try {
  await job.fn();
} catch (err) {
  console.error(`[CRON] Error in ${name}:`, err);
}
```

And within each job, product-level errors are caught and logged but the job continues to the next product:
```typescript
} catch (err) {
  console.error(`[JOB] lifecycle_check error for ${p.id}:`, err);
}
```

There is no job execution history table, no failure counter, no dead letter queue, and no alerting on repeated job failures. A job that fails silently for days would only be noticed when downstream data goes stale.

**Impact:**
- Persistent job failures are invisible
- No way to see which jobs last ran successfully or their duration
- Cannot distinguish between "job ran but did nothing" and "job never ran"

### F-11.10 Fire-and-forget patterns suppress errors (P3)

**Evidence:** At least 15 instances of `.catch(() => {})` or `catch { /* non-fatal */ }` patterns across the codebase, including:
- `src/middleware/auth.ts:128` — `query('UPDATE founders SET last_seen_at...').catch(() => {});`
- `src/services/scp/scheduler.ts:131` — `_sendBriefingToSlack(productId).catch(() => {});`
- `src/services/scp/agents/base.ts:171-176` — scratchpad write fire-and-forget
- `src/services/scp/events/dispatcher.ts:61` — signal event processing fire-and-forget

These patterns intentionally suppress errors to prevent cascading failures, which is a reasonable design choice. However, the suppressed errors are completely invisible — not logged, not counted, not reported anywhere.

**Impact:**
- Systematic failures in "non-critical" paths (Slack delivery, scratchpad writes, founder activity tracking) could go undetected indefinitely
- Difficult to distinguish between "feature not used" and "feature is broken"

---

## Severity Summary

| ID | Finding | Severity | Effort |
|----|---------|----------|--------|
| F-11.01 | No structured logging | P1 | Medium — add pino, replace console calls, add request context |
| F-11.02 | No error reporting service | P1 | Low — add Sentry SDK, wire to error handler + uncaught handlers |
| F-11.03 | No request tracing | P1 | Low — middleware to generate/propagate request IDs via Hono context |
| F-11.04 | No application metrics | P2 | Medium — add prom-client, instrument key paths, expose /metrics |
| F-11.05 | Health check is a liveness stub | P2 | Low — add DB ping, check critical env vars, report dependency status |
| F-11.06 | No alerting or incident response | P2 | Medium — requires choosing a stack and defining alert rules |
| F-11.07 | AI cost tracking is operationally invisible | P2 | Low — add cost alerting threshold, expose cost metrics |
| F-11.08 | Audit log is product-scoped, not operator-scoped | P3 | Medium — add operational event logging table or use structured logger |
| F-11.09 | Job failures silently continued | P3 | Low — add job execution history table, track last success/failure times |
| F-11.10 | Fire-and-forget patterns suppress errors | P3 | Low — replace empty catch with logger.warn calls |

---

## Recommended Priority Actions

### Immediate (P1)

1. **Install pino + pino-pretty and create a logger module.** Replace all 422 `console.*` calls with structured `logger.info/warn/error` calls. Each log entry should be JSON with at minimum: `{ level, msg, timestamp, requestId?, founderId?, productId?, agentName? }`.

2. **Add Sentry (or equivalent).** Install `@sentry/node`, initialize in `src/index.ts` before route mounting, wire to `app.onError()`, add `process.on('uncaughtException')` and `process.on('unhandledRejection')` handlers. Tag errors with `productId`, `founderId`, and `agentName` when available.

3. **Add request ID middleware.** Generate a UUID or nanoid per request, set it on Hono context via `c.set('requestId', id)`, return it in `X-Request-Id` response header, and pass it to the structured logger for every log call within that request.

### Near-term (P2)

4. **Upgrade health check** to verify Turso connectivity (execute `SELECT 1`), check that critical env vars are set, and report component status with a standard schema like `{ status: 'ok'|'degraded'|'down', checks: { db: {...}, ai: {...} } }`.

5. **Add application metrics.** Install `prom-client`, instrument: HTTP request count/latency by route and status, AI call count/latency/cost by model, database query count/latency, job execution count/duration/status. Expose at `/internal/metrics`.

6. **Add AI cost alerting.** Implement a daily cost aggregation check in the cron scheduler that alerts (via Slack, email, or PagerDuty) if daily AI spend exceeds a configurable threshold.

### Longer-term (P3)

7. **Add job execution tracking table** with columns: job_name, started_at, completed_at, status, error_message, items_processed. Query this for an operator dashboard.

8. **Replace fire-and-forget empty catches** with `logger.warn()` calls that at minimum record the error message, so systematic failures become visible in log aggregation.

9. **Add an operator-facing observability dashboard** (Grafana or equivalent) showing request rates, error rates, AI costs, job health, and agent run success rates.

---

## What Works

- **Agent run transparency:** The `agent_run_details` table (`migration 043`) records cost, latency, tokens, decisions, actions, and error messages per agent run. The `run-recorder.ts` service provides `getAgentCostSummary()` and `getAgentRunHistory()` queries. This is well-designed for product-facing transparency.

- **Integration health monitoring:** The `health-monitor.ts` service tracks per-integration failure counts, staleness, and status. It is domain-appropriate and feeds the `/integrations/health` dashboard.

- **Audit trail design:** The `agent_audit_log` table captures actor attribution (agent/founder/system/api), resource targeting, and structured metadata — a solid foundation for compliance and debugging within the product domain.

- **Docker HEALTHCHECK:** The Dockerfile includes a proper healthcheck with interval, timeout, start-period, and retries — it just needs a better endpoint to call.

- **Fly.io health polling:** `fly.toml` configures health checks with reasonable intervals (30s) and grace periods (30s) — the infrastructure is ready, the endpoint just needs substance.
