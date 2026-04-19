# Journey 08 — Settings and Billing with Multi-Company Pricing

## Goal

A founder manages account settings, reviews billing, upgrades/downgrades their subscription tier, and understands how pricing scales with fleet size. Every billing state transition should be clear, immediate, and reversible.

## Starting State

- Authenticated founder with 1-15 companies.
- Active Stripe subscription at any tier.
- May be considering tier change due to fleet size growth or contraction.

## Steps (Happy Path)

1. Navigate to account settings → billing section.
2. View current plan: tier, per-company breakdown, next billing date, usage.
3. Simulate tier change: see exactly how price changes with current fleet size.
4. Execute tier change → Stripe processes immediately.
5. New tier features unlock (or gate) instantly — no manual refresh needed.
6. Review billing history: invoices, credits, proration details.
7. Download invoices for accounting.

## Success Criteria

- Pricing is transparent: founder knows exactly what each company costs.
- Tier change preview shows before/after pricing with proration calculated.
- Upgrade unlocks features immediately; downgrade gates features at period end.
- Adding/removing companies updates billing in real-time.
- Invoice history is complete and downloadable.

## Abandonment Criteria

- Pricing is opaque — founder cannot predict next invoice amount.
- Tier change requires contacting support.
- Proration is incorrect or surprising (unexpected charges).

## Fleet-Size Relevance

Multi-company pricing is the revenue model for Foundry at scale. This journey must be tested at fleet sizes 1, 2, 5, and 15 to ensure pricing communication scales clearly. Edge cases: adding a company at tier limit, removing last company, downgrading with more companies than the lower tier allows.
