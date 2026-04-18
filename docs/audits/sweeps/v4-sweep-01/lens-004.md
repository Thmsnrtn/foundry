# Sweep 1 — Lens 004 (Database Architect)
## Prior findings status
- P0-01 (FK enforcement disabled): RESOLVED — `PRAGMA foreign_keys = ON` added to getDb() in client.ts.
- P0-02 (No transactions): IMPROVED — Provisioner uses `batch()`. Other paths still unprotected.
- P0-03 (integrations table 3x): IMPROVED — Migration 056_schema_reconciliation adds missing columns (commit 8304196). Structural dupe remains but columns reconciled.
- P0-04 (wisdom_network_opted_in opposing defaults): RESOLVED — Migration 057 fixes existing rows to opt-out (commit 52119e6).
- P0-05 (Migration runner swallows errors): STILL OPEN — Runner still swallows "duplicate column" / "already exists". No post-migration validation.
- P0-06 (schema.sql diverges from migration 001): STILL OPEN — Tier CHECK constraint mismatch not addressed.
- P0-07 (7 duplicate table names): IMPROVED — Migration 056 reconciles missing columns. Tables still defined multiple times but columns are aligned.
- P1-01 (N+1 query patterns in jobs): STILL OPEN.
- P1-05 (30 duplicate migration prefixes): STILL OPEN — Prefixes 004-033 still duplicated. New 056 also has a dupe.
- P1-09 (SELECT * everywhere): STILL OPEN.
- P1-10 (executeRaw SQL splitting fragile): STILL OPEN.
## New findings since prior audit
- None.
## Verdict: OPEN P0-P1
