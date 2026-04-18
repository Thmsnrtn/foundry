# Sweep 1 — Lens 051 (Concurrency / Race Conditions)
## Prior findings status
- CONC-01 (P0): Job scheduler double-fire on deploy — RESOLVED (DEFECT-0047, distributed locks via job_locks table + migration 056)
- CONC-02 (P1): SCP agent concurrent execution for same product — IMPROVED (lock prevents same job from double-firing; sequential execution still means overlap at hourly boundary)
- CONC-03 (P1): In-memory rate limiter bypassed by multi-instance — IMPROVED (size bound added, but still per-process)
- CONC-04 (P1): Double-submit on forms — STILL OPEN (no idempotency guards on POST handlers)
- CONC-05 (P1): Read-modify-write hazards — STILL OPEN (no transaction boundaries on most paths)
## New findings
- None
## Verdict: OPEN P0-P1
