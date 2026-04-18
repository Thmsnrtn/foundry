# Sweep 1 — Lens 032 (Billing Ops)
## Prior findings status
- F-01 (P0): No dunning or failed payment recovery — RESOLVED (DEFECT-0053, invoice.payment_failed handler added)
- F-02 (P1): No proration handling — STILL OPEN
- F-03 (P1): No refund or dispute handling — STILL OPEN
- F-04 (P1): Multi-product billing not metered; downgrade not enforced — STILL OPEN
- F-05 (P1): No idempotency keys on Stripe API calls — IMPROVED (webhook dedup added via DEFECT-0031, but customer/subscription create still lack idempotency keys)
- F-06 (P2): Webhook handler does not deduplicate events — RESOLVED (DEFECT-0031, migration 055)
- F-07 (P2): No billing audit trail — STILL OPEN
- F-08 (P2): Two Stripe clients with different API versions — STILL OPEN
## New findings
- None
## Verdict: OPEN P0-P1
