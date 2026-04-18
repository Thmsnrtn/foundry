# Sweep 1 — Lens 035 (Fraud / Abuse)
## Prior findings status
- F-01 (P0): Unbounded AI cost exposure — RESOLVED (DEFECT-0025, $25/day ceiling per product, configurable via env)
- F-02 (P1): Ingest token abuse: no rate limit, no size limit — STILL OPEN
- F-03 (P1): Share token grants permanent unauthenticated access — STILL OPEN
- F-04 (P1): Auth rate limiting per-IP only — STILL OPEN
- F-05 (P1): Rate limit state in-memory, lost on deploy — IMPROVED (rate limit Map now has size bound per DEFECT-0046 partial, but still in-memory)
- F-06 (P2): No abuse detection on public endpoints — STILL OPEN
- F-07 (P2): GitHub tokens in plaintext — RESOLVED (DEFECT-0001)
- F-08 (P2): No abuse detection on AI conversation endpoint — STILL OPEN
## New findings
- None
## Verdict: OPEN P0-P1
