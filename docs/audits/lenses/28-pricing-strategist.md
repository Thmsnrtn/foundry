# Lens 28 — Pricing Strategist (Company-Centric Model)

**Auditor perspective:** Pricing architecture, tier structure, value metric alignment, upgrade paths, billing edge cases, and multi-company control plane scalability.

**Date:** 2026-04-16

---

## Executive Summary

The three-tier pricing model (Solo $79, Growth $199, Investor-Ready $399) is structurally sound but has **multiple enforcement gaps that create revenue leakage**, a **stale legacy pricing layer producing incorrect MRR calculations**, and **no product-count enforcement on one of two product creation paths**. The founding cohort mechanism has been retired in code but not fully cleaned up, leaving a scheduled job running daily that does nothing and env vars referencing a dead tier. Multi-company billing is flat-rate per founder with no per-product metering, meaning a $399 founder running 5 full SCP instances (60 AI agent executions/hour, 5x DB load, 5x API calls) pays the same as one running a single product. This is a cost-of-goods time bomb.

---

## P0 — Billing Broken / Revenue Loss

### P0-01: MRR Calculation Uses Stale Tier Names — Revenue Reporting Wrong

**File:** `src/services/founder/intelligence.ts:129`

```typescript
const tierPricing: Record<string, number> = { founding_cohort: 99, growth: 199, scale: 399 };
```

The tier names were renamed in migration 015 (`founding_cohort` -> `solo`, `scale` -> `investor_ready`) and the pricing changed ($99 -> $79, $399 stays, new Solo at $79). But the MRR intelligence function still uses the old tier names and old pricing. Any founder on `solo` or `investor_ready` will map to `tierPricing[tier] ?? 0` = **$0 MRR**. The internal founder ops dashboard (`/founder-ops`) displays completely wrong revenue numbers. This means the product's own business intelligence about itself is broken.

**Impact:** Every revenue metric in the founder-ops dashboard is zero for current-model subscribers. Decisions about Foundry's own business are being made on phantom data.

### P0-02: env.ts References Legacy Price ID Names — Stripe Webhook May Fail on Tier Resolution

**File:** `src/env.ts:24-26`

```
STRIPE_FOUNDING_COHORT_PRICE_ID  (env.ts)
STRIPE_SCALE_PRICE_ID            (env.ts)
```

vs. the actual Stripe integration (`src/services/billing/stripe.ts`) expects:

```
STRIPE_SOLO_PRICE_ID
STRIPE_GROWTH_PRICE_ID
STRIPE_INVESTOR_READY_PRICE_ID
```

The env validation file warns about missing `STRIPE_FOUNDING_COHORT_PRICE_ID` and `STRIPE_SCALE_PRICE_ID` (which no one will set since these tiers are dead), but does NOT warn about the actually-needed `STRIPE_SOLO_PRICE_ID` and `STRIPE_INVESTOR_READY_PRICE_ID`. A fresh deployment following `.env.example` (which is correct) would work, but the startup validation gives misleading signals. More critically, if someone follows `env.ts` as the source of truth, they will set the wrong vars and `getPriceId()` will throw at checkout time.

### P0-03: No Product-Count Enforcement on No-Code Path

**File:** `src/routes/dashboard/onboarding.ts:76-93`

The `POST /onboarding/create-product` handler (the no-code/URL-based path) creates products with zero tier or product-count validation:

```typescript
onboardingRoutes.post('/onboarding/create-product', async (c) => {
  const founder = c.get('founder');
  const body = await parseBody(c);
  const productId = nanoid();
  await query(
    `INSERT INTO products (...) VALUES (?, ?, ?, ?, ?, 'active')`,
    [productId, body.name, founder.id, ...]
  );
```

Compare this with the GitHub-based path (`POST /onboarding/select-repo`, lines 120-151) which properly checks `productLimits` per tier. A Solo or Growth founder can bypass the 1-product limit by using the no-code onboarding path. Each extra product spins up a full SCP agent cycle (12 agents hourly), consuming Anthropic API credits with no corresponding revenue.

**Impact:** Direct revenue leakage through unbilled AI compute. Any user can add unlimited products via `/onboarding/no-code`.

---

## P1 — Pricing Doesn't Match Product Positioning / Tier Gates Bypassable

### P1-01: Investor Layer, Board Packets, Portfolio, and Team Routes Have No Tier Gates

The following dashboard routes are gated by auth (login required) but NOT by subscription tier:

| Route | Expected Tier | Gate Applied |
|-------|---------------|--------------|
| `/portfolio` | investor_ready | None |
| `/investors` | investor_ready | None |
| `/investors/*` | investor_ready | None |
| `/board-packet` | investor_ready | None |
| `/integrations` | growth+ | None |
| `/integrations/*` | growth+ | None |
| `/team` | growth+ | None |
| `/team/*` | growth+ | None |
| `/playbooks` | investor_ready | None |
| `/playbooks/*` | investor_ready | None |

**Files:** `src/routes/dashboard/portfolio.ts`, `src/routes/dashboard/investors.ts`, `src/routes/dashboard/board-packet.ts`, `src/routes/dashboard/integrations.ts`, `src/routes/dashboard/team.ts`, `src/routes/dashboard/playbooks.ts`

All six route files import auth middleware but zero import `requireTier`. A Solo ($79) founder can access Investor Layer features ($399 value), connect integrations ($199 value), invite team members ($199 value), and generate board packets ($399 value).

**Evidence:** Grepped for `requireTier|canAccess` in all six files: zero matches. Confirmed `src/index.ts` mounts these with only `authMiddleware`, no tier-gate middleware.

Only the following routes actually enforce tier gates: cohorts, competitive, DNA/wisdom, failures, patterns, remediation (6 out of ~30+ gated feature categories).

### P1-02: All API Routes (tier1-tier4) Have No Tier Enforcement

**Files:** `src/routes/api/tier1.ts`, `tier2.ts`, `tier3.ts`, `tier4.ts`

Despite being named "tier1" through "tier4" (implying tiered access), none of these API route files import or use `requireTier`. They are mounted with `authMiddleware` only. The naming suggests the developer intended tiered access but never implemented it.

These routes expose unit economics, competitive strategy, platform dependency analysis, psychology insights, expansion intelligence, and ethics assessments — all premium features accessible to any authenticated user regardless of tier.

### P1-03: Subscription Deletion Sets tier = NULL But Products Continue Running

**File:** `src/services/billing/stripe.ts:86-91`

```typescript
case 'customer.subscription.deleted': {
  const sub = event.data.object as Stripe.Subscription;
  await query('UPDATE founders SET tier = NULL WHERE stripe_customer_id = ?', [sub.customer]);
  break;
}
```

When a subscription is cancelled, the founder's tier is set to NULL. However:
1. Their products remain `status = 'active'`
2. SCP agents continue executing hourly for all active products (no tier check in scheduler)
3. The tier-gate middleware shows "Free Trial" for null tier and blocks page access, but backend agent execution continues consuming AI credits

There is no mechanism to pause or archive products when a subscription lapses. The SCP scheduler iterates all active products regardless of the owner's payment status.

### P1-04: canAccess Returns true for Unknown Feature Keys — Default-Open

**File:** `src/middleware/tier-gate.ts:43-45`

```typescript
export function canAccess(founder: Founder, featureKey: string): boolean {
  const gate = FEATURE_GATES[featureKey];
  if (!gate) return true; // Unknown feature — allow
```

Any feature key not registered in `FEATURE_GATES` defaults to allowed. This is a dangerous default. If a new premium feature is added and the developer forgets to register it in the gate config, it will be accessible to all tiers. The safe default should be deny-by-default for authenticated routes.

---

## P2 — Pricing Model Issues

### P2-01: Value Metric Is Per-Founder, Not Per-Company — Cost Misalignment

The subscription is **one flat fee per founder** regardless of how many products/companies they run. The pricing page says "Up to 5 companies" on Investor-Ready, but the billing is `quantity: 1` in the Stripe checkout:

```typescript
line_items: [{ price: getPriceId(tier), quantity: 1 }],
```

Each product runs 12 AI agents on hourly cadences. AI cost scales linearly with product count. A founder with 5 products at $399/mo generates ~5x the AI API cost of a single-product founder. At current Claude API pricing, 5 products could easily exceed $399/mo in Anthropic costs alone.

**Recommendation:** Either (a) charge per-company as an add-on, (b) introduce metered billing for AI consumption, or (c) enforce hard compute budgets per tier.

### P2-02: No Downgrade Path in UI — Only Upgrade

**File:** `src/routes/dashboard/settings.ts:80-88`

The settings page only shows upgrade buttons:
- If no tier: shows Solo, Growth, Investor-Ready buttons
- If on a tier below investor_ready: shows "Upgrade to Investor Ready"
- No downgrade button from Investor-Ready to Growth, or Growth to Solo

The Stripe Customer Portal (`/settings/manage-subscription`) may allow plan changes, but the in-app UI provides no guidance. A founder who wants to downgrade has to figure out the Stripe portal handles it. More critically, if a founder downgrades from Investor-Ready to Solo while running 5 products, there is no enforcement to archive the extra 4 products.

### P2-03: No Annual Pricing Option

All tiers are monthly only. For a $399/mo product targeting founders approaching investors, annual pricing with a discount (e.g., $3,990/year = 2 months free) would:
- Reduce churn
- Improve cash flow
- Signal commitment from serious founders
- Align with fundraising cycles (founders don't want monthly churn risk during due diligence)

### P2-04: Solo Tier Differentiation Is Thin

Solo ($79) and Growth ($199) both get 1 product and 12 AI agents. The $120/mo jump buys:
- Live integrations (Stripe, PostHog, Intercom, Linear)
- Team mode
- Intelligence Network (benchmarks)
- Wisdom Layer
- Remediation Engine

This is actually a large feature gap, but the pricing page doesn't communicate the ROI well. The Solo tier lists "AI Ask" and "Decision queue" — features that also exist on Growth. The differentiator is mostly whether the agents use live data or static/manual data. Consider positioning this more clearly: Solo = "AI team with manual data" vs Growth = "AI team with live data."

---

## P3 — Cleanup and Optimization

### P3-01: Founding Cohort Vestiges Throughout Codebase

The founding cohort was retired but leaves debris:

1. `src/services/billing/cohort.ts` — Entire file is a no-op function kept "so the job registry doesn't break"
2. `src/jobs/index.ts:1801` — `slot_enforcement` job runs daily at 9:00 UTC calling the no-op
3. `src/env.ts:24` — References `STRIPE_FOUNDING_COHORT_PRICE_ID` ($99)
4. `src/env.ts:26` — References `STRIPE_SCALE_PRICE_ID` (old name for investor_ready)
5. `src/db/seed.ts:345` — Seeds `'founding_cohort'` as acquisition channel
6. `src/db/seed-demo.ts:22` — Seeds founder with `'founding_cohort'` tier (would fail CHECK constraint on clean DB with updated schema)
7. `src/db/migrations/001_initial.sql:14` — CHECK constraint still says `('founding_cohort', 'growth', 'scale')`, never altered (migration 015 does UPDATE but leaves the CHECK)
8. `src/routes/dashboard/founder-ops.ts:97` — Renders founding_cohort MRR card

The orientation document says "Founding cohort: 30 slots at locked rate" but the code shows this was fully retired. Neither the 30-slot limit nor the activation window is enforced anywhere.

### P3-02: Stripe API Version Pinned to 2023-10-16

**File:** `src/services/billing/stripe.ts:15`

The Stripe API is pinned to a version from October 2023. This is over 2.5 years old. While pinning is good practice, it should be periodically updated and tested.

### P3-03: getSoloSlotCount Function is Orphaned

**File:** `src/services/billing/stripe.ts:60-63`

```typescript
export async function getSoloSlotCount(): Promise<number> {
  const result = await query("SELECT COUNT(*) as c FROM founders WHERE tier = 'solo'", []);
  return (result.rows[0] as Record<string, number>)?.c ?? 0;
}
```

This function is exported but never called anywhere in the codebase. It appears to be a remnant of the founding cohort slot-counting logic adapted for solo tier but never wired in.

### P3-04: console.warn in Stripe Webhook Handler

**File:** `src/services/billing/stripe.ts:82`

```typescript
console.warn(`[STRIPE WEBHOOK] Unrecognised price ID: ${priceId}...`);
```

Should use the structured logger per CLAUDE.md standards.

### P3-05: No Idempotency on Checkout Session Creation

**File:** `src/routes/dashboard/settings.ts:20-43`

The POST `/checkout` handler creates a new Stripe checkout session on every submission. If a user clicks the checkout button twice (double-click, back-button retry), they get multiple sessions. Stripe handles this gracefully (only one will complete), but it creates orphaned sessions in the Stripe dashboard.

---

## Tier Differentiation Assessment

| Dimension | Solo ($79) | Growth ($199) | Investor-Ready ($399) |
|-----------|-----------|---------------|----------------------|
| Products | 1 | 1 | 5 |
| AI Agents | 12 | 12 | 12 per product |
| Live integrations | No | Yes | Yes |
| Team members | 1 | 3 | Unlimited |
| Wisdom/DNA | No | Yes | Yes |
| Remediation PRs | No | Yes | Yes |
| Investor layer | No | No | Yes |
| Competitive intel | No | No | Yes |
| Benchmarks | No | Yes | Yes |
| **Price jump** | -- | **+$120 (152%)** | **+$200 (100%)** |
| **COGS risk** | Low | Medium | High (5x AI) |

The Solo-to-Growth jump is the steepest percentage-wise but provides genuine value differentiation. The Growth-to-Investor-Ready jump is reasonable given multi-product and investor features, but the cost exposure from 5 simultaneous SCP instances is unpriced.

---

## Multi-Company Billing Edge Cases

| Scenario | Current Behavior | Expected Behavior |
|----------|-----------------|-------------------|
| Product added mid-cycle | No billing impact (flat rate) | Should at minimum log for cost tracking |
| Product paused | No mechanism exists | Should suspend SCP execution, reduce AI cost |
| Product deleted | Products table has `status` column but nothing sets it to archived on delete | Should archive, stop agents, retain data |
| Downgrade with excess products | Nothing happens | Should prompt user to select which products to keep |
| Subscription cancelled | tier = NULL, products keep running | Should suspend all SCP execution |
| Upgrade from Solo to Investor-Ready | New checkout session, Stripe handles proration | Works but no in-app communication of proration |

---

## Founding Cohort Assessment

The founding cohort was fully retired. The 30-slot limit and 7-day activation window are not enforced. The `enforceActivationWindow()` function is an empty no-op. The daily cron job `slot_enforcement` calls this no-op. There is no mechanism to lock pricing for early adopters. If this is intentional, the dead code should be removed. If the intent was to preserve a "founding cohort" concept under the new tier names, it was lost in the migration.

---

## Summary of Findings

| ID | Severity | Finding |
|----|----------|---------|
| P0-01 | P0 | MRR calculation uses dead tier names — all revenue reporting is zero |
| P0-02 | P0 | env.ts references legacy Stripe price ID names, not current ones |
| P0-03 | P0 | No-code product creation path bypasses product-count limits |
| P1-01 | P1 | 6+ dashboard route groups (investor, integrations, team, etc.) have no tier gates |
| P1-02 | P1 | API routes tier1-tier4 have no tier enforcement despite naming |
| P1-03 | P1 | Cancelled subscription leaves SCP agents running, consuming AI credits |
| P1-04 | P1 | canAccess defaults to allow for unknown feature keys |
| P2-01 | P2 | Flat per-founder pricing with no per-company metering creates cost exposure |
| P2-02 | P2 | No downgrade path in UI; no product-count enforcement on downgrade |
| P2-03 | P2 | No annual pricing option |
| P2-04 | P2 | Solo/Growth differentiation messaging could be clearer |
| P3-01 | P3 | Founding cohort code vestiges across 8+ files |
| P3-02 | P3 | Stripe API version 2.5 years old |
| P3-03 | P3 | Orphaned getSoloSlotCount function |
| P3-04 | P3 | console.warn in Stripe webhook |
| P3-05 | P3 | No idempotency on checkout session creation |
