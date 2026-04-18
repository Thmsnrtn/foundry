# Lens 140 — Company Retirement / Archival

**Auditor perspective:** Edge-case hunter / domain adversary — data export, cost cessation, SCP shutdown, and reactivation
**Distinct-value declaration:** Traces the complete retirement lifecycle: what happens to data, costs, agent state, and whether a retired company can be brought back. No prior lens examined the full retirement path.
**Tenancy-critical:** Yes. Proper retirement is essential for fleet hygiene, cost control, and data compliance.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P1 | 2 |
| P2 | 3 |

---

## Current Retirement Mechanisms

### 1. Product Archival (status = 'archived')

**How triggered:** No UI mechanism found. Must be set via direct DB update or admin API.
**What it does:** `getAllActiveProducts()` filters by `status = 'active'`, so archived products are excluded from most background jobs.
**What it does NOT do:** Does not call `deprovisionSCP()`, does not stop SCP agents, does not notify the founder, does not export data.

### 2. SCP Deprovisioning

**How triggered:** `deprovisionSCP(productId)` -- called from specific code paths.
**What it does:** Sets `products.scp_status = 'archived'` and pauses all agent instances.
**What it does NOT do:** Does not set `products.status = 'archived'`, does not stop background jobs that check `status` instead of `scp_status`.

### 3. Founder Deletion (Clerk user.deleted webhook)

**How triggered:** Clerk webhook when user is deleted from Clerk dashboard.
**What it does:** Deletes all products (hard delete: `DELETE FROM products WHERE id = ?`) and the founder row.
**What it does NOT do:** Does not export data, does not clean up related tables (agent_sessions, briefings, etc. depend on CASCADE or remain orphaned).

---

## CR-01. No data export mechanism exists

**Severity: P1**
**Files:** (none -- the feature does not exist)

A founder who wants to retire a company and take their data has no option. There is no:
- Export endpoint for company data
- Data download button in the UI
- API to retrieve historical metrics, decisions, briefings, or agent sessions
- GDPR-compliant data portability mechanism

The data is locked in Turso and can only be accessed via the Foundry dashboard or API while the account is active.

**Impact:** For data compliance (GDPR Article 20 -- right to data portability), founders must be able to export their data. For practical retirement, founders need their metrics, decisions, and audit history.

---

## CR-02. Hard deletion on Clerk user.deleted loses all data irreversibly

**Severity: P1**
**Files:** `src/routes/auth/clerk.ts:144-157`

The `user.deleted` handler executes:
```typescript
for (const row of productsResult.rows) {
  await query('DELETE FROM products WHERE id = ?', [productId]);
}
await query('DELETE FROM founders WHERE id = ?', [founderId]);
```

This is a hard delete with no:
- Soft-delete / tombstone
- Grace period for recovery
- Data export before deletion
- Cascade analysis (which related rows survive?)

**Cascade concerns:**
- If `products` has foreign key constraints with `ON DELETE CASCADE`, dependent tables are cleaned up
- If no CASCADE is defined (likely, given SQLite's optional FK enforcement), orphaned rows remain in `agent_sessions`, `agent_instances`, `scp_constitutions`, `briefings`, `decisions`, `stressor_history`, etc.
- These orphaned rows are never cleaned up and accumulate forever

**Evidence:**
- `src/routes/auth/clerk.ts:150-156`: Sequential DELETE without cascade verification
- No `PRAGMA foreign_keys = ON` in the database client setup
- SQLite does not enforce foreign keys by default unless explicitly enabled

---

## CR-03. `deprovisionSCP` is a soft pause, not a true retirement

**Severity: P2**
**Files:** `src/services/scp/provisioner.ts:184-193`

`deprovisionSCP` pauses agents and sets SCP status to 'archived'. But:
- Agent instances remain in the database (rows not deleted)
- Constitution rows remain
- Evolution history remains
- Agent session history remains
- Cost logs remain

This is a "hibernation", not a "retirement". Data storage costs continue indefinitely. For a product with 1 year of history, this could be thousands of rows across 10+ tables.

---

## CR-04. No mechanism to re-activate a retired company

**Severity: P2**
**Files:** `src/services/scp/provisioner.ts`

As documented in lens 131, there is no `reprovisionSCP` or `reactivateSCP` function. If a founder archives a company and later wants to bring it back:
1. They must manually set `products.status = 'active'` and `scp_status = 'active'`
2. Agent instances have `status = 'paused'` and stale `next_run_at` -- all 12 would fire immediately on resume
3. Lifecycle state may be inconsistent
4. No re-evaluation of metrics, stressors, or risk state occurs

There is no "resurrection ceremony" that validates readiness, re-provisions agents, and recalculates the starting state.

---

## CR-05. Orphaned data from deleted products may reference non-existent product IDs

**Severity: P2**
**Files:** `src/routes/auth/clerk.ts:150-153`

When products are deleted via `DELETE FROM products WHERE id = ?`, any table that references `product_id` without CASCADE constraints retains orphaned rows. These rows:
- Consume storage
- Appear in global queries (e.g., `SELECT COUNT(*) FROM agent_sessions` includes orphaned sessions)
- May cause errors if a new product happens to get the same ID (extremely unlikely with nanoid but not impossible)

**Tables likely containing orphaned data after product deletion:**
- `agent_instances`
- `agent_sessions`
- `agent_cost_log`
- `scp_constitutions`
- `agent_evolution_versions`
- `scp_briefings`
- `decisions`
- `stressor_history`
- `signal_history`
- `metric_snapshots`
- `competitive_signals`
- `lifecycle_state`
- `daily_insights`
- `weekly_plans`
- `notifications`
- `audit_log`

That is 16+ tables with orphaned rows.

---

## Recommendations

1. **Implement data export** -- `/api/products/:id/export` that generates a JSON archive of all product data: metrics, decisions, briefings, audit history, agent sessions, and DNA. Require authentication and product ownership.
2. **Replace hard delete with soft delete** -- Set `founders.status = 'deleted'` and `products.status = 'deleted'` instead of DELETE. Schedule hard deletion after a 30-day grace period.
3. **Enable SQLite foreign keys** -- Add `PRAGMA foreign_keys = ON` to the database client initialization. Ensure all tables have proper CASCADE constraints.
4. **Implement `reactivateSCP`** -- A function that resumes a retired company: validates data integrity, re-provisions agents if needed, recalculates lifecycle state, and sets fresh `next_run_at` values.
5. **Add a retirement cleanup job** -- Weekly job that finds `products.status = 'archived'` older than 90 days and deletes associated data from all child tables.
6. **Add a "Retire Company" UI flow** -- Guide the founder through: data export -> confirmation -> SCP shutdown -> product archival. Offer a "reactivate within 30 days" option.
