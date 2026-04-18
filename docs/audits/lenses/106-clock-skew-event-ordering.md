# Lens 106 — Clock-Skew / Out-of-Order Events

**Auditor Persona:** Edge-Case Hunter / Adversary (Tier 3)
**Date:** 2026-04-16
**Scope:** Webhook ordering, SQLite CURRENT_TIMESTAMP vs JS Date, cron job timing collisions, event sequencing

---

## Executive Summary

Foundry mixes SQLite's `CURRENT_TIMESTAMP` (server-local time at Turso edge) with JavaScript `new Date().toISOString()` (application-local time) throughout the codebase. Since Turso is a distributed SQLite service, its notion of "now" may differ from the application server's clock by seconds. Additionally, the 26 cron jobs scheduled in-process have no mutual exclusion — two jobs can query and mutate the same product simultaneously, creating out-of-order state transitions. Webhook events from Stripe and Clerk are processed without idempotency keys, so retried webhooks can re-apply stale state.

---

## Findings

### CLK-01 — Mixed CURRENT_TIMESTAMP and JS Date across writes (Severity: Medium)

**Description:** Some INSERT/UPDATE statements use SQLite's `CURRENT_TIMESTAMP` (Turso's server time) while others use `new Date().toISOString()` from the Node.js process. If Turso and the Fly.io VM disagree by a few seconds, events can appear out-of-order in the timeline.

**Evidence:**
- `src/db/schema.sql`: `created_at DATETIME DEFAULT CURRENT_TIMESTAMP` on all tables.
- `src/middleware/tenant.ts:100`: `updated_at: new Date().toISOString()` — JS time.
- `src/jobs/index.ts:501,531`: `new Date().toISOString()` for `resolved_at` and `created_at`.
- `src/middleware/auth.ts:128`: `UPDATE founders SET last_seen_at = CURRENT_TIMESTAMP` — SQL time.

**Remediation:** Pick one time source and use it consistently. Recommended: use `CURRENT_TIMESTAMP` in all SQL for consistency within the database, and `new Date()` only for application-level logic that is not persisted.

---

### CLK-02 — Cron jobs have no mutual exclusion (Severity: Medium)

**Description:** All 26 cron jobs run in-process via the `CronJob` library. If two jobs fire at the same minute (e.g., lifecycle_check and stressor_check both at 6:00 UTC), they run concurrently on the same products. Both may read the same lifecycle state, compute conflicting transitions, and write without coordination.

**Evidence:**
- `src/jobs/index.ts`: Multiple jobs have overlapping schedules. All iterate `getAllActiveProducts()` and mutate per-product state.
- No lock table, no mutex, no job queue with deduplication.

**Remediation:** Add a simple per-product lock mechanism: `INSERT INTO job_locks (product_id, job_name, locked_at) VALUES (?, ?, ?)` with a UNIQUE constraint, and `DELETE` on completion. Skip products that are already locked by another job.

---

### CLK-03 — Clerk webhook can arrive before auto-provisioning completes (Severity: Medium)

**Description:** The auth middleware auto-provisions a founder if the Clerk webhook has not yet fired (race condition handling, per comment). But the reverse race is also possible: the webhook fires before the user's first request, creating a founder record, and then the first request also tries to auto-provision, hitting the `ON CONFLICT DO NOTHING`. This is handled correctly, but if the webhook includes additional data (name, metadata) that the auto-provision does not, the auto-provisioned record lacks that data.

**Evidence:**
- `src/middleware/auth.ts:82-101`: Auto-provision uses `ON CONFLICT (clerk_user_id) DO NOTHING`.
- `src/routes/auth/clerk.ts:159-180`: Webhook creates founder with `stripe_customer_id`. If auth middleware's auto-provision ran first, the Stripe customer ID is never set because the INSERT has `DO NOTHING` on conflict.

**Remediation:** Change the webhook INSERT to `ON CONFLICT DO UPDATE SET stripe_customer_id = COALESCE(excluded.stripe_customer_id, founders.stripe_customer_id), name = COALESCE(excluded.name, founders.name)`.

---

### CLK-04 — Stripe webhook replay can re-process events (Severity: Medium)

**Description:** Stripe retries webhooks on failure. The webhook handler verifies the signature but does not check an idempotency key or `event.id` against a processed-events table. A retried webhook could re-apply a tier change or re-create a subscription record.

**Evidence:**
- `src/index.ts:229-240`: Stripe webhook handler calls `handleWebhook(body, signature)` with no event deduplication.
- No `processed_events` or `webhook_events` table in the schema.

**Remediation:** Create a `processed_webhook_events` table. Before processing, check if the event ID exists. INSERT the event ID on successful processing.

---

## Embarrassment Test

A founder upgrades their tier via Stripe checkout. The Stripe webhook fires, upgrading them to Growth. Stripe retries the webhook (network hiccup). The retry processes again, triggering a duplicate "Welcome to Growth" email and a duplicate cohort update. The founder gets two identical emails. **Likelihood: Medium.**

## Pride Test

The auth middleware's race condition handling (`ON CONFLICT DO NOTHING`) shows awareness of event ordering issues. The Clerk webhook signature verification includes a timestamp check (5-minute window), which is correct replay protection.

## Distinct-Value Declaration

This lens identifies the specific dual-clock problem (SQLite CURRENT_TIMESTAMP vs JS Date) and the cron-job mutual exclusion gap as architectural issues unique to Foundry's Turso + in-process-scheduler design.

## Tenancy-Critical Flag

**No.** Clock skew and event ordering affect individual product data integrity but do not create cross-tenant visibility.
