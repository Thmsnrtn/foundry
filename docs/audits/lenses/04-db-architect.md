# Lens 04 -- Database Architect Audit

Generated: 2026-04-16 | Auditor: Database Architect Lens

---

## Executive Summary

The Foundry database layer is a SQLite/Turso schema that grew from 16 core tables to approximately 205 unique tables across 54 migration files. The core schema (`schema.sql`) is well-designed with proper foreign keys, CHECK constraints, and covering indexes. However, the migration layer has accumulated severe structural debt: 30 duplicate migration-number prefixes, 7 duplicate table names (including 3 conflicting definitions for `integrations`), a conflicting ALTER TABLE column (`wisdom_network_opted_in` added with opposing defaults), zero FK enforcement at runtime, no transaction usage in application code, and pervasive N+1 query patterns in scheduled jobs that iterate all products. The schema is not ready for multi-company fleet operations without significant remediation.

---

## Table of Contents

1. [P0 -- Data Integrity Risks](#p0----data-integrity-risks)
2. [P1 -- Indexing, Query, and Normalization Issues](#p1----indexing-query-and-normalization-issues)
3. [Migration System Analysis](#migration-system-analysis)
4. [Schema Design Assessment](#schema-design-assessment)
5. [Multi-Company Fleet Readiness](#multi-company-fleet-readiness)
6. [Full Finding Catalog](#full-finding-catalog)

---

## P0 -- Data Integrity Risks

### P0-01: Foreign keys are never enforced at runtime

**Severity: P0 -- Data corruption risk**

SQLite disables foreign key enforcement by default. The connection must issue `PRAGMA foreign_keys = ON` before any write. The codebase has zero occurrences of this pragma. Every `REFERENCES` clause in every table is decorative.

**Impact:** Any orphaned row is silently accepted. Deleting a founder does not cascade to products; deleting a product does not cascade to agent_instances, integrations, decisions, or any of the ~200 child tables. Data corruption is not hypothetical -- it is guaranteed under any deletion scenario.

**Files:** `src/db/client.ts` (no PRAGMA), every migration that declares REFERENCES.

**Fix:** Add `PRAGMA foreign_keys = ON` to `getDb()` immediately after `createClient()`. For Turso specifically, this must be the first statement on each connection. Add a startup check that verifies the pragma is active.

---

### P0-02: No transactions for multi-step mutations

**Severity: P0 -- Partial-write corruption risk**

The `batch()` function in `client.ts` exists and uses Turso's `db.batch(..., 'write')` mode, but it is used exclusively in seed files. Zero service or route files call `batch()`. Multi-step operations (e.g., creating a product + lifecycle_state + agent_instances in SCP provisioning, or resolving a decision + creating an audit_log entry + updating lifecycle_state) are performed as sequential individual queries.

**Impact:** If any intermediate query fails (network error, constraint violation), the database is left in an inconsistent state. For example, a product could exist without a lifecycle_state row, or a decision could be marked "approved" without the corresponding audit_log entry.

**Files:** `src/db/client.ts` (batch exists but unused), every service that performs multi-step writes.

**Fix:** Wrap multi-step mutations in `batch()`. Critical paths: SCP provisioning, decision resolution, risk state transitions, remediation PR workflows.

---

### P0-03: `integrations` table defined three times with incompatible schemas

**Severity: P0 -- Schema ambiguity, silent data loss**

The `integrations` table is created in three separate migrations with conflicting column definitions:

| Migration | Key column | UNIQUE constraint | Status CHECK values |
|-----------|-----------|-------------------|---------------------|
| `008_integrations.sql` | `type` (CHECK: stripe, posthog, ...) | `UNIQUE(product_id, type)` | pending, active, error, paused, revoked |
| `021_data_ingestion.sql` | `provider` | `UNIQUE(product_id, provider)` | (no CHECK) |
| `021_integration_fabric.sql` | `name` (CHECK: stripe, posthog, ...) | `UNIQUE(product_id, name)` | active, paused, errored, pending_auth, disconnected |

Because all use `CREATE TABLE IF NOT EXISTS`, whichever migration runs first wins. Migrations 021_data_ingestion and 021_integration_fabric both sort after 008, so their table creations are silently skipped. But the index and column references in those later migrations may reference columns that do not exist in the 008 schema (e.g., `provider`, `name`, `authorized_agents`). The migration runner swallows "already exists" errors, so these index failures are silent.

**Impact:** Application code that queries `integrations.name` or `integrations.provider` will get runtime SQL errors or empty results depending on which schema is live. Service files reference different column names (`type` in some, `name` in others).

**Files:** `src/db/migrations/008_integrations.sql`, `src/db/migrations/021_data_ingestion.sql`, `src/db/migrations/021_integration_fabric.sql`, `src/services/integration/fabric.ts`, `src/services/integrations/framework.ts`

**Fix:** Consolidate to a single authoritative `integrations` schema. Remove the duplicate CREATE TABLE statements. Add a single migration that reconciles columns.

---

### P0-04: `wisdom_network_opted_in` column added twice with opposing defaults

**Severity: P0 -- Semantic data corruption**

- `004_signal_wisdom.sql`: `ALTER TABLE founders ADD COLUMN wisdom_network_opted_in INTEGER NOT NULL DEFAULT 1`
- `018_wisdom_network.sql`: `ALTER TABLE founders ADD COLUMN wisdom_network_opted_in INTEGER DEFAULT 0`

The migration runner swallows "duplicate column" errors, so whichever runs first wins. On a fresh install, `004_signal_wisdom.sql` runs first, setting the default to `1` (opted in). Migration 018 silently fails. The intent of migration 018 appears to be the opposite: opt-out by default.

**Impact:** Founders are silently enrolled in the wisdom network without consent. This is a privacy and trust issue.

**Files:** `src/db/migrations/004_signal_wisdom.sql`, `src/db/migrations/018_wisdom_network.sql`

**Fix:** Remove the ALTER from one file. Determine the correct default and ensure it is applied consistently.

---

### P0-05: Migration runner swallows structural errors

**Severity: P0 -- Silent schema drift**

`migrate.ts` catches errors and continues if the message contains "duplicate column" or "already exists". This is necessary for idempotent ALTER TABLE in SQLite, but it also masks:
- Failed index creation (column referenced does not exist)
- Failed ALTER TABLE when a later migration assumes a table structure from a different branch of duplicate migrations
- Type mismatches or constraint conflicts

The runner uses `console.log` and `console.error` (not structured logging), and errors are only visible in server startup output that may scroll past.

**Files:** `src/db/migrate.ts`

**Fix:** Log swallowed errors at WARNING level with structured metadata. Add a post-migration schema validation step that compares expected tables/columns against actual schema using `PRAGMA table_info()`.

---

### P0-06: `schema.sql` diverges from migration 001

**Severity: P0 -- New installs vs migrated installs have different schemas**

`schema.sql` uses tier values `('solo', 'growth', 'investor_ready')` while `001_initial.sql` uses `('founding_cohort', 'growth', 'scale')`. Migration `015_tier_rename.sql` performs UPDATE to convert existing rows, but does not alter the CHECK constraint (cannot in SQLite without table recreation). A fresh install using `schema.sql` directly would have the new tier names, but the CHECK constraint in the database (from migration 001) still validates against the old names.

**Impact:** On a migrated database, inserting `tier = 'solo'` may violate the CHECK constraint if the runtime enforces it (SQLite enforces CHECK constraints on INSERT/UPDATE). The application's TypeScript types use the new names.

**Files:** `src/db/schema.sql`, `src/db/migrations/001_initial.sql`, `src/db/migrations/015_tier_rename.sql`

**Fix:** Determine the authoritative path (seed from schema.sql or run migrations). If migrations are the source of truth, schema.sql should match. Add a migration that recreates the founders table with the correct CHECK.

---

### P0-07: Seven duplicate table names across migrations

**Severity: P0 -- Schema confusion**

Tables created multiple times with `CREATE TABLE IF NOT EXISTS` -- only the first definition survives:

| Table | Defined in | Conflict type |
|-------|-----------|---------------|
| `integrations` | 008, 021_data_ingestion, 021_integration_fabric | Incompatible columns (`type` vs `provider` vs `name`) |
| `experiments` | 023_experiments_strategy, 028_growth_experiments | Completely different schemas |
| `board_packets` | 011_investor, 039_investor_layer | Different columns |
| `investor_updates` | 030_investor_automation, 039_investor_layer | Different columns |
| `voice_sessions` | 013_voice_push, 031_voice_coo | Different columns |
| `outbound_webhooks` | 013_voice_push, 033_api_webhooks | Different columns |
| `integration_sync_log` | 008_integrations, 021_data_ingestion | Different columns |

Only the first-to-run definition of each table exists. Later migrations that reference columns unique to their version will fail silently.

---

## P1 -- Indexing, Query, and Normalization Issues

### P1-01: Pervasive N+1 query patterns in scheduled jobs

**Severity: P1 -- Performance bottleneck, will not scale**

`src/jobs/index.ts` follows a consistent antipattern: fetch all active products, then for each product, execute 3-10 individual queries. The `weeklySynthesis` job alone performs ~8 queries per product. With 100 products, that is 800 round-trips to Turso per job execution.

The pattern appears in: `lifecycleCheck`, `competitiveScan`, `weeklySynthesis`, `dailyBriefings`, `stressorCheck`, `milestoneCheck`, `decisionExpiry`, `patternGeneration`, `wisdomSynthesis`, `remediation check`, and more.

**Impact:** Each Turso round-trip incurs network latency (especially on Fly.io). Job execution time scales linearly with product count. At fleet scale (100+ companies), jobs will timeout or overlap.

**Files:** `src/jobs/index.ts`, every scheduled job function.

**Fix:** Use batch queries where possible. For jobs that need per-product context, use JOINs or CTEs to fetch all products + their lifecycle state + latest metrics in a single query. Consider `batch()` for read-heavy jobs.

---

### P1-02: Nearly zero JOINs in the codebase

**Severity: P1 -- Application-layer joins, extra round-trips**

Out of ~320 SQL queries across the codebase, only ~20 use JOINs. The majority fetch one table at a time and assemble data in TypeScript. Examples:
- Dashboard routes fetch product, then lifecycle_state, then latest_audit, then pending_decisions as four separate queries
- Investor automation fetches metric_snapshots, stressor_history, decisions, and competitive_signals as four parallel queries (Promise.all helps, but still 4 round-trips)

The portfolio manager (`src/services/portfolio/manager.ts`) is a notable exception -- it properly uses JOINs with LEFT JOIN.

**Fix:** Identify the top-10 most-executed multi-query patterns and consolidate into single JOIN queries. The dashboard product detail page is the highest-priority candidate.

---

### P1-03: Unbounded SELECT without LIMIT on growing tables

**Severity: P1 -- Potential OOM/timeout**

Several queries fetch from append-only tables without LIMIT:

| Query | File | Risk |
|-------|------|------|
| `SELECT * FROM audit_log WHERE product_id = ? AND action_type = 'risk_state_transition' ORDER BY created_at DESC` | `routes/api/metrics.ts:63` | Unbounded result set |
| `SELECT * FROM audit_log WHERE product_id = ? AND action_type = 'risk_state_transition' AND created_at > datetime('now', '-1 day')` | `jobs/index.ts:386` | Bounded by time, but no LIMIT |
| `SELECT mrr_cents FROM customers WHERE product_id = ? AND mrr_cents > 0 ORDER BY mrr_cents DESC` | `services/customers/intelligence.ts:154` | All paying customers |
| `SELECT * FROM cohorts WHERE product_id = ? ORDER BY acquisition_period DESC` | `db/client.ts:170` | All cohorts, ever |
| `SELECT * FROM competitors WHERE product_id = ?` | `db/client.ts:179` | Unbounded |

**Fix:** Add explicit LIMIT clauses. For API endpoints, add pagination (offset/limit or cursor-based).

---

### P1-04: `updated_at` columns never auto-update

**Severity: P1 -- Stale metadata**

Multiple tables declare `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP` but SQLite does not auto-update this on UPDATE (unlike PostgreSQL). There are no `CREATE TRIGGER` statements anywhere in the schema or migrations. Application code must explicitly set `updated_at = datetime('now')` in every UPDATE statement.

**Impact:** `updated_at` reflects creation time, not last modification time, for any row that is updated without explicitly setting the column. This breaks any feature that relies on "recently modified" queries.

**Files:** Every table with `updated_at`, the absence of triggers in all migration files.

**Fix:** Add `AFTER UPDATE` triggers for tables where `updated_at` matters (products, lifecycle_state, customer_intelligence, agent_instances, integrations). Or enforce at the application layer with a wrapper function.

---

### P1-05: 30 duplicate migration number prefixes

**Severity: P1 -- Maintenance hazard, ordering ambiguity**

Migrations 004 through 033 each have two files sharing the same numeric prefix (e.g., `004_sector_profiles.sql` and `004_signal_wisdom.sql`). The migration runner sorts lexicographically, so `004_sector_profiles.sql` runs before `004_signal_wisdom.sql` (alphabetical after the prefix), but this is fragile and undocumented.

**Impact:** The execution order of same-numbered migrations depends on the second part of the filename. Adding a new migration at an existing number is error-prone. Developers cannot determine order by number alone.

**Fix:** Adopt a timestamp-based naming scheme (e.g., `20260101_120000_feature.sql`) or renumber to eliminate duplicates.

---

### P1-06: Massive JSON column proliferation

**Severity: P1 -- Cannot index, cannot query, schema-in-schema**

At least 80+ columns across the schema store JSON as TEXT. While some are appropriate (e.g., `custom_metrics`, `metadata_json`), many store structured data that should be normalized:

- `competitive_signals.signal_detail` -- JSON array that could be rows
- `customer_intelligence.features_used` -- JSON string array, queried for analytics
- `customer_intelligence.upsell_signals` -- JSON string array, used for filtering
- `agent_sessions.actions_taken` -- JSON array of action objects
- `scp_briefings.agent_contributions` -- JSON object keyed by agent name
- `decisions.options` -- JSON array of option objects
- `decisions.context` -- JSON array of data points

SQLite has `json_extract()` but it cannot use indexes. Any query that filters or sorts by a JSON field must do a full table scan.

**Fix:** For the top queried JSON columns, extract into child tables. Minimum: `customer_intelligence.features_used` should be a junction table if it's used in WHERE clauses.

---

### P1-07: Missing indexes on high-traffic query patterns

**Severity: P1 -- Full table scans**

| Query pattern | Table | Missing index |
|---------------|-------|---------------|
| `WHERE product_id = ? AND status = 'active'` | `agent_remediations` | Has `(product_id, status)` -- OK |
| `WHERE product_id = ? AND snapshot_date = ?` | `metric_snapshots` | Has `(product_id, snapshot_date)` -- OK |
| `WHERE founder_id = ? AND active = 1` | `push_subscriptions` | Has `(founder_id, active)` -- OK |
| `WHERE product_id = ? AND status = 'pending_approval'` | `outbound_actions` | Has partial index -- OK |
| `WHERE product_id = ? ORDER BY created_at DESC` | `agent_audit_log` | Has `(product_id)` but not `(product_id, created_at DESC)` -- suboptimal |
| `WHERE product_id = ? AND agent_name = ? AND is_active = 1` | `evolved_prompts` | Has partial unique index -- OK |
| `WHERE rule_id = ? AND customer_id = ?` | `lifecycle_rule_triggers` | Has `(rule_id, customer_id, triggered_at DESC)` -- OK |
| `WHERE product_id = ? ORDER BY created_at DESC` (20+ tables) | Various tables from 025+ | Many have only `(product_id)` not `(product_id, created_at DESC)` |

The later migrations (025+) are noticeably less rigorous about compound indexes compared to the original 16 tables.

---

### P1-08: Many tables from later migrations lack REFERENCES constraints

**Severity: P1 -- No referential integrity even if PRAGMA were enabled**

Of 54 migration files that create tables, 27 have zero REFERENCES declarations. These include:

- `025_audit_log.sql` (agent_audit_log -- no FK to products)
- `026_financial_simulator.sql` (financial_scenarios -- no FK to products)
- `026_strategic_decisions.sql` (strategic_decisions_log -- no FK to products)
- `027_company_wiki.sql` (agent_wiki_entries -- no FK to products)
- `029_event_bus.sql` (event_stream, event_rules, anomalies -- no FK to products)
- `039_investor_layer.sql` (board_packets, fundraising_scores, investor_updates -- no FK)
- `040_prediction_accuracy.sql` through `054_coordination.sql` -- zero FKs in any table

There is a clear inflection point: migrations 001-024 consistently use REFERENCES; migrations 025-054 largely abandon them. This suggests the later migrations were generated or written under different standards.

---

### P1-09: `SELECT *` used everywhere instead of specific columns

**Severity: P1 -- Wasteful I/O, fragile to schema changes**

`db/client.ts` helper functions all use `SELECT *`. Every table touched by these helpers returns all columns. For tables with large TEXT columns (e.g., `scp_briefings.full_briefing`, `agent_sessions.observations`, `conversation_messages.content`), this transfers significant unnecessary data.

**Fix:** Replace `SELECT *` with explicit column lists in the most-used helpers. At minimum: `getLatestAudit`, `getPendingDecisions`, `getAuditLog`, `getActiveStressors`.

---

### P1-10: `executeRaw` SQL splitting is fragile

**Severity: P1 -- Migration failure on complex SQL**

`executeRaw()` and `runMigrations()` split SQL on `/;\s*\n/` (semicolons followed by whitespace and newline). This fails for:
- Semicolons inside string literals that span multiple lines
- Trigger definitions (which contain internal semicolons)
- Multi-line CHECK constraints

This has not caused issues yet because no migration uses triggers, but it blocks the recommended fix for P1-04 (auto-updating `updated_at` via triggers).

**Files:** `src/db/client.ts:52-61`, `src/db/migrate.ts:43-47`

---

## Migration System Analysis

### Migration count and structure

| Metric | Value |
|--------|-------|
| Total migration files | 54 |
| Unique migration number prefixes | 24 (001-054, with 30 duplicates at each number 004-033) |
| Unique tables created | ~205 |
| Tables in core schema.sql | 16 |
| Tables with REFERENCES | ~148 FK declarations across 41 files |
| Tables without any REFERENCES | 27 migration files (all post-024) |
| Duplicate table names | 7 (integrations x3, experiments x2, board_packets x2, investor_updates x2, voice_sessions x2, outbound_webhooks x2, integration_sync_log x2) |
| ALTER TABLE statements | 60 |
| Conflicting ALTER TABLE | 1 (wisdom_network_opted_in: DEFAULT 1 vs DEFAULT 0) |

### Migration ordering

The migration runner uses `readdirSync().sort()` which produces lexicographic order. With duplicate prefixes, the sort order is:
```
004_sector_profiles.sql     (runs first)
004_signal_wisdom.sql       (runs second)
```
This is correct but non-obvious. The dual-file-per-number pattern appears to be parallel development streams (one "core platform" track and one "intelligence/add-on" track) that were never reconciled.

### Schema evolution quality

| Phase | Migrations | Quality |
|-------|-----------|---------|
| 001-010 | Core schema + extensions | Good: proper FKs, indexes, CHECK constraints, ON DELETE CASCADE |
| 011-020 | Feature expansion | Mixed: some FKs, new feature tables, dual-track numbering starts |
| 021-030 | SCP + intelligence | Declining: duplicate tables, fewer FKs, more JSON columns |
| 031-040 | Advanced features | Poor: no FKs, no ON DELETE CASCADE, minimal CHECK constraints |
| 041-054 | Late additions | Poor: zero FKs, product_id columns with no referential integrity |

---

## Schema Design Assessment

### Normalization

The core 16 tables are reasonably normalized (mostly 3NF). The later additions are increasingly denormalized:
- `lifecycle_state` stores cached counts (`pending_decisions_count`, `unread_competitive_signals`) that should be computed from source tables. These are never updated by triggers and will drift.
- `scp_briefings` stores `financial_summary` as JSON that duplicates metric_snapshots data.
- `customer_intelligence` stores `agent_notes` as append-only JSON -- should be a child table.

### ID generation

All tables use `TEXT PRIMARY KEY` with no standard for how IDs are generated. The application uses `nanoid()`. This is fine for a single-node database but makes debugging harder (no sequential ordering, no time-derivable component).

### Timestamp handling

Mixed conventions:
- Some tables use `DATETIME DEFAULT CURRENT_TIMESTAMP`
- Others use `TEXT DEFAULT (datetime('now'))`

Both are valid SQLite, but the inconsistency makes query composition harder. ISO 8601 TEXT strings are the safer choice for Turso/libSQL compatibility.

### Data encryption claims

`products.github_access_token` is commented as "Encrypted" and `integrations.credentials_json` as "encrypted at rest" -- but the orientation document confirms there is no encryption code. These are plaintext secrets stored in the database.

---

## Multi-Company Fleet Readiness

### Current state

The schema supports multi-product per founder through `products.owner_id`. Every query helper scopes by `owner_id` or `product_id`. This is sufficient for a single-founder-multiple-products model.

### Gaps for fleet operations

| Capability | Schema support | Gap |
|-----------|---------------|-----|
| Product isolation | owner_id scoping | No row-level security; scoping is application-enforced |
| Portfolio rollup | portfolio_memberships table | Cross-portfolio queries would be expensive (no materialized views in SQLite) |
| Fleet-level agent coordination | None | No tables for fleet-level meta-agents or cross-SCP communication |
| SCP lifecycle management | products.scp_status | Only 4 states; no "migrating" or "upgrading" state |
| Cross-company intelligence | decision_patterns (anonymized) | No access control -- any query can read all patterns |
| Data residency | data_residency_settings table | Exists but Turso is a single-region database; the settings have no enforcement mechanism |
| Tenant deletion | No ON DELETE CASCADE (due to P0-01) | Deleting a company's data would require manual cascading across 200+ tables |

### Scalability concerns

SQLite/Turso is a single-writer database. At fleet scale (100+ companies, 1200+ agents running hourly), write contention will become a bottleneck. The current architecture has no sharding strategy. The database is accessed through a single client instance with no connection pooling.

---

## Full Finding Catalog

| ID | Severity | Category | Summary |
|----|----------|----------|---------|
| P0-01 | P0 | Integrity | FK enforcement disabled (no PRAGMA foreign_keys = ON) |
| P0-02 | P0 | Integrity | No transactions for multi-step writes |
| P0-03 | P0 | Schema | `integrations` table defined 3x with incompatible schemas |
| P0-04 | P0 | Integrity | `wisdom_network_opted_in` column added with opposing defaults |
| P0-05 | P0 | Migration | Migration runner silently swallows structural errors |
| P0-06 | P0 | Schema | schema.sql CHECK constraints diverge from migration 001 |
| P0-07 | P0 | Schema | 7 tables defined multiple times with different schemas |
| P1-01 | P1 | Performance | N+1 query patterns in all 14+ scheduled jobs |
| P1-02 | P1 | Performance | ~0 JOINs; data assembled in application layer |
| P1-03 | P1 | Performance | Unbounded SELECT on append-only tables (no LIMIT) |
| P1-04 | P1 | Integrity | `updated_at` columns never auto-update (no triggers) |
| P1-05 | P1 | Migration | 30 duplicate migration number prefixes |
| P1-06 | P1 | Design | 80+ JSON columns; unable to index or query efficiently |
| P1-07 | P1 | Performance | Missing compound indexes on later migration tables |
| P1-08 | P1 | Integrity | 27 migration files with zero REFERENCES constraints |
| P1-09 | P1 | Performance | SELECT * everywhere; wasteful for large TEXT columns |
| P1-10 | P1 | Migration | SQL splitting regex cannot handle triggers or multi-line strings |

---

## Recommended Priority Order

1. **P0-01**: Add `PRAGMA foreign_keys = ON` (1-line fix, immediate integrity gain)
2. **P0-03 + P0-07**: Audit and consolidate the 7 duplicate table definitions
3. **P0-02**: Wrap critical multi-step writes in `batch()`
4. **P0-04**: Resolve the wisdom_network_opted_in conflict
5. **P0-05**: Add post-migration schema validation
6. **P0-06**: Reconcile schema.sql with migration 001 + 015
7. **P1-01 + P1-02**: Convert top job loops to batch/JOIN queries
8. **P1-04**: Add UPDATE triggers or application-layer enforcement for updated_at
9. **P1-05**: Renumber migrations to eliminate duplicates
10. **P1-08**: Add REFERENCES constraints to the 27 FK-free migrations
