# Sweep 1 — Lens 001 (Principal Architect)
## Prior findings status
- F-01 (God entrypoint 512 lines): STILL OPEN — `src/index.ts` is 568 lines (grew). No route registry extraction.
- F-02 (Monolithic jobs 1865 lines): STILL OPEN — `src/jobs/index.ts` is 1867 lines. No split.
- F-03 (In-process cron, no distributed lock): RESOLVED — `src/services/job-lock.ts` implements DB-based locks (commit 549964e).
- F-04 (Duplicate migration prefixes): STILL OPEN — 004-033 still have dual prefixes. New 056 also has a dupe.
- F-05 (Migration failure swallowed): RESOLVED — production now `process.exit(1)` on failure (commit 0e06ab3).
- F-06 (No transaction support): IMPROVED — `batch()` now used in SCP provisioner (commit c3d7da1). Other paths still unprotected.
- F-07 (1528-line monotype barrel): STILL OPEN — `src/types/index.ts` is still 1528 lines.
- F-08 (No multi-product isolation boundary): STILL OPEN — No fleet abstraction added.
- F-09 (SCP dynamic import): STILL OPEN — No agent registry created.
- F-10 (In-memory rate limiting): IMPROVED — Memory bounded (commit 203294b) but still in-memory per-instance.
- F-11 (422 console.log calls): IMPROVED — Structured `logger` exists, jobs/index.ts and index.ts use it. ~184 console calls remain across 39 files (down from 422).
- F-12 (db/client.ts mixed concerns): STILL OPEN — Still 325 lines mixing primitives with business queries.
- F-13 (No external call resilience): RESOLVED — `src/services/resilience.ts` provides retry+timeout. AI client has timeout+retry+cost ceiling (commits 2273f72, dc01f38).
- F-16 (Auth cookie parsing regex-based): STILL OPEN — No evidence of `getCookie()` adoption.
## New findings since prior audit
- None genuinely new.
## Verdict: OPEN P0-P1
