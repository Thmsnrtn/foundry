# Lens 139 — Dormant / Paused Company

**Auditor perspective:** Edge-case hunter / domain adversary — billing, costs, data retention, and agent execution for paused companies
**Distinct-value declaration:** Traces the full lifecycle of a paused company: what stops, what continues, what costs money, and what data accumulates. No prior lens examined the paused state specifically.
**Tenancy-critical:** Yes. Paused companies in a fleet consume resources (DB storage, log volume) even when they should not.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P1 | 2 |
| P2 | 3 |

---

## How to Pause a Company

There is no explicit "pause" action in the UI. Companies can enter a dormant state through:

1. **Subscription cancellation** -- Stripe webhook sets `founders.tier = NULL` and (attempts to) pause SCP instances
2. **Manual agent pause** -- Founder pauses individual agents via the agents page
3. **Product archival** -- Setting `products.status = 'archived'` (no UI mechanism found)
4. **SCP deprovisioning** -- `deprovisionSCP()` sets `scp_status = 'archived'` and pauses all agents

---

## DP-01. Subscription cancellation pauses agents but does not stop all background jobs

**Severity: P1**
**Files:** `src/services/billing/stripe.ts:87-99`, `src/jobs/index.ts`

When a subscription is cancelled, the webhook handler pauses SCP instances. But most background jobs query `getAllActiveProducts()` which filters by `products.status = 'active'`, NOT by founder tier or SCP status. A cancelled founder's products remain `status = 'active'`.

**Jobs that still run on paused/cancelled products:**

| Job | Query | Runs on Cancelled? |
|-----|-------|-------------------|
| `lifecycle_check` | `getAllActiveProducts()` (`status='active'`) | Yes |
| `competitive_scan` | `getAllActiveProducts()` | Yes |
| `weekly_synthesis` | `getAllActiveProducts()` | Yes (AI calls!) |
| `daily_insight_generate` | `getAllActiveProducts()` | Yes (Opus call!) |
| `weekly_plan_generate` | `getAllActiveProducts()` | Yes (Opus call!) |
| `signal_alert_check` | `getAllActiveProducts()` | Yes (Sonnet call!) |
| `morning_briefings` | `getAllActiveProducts()` | Yes (AI call!) |
| `scp_agent_runner` | `scp_status='active'` | No (if properly paused) |

The SCP agent runner correctly checks `scp_status`, but all other jobs check `products.status` which is not updated on cancellation. AI-consuming jobs (daily insight, weekly plan, morning briefings) continue to run and generate costs.

**Evidence:**
- `src/services/billing/stripe.ts:95-98`: Targets `scp_instances` table (may be wrong table)
- `src/jobs/index.ts`: Most jobs use `getAllActiveProducts()` which checks `status`, not tier
- The `digestGenerate` job at line 160 does check `founders.tier IS NOT NULL` -- this is the only job that respects cancellation

---

## DP-02. No mechanism to pause a company without cancelling the subscription

**Severity: P1**
**Files:** `src/services/scp/instance.ts:254-270`, `src/services/scp/provisioner.ts:184-193`

A founder who wants to temporarily pause one company (e.g., seasonal business, founder vacation) has no clean option:

1. **Pause individual agents** -- Must click pause 12 times, and only stops agent runs. All other jobs continue.
2. **Deprovision SCP** -- Sets `scp_status='archived'` and pauses all agents. But there is no "re-provision" to resume. The product is effectively retired.
3. **Stripe pause** -- `pauseSubscription` exists in the billing service but only pauses billing, not product activity.

There is no "pause this company" button that:
- Stops all agent runs
- Stops all background jobs for this company
- Stops AI cost accumulation
- Keeps data intact for later resumption
- Is easily reversible

---

## DP-03. Data continues to accumulate for paused products

**Severity: P2**
**Files:** `src/jobs/index.ts`

Even with SCP agents paused, the following data continues to grow:
- `metric_snapshots`: Daily placeholder rows created by `metricSnapshot` job (if product is active)
- `signal_history`: `signalAlertCheck` computes and stores Signal scores
- `daily_insights`: `dailyInsightGenerate` creates insights (with AI call)
- `audit_log`: Various jobs write audit entries
- `notifications`: Alert jobs create notifications nobody will read

There is no cleanup for paused products and no TTL on data for products that are not being actively used.

---

## DP-04. Digest emails continue for paused products if founder tier is non-null

**Severity: P2**
**Files:** `src/jobs/index.ts:158-183`

The `digestGenerate` job queries `founders WHERE tier IS NOT NULL` and then iterates their products. If a founder pauses one product but keeps their subscription active, they continue receiving digests for the paused product. The digest includes Signal scores, stressor counts, and AI-generated content -- all of which are still being computed by background jobs.

**Evidence:**
- `src/jobs/index.ts:160`: `SELECT * FROM founders WHERE tier IS NOT NULL`
- No per-product pause flag checked in digest generation
- Even `deprovisionSCP` does not set a flag that digest generation checks

---

## DP-05. Voice session resumption after pause -- stale context

**Severity: P2**

If a company is paused for 3 months and then resumed, the voice briefing system will generate briefings based on 3-month-old data (the last metric snapshot, the last signal score). The briefing will sound current but refer to stale information.

There is no "data freshness check" before generating briefings or insights.

---

## Recommendations

1. **Add a `paused` product status** -- `products.status IN ('active', 'paused', 'archived')`. A paused product:
   - Stops SCP agent runs (`scp_status` check already works)
   - Is excluded from ALL background jobs (add `AND status = 'active'` to every job query)
   - Retains all data
   - Can be resumed with a single status change
2. **Add a "Pause Company" UI action** -- Single button that sets `products.status = 'paused'` and pauses SCP.
3. **Add a "Resume Company" action** -- Sets `products.status = 'active'`, resumes SCP, recalculates `next_run_at` for agents, and generates a fresh Signal score.
4. **Auto-pause on cancellation** -- Change the subscription cancellation handler to set `products.status = 'paused'` for all founder's products, not just SCP status.
5. **Add data freshness check** -- Before generating insights or briefings, check when the last metric snapshot was ingested. If > 7 days stale, include a "data may be outdated" disclaimer.
