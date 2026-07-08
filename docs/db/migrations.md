# Database migrations

## How the runner works

`src/db/migrate.ts` applies every `*.sql` file in `src/db/migrations/`, sorted
by filename, that isn't already recorded in the `schema_migrations` table. Each
file's statements are split by `splitSqlStatements` (which respects string
literals, `--` and `/* */` comments, and `CREATE TRIGGER … BEGIN … END`
bodies — do **not** go back to a naive `split(';')`). `duplicate column` /
`already exists` errors are swallowed so migrations are re-runnable; any other
error is fatal.

## The numbering rule

- **One migration per numeric prefix.** `NNN_description.sql`, zero-padded to 3
  digits, strictly increasing. The next migration takes the next unused number.
- Ordering is **by full filename**, so two files sharing a prefix
  (`007_a.sql`, `007_b.sql`) order by the part after the number. That is
  deterministic but fragile — a new `007_z.sql` would run *after* both, which is
  almost never what the author intends.

### Known duplicate prefixes (historical debt)

Several prefixes are currently duplicated (e.g. three `007_*`, two `021_*`, two
`056_*`). Do not add more files under an existing prefix. Renumbering the
existing duplicates requires rewriting the tracked filenames in
`schema_migrations` in the same transaction (so already-applied DBs don't
re-run them) and is deferred until the integrations-schema cleanup below lands.

## ⚠️ Fresh-DB migration is currently blocked (tracked)

Applying the full chain against an empty database fails in `008_integrations.sql`
because the `integrations` table is created by **four** migrations (`007`,
`008`, `021_data_ingestion`, `021_integration_fabric`) with **incompatible
columns** (`founder_id` vs `product_id`). `CREATE TABLE IF NOT EXISTS` means the
first creator wins, so later indexes reference columns that don't exist.

This is the Phase 2.4 "two integration subsystems" problem and must be resolved
there (consolidate on one `integrations` schema, drop the losers). Until then,
existing/production databases are fine (they applied migrations incrementally),
but a from-scratch deploy needs 2.4 first.

Two unrelated bad column references in `007_schema_hardening.sql` (indexes on
`stressor_history.created_at` and `competitive_signals.created_at`, neither of
which exists) were corrected to the real timestamp columns (`identified_at`,
`detected_at`) — no code referenced the wrong names.
