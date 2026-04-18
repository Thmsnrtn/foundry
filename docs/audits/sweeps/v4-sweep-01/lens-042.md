# Sweep 1 — Lens 042 (SCP Fleet Orchestration)
## Prior findings status
- F-01 (P0): Sequential scheduler times out at fleet scale — STILL OPEN (DEFECT-0048, fundamental architecture unchanged)
- F-02 (P1): No concurrency control on agent runs — IMPROVED (DEFECT-0047, distributed locks prevent double-execution on deploy, but no per-product locks)
- F-03 (P1): No instance-level pause/resume for SCP instances — IMPROVED (product-level pause on cancellation added via DEFECT-0023)
- F-04 (P1): No cross-instance signaling — STILL OPEN
- F-05 (P1): Deprovisioning leaves orphaned data — STILL OPEN
## New findings
- None
## Verdict: OPEN P0-P1
