# Sweep 1 — Lens 139
## Prior findings status
- DP-01: IMPROVED — subscription cancellation now pauses SCP at product level AND instance level; background jobs filter on scp_status='active' and status='active'
- DP-02: STILL OPEN — no mechanism to pause company without cancelling subscription
- DP-03: STILL OPEN — data accumulates for paused products
- DP-04: STILL OPEN — digest emails continue for paused products
- DP-05: STILL OPEN — voice session stale context after pause
## New findings
- None
## Verdict: OPEN P0-P1 (DP-01 improved from P1; DP-02 remains P1)
