# Sweep 1 — Lens 012 (API Design)
## Prior findings status
- P0-01 (Missing ownership checks on experiments/predictions): IMPROVED — `platform.ts` now calls `getProductByOwner` on multiple routes (confirmed 4 calls). Full coverage of all cited endpoints not confirmed.
- P0-02 (Decision approve/reject no ownership check): STILL OPEN — No evidence of fix in founder-intelligence.ts.
- P0-03 (Internal key timing-unsafe): RESOLVED — `timingSafeEqual` in internal.ts.
- P0-04 (Transcript webhook raw key vs hash): STILL OPEN.
- P1-01 (Zero request body validation): IMPROVED — `validateBody` Zod middleware exists and used on onboarding + ask. Most endpoints still unvalidated.
- P1-02 (Inconsistent error response formats): STILL OPEN.
- P1-03 (No pagination on most list endpoints): STILL OPEN.
- P1-06 (Tier-gated features no API enforcement): IMPROVED — RBAC middleware applied to settings, team, billing routes (commit f1a8587).
- P1-07 (AI endpoints no timeout/cost protection): RESOLVED — Cost ceiling + timeout in AI client.
- P1-08 (Stripe webhook no signature verification in supercharge.ts): STILL OPEN.
- P1-09 (SQL injection in LIKE pattern): STILL OPEN.
## New findings since prior audit
- None.
## Verdict: OPEN P0-P1
