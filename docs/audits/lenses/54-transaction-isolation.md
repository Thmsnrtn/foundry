# Lens 54 — Transaction Isolation-Level Reviewer

**Auditor perspective:** SQLite/Turso concurrency model, WAL mode configuration, read-committed vs serializable behavior, multi-writer conflicts, and how the application handles concurrent database access.

**Date:** 2026-04-16
**Codebase snapshot:** Turso (libSQL/SQLite) via `@libsql/client`, single `getDb()` client singleton

---

## Executive Summary

Foundry uses Turso (a hosted libSQL/SQLite fork) with zero explicit transaction isolation configuration. The only PRAGMA set is `foreign_keys = ON` — and even that is fire-and-forget with `.catch(() => {})`. There is no WAL mode configuration, no `busy_timeout` setting, no explicit isolation level selection. Turso operates as a remote database with its own concurrency model (not local SQLite), and the application makes no attempt to understand or configure this. The `batch()` function is the only transactional primitive, and it is used in exactly one place (`db/client.ts:41-49`). All other multi-step write operations (read-check-write patterns) run as individual queries with no isolation guarantees. The result is that every TOCTOU bug identified in Lens 51 is enabled by the absence of proper transaction boundaries.

---

## Findings

### TXN-01. No Explicit Transaction Isolation Configuration

**Severity: P1**

Turso (libSQL) supports `PRAGMA journal_mode`, `PRAGMA busy_timeout`, and transaction isolation via `BEGIN IMMEDIATE` / `BEGIN CONCURRENT`. None of these are configured.

**Evidence:**
- `src/db/client.ts:16-28` — `createClient({ url, authToken })` with no configuration beyond URL and auth
- Line 22: `_client.execute('PRAGMA foreign_keys = ON').catch(...)` — the only PRAGMA, and its failure is silently swallowed
- No `PRAGMA journal_mode = WAL` (critical for read-write concurrency)
- No `PRAGMA busy_timeout` (determines wait behavior on lock contention)
- Turso's default behavior depends on the server-side configuration, which the application does not control or verify

**Remediation:** After client creation, set: `PRAGMA busy_timeout = 5000` (wait up to 5 seconds on lock contention rather than failing immediately), `PRAGMA journal_mode = WAL` (if not already enabled server-side), and verify the settings with `PRAGMA journal_mode` / `PRAGMA busy_timeout` reads. Log the actual values at startup.

**Target phase:** P1

---

### TXN-02. `batch()` Is the Only Transaction Primitive — Used in One Place

**Severity: P1**

`src/db/client.ts:41-49` provides a `batch()` function that wraps multiple statements in a Turso write transaction. However, searching the codebase reveals it is used in only a small number of places. The vast majority of multi-step operations use sequential `query()` calls with no transaction boundary.

**Evidence:**
- `src/db/client.ts:41-49` — `batch(statements, 'write')` — correctly uses Turso's transactional batch mode
- Multi-step operations that should be transactional but are not:
  - `src/services/intelligence/risk-state.ts` — `transitionRiskState()` reads current state, writes new state, inserts audit log — three separate queries
  - `src/services/decisions/queue.ts` — `resolveDecision()` reads decision, checks status, updates decision, inserts audit log — four separate queries
  - `src/services/scp/provisioner.ts` — `ensureProvisioned()` checks existence, creates 12 agent_instances — 13 separate queries
  - `src/jobs/index.ts` stressor cleanup at line 353 — single UPDATE that is safe, but the surrounding read-modify-write patterns are not

**Remediation:** Identify all read-modify-write patterns and wrap them in `batch()` calls. Create a `withTransaction(async (tx) => { ... })` helper that makes transactional code ergonomic. Priority: `resolveDecision`, `transitionRiskState`, and `ensureProvisioned`.

**Target phase:** P1

---

### TXN-03. Read-Modify-Write in `transitionRiskState` — Lost Update Risk

**Severity: P1**

Risk state transitions involve: (1) reading current state, (2) determining the new state, (3) writing the new state. If two processes attempt this concurrently (e.g., a webhook-triggered stressor check and the `weekly_synthesis` cron job), both read the same current state, both decide to transition, and one overwrites the other's transition. The transition that loses is never recorded.

**Evidence:**
- The risk state transition is called from multiple paths: `weekly_synthesis` job, `processStripeEventChain` webhook handler, and `behavioral_triggers` job
- The transition writes to `lifecycle_state` and inserts into `stressor_history` — separate queries
- No `UPDATE lifecycle_state SET risk_state = ? WHERE product_id = ? AND risk_state = ?` (conditional update)

**Remediation:** Use a conditional UPDATE: `UPDATE lifecycle_state SET risk_state = ?, risk_state_changed_at = ? WHERE product_id = ? AND risk_state = ?` (where the last `?` is the expected current state). Check `changes` count. If 0, re-read and re-evaluate.

**Target phase:** P1

---

### TXN-04. SCP Provisioning Creates 12 Agent Instances Without Transaction

**Severity: P2**

`ensureProvisioned()` checks if a product has SCP instances, then inserts 12 `agent_instances` records (one per agent). If the process crashes after inserting 6 of 12, the product has a partially provisioned SCP. On restart, `ensureProvisioned` is called again (`src/index.ts:500-504`), but the check ("does this product have instances?") will return true (6 exist), so the remaining 6 are never created.

**Evidence:**
- `src/index.ts:500-504` — `ensureProvisioned(p.id, p.owner_id).catch(...)`
- The provisioner likely uses a simple "do any instances exist?" check rather than "do all 12 exist?"
- Individual INSERTs for 12 agents means partial failure is possible

**Remediation:** Wrap the 12 INSERTs in a `batch()` call. Add a health check that verifies all 12 agents exist for each active product and provisions missing ones.

**Target phase:** P2

---

### TXN-05. `foreign_keys = ON` PRAGMA Is Fire-and-Forget

**Severity: P2**

`src/db/client.ts:22-25` runs `PRAGMA foreign_keys = ON` with `.catch(() => {})`. If this PRAGMA fails (e.g., because Turso doesn't support it in the current configuration), all foreign key constraints become decorative. The application continues without any warning about this critical data integrity guard being disabled.

**Evidence:**
- `src/db/client.ts:22-25` — `.catch(() => { console.warn('[DB] Could not enable foreign_keys PRAGMA'); })`
- Uses `console.warn` instead of the structured `logger` (can be missed in production logs)
- No verification that the PRAGMA actually took effect (e.g., `PRAGMA foreign_keys` read-back)
- All REFERENCES clauses in the 54 migration files depend on this PRAGMA being enabled

**Remediation:** Read back `PRAGMA foreign_keys` after setting it. If the result is 0, log a fatal error and exit. Switch from `console.warn` to `logger.error`.

**Target phase:** P1

---

### TXN-06. Metric Snapshot UPSERT Race — Non-Atomic Read-Modify-Write

**Severity: P2**

The Stripe webhook handler (`src/services/integrations/stripe-webhook.ts:187-188`) uses `UPDATE metric_snapshots SET new_mrr_cents = new_mrr_cents + ?`. This is safe for incrementing, but the `ensureSnapshot` function at line 262-273 first reads (SELECT), then conditionally inserts. Two concurrent events can both see "no snapshot exists" and both attempt to INSERT, with one failing on the UNIQUE constraint. The `ON CONFLICT` at the ingest endpoint handles this, but `ensureSnapshot` does not use `ON CONFLICT`.

**Evidence:**
- `src/services/integrations/stripe-webhook.ts:262-273` — `ensureSnapshot`: SELECT then conditional INSERT
- No `INSERT ... ON CONFLICT DO NOTHING` in `ensureSnapshot`
- Two concurrent Stripe events on the same day for the same product would race

**Remediation:** Change `ensureSnapshot` to use `INSERT INTO metric_snapshots (id, product_id, snapshot_date) VALUES (?, ?, ?) ON CONFLICT(product_id, snapshot_date) DO NOTHING`.

**Target phase:** P2

---

## Embarrassment Test

1. **"Foreign key enforcement is fire-and-forget — if the PRAGMA fails, all REFERENCES clauses in 54 migrations become decorative, and orphaned records can be created"** — The database integrity guarantee is applied with a `.catch(() => {})`.

2. **"Risk state transitions have no conditional update, so two concurrent triggers can both 'win' and one's audit log entry is orphaned"** — The core state machine has no concurrency protection.

3. **"The only transaction primitive in the codebase (`batch()`) is barely used, while dozens of multi-step write operations run as individual queries"** — The tool exists but is not applied where needed.

## Pride Test

1. The `batch()` function correctly uses Turso's `'write'` mode, which provides serializable isolation for the statements within the batch.

2. The metric snapshot `ON CONFLICT(product_id, snapshot_date) DO UPDATE SET` pattern in the ingest endpoint is correct and handles concurrent writes gracefully.

3. The foreign key PRAGMA attempt shows awareness of SQLite's default (off) behavior — the implementation just needs to be made reliable.

## Distinct-Value Declaration

This lens examines the specific interaction between Turso's concurrency model and the application's transaction patterns. Tier 1 lenses identify "no transactions" as a problem; this lens catalogs every multi-step write operation that should be transactional, explains exactly how concurrent access creates data corruption, and provides SQLite/Turso-specific remediation (conditional UPDATEs, `batch()` with `'write'` mode, PRAGMA verification).

## Tenancy-Critical Flag

**TXN-02** and **TXN-03** are tenancy-critical. The risk state transition affects per-tenant business intelligence. If a transition is lost due to a concurrent write, one tenant's risk state may be incorrect, leading to wrong digest cadence (daily vs weekly), wrong decision gate thresholds, and incorrect Signal scores.
