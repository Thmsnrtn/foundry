# Lens 107 — Network Partition / Split-Brain

**Auditor Persona:** Edge-Case Hunter / Adversary (Tier 3)
**Date:** 2026-04-16
**Scope:** Turso latency, Anthropic timeouts, partial failures, half-complete operations

---

## Executive Summary

Foundry has improved since initial assessment: the AI client now has retry logic (2 retries, exponential backoff) and timeouts (2 minutes), and the GitHub API client uses a `withRetry` wrapper. However, the other external dependencies (Turso database, Stripe, Clerk, Resend) still lack explicit timeout or retry configuration. More critically, multi-step operations that span multiple external calls (audit pipeline: GitHub fetch -> AI scoring -> DB write -> PR creation) have no saga pattern or compensation logic — a failure midway leaves the system in an inconsistent state.

---

## Findings

### NET-01 — Turso client has no timeout configuration (Severity: High)

**Description:** The Turso database client is created with `createClient({ url, authToken })` and no timeout parameter. If Turso becomes slow (network degradation, edge node issues), every request hangs indefinitely until the Node.js HTTP server's own timeout (which is not configured either).

**Evidence:**
- `src/db/client.ts:16-18`: `createClient({ url, authToken: authToken || undefined })` — no `timeout` option.
- No `AbortController` or deadline wrapping on any database call.

**Remediation:** Set `timeout` in the Turso client configuration. Add a per-query AbortController with a 10-second deadline for read queries, 30 seconds for writes.

---

### NET-02 — Anthropic returns after timeout leaves dangling state (Severity: Medium)

**Description:** The AI client wraps calls in `Promise.race` with a 2-minute timeout. If the timeout fires, the calling function gets an error. But the Anthropic API call continues running — when it eventually returns, the SDK may log a warning or consume memory for the response, and the tokens are billed. No `AbortController` is used to actually cancel the HTTP request.

**Evidence:**
- `src/services/ai/client.ts:48`: `AI_TIMEOUT_MS = 120000` (2 minutes).
- `src/services/ai/client.ts:56`: `_client = new Anthropic({ apiKey, timeout: AI_TIMEOUT_MS })` — this sets the SDK's internal timeout, which does use AbortController. This is actually correct.
- However, `callClaudeMultiTurn` at line 162 does not pass through the retry/timeout logic — it calls `client.messages.create()` directly.

**Remediation:** Ensure `callClaudeMultiTurn` also uses the retry wrapper or at minimum uses the same Anthropic client instance (which has the timeout configured).

---

### NET-03 — Audit pipeline has no saga/compensation (Severity: High)

**Description:** The audit pipeline (`runAudit`) performs: (1) GitHub tree fetch, (2) GitHub file fetch, (3) 8 analysis steps, (4) AI scoring, (5) DB write, (6) remediation classification, (7) PR creation. If step 5 succeeds but step 7 fails, the audit is recorded as complete but the PR was never created. There is no rollback mechanism.

**Evidence:**
- `src/services/audit/engine.ts:14-36`: `runAudit` performs sequential async operations.
- `src/services/audit/remediation.ts:100-180`: `generateFix` creates a DB record (`status = 'generating'`), then calls Opus, then creates a PR. If PR creation fails, the record stays in `'generating'` status forever.

**Remediation:** Implement a status machine for remediation: `generating -> fix_ready -> pr_created | pr_failed`. Add a cleanup job that retries `pr_failed` records or marks them as `error` after N attempts.

---

### NET-04 — External fetch calls lack timeouts (Severity: Medium)

**Description:** Many integration fetch calls (Slack, Linear, PostHog, Intercom, Stripe API) use bare `fetch()` without timeout or AbortController. A hanging external service blocks the calling cron job or request handler.

**Evidence:**
- `src/services/notifications/push.ts:187`: `fetch('https://slack.com/api/chat.postMessage', ...)` — no timeout.
- `src/services/integrations/linear.ts:129`: `fetch('https://api.linear.app/graphql', ...)` — no timeout.
- `src/services/integrations/framework.ts:180`: `fetch('https://api.stripe.com/v1/subscriptions...')` — no timeout.
- Only `src/services/audit/github.ts` uses the `withRetry` wrapper consistently.

**Remediation:** Wrap all external fetch calls with `withRetry` from `src/services/resilience.ts`, or at minimum add `AbortController` with a 30-second timeout.

---

### NET-05 — Single Fly.io instance means no split-brain but also no redundancy (Severity: High)

**Description:** With `min_machines_running = 1` and a single machine, there is no split-brain risk but also zero redundancy. If the machine restarts (deploy, OOM, crash), all 26 cron jobs stop, all in-flight requests fail, and the rate limit store (in-memory Map) is lost.

**Evidence:**
- `fly.toml`: `min_machines_running = 1`, no secondary region.
- `src/middleware/rate-limit.ts`: `const store = new Map<string, RateLimitEntry>()` — in-memory, lost on restart.

**Remediation:** For rate limiting: accept the loss on restart (rate limits reset, which is benign). For availability: consider a second machine in a different region, or at minimum increase `min_machines_running = 2` behind the Fly.io load balancer.

---

## Embarrassment Test

Turso has a 30-second latency spike during an Anthropic AI call. The AI client times out at 2 minutes, the Turso write hangs. The cron job that triggered the call holds the product in a locked state. For that 2-minute window, the founder's dashboard hangs on every page load because the tenant middleware's Turso query is also blocked. **Likelihood: Low but catastrophic when it happens.**

## Pride Test

The `withRetry` utility in `src/services/resilience.ts` is well-designed with configurable retries, exponential backoff with jitter, and timeout support. The AI client's retry logic is also solid. The team clearly understands the pattern — it just needs to be applied universally.

## Distinct-Value Declaration

This lens maps the specific partial-failure states in the audit/remediation pipeline and identifies that the `withRetry` resilience pattern exists but is only used by 2 of 30+ external integration points.

## Tenancy-Critical Flag

**Yes.** A Turso latency spike or Anthropic timeout on a single Fly.io instance affects all tenants simultaneously. There is no isolation between tenants' database or AI calls.
