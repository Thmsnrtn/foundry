# Sweep 1 — Lens 039 (LLM Cost/Ops)
## Prior findings status
- COST-01 (P1): Per-token cost calculations hardcoded and incorrect — RESOLVED (DEFECT-0060, centralized COST_PER_1M table in client.ts with model-specific input/output rates)
- COST-02 (P1): Cost rates not centralized — RESOLVED (single calculateCost path in client.ts)
- COST-03 (P2): Evolution pipeline costs not attributed — STILL OPEN
- COST-04 (P2): Fire-and-forget cost logging — IMPROVED (DEFECT-0045, some silent catches replaced with logging)
- COST-05 (P0): Budget informational only, no hard enforcement — RESOLVED (DEFECT-0025, $25/day ceiling enforced before API calls)
- COST-06 (P1): No per-call cost estimation before execution — STILL OPEN
- COST-07 (P1): No platform-level cost alerting — STILL OPEN
- COST-08 (P2): Default $50 budget too low — IMPROVED (ceiling is now $25/day = ~$750/mo, decoupled from display budget)
## New findings
- None
## Verdict: OPEN P0-P1
