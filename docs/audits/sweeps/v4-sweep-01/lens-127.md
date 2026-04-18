# Sweep 1 — Lens 127
## Prior findings status
- CL-01: IMPROVED — decision_patterns writes now gated by consent check (DEFECT-0044); table still globally queryable but requires opt-in
- CL-02: STILL OPEN — portfolio benchmarking reveals percentile position
- CL-03: STILL OPEN — network intelligence exposes aggregate distributions
- CL-04: IMPROVED — wisdom network queries filter on wisdom_network_opted_in=1; opt-in default fixed to opt-out (DEFECT-0043)
- CL-05: STILL OPEN — competitive scan cross-contamination risk
## New findings
- None
## Verdict: OPEN P0-P1 (CL-01 improved from P1; CL-02 remains P1 — percentile distribution leakage)
