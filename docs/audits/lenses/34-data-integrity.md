# Lens 34 — Data Integrity Reviewer Audit

**Auditor perspective:** Data integrity reviewer
**Scope:** Orphaned records, missing cascade deletes, inconsistent state transitions, data consistency across related tables
**Date:** 2026-04-16

---

## Executive Summary

Foundry has a **fundamental data integrity gap**: SQLite foreign keys are not enforced at runtime. The schema declares `REFERENCES` constraints, but SQLite requires `PRAGMA foreign_keys = ON` to enforce them -- and this pragma is never set. This means every `REFERENCES` clause in the schema is decorative. Deletion of a founder or product will leave orphaned records across all child tables unless application code manually cleans them up. The core schema (16 tables) uses bare `REFERENCES` with no `ON DELETE CASCADE`, while later migrations (54 migration files) inconsistently add `ON DELETE CASCADE` to some tables but not others. State transitions (risk state, decision status, product status) are enforced by CHECK constraints at the column level but have no transition validation -- any state can jump to any other state.

**P0 findings:** 2
**P1 findings:** 3
**P2 findings:** 3

---

## Finding 01 — PRAGMA foreign_keys is never enabled

**Severity: P0**
**Files:** `src/db/client.ts`, `src/db/schema.sql`

SQLite does not enforce foreign key constraints by default. The `PRAGMA foreign_keys = ON` statement must be executed per connection. A search of the entire codebase for `PRAGMA foreign_keys` or `foreign_keys =` returns zero results. The Turso client in `client.ts` creates a connection without enabling foreign keys.

This means:
- `REFERENCES founders(id)` on `products.owner_id` is not enforced. A product can reference a non-existent founder.
- `REFERENCES products(id)` on all child tables is not enforced. Deleting a product leaves orphaned audit_scores, decisions, stressor_history, etc.
- `REFERENCES decisions(id)` on `scenario_models.decision_id` is not enforced.
- Every `ON DELETE CASCADE` in the migration files is also not enforced.

**Impact:** The entire relational integrity of the database is unenforced. Any deletion at any level can create orphaned records. Any insert can reference non-existent parents.

**Remediation:**
1. Execute `PRAGMA foreign_keys = ON` immediately after each connection is established.
2. For Turso (libSQL), verify that the pragma is supported and persists across connections.
3. Run a one-time data integrity check to find and clean existing orphaned records.

---

## Finding 02 — Core schema tables lack ON DELETE CASCADE

**Severity: P0**
**Files:** `src/db/schema.sql`

The 16 core schema tables use bare `REFERENCES` with no `ON DELETE` behavior:

```sql
owner_id TEXT NOT NULL REFERENCES founders(id)       -- products
product_id TEXT NOT NULL REFERENCES products(id)     -- lifecycle_state, audit_scores, decisions, etc.
decision_id TEXT NOT NULL REFERENCES decisions(id)   -- scenario_models
```

Without `ON DELETE CASCADE` (and without `PRAGMA foreign_keys = ON`), deleting a founder requires manual deletion of:
1. All products owned by the founder
2. For each product: lifecycle_state, audit_scores, decisions, audit_log, beta_intake, lifecycle_conditions, founding_story_artifacts, metric_snapshots, stressor_history, scenario_models, cohorts, competitors, competitive_signals
3. For each decision: scenario_models
4. Plus all tables from the 54 migrations that reference products

The Clerk webhook handler (`routes/auth/clerk.ts` lines 150-155) attempts manual cleanup:

```typescript
for (const row of productsResult.rows) {
  await query('DELETE FROM products WHERE id = ?', [productId]);
}
await query('DELETE FROM founders WHERE id = ?', [founderId]);
```

This deletes the products but does **not** delete any child records (audit_scores, decisions, stressor_history, etc.) because (a) foreign keys are not enforced and (b) there is no cascade. The child records become orphans.

**Impact:** Every founder deletion creates orphaned records across potentially 40+ tables. Over time, the database accumulates stale data that inflates query results and wastes storage.

**Remediation:**
1. Add `ON DELETE CASCADE` to all `REFERENCES` clauses in a migration.
2. Enable `PRAGMA foreign_keys = ON` (Finding 01).
3. Update the deletion code to either rely on cascades or explicitly delete all child tables.
4. Run a cleanup migration to remove existing orphaned records.

---

## Finding 03 — Risk state transitions have no validation

**Severity: P1**
**Files:** `src/services/intelligence/risk-state.ts`, `src/db/schema.sql`

The lifecycle_state table constrains risk_state to `green`, `yellow`, `red` via a CHECK constraint. However, state transitions are not validated:
- A product can jump from `green` directly to `red` (bypassing `yellow`).
- A product can oscillate rapidly between states with no debounce.
- The `risk_state_changed_at` timestamp is updated on every transition, but there is no transition history table in the core schema (stressor_history records stressor events, not state transitions).

The `transitionRiskState` function in the intelligence layer updates the state directly:

```sql
UPDATE lifecycle_state SET risk_state = ?, risk_state_changed_at = ?, risk_state_reason = ? WHERE product_id = ?
```

There is no check that the transition is valid (e.g., green -> yellow is valid, green -> red should require passing through yellow or an explicit override).

**Impact:** Risk state can be inconsistent or oscillate rapidly, confusing the founder and triggering/untriggering recovery protocols in rapid succession.

**Remediation:**
1. Define a valid transition map: green -> yellow, yellow -> red, red -> yellow, yellow -> green. Direct green -> red and red -> green should require explicit justification.
2. Add a `risk_state_transitions` table recording from_state, to_state, reason, timestamp.
3. Add a debounce: no state change within 4 hours of the last transition (unless overridden by a critical stressor).

---

## Finding 04 — Decision status transitions are not validated

**Severity: P1**
**Files:** `src/db/schema.sql` (decisions table)

The decisions table constrains status to `pending`, `approved`, `rejected`, `executed`, `expired`. However, there is no validation of transition order:
- A decision can go from `pending` to `executed` without passing through `approved`.
- A decision can be moved from `rejected` back to `pending`.
- An `expired` decision can be retroactively approved.

The application code likely enforces some of these transitions logically, but the database allows any transition.

**Impact:** Inconsistent decision states could confuse the accuracy tracking system and the decision pattern learning system, which relies on clean state transitions to measure outcome quality.

**Remediation:**
1. Add transition validation in the application layer before updating decision status.
2. Define valid transitions: pending -> approved/rejected/expired, approved -> executed, rejected -> (terminal), expired -> (terminal).
3. Log all status transitions with timestamps.

---

## Finding 05 — Product deletion does not clean up migration-era tables

**Severity: P1**
**Files:** `src/routes/auth/clerk.ts` (lines 150-155), `src/db/migrations/`

The Clerk webhook handler deletes products with:

```typescript
await query('DELETE FROM products WHERE id = ?', [productId]);
```

The 54 migrations create approximately 40 additional tables that reference `products(id)`. Many of these (in later migrations) include `ON DELETE CASCADE`, but since foreign keys are not enforced (Finding 01), the cascades do not fire. Tables that would be orphaned include:

- `signal_history` (migration 005)
- `daily_insights` (migration 006)
- `operating_plans` (migration 007)
- `conversation_threads`, `conversation_messages` (migration 009)
- `team_members`, `team_invitations` (migration 010)
- `investors`, `investor_decisions`, `board_packets` (migration 011)
- `customers`, `customer_events`, `customer_health_snapshots` (migration 022)
- `experiments`, `experiment_results` (migration 023)
- `scp_agent_instances`, `scp_agent_health` (migration 020)
- Plus 20+ more tables

**Impact:** Product and founder deletion creates orphaned records across 40+ tables. These orphans consume storage and may appear in aggregate queries (e.g., cross-product benchmarking, decision patterns).

**Remediation:**
1. Enable foreign key enforcement (Finding 01).
2. Ensure all product-referencing tables have `ON DELETE CASCADE`.
3. Or implement a comprehensive `deleteProduct(productId)` function that explicitly deletes from all known tables in dependency order.

---

## Finding 06 — No transaction support for multi-step operations

**Severity: P2**
**Files:** `src/db/client.ts`, `src/routes/dashboard/onboarding.ts`

The database client has a `batch()` function that executes multiple statements, but it is used sparingly. Most multi-step operations use sequential `query()` calls without transactions. For example, product creation in onboarding:

```typescript
await query('INSERT INTO products ...', [...]);
await query('INSERT INTO lifecycle_state ...', [...]);
```

If the second query fails, the product exists without a lifecycle_state record. The dashboard would show an incomplete product.

Similar patterns exist in:
- Milestone checking (multiple sequential queries with no transaction)
- Tour state updates (read then write without atomicity)
- Billing webhook processing (update tier, update subscription record -- non-atomic)

**Impact:** Partial writes on failure. Products can exist in inconsistent states with missing related records.

**Remediation:**
1. Wrap multi-step mutations in `batch()` or explicit transactions.
2. Prioritize critical paths: product creation, billing updates, decision resolution.

---

## Finding 07 — Metric snapshots can have duplicate dates with conflicting data

**Severity: P2**
**Files:** `src/routes/ingest/index.ts`, `src/db/schema.sql`

The metric_snapshots table has a `UNIQUE (product_id, snapshot_date)` constraint, and the ingest handler uses `ON CONFLICT DO UPDATE`. This prevents duplicate rows but introduces a subtler issue: multiple ingest calls on the same day will overwrite previous values. If a founder submits metrics at 9am and then a Stripe webhook updates `new_mrr_cents` at 2pm, the 2pm update may overwrite other fields if they are included in the `ON CONFLICT DO UPDATE` clause.

The ingest handler only updates columns that are present in the POST body (good), but the Stripe webhook handler (`integrations/stripe-webhook.ts`) uses:

```sql
UPDATE metric_snapshots SET new_mrr_cents = new_mrr_cents + ?
```

This uses additive updates, which compound if the webhook is delivered multiple times (Finding 06 in Lens 32 -- no deduplication).

**Impact:** Metric values can drift from reality due to duplicate webhook processing or conflicting update patterns.

**Remediation:**
1. Deduplicate Stripe webhook events before processing metric updates.
2. Use idempotent metric updates (set to absolute value, not increment) where possible.
3. Log metric change provenance (which system updated which field and when).

---

## Finding 08 — JSON columns have no schema validation

**Severity: P2**
**Files:** `src/db/schema.sql` (multiple tables)

Multiple tables store JSON in TEXT columns:
- `founders.preferences` (JSON)
- `decisions.context` (JSON: array of data points)
- `decisions.options` (JSON: array of objects)
- `decisions.scenario_model` (JSON)
- `metric_snapshots.custom_metrics` (JSON)
- `lifecycle_state.prompt_2_hypotheses` (JSON)
- `stressor_history` (various JSON fields)

There is no validation of the JSON structure at the database level (SQLite does not support JSON schema constraints) or at the application level. The code uses `JSON.parse()` with try/catch in some places and bare casts in others.

**Impact:** Corrupt or malformed JSON in these columns will cause runtime errors. Over time, schema drift in JSON columns is difficult to detect.

**Remediation:**
1. Add Zod schemas for all JSON columns.
2. Validate JSON on write (before INSERT/UPDATE).
3. Add a data integrity job that periodically validates all JSON columns against their schemas.

---

## Summary Table

| # | Finding | Severity | File(s) |
|---|---------|----------|---------|
| 01 | PRAGMA foreign_keys never enabled | P0 | `db/client.ts` |
| 02 | Core schema lacks ON DELETE CASCADE | P0 | `db/schema.sql` |
| 03 | Risk state transitions not validated | P1 | `services/intelligence/risk-state.ts` |
| 04 | Decision status transitions not validated | P1 | `db/schema.sql` |
| 05 | Product deletion orphans 40+ tables | P1 | `routes/auth/clerk.ts` |
| 06 | No transaction support for multi-step operations | P2 | `db/client.ts` |
| 07 | Metric snapshots vulnerable to duplicate updates | P2 | `routes/ingest/index.ts` |
| 08 | JSON columns have no schema validation | P2 | `db/schema.sql` |

---

## Cross-References

- **Lens 06 (Reliability/SRE):** Finding 06 here (no transactions) was noted in Lens 06 Finding 02 (Turso client issues).
- **Lens 07 (Security):** Orphaned records (Finding 05) may contain sensitive data (GitHub tokens) that persists after "deletion."
- **Lens 32 (Billing ops):** Metric update conflicts (Finding 07) interact with Stripe webhook deduplication.
- **Orientation doc item #12:** "No transaction support" confirmed and expanded with specific examples.
