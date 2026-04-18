# Sweep 1 — Lens 045 (Cross-Company Ethics/Consent)
## Prior findings status
- P0: decision_patterns table unconsented — RESOLVED (DEFECT-0044, hasConsent check added to patterns.ts before writes)
- P1: Consent defaults opt-in — RESOLVED (DEFECT-0043, migration 057 fixes defaults to opt-out)
- P1: De-anonymization surface via market_category + metrics — STILL OPEN (no k-anonymity analysis)
- P2: hasConsent never imported outside consent.ts — RESOLVED (now imported in patterns.ts)
## New findings
- None
## Verdict: OPEN P0-P1
