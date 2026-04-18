# Lens 087 — Refund / Dispute / Chargeback Flow

**Distinct value:** Traces the complete money-back path: Stripe dispute webhooks, refund initiation, subscription state reconciliation, tier downgrade on refund, data access after payment reversal, and accounting record integrity. No other lens specifically audits the reverse-money flow.

**Tenancy-critical:** Yes. A chargeback on a multi-product founder (Investor-Ready tier) should not silently downgrade them while SCP instances are running, potentially leaving orphaned agent sessions or stale tier gates.

## Executive Summary

Foundry has **no dispute/chargeback handling whatsoever**. The Stripe webhook handler (`src/services/billing/stripe.ts`) processes `subscription.created`, `subscription.updated`, and `subscription.deleted` but does not handle `charge.dispute.created`, `charge.dispute.closed`, `charge.refunded`, `invoice.payment_failed`, or `customer.subscription.paused`. The customer-facing Stripe webhook integration (`src/services/integrations/stripe-webhook.ts`) does handle `charge.refunded` for the customer's product metrics, but this is tracking the founder's customers' refunds, not Foundry's own billing refunds. There is no admin interface, no refund API, and no mechanism for a founder to request a refund. The only path for a refund today is manual Stripe dashboard action, with no automatic tier adjustment.

## Findings

### RDC-01 No Dispute Webhook Handler
- **Severity:** P0
- **Description:** The Foundry billing webhook (`src/services/billing/stripe.ts:handleWebhook()`) handles 3 event types: `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`. It does not handle `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, or `charge.dispute.funds_reinstated`. When a founder files a chargeback with their bank, Stripe sends `charge.dispute.created`. Foundry ignores it. The subscription remains active, agents keep running (incurring AI costs), and there is no record of the dispute.
- **Evidence:** `src/services/billing/stripe.ts:72-103` — switch statement only covers 3 event types. No dispute-related cases.
- **Remediation:** Add handlers for dispute events. On `charge.dispute.created`: pause the subscription, pause all SCP instances, send a notification to the founder, log to audit trail. On `charge.dispute.closed` with status `won` (Foundry wins): resume. On `charge.dispute.closed` with status `lost`: cancel and handle as subscription deleted.
- **Financial risk:** Each disputed subscription continues to burn AI costs ($25/day ceiling per product) while the revenue is held. At $399/month Investor-Ready tier with 3 products, that is $75/day in AI costs against disputed revenue.

### RDC-02 No Refund Path Exists
- **Severity:** P1
- **Description:** There is no `refundSubscription()` function, no admin API endpoint, no founder-facing refund request mechanism, and no refund policy page. The only way to issue a refund is through the Stripe dashboard directly. When a Stripe refund is issued manually, the `charge.refunded` event is not handled by the billing webhook, so Foundry's internal state is not updated. The founder keeps their tier, agents keep running, and the `founders.tier` column remains set.
- **Evidence:** `src/services/billing/stripe.ts` — no refund function. `src/routes/` — no refund route. Grep for "refund" only finds customer-product-level refund tracking in `src/services/integrations/stripe-webhook.ts:235`.
- **Remediation:** Implement `charge.refunded` handler that: (1) checks if the refund is for a subscription payment, (2) if full refund, treat as subscription cancellation (set tier to null, pause SCP), (3) if partial refund, log but maintain access, (4) record the refund in an internal ledger for accounting.

### RDC-03 No Invoice Payment Failed Handler
- **Severity:** P1
- **Description:** `invoice.payment_failed` is not handled. When a founder's card declines on renewal, Stripe retries according to its Smart Retries schedule (typically 3 attempts over ~2 weeks). During this period, the subscription enters `past_due` status. Foundry's webhook handler only processes `subscription.created/updated/deleted`. The `subscription.updated` handler would fire, but it only extracts the price ID and updates the tier — it does not check `sub.status === 'past_due'` and does not take any action on payment failure.
- **Evidence:** `src/services/billing/stripe.ts:73-83` — the `subscription.updated` case extracts `priceId` and calls `getTierFromPrice()` but does not check subscription status.
- **Remediation:** In the `subscription.updated` handler, check `sub.status`. If `past_due`: send a dunning email via Resend, show a banner in the dashboard, and after Stripe's retry period expires (subscription moves to `canceled`), the `subscription.deleted` handler fires. Consider adding a grace period before pausing SCP to avoid disrupting a founder whose card simply expired.

### RDC-04 Subscription Deletion Does Not Handle Data Access
- **Severity:** P2
- **Description:** When a subscription is deleted (`src/services/billing/stripe.ts:87-99`), the handler sets `tier = NULL` and pauses all SCP instances. This is correct for stopping AI costs. However, there is no grace period, no data export prompt, no "your account will become read-only" transition. The founder loses access to all tier-gated features immediately. Dashboard routes that check `tier` via `tier-gate.ts` middleware will start returning 403s. The founder cannot even view their historical briefings if those routes are tier-gated.
- **Evidence:** `src/services/billing/stripe.ts:87-99` — immediate `tier = NULL` and SCP pause. `src/middleware/tier-gate.ts` — gates features by tier, returns 403 for null tier.
- **Remediation:** Implement a 7-day grace period after cancellation where the founder has read-only access to dashboards and data export functionality. Store `subscription_cancelled_at` timestamp and check it in tier-gate middleware. After 7 days, enforce full lockout.

### RDC-05 No Accounting Ledger for Revenue Events
- **Severity:** P2
- **Description:** There is no internal record of payments received, refunds issued, or disputes filed. The `founders` table has `stripe_customer_id` and `tier` but no `last_payment_at`, `total_paid_usd`, or `dispute_count` fields. All financial history lives exclusively in Stripe. If the Stripe webhook fails silently (which is possible since errors in the handler are thrown but not logged to a persistent store), there is no reconciliation mechanism.
- **Evidence:** `src/db/schema.sql:1-20` — founders table has no payment/billing history columns. No `billing_events` or `payment_ledger` table exists.
- **Remediation:** Create a `billing_events` table that logs every payment, refund, and dispute event with the Stripe event ID for idempotent processing. This provides an internal audit trail independent of Stripe and enables billing reconciliation.

## Missing Event Types (Full Gap List)

| Stripe Event | Status | Risk |
|---|---|---|
| `charge.dispute.created` | Not handled | P0 — AI costs run against disputed revenue |
| `charge.dispute.closed` | Not handled | P0 — No resolution path |
| `charge.refunded` | Not handled (for Foundry billing) | P1 — State not updated |
| `invoice.payment_failed` | Not handled | P1 — No dunning, no grace |
| `customer.subscription.paused` | Not handled | P2 — Stripe supports pause natively |
| `invoice.upcoming` | Not handled | P3 — Could warn founders |
| `checkout.session.expired` | Not handled | P3 — Abandoned checkout not tracked |
