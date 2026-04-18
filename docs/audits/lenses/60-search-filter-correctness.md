# Lens 60 — Search / Filter Correctness

**Auditor perspective:** Query injection in search/filter params, LIKE wildcards, SQL injection via dynamic WHERE, and filter correctness in the context of Turso/SQLite parameterized queries.

**Date:** 2026-04-16
**Codebase snapshot:** 82 route files, dynamic SQL construction in audit-log and several dashboard routes

---

## Executive Summary

Foundry uses parameterized queries (`?` placeholders) throughout, which prevents classical SQL injection. However, the audit-log route constructs dynamic SQL by concatenating filter conditions, and while the values are parameterized, the column names and operators are hardcoded and safe. The bigger concern is LIKE-pattern injection: agent queries use `LOWER(stressor_name) LIKE '%keyword%'` with hardcoded keywords (safe), but the `decision_follow_up` job uses `LIKE ?` with a value containing the decision ID, which could theoretically contain LIKE wildcards (% or _) if decision IDs were user-controllable (they are nanoid-generated, so this is safe in practice). The real filter correctness issues are about missing filters: the `decision_patterns` table has no access control, the `founders` table query in `digest_generate` has no status filter (includes deactivated founders), and several "search" operations have no input sanitization beyond parameterization.

---

## Findings

### FILT-01. Audit Log Route Constructs Dynamic SQL — Safe but Fragile

**Severity: P2**

`src/routes/dashboard/audit-log.ts:61-77` builds SQL dynamically by appending WHERE clauses based on query parameters. The values are parameterized (safe against injection), but the pattern is fragile: future developers might add a column filter by interpolating the column name from user input.

**Evidence:**
- `src/routes/dashboard/audit-log.ts:61` — `let sql = 'SELECT * FROM agent_audit_log WHERE product_id=?'`
- Lines 64-75: `if (actorType) { sql += ' AND actor_type=?'; params.push(actorType); }`
- The `actorType` and `action` values come from `c.req.query()` — user-controllable
- The values are parameterized (safe), but the WHERE clause structure is dynamic
- No allowlist validation of `actorType` or `action` values against expected enums

**Remediation:** Validate `actorType` against an allowlist: `['agent', 'user', 'system', 'api']`. Validate `action` against a list of known actions. Reject unexpected values with a 400 response.

**Target phase:** P2

---

### FILT-02. Decision Follow-Up Uses LIKE with Decision ID — Safe but Smells

**Severity: P3**

`src/jobs/index.ts:688` — `AND body LIKE ?` with `[..., '%' + d.id + '%']`. The decision ID is nanoid-generated (alphanumeric + dash + underscore), so it cannot contain LIKE wildcards. However, this pattern is a code smell: searching for a substring match in a notification body to detect duplicates is fragile.

**Evidence:**
- `src/jobs/index.ts:688` — `AND body LIKE ?` with value `%${d.id}%`
- Decision IDs are 21-character nanoid strings (safe characters only)
- If the decision ID system ever changed to include `%` or `_`, this query would match wrong rows
- The pattern searches the full `body` TEXT column for a substring — no index can help

**Remediation:** Add a `decision_id` column to the `notifications` table for structured lookup instead of LIKE on body text. This is both safer and more performant.

**Target phase:** P3

---

### FILT-03. `decision_patterns` Table Has No Tenant Filtering

**Severity: P1**

`src/db/client.ts:222-237` — `getRelevantPatterns()` queries the `decision_patterns` table with no `product_id` or `owner_id` filter. The comments explain this is intentional ("cross-product, anonymized"), but there is no verification that the data is actually anonymized when written.

**Evidence:**
- `src/db/client.ts:222-237` — `SELECT * FROM decision_patterns WHERE (decision_type = ? OR ...)` — no tenant scoping
- `src/db/migrations/001_initial.sql:266-267` — "This table is intentionally NOT scoped by founder or product"
- `src/services/decisions/patterns.ts:19` (line referenced from imports) — writes to this table
- If the write path accidentally includes product-identifiable data (product name, founder name), it would be readable by any founder through the pattern matching system

**Remediation:** Audit the write path to `decision_patterns` and verify that no product-identifiable or founder-identifiable data is stored. Add a CI test that verifies columns contain only anonymized data. Consider adding a `is_anonymized` flag that is checked on read.

**Target phase:** P1

---

### FILT-04. `digest_generate` Queries All Founders Without Status Filter

**Severity: P2**

`src/jobs/index.ts:160` — `SELECT * FROM founders WHERE tier IS NOT NULL`. This includes founders who may have cancelled their subscription, deactivated their account, or unsubscribed from emails. There is no `status` column check, no `email_unsubscribed` check, and no validation that the founder's email is deliverable.

**Evidence:**
- `src/jobs/index.ts:160` — `SELECT * FROM founders WHERE tier IS NOT NULL`
- No `status != 'deactivated'` filter
- No email preference check (the `preferences` JSON column could contain opt-out settings)
- Sending digest emails to cancelled founders wastes Resend API credits and may violate unsubscribe preferences

**Remediation:** Add `AND status = 'active'` filter (requires adding a `status` column to `founders`). Check `preferences` for email opt-out before sending.

**Target phase:** P2

---

### FILT-05. Agent Stressor Queries Use Hardcoded LIKE Keywords — No Index Support

**Severity: P2**

All 12 SCP agents use `LOWER(stressor_name) LIKE '%keyword%'` patterns to find relevant stressors for their domain. These are hardcoded strings (not user input, so no injection risk), but the `LOWER()` and `%prefix` LIKE patterns prevent index usage, causing full table scans.

**Evidence:**
- `src/services/scp/agents/atlas.ts:73-79` — 5 LIKE conditions with `LOWER()`
- `src/services/scp/agents/crucible.ts:88-94` — 7 LIKE conditions
- `src/services/scp/agents/harbor.ts:87-90` — 4 LIKE conditions
- `src/services/scp/agents/sentinel.ts:64-69` — 6 LIKE conditions
- `src/services/scp/agents/shield.ts:91-97` — 7 LIKE conditions
- Each agent runs these queries during their analysis phase — 12 agents * daily = 12 full scans of `stressor_history`
- As stressor_history grows (hundreds of entries per product), scan time increases linearly

**Remediation:** Add a `domain` or `category` column to `stressor_history` (e.g., 'technical', 'customer', 'legal') and index it. Assign domain at stressor creation time. Replace LIKE queries with `WHERE domain = ?`.

**Target phase:** P2

---

### FILT-06. No Input Sanitization on Search-Like Query Parameters

**Severity: P2**

Multiple routes accept query parameters for filtering (`actorType`, `action`, `since` in audit-log; `product_id` in mobile API) with no validation beyond parameterization. While parameterized queries prevent SQL injection, the values are not validated against expected formats:

**Evidence:**
- `src/routes/dashboard/audit-log.ts:59` — `const since = c.req.query('since') ?? ''` — accepts any string as a date
- `src/routes/api/mobile.ts:21` — `const productId = c.req.query('product_id')` — no format validation
- `src/routes/api/founder-intelligence.ts:90` — `const limit = parseInt(c.req.query('limit') ?? '50')` — `parseInt` of user input, could return NaN (though `parseInt('abc')` returns NaN which SQLite would handle as NULL in LIMIT)
- No Zod schema validation on query parameters anywhere in the codebase

**Remediation:** Add Zod validation for query parameters on all API routes. For date parameters, validate ISO 8601 format. For IDs, validate nanoid format (`/^[\w-]{21}$/`). For numeric parameters, validate as positive integers.

**Target phase:** P2

---

## Embarrassment Test

1. **"The cross-product `decision_patterns` table is intentionally unscoped, but there is no verification that the data written to it is actually anonymized — a write-path bug could leak product-identifiable data to all founders"** — Trust-but-don't-verify on data anonymization.

2. **"Digest emails are sent to ALL founders with a non-null tier, including cancelled subscribers and those who may have opted out"** — No unsubscribe/opt-out filter.

3. **"Every SCP agent does a full table scan with `LOWER(stressor_name) LIKE '%keyword%'` — 12 full scans per product per day on an ever-growing table"** — Performance-killing query pattern repeated across every agent.

## Pride Test

1. All queries use parameterized `?` placeholders consistently — no string interpolation of user values into SQL anywhere in the codebase.

2. The static file route (`src/index.ts:183`) validates filenames with `!/^[\w.-]+$/.test(fileName)` before serving, preventing path traversal.

3. The ingest endpoint validates the token format with a regex (`/^[\w-]{8,64}$/`) before any database query, providing input validation at the edge.

## Distinct-Value Declaration

This lens examines filter correctness beyond SQL injection — focusing on semantic correctness (right rows returned?), missing filters (deactivated founders), unindexed LIKE patterns in hot paths, and the anonymization contract of cross-tenant tables. Tier 1 security lens covers SQL injection; this lens covers the query semantics that determine whether the right data reaches the right user.

## Tenancy-Critical Flag

**FILT-03** is tenancy-critical: the `decision_patterns` table is intentionally cross-tenant, but if the anonymization contract is violated (product names, founder names included in pattern data), it constitutes a cross-tenant data leak.
