# Sweep 1 — Lens 010 (DevOps / Deployment)
## Prior findings status
- P0-1 (SQLite database committed to git): RESOLVED — `foundry.db` no longer tracked by git (confirmed: `git ls-files foundry.db` returns empty).
- P0-2 (30 duplicate migration prefixes): STILL OPEN — Prefixes 004-033 still duplicated. New 056 also has a dupe.
- P0-3 (Migration failure doesn't stop server): RESOLVED — `process.exit(1)` in production (commit 0e06ab3).
- P1-1 (No .dockerignore): RESOLVED — `.dockerignore` exists with proper exclusions (commit 0e06ab3).
- P1-2 (DevDependencies shipped to production): STILL OPEN — Not verified as fixed in Dockerfile.
- P1-3 (No CI/CD pipeline): RESOLVED — `.github/workflows/ci.yml` exists (commit 203294b).
- P1-5 (Env var naming mismatch): STILL OPEN — Tier naming reconciliation via migration 059_fix_tier_check.sql exists but `.env.example` vs `env.ts` consistency unverified.
- P1-6 (Duplicate startup env validation): STILL OPEN.
- P1-7 (In-memory rate limiting): IMPROVED — Memory bounded but still in-memory.
- P2-1 (No graceful shutdown): RESOLVED — SIGTERM/SIGINT handlers added.
- P2-2 (Shallow health check): RESOLVED — DB probe + env var checks in health.ts.
- P2-7 (No build versioning): STILL OPEN.
- P2-9 (kill_timeout too short): STILL OPEN.
## New findings since prior audit
- None.
## Verdict: OPEN P0-P1
