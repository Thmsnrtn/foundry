# Lens 59 — Pagination / Cursor Correctness

**Auditor perspective:** List endpoints, unbounded SELECTs, missing LIMIT clauses, cursor-based vs offset pagination, and data volume growth implications.

**Date:** 2026-04-16
**Codebase snapshot:** 82 route files, ~60 dashboard routes, 14+ API routes

---

## Executive Summary

Foundry has a systemic pagination problem: the majority of list queries have no LIMIT clause or use hardcoded limits with no pagination mechanism. Dashboard routes retrieve all records for a product (all decisions, all competitors, all cohorts, all stressors) in a single query. The audit log page has a LIMIT 100 but no "next page" mechanism. The API v1 endpoints return all rows from a query with no pagination parameters. As products accumulate data over months of operation (hundreds of decisions, thousands of competitive signals, tens of thousands of audit log entries), these unbounded queries will degrade performance, increase memory usage, and eventually cause timeouts. The only endpoint with any form of pagination is the audit-log route, and even that uses hardcoded LIMIT 100 with no offset or cursor.

---

## Findings

### PAG-01. Decision Queue Returns All Pending Decisions with No Limit

**Severity: P1**

The decision queue (`src/db/client.ts:118-130`) returns all pending decisions for a product with no LIMIT clause. The dashboard route at `src/routes/dashboard/decisions.ts:32` passes all results to the view. A product with 500+ accumulated decisions (realistic after a year of operation with AI-generated decisions from 12 agents) sends a massive HTML page.

**Evidence:**
- `src/db/client.ts:118-130` — `getPendingDecisions()` — `SELECT * FROM decisions WHERE product_id = ? AND status = 'pending' ORDER BY ... ASC` — no LIMIT
- `src/routes/dashboard/decisions.ts:32` — passes full result set to `decisionList()`
- Each decision row contains TEXT columns (`what`, `why_now`, `context`, `options`, `recommendation`) that can be 500+ characters each
- 500 decisions * ~2KB per decision = ~1MB of HTML rendered server-side

**Remediation:** Add `LIMIT 50` to `getPendingDecisions()` and add a "Show more" button (HTMX `hx-get` with offset parameter) to the dashboard. For the API, support `?limit=50&offset=0` query parameters.

**Target phase:** P1

---

### PAG-02. Competitive Signals Has Hardcoded LIMIT 20 — No Pagination

**Severity: P2**

`src/db/client.ts:192-199` — `getCompetitiveSignals(productId, limit = 20)` has a default limit of 20. This is good, but there is no mechanism to retrieve signals 21-40 or beyond. The dashboard and API routes that use this function cannot paginate.

**Evidence:**
- `src/db/client.ts:192-199` — `LIMIT ?` with default 20
- `src/routes/api/metrics.ts:134` — `getCompetitiveSignals(productId)` — uses default 20
- The Signal Timeline page and competitive dashboard show only the 20 most recent signals
- Older signals are invisible to the user — no "load more" or "page 2" option

**Remediation:** Add `offset` parameter to `getCompetitiveSignals()` and expose it via query parameters in the API and dashboard routes.

**Target phase:** P2

---

### PAG-03. `getAllActiveProducts()` Returns All Products — Used by Every Job

**Severity: P1**

`src/db/client.ts:323-325` — `getAllActiveProducts()` returns `SELECT * FROM products WHERE status = 'active'`. Every one of the 72 cron jobs calls this and iterates all products. With 1000 active products (realistic for a multi-tenant platform), each job loads 1000 full product rows including TEXT columns (`stack_description`, `github_access_token`).

**Evidence:**
- `src/db/client.ts:323-325` — `SELECT * FROM products WHERE status = 'active'` — no LIMIT, SELECT *
- Called in: `lifecycleCheck`, `competitiveScan`, `weeklySynthesis`, `metricSnapshot`, `coldStartCheck`, `milestoneCheck`, `navBadgeRefresh`, `signalAlertCheck`, `dailyInsightGenerate`, `weeklyPlanGenerate`, `morningBriefings`, and 10+ SCP jobs
- Each product row may include `github_access_token` (sensitive) and `stack_description` (potentially large)
- For jobs that only need `id` and `owner_id`, loading all columns is wasteful

**Remediation:** Create specialized queries for jobs: `getAllActiveProductIds()` returning only `id, owner_id, name`. For jobs that need additional fields, create specific queries. Consider processing products in batches with `LIMIT 100 OFFSET ?` for very large fleets.

**Target phase:** P1

---

### PAG-04. Audit Log Has LIMIT 100 But No Next-Page Mechanism

**Severity: P2**

`src/routes/dashboard/audit-log.ts:61-77` builds a dynamic SQL query with filters and appends `LIMIT 100`. There is no offset parameter, cursor, or "next page" link. Once a product has more than 100 audit log entries (which happens within the first few days given 12 agents logging multiple actions per session), older entries are inaccessible.

**Evidence:**
- `src/routes/dashboard/audit-log.ts:77` — `sql += ' ORDER BY created_at DESC LIMIT 100'`
- No `offset`, `page`, or `cursor` query parameter handling
- No "Load more" or "Next page" in the rendered HTML
- The `agent_audit_log` table grows rapidly: 12 agents * daily runs * multiple actions per run = 100+ entries per day

**Remediation:** Add `?page=N` or `?before=<created_at>` cursor parameter. Render a "Load more" button with HTMX that fetches the next page.

**Target phase:** P2

---

### PAG-05. API v1 Webhooks List Returns All Rows — No Pagination

**Severity: P2**

`src/api/v1/webhooks.ts:18-25` — `SELECT ... FROM webhooks WHERE product_id = ? ORDER BY created_at DESC`. No LIMIT clause. Returns all webhooks. While most products won't have many webhooks, this sets a bad precedent for the API pattern.

**Evidence:**
- `src/api/v1/webhooks.ts:18-25` — no LIMIT
- `meta.total` is returned but no `meta.page` or `meta.cursor`
- Other API v1 endpoints likely follow the same pattern

**Remediation:** Add `LIMIT 100` as a default. Accept `?limit` and `?offset` query parameters. Return `meta: { total, limit, offset }` in the response.

**Target phase:** P2

---

### PAG-06. Stressor History and Cohort Queries Return All Rows

**Severity: P2**

Multiple `db/client.ts` helper functions return all matching rows:
- `getCohorts()` (line 174) — all cohorts for a product
- `getCompetitors()` (line 183) — all competitors for a product
- `getLifecycleConditions()` (line 275) — all conditions for a product

**Evidence:**
- `src/db/client.ts:174` — `SELECT * FROM cohorts WHERE product_id = ? ORDER BY acquisition_period DESC` — no LIMIT
- `src/db/client.ts:183` — `SELECT * FROM competitors WHERE product_id = ?` — no LIMIT
- Cohorts grow by 1 per month per acquisition channel — after 2 years with 3 channels, 72 rows
- Competitors are typically <20 per product, but have no hard limit

**Remediation:** Add default LIMIT clauses (e.g., LIMIT 100 for cohorts, LIMIT 50 for competitors). For dashboard routes, paginate with "Show all" option. For API routes, support `?limit` and `?offset`.

**Target phase:** P3

---

## Embarrassment Test

1. **"The decision queue loads ALL pending decisions for a product with no LIMIT — a year-old product with 500+ decisions generates a 1MB HTML page on every dashboard load"** — The most-visited page has no pagination.

2. **"`getAllActiveProducts()` loads every column of every active product (including encrypted GitHub tokens) into memory for every one of 72 cron jobs"** — Wasteful and potentially insecure.

3. **"The audit log shows exactly 100 entries with no way to see older entries — once a product generates entry 101, the oldest entry becomes permanently invisible in the UI"** — The security audit trail is truncated with no pagination.

## Pride Test

1. The `getCompetitiveSignals()` function has a configurable `limit` parameter with a sensible default of 20, showing awareness of the need for bounded queries.

2. The `getAuditLog()` function (`db/client.ts:204`) has a default `limit` of 50, which is a reasonable default for the API-facing audit log.

3. The decision queue sorts by category urgency first and creation date second, which means the most important decisions appear first even without pagination — a thoughtful UX choice.

## Distinct-Value Declaration

This lens catalogs every unbounded query in the system and traces the data growth trajectory to determine when each will become a performance problem. Tier 1 performance lens may note "some queries lack LIMIT" but this lens quantifies the growth rate (e.g., 100+ audit log entries per day per product) and identifies which queries will degrade first. The cursor-vs-offset analysis is specific to this specialty.

## Tenancy-Critical Flag

**PAG-03** is tenancy-critical: `getAllActiveProducts()` loads all products for all tenants, and as the platform grows, the memory and query cost of loading 1000+ products for each of 72 jobs becomes a scaling bottleneck that degrades performance for all tenants.
