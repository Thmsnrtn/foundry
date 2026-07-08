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

## Fresh-DB migration (fixed — verify before relying on it)

Applying the full chain against an empty database now completes with **0
failures** (verified in-memory). Getting there required fixing a run of
accumulated schema drift — all fixes touch only fresh DBs, since existing
databases already recorded these migrations as applied and never re-run them:

- **`007_schema_hardening`** created a rogue `integrations` table
  (`founder_id`/`provider`) *before* `008_integrations`' canonical
  `product_id`/`type` table. `CREATE TABLE IF NOT EXISTS` made 008 a no-op, so
  008's indexes failed. Removed 007's copy; the canonical table is 008, widened
  by `056_schema_reconciliation`. Also fixed two 007 indexes that referenced
  non-existent columns (`stressor_history.created_at` → `identified_at`,
  `competitive_signals.created_at` → `detected_at`).
- **Expression UNIQUE constraints** (`funding_readiness`,
  `network_contributions`) moved to `CREATE UNIQUE INDEX` — libSQL prohibits
  expressions in table-level UNIQUE constraints.
- **Indexes referencing reconciled columns** (`integrations.provider`,
  `outbound_webhooks.is_active`, `investor_updates.month`) moved into `056`
  after the `ALTER … ADD COLUMN`s. `api_keys` index re-pointed to its real
  column (`founder_id`); a `webhook_deliveries` retry index referencing columns
  absent from the canonical schema was dropped.

### Integration status is 'active', not 'connected'

Every `integrations` schema's `status` CHECK permits `'active'` but **none**
permits `'connected'`. The code standardizes on `'active'` (writer, all sync
adapter guards, and the schema CHECK all agree). Writing `'connected'` fails the
constraint — don't.

### Still open (Phase 2.4 code consolidation)

The migration/deploy blocker is fixed, but the two integration *code* subsystems
(`services/integration/` fabric vs `services/integrations/` framework) still
coexist over the reconciled table. Consolidating on the fabric (porting the
framework's metric pulls, implementing the stubbed analytics adapter, deleting
the loser) remains — see the roadmap 2.4.
