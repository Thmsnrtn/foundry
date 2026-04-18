# Lens 078 — Table Design Specialist

**Distinct value:** Evaluates table visual design: density, alignment, sort affordance, filter UI, hover states, responsive behavior, and readability at scale. Focuses on the portfolio view with 25+ companies and the cohort/comparison grids.

**Tenancy-critical:** Yes. Fleet view tables must remain readable and usable at 25+ rows.

## Executive Summary

Foundry uses CSS Grid-based tables (`.comparison-grid`, `.comp-row`) rather than HTML `<table>` elements. This approach offers flexible column sizing and responsive behavior but loses native table semantics (important for accessibility). The visual design is clean: subtle row borders, proper alignment, consistent typography, and good information density. However, there are no sort affordances, no hover states on rows, no sticky headers for scrollable tables, and no responsive breakpoints for narrow screens. The agent roster, decision queue, and briefing history use styled card stacks rather than tables, which works well for their data types. The cohort table would benefit from heatmap coloring. The portfolio grid is the weakest table-like view — it is a card grid with no density controls.

## Findings

### TD-01 Comparison Grid Has Good Base Design
- **Severity:** (Positive Finding)
- **Description:** The `.comparison-grid` pattern (used for cohorts, audit comparisons, and other tabular data) has proper column headers (uppercase, small font, dim color), consistent row spacing, subtle border separators, and delta coloring (green for up, red for down). The visual density is appropriate — not too cramped, not too spacious.
- **Evidence:** `src/public/styles.css:951-977` — comparison grid with header, row, and total styles. Delta classes for positive/negative changes.
- **Remediation:** N/A — good base to build on. Add hover state and sticky header.
- **Target Phase:** N/A

### TD-02 No Row Hover State on Any Table
- **Severity:** P2
- **Description:** No table or list in Foundry has a hover state. The decision cards have hover via inline `onmouseover` in the briefing history, but the comparison grids, cohort tables, and metric grids have no hover highlight. Row hover is important for visual tracking across wide tables with multiple columns.
- **Evidence:** No `.comp-row:hover` or `.decision-card:hover` in the stylesheet. The briefing history list uses inline `onmouseover="this.style.background='rgba(255,255,255,0.03)'"` — an inline style doing CSS's job.
- **Remediation:** Add `.comp-row:hover { background: rgba(255,255,255,0.03); }`. Add `.decision-card:hover { border-left-color: var(--accent); }` (already partially defined but not consistently applied).
- **Target Phase:** 2

### TD-03 No Sticky Headers for Scrollable Tables
- **Severity:** P2
- **Description:** The comparison grid header (`.comp-header`) is not sticky. For tables with many rows (cohort data over 12+ months, decision history over 50+ items), scrolling loses the column headers. This is a standard table usability issue.
- **Evidence:** `src/public/styles.css:952-963` — `.comp-header` has no `position: sticky`.
- **Remediation:** Add: `.comp-header { position: sticky; top: 0; background: var(--surface-2); z-index: 2; }`. This keeps column headers visible during vertical scroll.
- **Target Phase:** 2

### TD-04 No Sort Affordance in Column Headers
- **Severity:** P2
- **Description:** No table has clickable column headers for sorting. The comparison grid headers are plain text. For the cohort table, the ability to sort by D7/D14/D30 retention would immediately surface the best and worst performing cohorts. For the decision queue, sorting by date, gate, or category would help triage. Currently, all sort order is hardcoded server-side with no user control.
- **Evidence:** `src/views/components.ts:458-459` — cohort table header: `<span>Period</span><span>Users</span><span>D7</span>...` — plain text, no links or buttons.
- **Remediation:** Make column headers clickable links: `<a href="?sort=d7&dir=desc" hx-get="?sort=d7&dir=desc" hx-target="#table-body">D7 &#x25BC;</a>`. Server re-renders with updated ORDER BY. HTMX makes this instant.
- **Target Phase:** 3

### TD-05 Portfolio Grid Needs Density Options
- **Severity:** P2
- **Description:** The portfolio grid uses `minmax(200px, 1fr)` cards. At 25+ companies, this creates a long scrollable page of cards. There is no compact/dense mode, no list view alternative, and no way to see all companies at once. A founder managing a fleet needs a density toggle: grid (current), list (one row per company), or table (all data visible).
- **Evidence:** `src/public/styles.css:1135-1142` — portfolio grid with fixed card sizing. No alternative layout options.
- **Remediation:** Add a view toggle: "Grid | List | Table". Grid = current cards. List = horizontal rows with signal, name, and status. Table = full comparison grid with MRR, risk state, and signal for all products.
- **Target Phase:** 3

### TD-06 Decision Cards Use Card Stack, Not Table — Correct Choice
- **Severity:** (Positive Finding)
- **Description:** Decisions are displayed as stacked cards rather than table rows. This is the correct choice because each decision has variable-length text (the "what" field can be 1-3 lines) and the visual weight of each card communicates its importance. The category-based left border color provides quick visual categorization.
- **Evidence:** `src/public/styles.css:991-1005` — decision card styling. `src/views/components.ts:347-358` — card rendering with metadata row.
- **Remediation:** N/A — card stacks are better than tables for decision display. Consider adding category filter tabs.
- **Target Phase:** N/A

### TD-07 Agent Roster Layout Is Dense and Effective
- **Severity:** (Positive Finding)
- **Description:** The agent roster displays 12 agents in a compact layout with status dots, names, roles, lifecycle badges, and success rates. The fixed cardinality (always 12) means the roster is always a manageable size. The visual hierarchy is clear: status dot for health, name for identity, role for context.
- **Evidence:** `src/routes/dashboard/agents.ts:99-150` — agent roster rendering with consistent card pattern.
- **Remediation:** N/A. At fleet scale, consider a condensed fleet-wide agent health grid (12 agents x N products matrix).
- **Target Phase:** N/A

### TD-08 Responsive Table Behavior Is Missing
- **Severity:** P2
- **Description:** The comparison grid columns are fixed-ratio (`2fr 1fr 1fr 1fr`). On mobile, this squishes all columns equally rather than adapting (e.g., hiding less-important columns, stacking headers). The only responsive table behavior is the analytics grid changing from 4 columns to 2 at 600px width.
- **Evidence:** `src/public/styles.css:727-730` — only media query for analytics grid. No responsive rules for comparison grids or cohort tables.
- **Remediation:** Add responsive behavior: hide D60 column on narrow screens, use `overflow-x: auto` wrapper for horizontal scroll, or stack cells vertically on mobile.
- **Target Phase:** 3

## Embarrassment Test
1. A founder scrolling through 12 months of cohort data loses the column headers and cannot remember which column is D7, D14, or D30.
2. A fleet view with 25 products is a long scroll of identical cards with no way to sort by performance or switch to a compact list view.

## Recommendations (Priority Order)
1. Add row hover states to all table/grid patterns (P2, Phase 2)
2. Add sticky headers to comparison grids (P2, Phase 2)
3. Add sort affordance to cohort and decision tables (P2, Phase 3)
4. Add view toggle (grid/list/table) to portfolio (P2, Phase 3)
5. Add responsive table behavior for mobile (P2, Phase 3)
