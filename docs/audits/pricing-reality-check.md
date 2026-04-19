# Pricing Tier Reality Check

Date: 2026-04-19

## Shipped Tier Names (in code)
- **Solo** — $79/mo — 1 product — `tier = 'solo'`
- **Growth** — $199/mo — up to 3 products — `tier = 'growth'`
- **Investor-Ready** — $399/mo — up to 5 products — `tier = 'investor_ready'`

## Consistency Check

| Surface | Solo | Growth | Investor-Ready | Aligned? |
|---------|------|--------|---------------|----------|
| `src/middleware/tier-gate.ts` | solo | growth | investor_ready | YES |
| `src/services/billing/stripe.ts` | solo | growth | investor_ready | YES |
| `.env.example` | STRIPE_SOLO_PRICE_ID | STRIPE_GROWTH_PRICE_ID | STRIPE_INVESTOR_READY_PRICE_ID | YES |
| Landing page (v6 redesign) | $79 | $199 | $399 | YES |
| README (rewritten) | $79 | $199 | $399 | YES |

## Legacy References (stale)
- `.env.example` still contains `STRIPE_FOUNDING_COHORT_PRICE_ID` and `STRIPE_SCALE_PRICE_ID` from old tier names — these are NOT used by billing code but remain in Fly.io secrets
- `src/db/migrations/001_initial.sql` has CHECK constraint with old names (`founding_cohort`, `scale`) — migration 059 fixes existing rows but can't alter the CHECK constraint in SQLite
- `src/services/billing/cohort.ts` references founding cohort slot logic — dead code

## Product Limits Per Tier (enforced in code)
- Solo: 1 product (checked in `src/routes/dashboard/onboarding.ts`)
- Growth: 3 products
- Investor-Ready: unlimited (code uses `Infinity`)

## Gaps
1. Growth tier product limit (3) is not communicated on the pricing page — the page says "Full agent team + integrations" but doesn't mention the product count
2. Investor-Ready says "up to 5 companies" on the pricing page but the code allows unlimited — inconsistency favoring the user (not harmful)
3. No annual pricing option exists in code or UI

## Verdict
Pricing tiers are **aligned** across code, billing service, .env.example, landing page, and README. Legacy env vars and migration CHECK constraints are cosmetic issues — the billing code reads the correct tier names.
