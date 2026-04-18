# Lens 144 — Data-Loss Recovery Drill

**Distinct value:** Simulates three specific data-loss scenarios -- a founder accidentally deletes all their products, a migration corrupts a table, an agent writes bad data -- and traces the exact recovery path through the codebase. Focuses on whether the data can actually be recovered, not whether the system "should" have prevented the loss.

**Tenancy-critical:** Yes. Each scenario must be recoverable per-tenant without affecting other tenants. A migration corruption affects all tenants; the recovery must be tenant-aware.

## Scenario 1: Founder Accidentally Deletes All Their Products

### How This Can Happen

The privacy settings page at `src/routes/dashboard/privacy.ts:404-416` has a `POST /privacy/delete` endpoint that calls `scheduleDataDeletion(productId, 30)`. This schedules a deletion, not an immediate delete.

However, the Clerk webhook at `src/routes/auth/clerk.ts:144-157` handles `user.deleted` events by immediately deleting all products and the founder record:

```
DELETE FROM products WHERE id = ? (for each product)
DELETE FROM founders WHERE id = ?
```

If the founder deletes their Clerk account (via Clerk's hosted UI or API), this webhook fires and immediately destroys all data. There is no soft-delete, no grace period, and no confirmation step on Foundry's side.

Additionally, there is no UI button to delete individual products. But the product archival flow (if it exists) or a direct API call could trigger deletion.

### What Is Lost

When `DELETE FROM products WHERE id = ?` executes:
- The product row is deleted
- **Dependent data survival depends on CASCADE constraints.** The schema uses `REFERENCES products(id)` in some migrations, but SQLite only enforces foreign keys if `PRAGMA foreign_keys = ON` is explicitly set. There is no evidence this pragma is configured in the Turso client at `src/db/client.ts`.
- If CASCADE is not active: the product row is deleted, but all child rows (metric_snapshots, audit_scores, decisions, stressor_history, scp_briefings, agent_configs, lifecycle_state, cohorts, competitors, competitive_signals, scenario_models, founding_story_artifacts, privacy_consents, etc.) become orphaned. They still exist in the database but reference a nonexistent product_id.
- If CASCADE is active: all child rows are deleted along with the product. Total data loss.

### Recovery Path

1. **If caught immediately (< 30 seconds):** No recovery. The DELETE is committed. Turso does not support `ROLLBACK` after commit, and there is no undo log.
2. **From backup:** Restore the entire database from the last manual backup (`turso db create foundry-restore --from-dump backup.sql`). This restores ALL tenants to the backup point, losing all changes from all tenants since the backup. There is no per-tenant restore capability.
3. **From Turso point-in-time recovery:** Turso supports point-in-time recovery for paid plans. If configured, the database can be restored to a timestamp before the deletion. This still requires creating a new database and migrating.
4. **Partial recovery (orphaned data):** If CASCADE is not active, the product row is gone but child data survives. A new product row could be inserted with the same ID to "reconnect" the orphaned data. This requires knowing the original product ID and manually reconstructing the product row.

### Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| No soft-delete for products | P0 | DELETE is permanent and immediate. No `deleted_at` column, no grace period. |
| No deletion confirmation on Clerk webhook path | P0 | Clerk `user.deleted` webhook immediately destroys all data without Foundry-side confirmation. |
| No per-tenant backup restore | P1 | Restoring a single founder's data requires restoring the entire database for all tenants. |
| CASCADE enforcement unverified | P1 | Unknown whether child data is deleted or orphaned. Both outcomes are bad. |
| No deletion audit trail | P1 | The Clerk webhook DELETE operations are not logged to the audit_log table. |
| No pre-deletion export | P1 | The webhook does not export data before deleting it. The scheduled deletion at `/privacy/delete` has a 30-day window but the Clerk webhook path does not. |

## Scenario 2: A Migration Corrupts a Table

### How This Can Happen

The migration runner at `src/db/migrate.ts` executes SQL files sequentially from `src/db/migrations/`. There are 54 migrations. The orientation doc flags item #9: "Migration failures don't stop server -- can run with inconsistent schema."

A corruption scenario: migration 055 adds a column with a DEFAULT that depends on existing data, or migration 055 runs an UPDATE that incorrectly sets values for all rows. Since migrations are not wrapped in transactions (SQLite has limited DDL transaction support), a partially-completed migration leaves the schema in an inconsistent state.

Concrete example: a migration that renames a column would fail if interrupted:
```sql
ALTER TABLE products ADD COLUMN new_name TEXT;
UPDATE products SET new_name = old_name;
ALTER TABLE products DROP COLUMN old_name;  -- fails: SQLite < 3.35 doesn't support DROP COLUMN
```

### What Is Corrupted

- **Schema corruption:** A partially-applied DDL migration leaves the table with both old and new columns, or missing expected columns. All queries referencing the expected schema fail.
- **Data corruption:** An UPDATE migration that sets incorrect values affects every row in the table. All tenants are affected simultaneously.
- **Index corruption:** A failed index creation leaves a partial index. Queries using that index return incomplete results.

### Recovery Path

1. **Detection:** If the server starts with an inconsistent schema, routes that query the affected table fail with SQL errors. The error is typically `no such column` or `table X has no column named Y`. This appears in application logs but there is no structured alert.
2. **Immediate mitigation:** Deploy the previous version of the code (but the runbook has no rollback procedure). The previous code version expects the old schema, which may or may not still be intact depending on how far the migration progressed.
3. **From backup:** Restore the pre-migration database. This loses all data written since the backup. Combined with the lack of automated backups, RPO could be days.
4. **Manual repair:** If the migration is partially applied:
   - Connect to Turso: `turso db shell foundry-intel`
   - Inspect the schema: `.schema <table_name>`
   - Manually complete or reverse the migration
   - This requires deep knowledge of both the migration's intent and SQLite's DDL constraints
5. **If data values are corrupted (UPDATE gone wrong):**
   - There is no row-level change log or temporal table
   - If the original values were not backed up before the UPDATE, they are permanently lost
   - Restore from backup is the only path

### Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| Migrations not wrapped in transactions | P0 | Partial migration execution leaves inconsistent schema. |
| No pre-migration backup | P0 | The deploy process does not create a backup before running migrations. |
| Migration failures do not stop the server | P1 | A failed migration allows the server to start with an inconsistent schema, potentially serving corrupted data to all tenants. |
| No migration rollback scripts | P1 | Migrations are forward-only. There are no corresponding `down` migrations. |
| No data change logging | P2 | UPDATE migrations cannot be reversed without backups because original values are not preserved. |
| Migration state tracking | P2 | The migration runner tracks which migrations have run (via a `migrations` table), but does not track partial completion. A failed migration may be marked as "run" even if it partially completed. |

## Scenario 3: An Agent Writes Bad Data

### How This Can Happen

SCP agents call Claude for analysis and then write results to the database. The agent base class at `src/services/scp/instance.ts` processes the AI response and writes signals, briefings, and health updates. If Claude returns malformed JSON, hallucinated data, or an analysis that misclassifies risk state, the agent writes bad data.

Concrete examples:
- Agent writes `risk_state = 'red'` based on a hallucinated metric decline. This triggers Red state behavior: Gate 0/1 suspension, daily briefings, recovery protocol. The founder sees false crisis alerts.
- Agent writes a negative Signal score or a score > 100. The Signal computation at `src/services/signal.ts` clamps the score to 0-100, but individual component scores may not be clamped.
- Agent writes a stressor with `severity = 'critical'` for a non-existent issue. This escalates to the founder as a false alarm.
- Agent writes a briefing with fabricated competitive intelligence. The founder makes business decisions based on hallucinated competitor data.

### What Is Corrupted

Agent-written data spans multiple tables:
- `scp_briefings` — daily synthesis, health scores, recommendations
- `stressor_history` — risk signals
- `agent_run_details` — per-run analysis and actions
- `decisions` — agent-proposed decisions
- `agent_audit_log` — agent activity records
- `metric_snapshots` — if agents write derived metrics
- `signal_events` — signal timeline entries

### Recovery Path

1. **Detection:** Bad agent data is difficult to detect. There is no validation layer between the AI response and the database write. The `evaluateGate` function validates decision authority but not data quality. Detection relies on:
   - The founder noticing incorrect data in the dashboard
   - A subsequent agent run contradicting the bad data (but the bad data is already in the historical record)
   - Manual audit of agent run logs

2. **Identifying the bad data:**
   - Query `agent_run_details` for the specific agent and time window
   - Cross-reference with `scp_briefings` to find briefings that incorporated the bad analysis
   - Check `stressor_history` for stressors created by the agent during that run
   - Check `decisions` for proposals made based on the bad analysis

3. **Reverting:**
   - There is no "undo agent run" function. Each piece of bad data must be manually identified and deleted or corrected.
   - For stressors: `UPDATE stressor_history SET status = 'resolved' WHERE id = ?`
   - For briefings: DELETE the briefing row. The dashboard will show the previous briefing.
   - For risk state: Manually recalculate and update. The risk state machine at `src/services/intelligence/risk-state.ts` can be re-run, but it depends on the stressor data, which may itself be corrupted.
   - For decisions: Mark as `status = 'rejected'` with a note explaining the reversal.

4. **Prevention (what exists):**
   - The evolution gate system (`src/services/ai/gates.ts`) validates agent behavior changes, not data quality
   - The Signal score computation clamps to 0-100 but does not validate component inputs
   - The risk state machine has stage-aware rules (pre-launch products cannot go Red from metric absence alone)
   - The daily cost ceiling limits how much AI-generated data can be produced per day

### Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| No AI output validation | P1 | Agent writes are not validated against expected ranges, types, or consistency checks before DB insert. |
| No "undo agent run" capability | P1 | Bad data must be manually identified and corrected row-by-row. |
| No agent data versioning | P2 | Agent writes overwrite previous state. There is no history of what the agent changed, making rollback impossible without backups. |
| No anomaly detection on agent outputs | P2 | No check for sudden risk state changes, score jumps > 20 points, or other statistical anomalies that would flag bad data. |
| No human review gate for high-impact writes | P1 | Risk state transitions to Red should require confirmation, but the risk state machine writes directly. The Gate system governs actions, not state transitions. |
| No data integrity constraints | P2 | No CHECK constraints on score ranges, risk state values, or other bounded fields in the schema. SQLite would accept `signal_score = 999`. |

## Cross-Scenario Findings

| Finding | Scenarios | Severity |
|---------|-----------|----------|
| No soft-delete anywhere in the system | 1, 2 | P0 |
| No automated pre-operation backups | 1, 2 | P0 |
| No per-tenant data restore capability | 1, 2, 3 | P1 |
| CASCADE enforcement unverified | 1 | P1 |
| No undo/rollback for any write operation | 1, 3 | P1 |
| No data validation between AI output and DB write | 3 | P1 |
| Migration failure does not halt the system | 2 | P1 |

## Priority Remediation

1. **P0:** Implement soft-delete for products and founders (add `deleted_at` column, filter in queries, scheduled hard-delete after grace period)
2. **P0:** Add pre-migration automatic backup to the deploy pipeline
3. **P1:** Verify and enforce `PRAGMA foreign_keys = ON` in the Turso client
4. **P1:** Add AI output validation (range checks, type checks, consistency checks) before agent DB writes
5. **P1:** Add an "undo agent run" CLI command that identifies and reverts all data written by a specific agent run
6. **P1:** Make migration failure halt server startup (fail-closed, not fail-open)
7. **P2:** Add data change logging for critical tables (risk_state, signal_score, scp_briefings) to enable point-in-time reversal
