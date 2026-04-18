# Sweep 1 — Lens 028 (Pricing Strategist)
## Prior findings status
- P0-01: MRR calculation uses dead tier names — RESOLVED (DEFECT-0020)
- P0-02: env.ts references legacy Stripe price IDs — RESOLVED (env.ts updated)
- P0-03: No-code path bypasses product-count limits — RESOLVED (DEFECT-0021, validateBody added)
- P1-01: 6+ route groups missing tier gates — RESOLVED (DEFECT-0036, commits 8262a79, 3b979b6)
- P1-02: API tier routes have no tier enforcement — RESOLVED (DEFECT-0036)
- P1-03: Cancelled subscription leaves agents running — RESOLVED (DEFECT-0023, commit a0101ae)
- P1-04: canAccess defaults to allow for unknown keys — STILL OPEN
- P3-01: Founding cohort vestiges — STILL OPEN (low priority cleanup)
## New findings
- None
## Verdict: OPEN P0-P1
