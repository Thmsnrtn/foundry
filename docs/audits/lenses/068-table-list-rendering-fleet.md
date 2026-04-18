# Lens 068 — Table / List Rendering for Fleet View

**Distinct value:** Analyzes how Foundry renders tabular data and lists when the founder manages 25+ companies. Checks for virtualization, lazy loading, pagination, and HTML table performance in the server-rendered paradigm.

**Tenancy-critical:** Yes. This is a direct fleet-scale concern. The portfolio view, cohort tables, decision lists, agent rosters, and competitive grids all render as flat HTML. At 25+ companies, data volume scales linearly with no mitigation.

## Executive Summary

Foundry renders all lists and tables as flat, un-paginated HTML. There is no virtualization (expected — this is SSR, not React), no pagination, no lazy loading, and no "load more" pattern. The portfolio grid renders all products at once. The decision queue renders all pending decisions. The cohort table renders all cohorts. The agent roster renders all 12 agents (fixed). For the current single-company use case, this is fine. At fleet scale (25+ companies), the portfolio page will render 25+ signal-computation blocks, the digest view will render 25+ product sections, and any aggregate list (cross-company decisions, fleet-wide signals) will be unbounded. The comparison grid and cohort table use CSS Grid, which handles large row counts well, but HTML size grows linearly.

## Findings

### TLR-01 Portfolio Grid Renders All Products With No Pagination
- **Severity:** P1
- **Description:** The portfolio route renders every product as a card in a CSS Grid. For the Investor-Ready tier (5 companies), this is fine. But the fleet vision targets 25+ companies, and each card requires a `computeSignal()` call. There is no pagination, no "show first 10 + load more", and no infinite scroll. The page will grow linearly in both compute time and HTML size.
- **Evidence:** `src/routes/dashboard/portfolio.ts:28-36` — `Promise.all(productRows.map(...))` with no limit. The CSS grid `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))` handles layout but not scale.
- **Remediation:** Add pagination (12 items per page) or a load-more button via HTMX. Cache signal scores so the portfolio page reads from cache rather than computing live.
- **Target Phase:** 2

### TLR-02 Decision Queue Is Unbounded
- **Severity:** P2
- **Description:** The decision list renders all pending decisions for a product. At fleet scale, if each company generates 2-3 decisions per day and a founder has 25 companies, the queue could have 50+ items. The list is rendered as a flat `<div>` stack with no pagination, filtering, or grouping.
- **Evidence:** `src/views/components.ts:336-358` — `decisions.map((d) => ...)` with no limit. `src/routes/dashboard/decisions.ts:31-33` — `getDecisionQueue(productId, riskState)` with no `LIMIT` clause visible.
- **Remediation:** Add a `LIMIT 25 OFFSET ?` to the decision query. Add HTMX-powered "load more" button. For fleet view, group decisions by product with collapsible sections.
- **Target Phase:** 3

### TLR-03 Cohort Table Uses Proper Grid Layout
- **Severity:** (Positive Finding)
- **Description:** The cohort retention table uses `.comparison-grid` with CSS Grid, which renders efficiently even with many rows. The header is sticky-capable, columns are properly aligned, and the data is presented in a clear tabular format. This is the best table pattern in the codebase.
- **Evidence:** `src/views/components.ts:446-484` — cohort table with `.comp-header` and `.comp-row` classes. `src/public/styles.css:951-975` — proper grid layout with consistent column widths.
- **Remediation:** N/A — use this as the model for other tabular data.
- **Target Phase:** N/A

### TLR-04 No Sort or Filter on Any List View
- **Severity:** P2
- **Description:** No list or table in Foundry supports client-side or server-side sorting or filtering. The decision queue cannot be filtered by category or gate level. The agent roster cannot be sorted by health or last active. The cohort table cannot be sorted by retention rate. For single-company use this is manageable, but for fleet-scale aggregate views it becomes unusable.
- **Evidence:** No `sort`, `filter`, `ORDER BY` toggles, or HTMX sort triggers found in any route or view template. All sort order is hardcoded server-side.
- **Remediation:** For server-rendered tables, use `<a href="?sort=field&dir=asc">` links in column headers that trigger server-side re-rendering with updated ORDER BY. HTMX can make this feel instant via `hx-get="?sort=..." hx-target="#table-body" hx-swap="innerHTML"`.
- **Target Phase:** 3

### TLR-05 Digest View Renders All Products Sequentially
- **Severity:** P2
- **Description:** The `digestView()` component renders every product's digest data (risk state, stressors, MRR, metrics) in a single flat HTML output. For 5 products this is a long page. For 25+ products this would be thousands of lines of HTML in a single response with no collapse, tabbing, or progressive loading.
- **Evidence:** `src/views/components.ts:601-617` — `digests.map((d) => ...)` renders all digest data inline.
- **Remediation:** Use `<details>` elements to collapse per-product digests (show only product name + signal score in summary). Alternatively, render only the current product's digest and use a product selector to switch.
- **Target Phase:** 3

### TLR-06 Agent Roster Is Fixed at 12 — No Scale Concern
- **Severity:** (Positive Finding)
- **Description:** The agent roster always renders exactly 12 agents (one per SCP agent type). This is a fixed cardinality that will not grow with fleet scale. The roster is well-structured with status dots, lifecycle badges, success rates, and authority levels.
- **Evidence:** `src/routes/dashboard/agents.ts:119-121` — queries `agent_instances WHERE product_id = ?`, which returns exactly 12 rows per product.
- **Remediation:** N/A — fixed cardinality is not a scale concern.
- **Target Phase:** N/A

### TLR-07 No Fleet-Wide Aggregate Table Exists Yet
- **Severity:** P2
- **Description:** There is no cross-company table view: no "all decisions across all products" view, no "fleet signal scores" table, no "all stressors across companies" list. The portfolio grid is the only multi-company view, and it shows only the signal score and product name. Building fleet-scale tables will require the patterns identified above (pagination, sort, filter, grouping).
- **Evidence:** No route in `src/routes/dashboard/` that queries multiple products' data in a single table view. `src/routes/dashboard/portfolio.ts` is the only multi-product route.
- **Remediation:** When building fleet aggregate views, implement server-side pagination from the start. Use the comparison grid pattern (TLR-03) with sort headers and HTMX for column sorting.
- **Target Phase:** 3

## Embarrassment Test
1. A founder with 25 products visits the portfolio page and waits 8+ seconds while 25 `computeSignal()` calls complete before seeing anything.
2. A fleet-level decision queue with 100+ pending decisions renders as a 200KB HTML page with no way to filter by urgency or product.

## Recommendations (Priority Order)
1. Paginate the portfolio grid and cache signal scores (P1, Phase 2)
2. Add LIMIT/pagination to decision queue (P2, Phase 3)
3. Add sort/filter to all list views via HTMX (P2, Phase 3)
4. Collapse per-product sections in digest view (P2, Phase 3)
5. Design fleet aggregate views with pagination from the start (P2, Phase 3)
