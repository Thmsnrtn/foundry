# Lens 132 — Billing Aggregation Across Companies

**Auditor perspective:** Edge-case hunter / domain adversary — mid-cycle company additions, proration, downgrades
**Distinct-value declaration:** Examines billing edge cases unique to multi-company founders: adding a company mid-billing-cycle, downgrading with 15 active companies, and proration across 20 companies. No prior lens tested multi-company billing scenarios.
**Tenancy-critical:** Yes. Billing operates at the founder level but costs scale with company count.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P1 | 2 |
| P2 | 3 |

---

## Billing Model

- **Solo ($79/mo):** 1 product
- **Growth ($199/mo):** 1 product (same product limit as Solo)
- **Investor-Ready ($399/mo):** Up to 5 products

Billing is per-founder, not per-product. The subscription price does not increase with product count within the tier limit.

---

## BA-01. Adding a company mid-cycle: no proration or billing adjustment

**Severity: P1**
**Files:** `src/services/billing/stripe.ts`, `src/routes/dashboard/onboarding.ts`

When an Investor-Ready founder adds their 3rd product mid-billing-cycle, there is no Stripe event or billing adjustment. The founder pays the same $399/mo whether they have 1 product or 5. This is correct by design (flat tier pricing), but the AI cost implications are not accounted for:

- Each additional product adds ~$5-25/day in AI costs (agent runs, insights, briefings)
- The $25/day per-product AI cost ceiling applies independently
- A founder with 5 products could consume $125/day in AI costs against a $399/mo subscription

There is no per-product cost allocation visible to the founder and no mechanism to adjust pricing based on actual AI consumption.

**Evidence:**
- `src/services/billing/stripe.ts`: No per-product billing events
- `src/services/ai/client.ts:19`: Per-product daily ceiling of $25 (2500 cents)
- No aggregate cost ceiling across all products for a founder

---

## BA-02. Downgrade from Investor-Ready to Solo with 5 active products

**Severity: P1**
**Files:** `src/services/billing/stripe.ts:73-99`, `src/routes/dashboard/onboarding.ts:125-151`

When a Stripe `customer.subscription.updated` webhook fires with a tier change from `investor_ready` to `solo`, the handler at line 81 simply updates `founders.tier = 'solo'`. It does NOT:

1. Check if the founder has more products than the new tier allows (Solo: 1, Growth: 1)
2. Archive, pause, or deactivate excess products
3. Notify the founder that 4 of their 5 products will lose agent coverage
4. Pause SCP instances for excess products

The founder continues with 5 active products on a Solo plan. All 5 products continue to have agents running, consuming AI credits, generating briefings, and appearing in the dashboard. The only enforcement is at product creation time (`select-repo` handler checks limits), but existing products are never audited.

**Evidence:**
- `src/services/billing/stripe.ts:76-85`: Only updates tier, no product audit
- No `enforceTierLimits()` function exists
- `productLimits = { solo: 1, growth: 1, investor_ready: 5 }` in `onboarding.ts:125` -- only checked at creation time
- `getAllActiveProducts()` does not filter by founder tier -- background jobs process all products regardless

---

## BA-03. No usage-based billing component despite variable AI costs

**Severity: P2**

The pricing model is flat-rate per tier, but AI consumption varies dramatically:
- A Solo founder with a quiet product: ~$2-5/day in AI costs
- An Investor-Ready founder with 5 active Red-state products: ~$50-125/day in AI costs

At $399/mo and $125/day, Foundry loses money within 4 days of the billing cycle. The per-product daily ceiling ($25) limits maximum AI spend but does not ensure profitability.

**Evidence:**
- `src/services/ai/client.ts:19`: `DAILY_COST_CEILING_CENTS = 2500` (configurable)
- No usage metering or reporting to Stripe
- No overage charges or throttling based on cumulative spend

---

## BA-04. Founding cohort slots are counted but not enforced on tier change

**Severity: P2**
**Files:** `src/services/billing/cohort.ts`, `src/jobs/index.ts:213-218`

The `slotEnforcement` job calls `enforceActivationWindow()`, and `getSoloSlotCount()` returns the count of founders with `tier='solo'`. If a founding cohort member upgrades to Growth and then downgrades back to Solo, they re-occupy a Solo slot. There is no guarantee their cohort pricing is preserved -- Stripe handles this at the subscription level, but the cohort tracking in Foundry does not track upgrade/downgrade cycles.

---

## BA-05. Cancelled subscription handler pauses SCP but does not address active billing cycle

**Severity: P2**
**Files:** `src/services/billing/stripe.ts:87-99`

When a subscription is deleted, the handler:
1. Sets `founders.tier = NULL`
2. Queries for the founder's products
3. Pauses SCP instances

But the handler targets `scp_instances` table, not `agent_instances`. The schema shows `agent_instances` is where agent status is stored. If `scp_instances` does not exist or is a different table, the pause has no effect.

**Evidence:**
- Line 95-98: `UPDATE scp_instances SET status = 'paused'` -- but the codebase uses `agent_instances` for agent status
- `deprovisionSCP` in `provisioner.ts:184-193` updates both `products.scp_status` and `agent_instances.status`
- The webhook handler may be targeting the wrong table

---

## Recommendations

1. **Add tier enforcement on downgrade** -- When the Stripe webhook fires a tier change, count active products and archive/pause excess products. Notify the founder.
2. **Add aggregate AI cost ceiling per founder** -- A founder-level daily ceiling (e.g., $50 for Solo, $100 for Growth, $200 for Investor-Ready) in addition to the per-product ceiling.
3. **Verify the cancelled subscription handler targets the correct table** -- Ensure `scp_instances` vs `agent_instances` vs `products.scp_status` are all correctly updated.
4. **Add a periodic tier audit job** -- Weekly check that no founder has more products than their tier allows.
5. **Surface AI cost to founders** -- Show per-product and total AI spend in the dashboard, with warnings when approaching the ceiling.
