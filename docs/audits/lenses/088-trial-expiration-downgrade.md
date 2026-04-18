# Lens 088 — Trial Expiration / Downgrade Flow

**Distinct value:** Audits what happens at subscription lifecycle transitions: trial end, downgrade between tiers, cancellation, and the resulting data access, feature gating, and SCP instance state changes. Specifically examines the gap between "subscription ends" and "user experience degrades."

**Tenancy-critical:** Yes. A founder on Investor-Ready ($399) with multiple products who downgrades to Solo ($79, 1 product) has orphaned products with running SCP instances that are no longer covered by their tier.

## Executive Summary

Foundry has **no trial period** and **no downgrade flow**. The billing model is direct subscription with no trial: Solo ($79), Growth ($199), Investor-Ready ($399). There is no trial_ends_at field, no trial-to-paid conversion logic, and no downgrade webhook handling. The subscription deletion handler exists and correctly nullifies the tier and pauses SCP instances, but the transition states between tiers (e.g., Investor-Ready to Solo) are not handled at all. The `subscription.updated` handler only updates the tier column based on the new price ID — it does not check whether the new tier is lower than the old tier, does not enforce product count limits on downgrade, and does not pause excess SCP instances.

## Findings

### TED-01 No Downgrade Logic When Tier Changes
- **Severity:** P0
- **Description:** The `subscription.updated` webhook handler (`src/services/billing/stripe.ts:73-83`) extracts the new price ID, maps it to a tier, and updates `founders.tier`. That is the entire handler. It does not compare old tier to new tier. A founder who downgrades from Investor-Ready (up to 10 products) to Solo (1 product) will have their tier column updated to `solo`, but their 10 existing products and their running SCP instances continue operating. The tier-gate middleware only checks the founder's current tier when they try to access a feature; it does not retroactively pause products or agents that exceed the new tier's limits.
- **Evidence:** `src/services/billing/stripe.ts:73-83` — no comparison of old vs. new tier. `src/middleware/tier-gate.ts` — checks current tier per-request but does not enforce product count limits. Products table has no enforcement of max-products-per-tier.
- **Remediation:** On `subscription.updated`, compare old tier (from DB) to new tier (from webhook). If downgrading: (1) determine product count limit for new tier (Solo=1, Growth=3, Investor-Ready=10), (2) if founder has more products than allowed, pause excess SCP instances (most recently created first) and notify the founder, (3) downgrade access to tier-gated features immediately, (4) give 7-day grace period to export data from excess products.

### TED-02 No Trial Period Implementation
- **Severity:** P2 (business decision, not a bug)
- **Description:** There is no trial period. The legacy "Founding Cohort" concept has been retired (`src/services/billing/cohort.ts` is a no-op). New founders must subscribe immediately to access the product. This means the onboarding chat and first briefing (Lens 086) are the only taste of value before the paywall. If the checkout flow (`createCheckoutSession`) fails or the founder is not ready to pay, they are stuck with no access.
- **Evidence:** `src/services/billing/cohort.ts` — `enforceActivationWindow()` is a no-op. No `trial_ends_at` column on founders table. No trial-related Stripe configuration in `createCheckoutSession()` — the mode is `'subscription'` with no `subscription_data.trial_period_days`.
- **Remediation:** Consider adding a 14-day trial via Stripe's native `trial_period_days` parameter. This gives founders time to experience SCP analysis before committing. Add a `trial_ends_at` field to the founders table. Add a cron job that sends trial-ending-soon emails at day 10 and day 13. Handle the `customer.subscription.trial_will_end` webhook.

### TED-03 Cancellation Leaves No Read-Only Access Period
- **Severity:** P1
- **Description:** As documented in Lens 087 (RDC-04), when a subscription is deleted, tier is immediately set to NULL. The founder loses access to all authenticated routes that pass through tier-gate middleware. There is no "cancelled but accessible until period end" state. Stripe subscriptions by default remain active until the current billing period ends (unless `cancel_at_period_end` is used vs immediate cancellation). The webhook handler does not distinguish between immediate cancellation and end-of-period cancellation.
- **Evidence:** `src/services/billing/stripe.ts:87-99` — `customer.subscription.deleted` immediately nullifies tier. Does not check `sub.cancel_at_period_end` or `sub.current_period_end`.
- **Remediation:** On `subscription.deleted`, check `sub.current_period_end`. If the period has not ended, store the end date and allow read-only access until then. If using `cancel_at_period_end`, the subscription transitions through `updated` (with `cancel_at_period_end: true`) before `deleted`. Handle the intermediate state: show a "Your subscription ends on {date}" banner but maintain full access until then.

### TED-04 Founding Cohort Legacy Code Creates Confusion
- **Severity:** P3
- **Description:** The `STRIPE_FOUNDING_COHORT_PRICE_ID` environment variable is still referenced in `src/env.ts:24`, the `enforceActivationWindow` function is still registered as a cron job, and the billing cohort module exists. This creates confusion about whether a founding cohort tier still exists. The `getTierFromPrice()` function does not map the founding cohort price ID, so if a legacy cohort subscriber's subscription updates, they would get `tier = null` (the function returns null for unrecognized prices), which would lock them out.
- **Evidence:** `src/env.ts:24` — `STRIPE_FOUNDING_COHORT_PRICE_ID` listed as optional env var. `src/services/billing/stripe.ts:117-122` — `getTierFromPrice()` only maps solo, growth, and investor_ready. `src/services/billing/stripe.ts:82-83` — unrecognized price ID logs a warning and takes no action.
- **Remediation:** If founding cohort subscribers exist, add the founding cohort price ID to `getTierFromPrice()` mapping to an appropriate tier (likely `solo` or `growth`). If no legacy subscribers exist, remove the env var reference and the cohort module entirely.

### TED-05 No Dunning or Pre-Cancellation Communication
- **Severity:** P1
- **Description:** When a subscription payment fails (card declined, expired, insufficient funds), Stripe enters its retry cycle. Foundry has no mechanism to: (1) email the founder about the failed payment, (2) show an in-app banner about billing issues, (3) offer to update payment method, or (4) warn about upcoming access loss. The founder will be surprised when their subscription is eventually cancelled after all retries fail.
- **Evidence:** No `invoice.payment_failed` handler. No billing status field on founders table. No conditional UI in dashboard layout for billing warnings.
- **Remediation:** Handle `invoice.payment_failed`: add a `billing_status` field to founders (values: 'active', 'past_due', 'cancelled'). On payment failure, set to 'past_due' and send email. Show a persistent top-banner in dashboard layout when billing_status is 'past_due'. Include a direct link to Stripe's hosted payment method update page (`billing_portal` session).

## Data Access Matrix After Tier Changes

| Scenario | Current Behavior | Expected Behavior |
|---|---|---|
| Investor-Ready -> Solo (downgrade) | Tier updated, all products + SCP continue running | Excess products paused, 7-day export grace |
| Solo -> NULL (cancellation) | Immediate lockout, SCP paused | Read-only until period end, then lockout |
| Payment failure (past_due) | No action, no notification | Email + in-app banner, maintain access during retry window |
| Founding cohort -> any update | Tier set to NULL (unrecognized price) | Map to appropriate current tier |
