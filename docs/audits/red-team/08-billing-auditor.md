# Red Team 08 -- Billing Auditor

**Persona:** Billing Auditor (adversarial)
**Objective:** Find billing edge cases that leak revenue, allow free access, or corrupt subscription state in a multi-company autonomous control plane.
**Date:** 2026-04-16
**Codebase version:** ff7b154 (main)

---

## Executive Summary

The billing system has **five P0 revenue-bleed vulnerabilities** and **four P1 enforcement gaps** that together allow cancelled founders to keep running AI agents indefinitely, let Solo founders access Investor-Ready features, and expose every premium API route to any authenticated user regardless of tier. The cancellation webhook targets the wrong database table for SCP pausing, creating a false sense of protection while all 12 AI agents continue executing hourly. There is zero webhook idempotency, meaning a replayed `subscription.created` event can reactivate a cancelled account.

Revenue at risk: Every cancelled subscription continues to burn Anthropic API credits at ~$50-400/month/product (12 agents x hourly executions) with zero corresponding revenue. For a fleet-management product where a single founder can run 5 products, this is a potential $2,000/month/churned-founder cost leak.

---

## P0 -- Active Revenue Bleed / Billing Broken

### P0-01: Cancellation Webhook Pauses Wrong Table -- SCP Agents Keep Running

**Severity:** P0 -- Direct, ongoing cost bleed on every cancellation
**Files:** `src/services/billing/stripe.ts:90-99`, `src/services/scp/scheduler.ts:30-34`

The `customer.subscription.deleted` webhook handler pauses `scp_instances`:

```typescript
// stripe.ts:95
UPDATE scp_instances SET status = 'paused', updated_at = datetime('now')
 WHERE product_id IN (SELECT id FROM products WHERE owner_id = ?)
```

But the SCP scheduler queries `products.scp_status`, not `scp_instances.status`:

```typescript
// scheduler.ts:31-33
SELECT id FROM products
 WHERE scp_status='active' AND company_lifecycle_state != 'setup'
```

These are different columns on different tables. The `products.scp_status` column is never updated on cancellation. All 12 AI agents continue their hourly execution cycle. The briefing generator (`generateBriefingsForAllProducts`) also queries `products WHERE scp_status='active'` (line 120). The evolution cycle queries `products WHERE scp_status='active' AND evolution_enabled=1` (line 94).

**Reproduction:** Cancel a Stripe subscription. Wait for the webhook. Run `SELECT scp_status FROM products WHERE owner_id = '<cancelled-founder>'`. It will still say `active`. The next hourly cron fires `runDueAgentsForAllProducts()` and the agents execute normally.

**Fix:** The webhook must also execute:
```sql
UPDATE products SET scp_status = 'paused'
 WHERE owner_id = ? AND scp_status = 'active'
```

### P0-02: 25+ Scheduled Jobs Ignore Subscription Status Entirely

**Severity:** P0 -- Multiplier on P0-01
**File:** `src/db/client.ts:323-325`, `src/jobs/index.ts` (25+ call sites)

`getAllActiveProducts()` returns `products WHERE status = 'active'`. It does not check `scp_status`, nor does it join to `founders` to check subscription tier. Twenty-five scheduled jobs use this function including:

- `lifecycleCheck` -- AI evaluation per product
- `competitiveScan` -- Claude Sonnet call per product per competitor
- `weeklySynthesis` -- massive AI synthesis per product
- `dailyInsightGenerate` -- daily Claude call per product
- `morningBriefings` -- email generation per product
- `networkContribution` -- benchmark processing per product
- `graphRebuild` -- causal chain discovery per product
- `predictiveIntelligence` -- Monte Carlo per product
- `actionDraftGeneration` -- AI action drafting per product
- `regulatoryScan` -- regulatory AI scan per product
- `geopoliticalScan` -- geopolitical AI scan per product
- `customerHealthRefresh` -- customer intelligence per product
- `stageDetection` -- growth stage AI detection per product

All of these consume Anthropic API credits for products whose founders have cancelled their subscriptions, as long as `products.status` remains `'active'` (which is never changed on cancellation).

**Impact:** Every cancelled founder's products continue incurring AI compute costs across 25+ job categories indefinitely.

### P0-03: Zero Webhook Idempotency -- Replay Attack Reactivates Cancelled Accounts

**Severity:** P0 -- Subscription state corruption
**File:** `src/services/billing/stripe.ts:66-103`

The webhook handler processes every event it receives with no deduplication. There is no `processed_events` table, no event ID tracking, no idempotency key check. The `handleWebhook` function:

1. Verifies the Stripe signature (good)
2. Processes the event (no dedup)
3. Returns success

**Attack vector:** If Stripe retries a `customer.subscription.created` or `customer.subscription.updated` webhook (which it does by default on 5xx responses or timeouts), the tier is set again. More critically:

**Out-of-order delivery scenario:**
1. Founder subscribes: `subscription.created` arrives -> tier = 'solo'
2. Founder cancels: `subscription.deleted` arrives -> tier = NULL, scp_instances paused
3. Stripe retries the original `subscription.created` (timeout on first delivery, or manual replay via Stripe dashboard) -> tier = 'solo' again
4. Founder now has an active tier with no active subscription

This is not hypothetical. Stripe explicitly documents that webhooks can arrive out of order and may be retried. The Stripe docs recommend storing the event ID and skipping duplicates.

**Fix:** Add a `processed_webhook_events` table with `event_id TEXT PRIMARY KEY` and check before processing.

### P0-04: Portfolio Route Has No Tier Gate -- Any Founder Accesses Multi-Product View

**Severity:** P0 -- Feature access without payment
**File:** `src/routes/dashboard/portfolio.ts:15`

The `/portfolio` route has auth middleware but no `requireTier` call. Multi-product management is an Investor-Ready ($399) feature, but any authenticated user can access this route. While the route redirects to `/dashboard` for single-product founders, a Solo founder who created extra products (see P0-05) would see the full portfolio view.

Verified: `grep -c requireTier portfolio.ts` returns 0.

### P0-05: API Tier Routes Have Zero Tier Enforcement

**Severity:** P0 -- Premium feature access without payment
**Files:** `src/routes/api/tier1.ts`, `tier2.ts`, `tier3.ts`, `tier4.ts`

All four tiered API route files (`tier1.ts` through `tier4.ts`) have `authMiddleware` only. None import or use `requireTier`. Despite the naming convention implying tiered access, every authenticated user regardless of subscription tier can:

- Modify sector profiles and growth stages (tier1)
- Access unit economics and competitive strategy (tier2, tier3)
- Generate psychology insights, expansion intelligence, and ethics assessments (tier4)
- Access the full wisdom network (tier4)

Verified: `grep -r requireTier src/routes/api/` returns 0 matches.

---

## P1 -- Exploitable Enforcement Gaps

### P1-01: Cancelled Founder Still Accesses Full Dashboard

**Severity:** P1 -- Feature access after payment stops
**Files:** `src/middleware/auth.ts`, `src/routes/dashboard/index.ts:124`

The auth middleware resolves the founder and sets `c.set('founder', founder)` regardless of `founder.tier`. The main `/dashboard` route has no tier check. A founder whose subscription was cancelled (tier = NULL) can still:

1. Log in normally (Clerk session is independent of Stripe)
2. View the full Signal dashboard with all metrics
3. Access decision queue, audit results, and lifecycle tracking
4. Use the AI Ask endpoint
5. View all historical data

The `requireTier` middleware only gates specific feature routes. The core dashboard, signal computation, decision queue, and AI ask features are accessible to any authenticated user including those with no subscription at all.

**Expected behavior:** After cancellation + grace period, the dashboard should show a "resubscribe" prompt, not the full operational view.

### P1-02: canAccess Defaults to Allow for Unregistered Feature Keys

**Severity:** P1 -- Default-open security posture
**File:** `src/middleware/tier-gate.ts:44-45`

```typescript
const gate = FEATURE_GATES[featureKey];
if (!gate) return true; // Unknown feature -- allow
```

Any new feature added to the codebase that forgets to register in `FEATURE_GATES` is automatically accessible to all tiers including cancelled founders. The safe default should be deny, not allow.

### P1-03: No Product-Count Enforcement on Downgrade

**Severity:** P1 -- Over-entitlement after tier change
**Files:** `src/services/billing/stripe.ts:73-84`, `src/routes/dashboard/onboarding.ts`

When the `subscription.updated` webhook fires (e.g., Investor-Ready -> Solo downgrade via Stripe portal), the handler updates the founder's tier. But it does not check whether the founder's existing product count exceeds the new tier's limit. An Investor-Ready founder with 5 products who downgrades to Solo (limit: 1) keeps all 5 products active. All 5 continue running SCP agents. Product limits are only enforced at creation time, not on tier change.

### P1-04: No Checkout Session Deduplication

**Severity:** P1 -- Orphaned Stripe sessions, potential double-charge confusion
**Files:** `src/routes/dashboard/settings.ts:21-43`, `src/routes/dashboard/settings.ts:227-256`

Both the POST `/checkout` and GET `/checkout` handlers create new Stripe checkout sessions on every request. There is no deduplication by founder ID, tier, or time window. A double-click, back-button retry, or automated bot can create unlimited orphaned checkout sessions.

While Stripe prevents actual double-charging (only one session completes), this creates:
- Orphaned sessions in the Stripe dashboard (operational noise)
- Potential for two sessions completing if the founder opens both in separate tabs
- No rate limiting on session creation (a bot could create thousands)

---

## P2 -- Structural Cost / Pricing Issues

### P2-01: Flat Per-Founder Pricing With Unbounded AI Cost

**Severity:** P2 -- COGS time bomb
**File:** `src/services/billing/stripe.ts:44`

```typescript
line_items: [{ price: getPriceId(tier), quantity: 1 }],
```

An Investor-Ready founder pays $399/month flat. They can run 5 products. Each product runs 12 agents hourly. At current Claude Sonnet 4.5 pricing (~$3/1M input, $15/1M output), a single product's agent runs likely cost $30-80/month in API calls. Five products: $150-400/month, potentially exceeding the subscription price.

There is no:
- Per-product metering or usage tracking at the billing level
- AI cost ceiling enforced at the tier level
- Budget enforcement (the `operating_budget_monthly_usd` column exists but is not checked before agent execution)

### P2-02: env.ts References Dead Stripe Price IDs

**Severity:** P2 -- Misleading startup validation
**File:** `src/env.ts:24-26`

```
STRIPE_FOUNDING_COHORT_PRICE_ID  (line 24, references $99 founding cohort)
STRIPE_SCALE_PRICE_ID            (line 26, references $399 "Scale" -- old name)
```

The actual billing code uses `STRIPE_SOLO_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, `STRIPE_INVESTOR_READY_PRICE_ID`. A new deployment following `env.ts` as the source of truth will set the wrong variables. The startup validation will not warn about the missing correct variables.

### P2-03: No Downgrade UI -- Only Upgrade

**Severity:** P2 -- Churn risk
**File:** `src/routes/dashboard/settings.ts:81-91`

The settings page shows upgrade buttons but no downgrade option. A founder who wants to downgrade must figure out the Stripe Customer Portal handles it. There is no in-app guidance, no product archival workflow, and no communication of what happens to excess products on downgrade.

### P2-04: No Grace Period After Cancellation

**Severity:** P2 -- Poor UX driving churn
**File:** `src/services/billing/stripe.ts:87-99`

The `subscription.deleted` webhook immediately NULLs the tier and (attempts to) pause SCP. There is no grace period, no "your access continues until end of billing period" logic, no `cancel_at_period_end` handling. If a founder cancels mid-month, they lose access immediately despite having paid for the full month.

Stripe sends `subscription.updated` with `cancel_at_period_end: true` when a founder initiates cancellation, followed by `subscription.deleted` at period end. The current handler does not distinguish between these states.

---

## P3 -- Dead Code and Cleanup

### P3-01: Founding Cohort No-Op Job Running Daily

**Severity:** P3 -- Wasted cron cycle
**Files:** `src/services/billing/cohort.ts`, `src/jobs/index.ts:1802`

`slot_enforcement` runs daily at 9:00 UTC calling `enforceActivationWindow()` which is an empty function. The comment says "kept so the job registry doesn't break" -- the job registry would simply not include it if removed.

### P3-02: Orphaned getSoloSlotCount Function

**Severity:** P3 -- Dead code
**File:** `src/services/billing/stripe.ts:61-64`

Exported but never imported or called anywhere. Appears to be a founding cohort vestige.

### P3-03: Stripe API Version 2.5 Years Stale

**Severity:** P3 -- Technical debt
**File:** `src/services/billing/stripe.ts:16`

Pinned to `2023-10-16`. The per-product webhook handler (`stripe-webhook.ts:23`) uses `2024-04-10`. Two different Stripe API versions in the same codebase. Should be unified and updated.

### P3-04: console.warn in Billing Code

**Severity:** P3 -- Violates CLAUDE.md structured logging requirement
**File:** `src/services/billing/stripe.ts:83`

```typescript
console.warn(`[STRIPE WEBHOOK] Unrecognised price ID: ${priceId}...`);
```

---

## Attack Scenarios

### Scenario 1: The Eternal Free Rider

1. Sign up, subscribe to Solo ($79)
2. Webhook fires: tier = 'solo', products get SCP provisioned
3. Cancel subscription through Stripe portal
4. Webhook fires: tier = NULL, `scp_instances` rows paused
5. `products.scp_status` remains `'active'`
6. All 12 agents continue executing hourly (scheduler checks `products.scp_status`)
7. All 25+ background jobs continue processing (they check `products.status = 'active'`)
8. Founder can still access dashboard, view Signal, use AI Ask
9. Foundry bleeds ~$50-80/month in AI costs per product with $0 revenue

**Result:** Permanent free access to the core product with ongoing AI cost bleed.

### Scenario 2: The Tier Escalation

1. Subscribe to Solo ($79)
2. Access `/portfolio`, all `/api/tier1` through `/api/tier4` endpoints
3. Access psychology insights, expansion intelligence, wisdom network, ethics assessments
4. These are Investor-Ready ($399) features accessible for $79

**Result:** $320/month in feature arbitrage per founder.

### Scenario 3: The Webhook Replay Attack

1. Subscribe to Growth ($199), receive `subscription.created` webhook
2. Cancel subscription, receive `subscription.deleted` webhook, tier = NULL
3. Replay the original `subscription.created` event (same Stripe signature is valid since the secret hasn't rotated; or wait for Stripe's automatic retry)
4. Tier is set back to 'growth' with no active Stripe subscription
5. Full access restored

**Result:** Permanent free tier restoration via webhook replay.

### Scenario 4: The Phantom Fleet

1. Subscribe to Investor-Ready ($399)
2. Create 5 products, all with full SCP running
3. Downgrade to Solo ($79) via Stripe portal
4. `subscription.updated` webhook fires, tier changes to 'solo'
5. All 5 products remain active, all 5 SCP instances keep running
6. 60 AI agent executions per hour (12 agents x 5 products)
7. Solo price: $79. AI cost: ~$250-400/month

**Result:** 5x compute for 1x price.

---

## Multi-Company Billing Edge Case Matrix

| Scenario | Current Behavior | Revenue Impact |
|----------|-----------------|----------------|
| Company added mid-cycle | No billing impact (flat rate) | Under-billing if AI cost exceeds per-company margin |
| Company paused by founder | No mechanism exists | Agents keep running, cost continues |
| Company deleted by founder | No deletion mechanism in UI | Products persist, agents keep running |
| Downgrade with excess products | All products remain active | Over-entitlement, excess AI cost |
| Subscription cancelled | tier = NULL, wrong table paused | Agents keep running (P0-01), dashboard accessible (P1-01) |
| Webhook replay | No dedup, tier restored | Free reactivation (P0-03) |
| Out-of-order webhook delivery | Last event wins | State corruption (P0-03) |
| Stripe retry on 5xx | Duplicate processing | Potential double tier-set, no harm but noise |
| Upgrade mid-cycle | New checkout, Stripe prorates | Works, but no in-app proration communication |
| Payment failure | No handling in billing webhook | `invoice.payment_failed` not processed by foundry billing webhook |
| Trial expiration | No trial mechanism exists | N/A |

---

## Verification Commands

```bash
# Confirm cancellation webhook targets wrong table
grep -n 'scp_instances' src/services/billing/stripe.ts
# Should show UPDATE scp_instances, NOT UPDATE products

# Confirm scheduler queries products table
grep -n 'scp_status' src/services/scp/scheduler.ts
# Shows products WHERE scp_status='active'

# Confirm zero idempotency
grep -rn 'event.id\|event_id\|idempoten\|processed_event' src/services/billing/
# Zero matches

# Confirm API routes have no tier gates
grep -rn 'requireTier' src/routes/api/
# Zero matches

# Confirm portfolio has no tier gate
grep -n 'requireTier' src/routes/dashboard/portfolio.ts
# Zero matches

# Count jobs using getAllActiveProducts (no subscription check)
grep -c 'getAllActiveProducts' src/jobs/index.ts
# Returns 25+
```

---

## Recommended Fix Priority

1. **Immediate (P0-01):** Fix cancellation webhook to update `products.scp_status = 'paused'` in addition to `scp_instances`
2. **Immediate (P0-02):** Add founder tier/subscription check to `getAllActiveProducts()` or wrap it with a billing-aware variant
3. **Immediate (P0-03):** Add `processed_webhook_events` table with event ID dedup before processing
4. **This sprint (P0-04, P0-05):** Add `requireTier` to portfolio route and all API tier routes
5. **This sprint (P1-01):** Add tier-aware guard to dashboard route (show resubscribe CTA for null tier)
6. **This sprint (P1-02):** Flip `canAccess` default from allow to deny for unregistered features
7. **This sprint (P1-03):** Add product-count reconciliation on tier downgrade webhook
8. **Next sprint (P2):** Implement AI cost ceiling per tier, env.ts cleanup, downgrade UI

---

*Red team review by Billing Auditor (Persona 8). This review is hostile by design. All findings are based on static code analysis of the actual codebase.*
