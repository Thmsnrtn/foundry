# Lens 53 — Database Migration Safety

**Auditor perspective:** 54 migrations with 30 duplicate prefixes. Destructive migrations, missing rollback, data loss risk, ordering ambiguity, and runtime safety of the migration runner.

**Date:** 2026-04-16
**Codebase snapshot:** 54 SQL migration files in `src/db/migrations/`, migration runner in `src/db/migrate.ts`

---

## Executive Summary

The migration system is dangerously fragile. 30 of 54 migration files share duplicate numeric prefixes (e.g., two `004_*.sql`, two `005_*.sql`, etc. through `033_`), and the runner sorts by filename lexicographically — meaning execution order depends on the second part of the filename, not a guaranteed sequence. The runner swallows `duplicate column` and `already exists` errors silently, masking genuine schema drift. There are zero rollback capabilities: no `DOWN` migrations, no `undo` command, no snapshot-before-apply. The migration runner executes each statement individually (not in a transaction), so a failure mid-migration leaves the schema in an inconsistent state with the migration marked as NOT applied (the `INSERT INTO schema_migrations` runs only after all statements succeed). No migration contains a destructive operation (DROP TABLE/COLUMN), which is fortunate, but there is also no guard preventing one from being added.

---

## Findings

### MIG-01. 30 Duplicate Migration Prefixes Create Ambiguous Ordering

**Severity: P1**

The following prefix numbers each have two migration files: 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018, 019, 020, 021, 022, 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033. The runner sorts by full filename (`files.sort()` at `src/db/migrate.ts:29`), so `004_sector_profiles.sql` runs before `004_signal_wisdom.sql` purely because 's' < 's' (they both start with 's' but 'e' < 'i'). If either migration depends on the other, the order is fragile and could break if a file is renamed.

**Evidence:**
- `src/db/migrations/` — `ls` shows 30 pairs of duplicate-prefix files
- `src/db/migrate.ts:28-29` — `readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()`
- Sort is lexicographic on the full filename, so `004_sector_profiles.sql` < `004_signal_wisdom.sql`
- No documentation states whether the two files in each pair are order-independent

**Remediation:** Renumber all migrations with unique sequential prefixes (e.g., `004a_`, `004b_` or `004_`, `005_`). Add a CI check that rejects duplicate prefixes. Since all migrations have already been applied in production, this only affects new deployments from scratch (test, staging).

**Target phase:** P1

---

### MIG-02. Migration Runner Does Not Use Transactions

**Severity: P1**

`src/db/migrate.ts:49-51` executes each SQL statement individually with `db.execute()`. If statement 3 of 5 in a migration fails (with a non-swallowed error), statements 1-2 are committed but the migration is NOT recorded in `schema_migrations` (the INSERT at line 65 runs only after all statements succeed). On the next startup, the runner retries the entire migration, attempting statements 1-2 again, which may fail with "already exists" (swallowed) or succeed with duplicate data.

**Evidence:**
- `src/db/migrate.ts:49` — `await db.execute({ sql: stmt, args: [] })` — individual statements, no transaction wrapper
- Line 52-59: error handling swallows `duplicate column` and `already exists`
- Line 65-68: `INSERT INTO schema_migrations` only runs after all statements succeed
- Turso supports `db.batch([...], 'write')` for transactional execution, but the runner doesn't use it

**Remediation:** Wrap each migration's statements in a `db.batch([...statements, insertSchemaRecord], 'write')` call. This ensures atomicity: either all statements and the schema_migrations record commit, or none do.

**Target phase:** P1

---

### MIG-03. No Rollback / Down Migration Capability

**Severity: P1**

There are zero `DOWN` migration files, no `rollback` command in the CLI, and no mechanism to undo a migration. SQLite does not support `DROP COLUMN` (until SQLite 3.35.0, and Turso may not support it), so even manual rollback is complex. If a migration introduces a bug (e.g., a wrong DEFAULT value, an incorrect CHECK constraint), the only remediation is a new forward migration.

**Evidence:**
- `src/db/migrations/` — all 54 files are forward-only SQL
- `src/cli/index.ts` — no `rollback` or `down` command
- `src/db/migrate.ts` — no rollback logic
- SQLite limitations make DROP COLUMN complex

**Remediation:** For SQLite, true rollback is impractical. Instead: (1) add a `--dry-run` flag that validates migration SQL without applying it, (2) add automatic database backup before migration (Turso supports point-in-time recovery), (3) require new migrations to include a comment block with manual rollback instructions.

**Target phase:** P2

---

### MIG-04. Error Swallowing Masks Genuine Schema Drift

**Severity: P1**

`src/db/migrate.ts:53-56` catches errors and continues if the message includes `duplicate column` or `already exists`. This was designed for idempotency but also silently masks:
- A migration that accidentally re-adds a column with a different type
- A migration that creates a table with the same name but different schema
- Typos in column names that happen to match an existing column

**Evidence:**
- `src/db/migrate.ts:53-56` — `if (msg.includes('duplicate column') || msg.includes('already exists')) { continue; }`
- No logging of swallowed errors — silent suppression
- No schema validation after migrations complete

**Remediation:** Log swallowed errors at `warn` level with the specific migration filename and statement. After all migrations, run a schema validation step that compares actual table schemas against expected schemas (can be generated from the SQL files).

**Target phase:** P1

---

### MIG-05. Migrations Run Before Server Starts — Failure in Dev Does Not Block

**Severity: P2**

`src/index.ts:495-536` — migration failures are fatal in production (`process.exit(1)` at line 529) but non-fatal in development (server starts anyway at line 532). This means dev environments can run with inconsistent schemas, producing confusing errors that mask migration bugs.

**Evidence:**
- `src/index.ts:524-536` — dev branch: `serve({ fetch: app.fetch, port }, ...)` runs even after migration failure
- Line 525: `logger.error('Migration error', ...)` logs the error
- No schema consistency check before serving requests

**Remediation:** In development, still exit on migration failure but with a clear error message suggesting manual intervention. Or, add a health check endpoint that reports schema status and returns 503 if migrations are pending.

**Target phase:** P2

---

### MIG-06. SQL Statement Splitting Is Fragile

**Severity: P2**

`src/db/migrate.ts:43-47` splits SQL on `/;\s*\n/` (semicolons followed by a newline). This breaks if a migration contains:
- String literals with semicolons followed by newlines
- TRIGGER bodies with embedded semicolons
- Comments containing semicolons before newlines

**Evidence:**
- `src/db/migrate.ts:43-44` — `sql.split(/;\s*\n/)`
- Line 45: strips `--` comments after splitting, not before
- The same fragile splitter is used in `src/db/client.ts:57-63` (`executeRaw`)
- None of the current 54 migrations happen to trigger this bug, but any future migration with a TRIGGER or complex CHECK constraint could

**Remediation:** Use a proper SQL parser or at minimum a state-aware splitter that respects string literals and parenthesized blocks. The `sql-parser-cst` package handles this. Alternatively, switch to the Turso `batch()` API which handles statement boundaries internally.

**Target phase:** P2

---

### MIG-07. No Migration Linting or CI Validation

**Severity: P2**

There is no CI check that validates migration files before merge. A developer could commit a migration with:
- A `DROP TABLE` statement
- SQL syntax errors (only caught at runtime)
- A duplicate prefix number
- A statement that modifies data (UPDATE/DELETE) without a WHERE clause

**Evidence:**
- No `.github/workflows/` migration validation step
- No linting rules for SQL files
- The migration runner is the only validation, and it runs at deploy time

**Remediation:** Add a CI step that: (1) rejects duplicate prefixes, (2) rejects `DROP TABLE`/`DROP COLUMN`/`DELETE FROM`/`TRUNCATE` unless explicitly allowlisted, (3) applies all migrations to a fresh SQLite database to catch syntax errors, (4) validates that each migration is independently idempotent.

**Target phase:** P2

---

## Embarrassment Test

1. **"30 of 54 migrations share duplicate prefixes, and execution order depends on the alphabetical sort of the descriptive name after the prefix"** — A rename of any migration file could change execution order and break schema setup on new environments.

2. **"A migration failure mid-file leaves the schema in a half-applied state with no record in schema_migrations, causing a retry loop on the next startup"** — Non-transactional migration execution means partial schema states are possible.

3. **"The migration runner silently swallows 'already exists' errors, so a migration that accidentally redefines a table with a different schema produces no warning"** — Silent error swallowing is the opposite of safe migration practice.

## Pride Test

1. The migration runner correctly tracks applied migrations in a `schema_migrations` table, preventing re-application of already-applied files.

2. Production migration failures are correctly treated as fatal (`process.exit(1)`), preventing the server from running with an inconsistent schema.

3. None of the 54 existing migrations contain destructive operations (DROP TABLE, DELETE FROM, TRUNCATE) — all are additive (CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN).

## Distinct-Value Declaration

This lens performs a deep structural analysis of the migration system that goes beyond the Tier 1 DB architect lens. It analyzes the runtime behavior of the migration runner under failure conditions, the implications of duplicate prefixes for ordering, and the fragility of the SQL statement splitter. The DB architect lens identifies the duplicate prefixes as a problem; this lens explains exactly how they interact with the `sort()` call, why the error swallowing is dangerous, and what specific failure modes the non-transactional runner creates.

## Tenancy-Critical Flag

Not directly tenancy-critical. Migrations affect all tenants equally since Turso is a shared database. However, **MIG-02** (non-transactional migration) could leave the schema in a state where some tables exist and others don't, causing 500 errors for all tenants simultaneously.
