# Sweep 1 — Lens 033 (Auth Expert)
## Prior findings status
- P0-01: Portfolio API routes have zero ownership validation — RESOLVED (DEFECT-0026)
- P0-02: Transcript webhook auth broken — RESOLVED (DEFECT-0030)
- P0-03: Internal ecosystem routes lack access control — STILL OPEN (ECOSYSTEM_SERVICE_KEY still optional)
- P0-04: RBAC middleware applied to zero routes — IMPROVED (DEFECT-0052, applied to settings/team/billing but not all routes)
- P0-05: Voice session endpoint lacks ownership validation — RESOLVED (DEFECT-0027, commit cb2f9d2)
- P1-01: Cookie parsing naive — STILL OPEN
- P1-02: foundry_product cookie lacks Secure flag — STILL OPEN
- P1-03: Portfolio API keys stored in plaintext — RESOLVED (DEFECT-0001 scope)
- P1-04: GitHub access tokens stored in plaintext — RESOLVED (DEFECT-0001)
- P1-05: Integration credentials in plaintext — RESOLVED (DEFECT-0001)
- P1-06: No CSRF protection — RESOLVED (DEFECT-0003)
- P1-08: Ingest/share tokens not rate-limited per-token — STILL OPEN
- P1-09: Clerk verifyToken with as-any cast — IMPROVED (DEFECT-0049 reduced casts)
- P1-10: Auto-provisioning race condition — STILL OPEN
## New findings
- None
## Verdict: OPEN P0-P1
