# Sweep 1 — Lens 003 (Staff Backend)
## Prior findings status
- P0-01 (Lifecycle state not persisted): RESOLVED — `INSERT OR IGNORE INTO lifecycle_state` added in tenant.ts (commit ad0fd3a).
- P0-02 (Migration failures don't stop server): RESOLVED — `process.exit(1)` in production (commit 0e06ab3).
- P0-03 (SCP provisioning failures swallowed): STILL OPEN — Still `.catch()` and warn pattern in startup.
- P0-04 (Plaintext tokens): IMPROVED — `src/services/encryption.ts` implements AES-256-GCM. Rollout scope unclear.
- P0-05 (SQL injection via dynamic column): STILL OPEN — No evidence of allowlist hardening.
- P0-06 (No retry/timeout on external calls): RESOLVED — `src/services/resilience.ts` + AI client timeout/retry (commits 2273f72, 2e2f999).
- P0-07 (No transaction support): IMPROVED — Provisioner uses `batch()` (commit c3d7da1). Other critical paths still unprotected.
- P0-08 (Silent error swallowing): IMPROVED — BaseAgent catch blocks now log via `logger.error()` instead of empty catch (commit 59e355e). 1 empty catch remains.
- P1-01 (Zero request validation): IMPROVED — `validateBody` middleware with Zod exists and is used on onboarding + ask routes. Most routes still unvalidated.
- P1-02 (422 console.log): IMPROVED — ~184 remain, structured logger in use for critical paths.
- P1-05 (Timing-unsafe key compare): RESOLVED — `timingSafeEqual` in internal.ts.
- P1-07 (Inconsistent error shapes): STILL OPEN.
- P1-08 (55 jobs no concurrency control): IMPROVED — Job locking implemented (commit 549964e).
## New findings since prior audit
- None.
## Verdict: OPEN P0-P1
