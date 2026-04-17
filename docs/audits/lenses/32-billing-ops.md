# Lens 32 — Billing Ops Reviewer Audit

**Auditor perspective:** Billing operations reviewer
**Scope:** Multi-company billing edge cases, mid-cycle changes, proration, refunds, dunning, Stripe webhook handling
**Date:** 2026-04-16

---

## Executive Summary

Foundry's billing implementation is **functionally minimal**. It handles checkout, subscription creation, tier changes via webhook, and cancellation. However, it delegates almost all complexity to Stripe's defaults without explicit configuration, and it does not handle several critical edge cases: **no proration logic for mid-cycle tier changes, no dunning/failed payment recovery, no grace period after payment failure, no refund handling, no multi-product billing adjustments when products are added or removed, and no idempotency on mutating Stripe calls**. The Stripe webhook handler processes only 3 event types and ignores payment failures, refunds, invoice events, and dispute events entirely.

**P0 findings:** 1
**P1 findings:** 4
**P2 findings:** 3

---

## Finding 01 — No dunning or failed payment recovery

**Severity: P0**
**Files:** `src/services/billing/stripe.ts` (handleWebhook)

The webhook handler processes:
- `customer.subscription.created` / `customer.subscription.updated` -> update tier
- `customer.subscription.deleted` -> set tier to NULL

It does **not** handle:
- `invoice.payment_failed` -> no action (in the primary billing handler)
- `invoice.payment_action_required` -> no action
- `customer.subscription.past_due` -> no action

When a payment fails, Stripe retries according to its Smart Retries configuration (or default 3 attempts). During this period, Foundry takes no action:
- The founder's tier remains active (they keep full access)
- No in-app notification about the payment failure
- No email prompting the founder to update their payment method
- No banner on the dashboard warning about billing issues
- No grace period logic (when does Foundry revoke access after payment failure?)

The integration-layer webhook handler (`src/services/integrations/stripe-webhook.ts`) *does* handle `invoice.payment_failed` -- but only for the **founder's product's Stripe** (the product being monitored), not for Foundry's own billing. It sends a COO notification to the founder about *their customer's* payment failure.

**Impact:** A founder with a failed payment retains full access indefinitely until Stripe eventually cancels the subscription (which may take 30+ days depending on configuration). No revenue recovery mechanism. No awareness that payment failed.

**Remediation:**
1. Handle `invoice.payment_failed` in the primary webhook handler:
   - Set a `billing_status` field on the founder to `past_due`.
   - Display a dashboard banner: "Your payment failed. Update your payment method to continue."
   - Send an email with a link to the Stripe billing portal.
2. Handle `invoice.payment_action_required` similarly.
3. Define a grace period policy (e.g., 14 days past_due = downgrade to read-only, 30 days = suspend).
4. Handle `customer.subscription.past_due` to enforce the grace period.

---

## Finding 02 — No proration handling for mid-cycle tier changes

**Severity: P1**
**Files:** `src/services/billing/stripe.ts` (createCheckoutSession)

The checkout session is created with `mode: 'subscription'` and no `proration_behavior` configuration. Stripe's default proration behavior is `create_prorations`, which means:
- Upgrading mid-cycle generates a prorated invoice for the price difference.
- Downgrading mid-cycle generates a prorated credit.

However, Foundry does not:
- Show the founder what the prorated amount will be before checkout
- Handle proration invoice webhooks (`invoice.created` with proration line items)
- Display proration credits or charges in any UI
- Test that proration works correctly across all tier transitions

The `createSubscription` function (used separately from checkout) creates a new subscription with `payment_behavior: 'default_incomplete'`, which may create a different proration experience than the checkout flow.

**Impact:** Founders may be surprised by unexpected charges or credits. No visibility into proration amounts. The two subscription creation paths (checkout vs. direct) may behave differently.

**Remediation:**
1. Explicitly set `proration_behavior` on subscription updates (not just new subscriptions).
2. Show a proration preview on the upgrade/downgrade UI using Stripe's `upcoming_invoice` API.
3. Handle `invoice.created` webhook to log proration events.
4. Unify the subscription creation paths to use a single approach.

---

## Finding 03 — No refund handling

**Severity: P1**
**Files:** `src/services/billing/stripe.ts` (handleWebhook)

The webhook handler does not process:
- `charge.refunded` -> no action
- `charge.dispute.created` -> no action
- `charge.dispute.closed` -> no action

If the operator issues a refund through the Stripe dashboard:
- The founder's tier is unchanged (they keep paid access despite the refund)
- No audit log entry is created
- No notification to the founder

If a chargeback/dispute is filed:
- No automatic access restriction
- No internal alert
- No response workflow

**Impact:** Refunds and disputes are invisible to the Foundry application. A founder who receives a refund and a founder who pays normally have identical system states.

**Remediation:**
1. Handle `charge.refunded`: if full refund, set tier to NULL. If partial, log but do not change tier.
2. Handle `charge.dispute.created`: flag the founder account, restrict access, send internal alert.
3. Log all refund and dispute events in the audit_log.

---

## Finding 04 — Multi-product billing is not metered

**Severity: P1**
**Files:** `src/routes/dashboard/onboarding.ts` (product limit enforcement), `src/services/billing/stripe.ts`

The product limit is enforced at creation time:
- Solo: 1 product
- Growth: 1 product
- Investor-Ready: 5 products

However:
- Adding a 2nd product on Investor-Ready does not change the billing amount ($399/mo flat).
- If a founder downgrades from Investor-Ready to Growth while having 3 products, the extra products are not archived or billing-adjusted. The tier-gate check happens at product creation time, not enforcement time. Existing products above the new tier's limit remain active.
- There is no `pauseSubscription` integration with product status (pausing billing does not pause SCP agent execution, which continues consuming AI credits).

**Impact:** A downgraded founder retains access to products above their tier's limit. AI costs continue during billing pause.

**Remediation:**
1. On tier downgrade, enforce product limits: archive excess products or prompt the founder to choose which to keep.
2. On subscription pause, pause SCP agent execution and cron jobs for that founder's products.
3. Consider per-product billing for Investor-Ready (base + incremental per product).

---

## Finding 05 — No idempotency keys on Stripe API calls

**Severity: P1**
**Files:** `src/services/billing/stripe.ts`

`stripe.customers.create()`, `stripe.subscriptions.create()`, and `stripe.checkout.sessions.create()` are called without idempotency keys. If a network timeout causes a retry (automatic by the Stripe SDK or manual by the user clicking "subscribe" twice):
- Duplicate customers may be created
- Duplicate subscriptions may be created
- Duplicate checkout sessions (less harmful, but still wasteful)

The Clerk webhook handler (`routes/auth/clerk.ts`) calls `createCustomer` during `user.created` processing. If the Clerk webhook is retried (which Svix does on failure), a duplicate Stripe customer is created.

**Impact:** Duplicate Stripe objects waste money and create reconciliation problems.

**Remediation:**
1. Pass `idempotencyKey` to all mutating Stripe operations:
   - `customers.create`: use the founder ID as the idempotency key.
   - `subscriptions.create`: use `${founderId}_${tier}` as the key.
   - `checkout.sessions.create`: use `${founderId}_${tier}_${Date.now()}` (or a request-specific key).
2. Deduplicate Stripe webhook events by checking `event.id` before processing.

---

## Finding 06 — Webhook handler does not deduplicate events

**Severity: P2**
**Files:** `src/services/billing/stripe.ts` (handleWebhook)

Stripe explicitly states webhooks may be delivered multiple times. The handler processes every event without checking if it has already been processed. For the tier update logic (`UPDATE founders SET tier = ?`), this is effectively idempotent (same UPDATE applied twice). But for any future logic that involves side effects (sending emails, creating audit log entries, triggering notifications), duplicate processing will cause duplicate side effects.

The integration-layer Stripe handler (`services/integrations/stripe-webhook.ts`) does store events but does not deduplicate them either.

**Impact:** Low risk today (tier UPDATE is idempotent), but a latent bug that will manifest when webhook processing adds side effects.

**Remediation:**
1. Store the Stripe event ID in a `processed_stripe_events` table.
2. Check for existence before processing. Skip duplicates.

---

## Finding 07 — No billing audit trail

**Severity: P2**
**Files:** `src/services/billing/stripe.ts`

Billing events (subscription created, updated, deleted) do not create entries in Foundry's `audit_log` table. The only record of billing changes is in Stripe's dashboard. If a founder disputes a charge or claims they were incorrectly billed, Foundry has no internal record of when their tier changed or why.

**Impact:** No internal audit trail for billing operations. Cannot correlate tier changes with system behavior without going to Stripe.

**Remediation:**
1. Log all billing webhook events to the `audit_log` table with `action_type: 'billing_*'`.
2. Include the Stripe event ID, previous tier, new tier, and subscription details.

---

## Finding 08 — Two separate Stripe client instances with different API versions

**Severity: P2**
**Files:** `src/services/billing/stripe.ts`, `src/services/integrations/stripe-webhook.ts`

The billing service uses `apiVersion: '2023-10-16'` and the integration webhook handler uses `apiVersion: '2024-04-10' as any` (with a type assertion). Two different API versions on the same Stripe account can cause subtle behavioral differences in how events are structured and how API calls respond.

**Impact:** Potential for inconsistent Stripe behavior between the billing and integration layers. The `as any` cast suggests the integration handler was written at a different time and not harmonized.

**Remediation:**
1. Consolidate to a single Stripe client instance shared across the application.
2. Use a single API version. Update both to the latest stable version.

---

## Summary Table

| # | Finding | Severity | File(s) |
|---|---------|----------|---------|
| 01 | No dunning or failed payment recovery | P0 | `services/billing/stripe.ts` |
| 02 | No proration handling for mid-cycle tier changes | P1 | `services/billing/stripe.ts` |
| 03 | No refund or dispute handling | P1 | `services/billing/stripe.ts` |
| 04 | Multi-product billing not metered; downgrade not enforced | P1 | `routes/dashboard/onboarding.ts` |
| 05 | No idempotency keys on Stripe API calls | P1 | `services/billing/stripe.ts` |
| 06 | Webhook handler does not deduplicate events | P2 | `services/billing/stripe.ts` |
| 07 | No billing audit trail | P2 | `services/billing/stripe.ts` |
| 08 | Two Stripe clients with different API versions | P2 | `services/billing/stripe.ts`, `services/integrations/stripe-webhook.ts` |

---

## Cross-References

- **Lens 06 (Reliability/SRE):** Finding 05 (idempotency) was flagged in Lens 06 Finding 03.
- **Lens 07 (Security):** Dispute handling (Finding 03) has security implications.
- **Lens 28 (Pricing strategist):** Multi-product billing (Finding 04) affects pricing strategy.
- **Lens 29 (Customer success):** Dunning (Finding 01) is a critical customer success concern.
