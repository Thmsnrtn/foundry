# Sweep 1 — Lens 006 (Reliability / SRE)
## Prior findings status
- F01 (Anthropic API no retry/timeout/CB): RESOLVED — AI client has timeout + retry + cost ceiling (commits 2273f72, dc01f38).
- F02 (Turso no retry/timeout): STILL OPEN — `db/client.ts` query() still bare pass-through to db.execute().
- F03 (Stripe no retry/timeout/idempotency): STILL OPEN — No idempotency keys added. Dunning handler added (commit b2284b9) but no retry wrapper.
- F04 (Health check static lie): RESOLVED — Health check now probes DB with `SELECT 1` + checks env vars.
- F05 (No graceful shutdown): RESOLVED — SIGTERM/SIGINT handlers with graceful shutdown in index.ts (line 565-566).
- F06 (Migrations don't block startup): RESOLVED — `process.exit(1)` in production on migration failure.
- F07 (SCP provisioning failures swallowed): STILL OPEN — Still catch-and-warn.
- F08 (55 cron jobs no concurrency control): IMPROVED — Job locking via job_locks table (commit 549964e).
- F09 (Integration services inconsistent retry): STILL OPEN — Only GitHub audit has retry. Resilience wrapper exists but not applied to all integrations.
- F10 (Resend digest no retry): STILL OPEN.
- F18 (Zero structured logging): IMPROVED — `logger` module exists and used in critical paths. ~184 console calls remain.
- F19 (Non-idempotent webhook processing): IMPROVED — 055_webhook_idempotency migration added. Stripe event dedup unclear.
- F21 (No AI call rate/cost limiting): RESOLVED — Daily cost ceiling per product in AI client.
## New findings since prior audit
- None.
## Verdict: OPEN P0-P1
