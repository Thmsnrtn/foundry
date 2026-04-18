# Sweep 1 — Lens 087
## Prior findings status
- RDC-01: STILL OPEN — no dispute webhook handler (charge.disputed not in event list)
- RDC-02: IMPROVED — charge.refunded event now handled in stripe-webhook.ts
- RDC-03: RESOLVED — invoice.payment_failed handler added (DEFECT-0053)
- RDC-04: STILL OPEN — subscription deletion data access period unchanged
- RDC-05: STILL OPEN — no accounting ledger for revenue events
## New findings
- None
## Verdict: OPEN P0-P1 (RDC-01 remains P0 — no dispute webhook)
