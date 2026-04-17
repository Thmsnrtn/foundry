# Lens 49 — Empty / Loading / Error State Designer Audit

**Auditor perspective:** Empty/loading/error state UX designer
**Scope:** What shows when there is no data, what shows while loading, what shows on error across all dashboard routes. Are empty states helpful or just "No data"?
**Date:** 2026-04-16

---

## Executive Summary

Foundry's empty state handling is significantly above average for an early-stage product. The codebase has a reusable `emptyState()` component that renders a styled message with an optional CTA, and an enhanced `emptyStateWithHint()` that integrates with the contextual hints system. Most dashboard routes handle the zero-data case with meaningful copy that explains why there is no data and what action will produce data. The Decisions page is the gold standard: "Your decision queue is empty" followed by an explanation of when decisions appear and what they mean. However, loading states are almost entirely absent -- the server-rendered architecture means the HTML arrives fully formed, but any client-side data fetching (the `/api/ask` query bar, HTMX-driven onboarding chat) has minimal loading indication. Error states are the weakest layer: most routes either return raw JSON `{error: 'Not found'}` or silently redirect, with no user-facing error UI for server failures or partial data scenarios.

**P0 findings:** 0
**P1 findings:** 2
**P2 findings:** 5
**P3 findings:** 4

---

## Route-by-Route Analysis

### Dashboard (`/dashboard`) -- GOOD

**Empty state:** Redirects to `/onboarding` if no products exist. If products exist but no metrics, the Signal score computes from defaults (score ~85 with no penalties). The daily insight section is conditionally rendered -- it simply does not appear if null. Stressors section is conditionally rendered.

**Loading state:** None needed -- server-rendered. The query bar has a `loading` CSS class that shows "Thinking" text during the fetch.

**Error state:** The query bar catch block shows "Something went wrong. Try again." in the response area. No other error handling for data load failures.

**Assessment:** Solid. The conditional rendering avoids "No data" messages for sections that are simply not relevant yet.

### Decisions (`/decisions`) -- EXCELLENT

**Empty state:** Uses `decisionList([])` which renders via `emptyState('No pending decisions.', { label: 'Back to Dashboard', href: '/dashboard' })`. The hints system adds: "Your decision queue is empty. Foundry is operating autonomously. Decisions surface here when the intelligence layer detects something that requires your specific judgment."

**Loading state:** N/A (server-rendered).

**Error state:** Decision detail returns `c.json({ error: 'Not found' }, 404)` -- raw JSON for a user-facing page.

**Assessment:** Best empty state in the codebase. The error state is a JSON response that should be HTML.

### Audit (`/products/:id/audit`) -- GOOD

**Empty state:** Shows `emptyState('No audit has been run yet.', { label: 'Run First Audit', href: '#' })` with an audit run button. Contextual hints provide additional guidance for first audits, low composites, and wisdom-blocked issues.

**Loading state:** N/A. The audit POST returns JSON (not HTML), so the UI must handle the "audit in progress" state client-side. No loading indicator is provided.

**Error state:** Returns `c.json({ error: 'Not found' }, 404)` for missing products.

**Assessment:** Good empty state. Missing loading state for the audit-in-progress period.

### Revenue (`/products/:id/revenue`) -- ADEQUATE

**Empty state:** Shows `<p class="text-muted">No revenue data yet. Metric snapshots will populate once ingested.</p>` inside a card. The Revenue Summary card still renders with $0.00 values rather than hiding.

**Loading state:** N/A.

**Error state:** Redirects to `/dashboard` if product not found (silent failure -- founder does not know why they were redirected).

**Assessment:** The $0.00 values are debatable -- they are technically correct but may cause confusion. The redirect-on-error gives no feedback.

### Competitive (`/products/:id/competitive`) -- ADEQUATE

**Empty state:** Delegates to `competitiveView()` component. If no competitors or signals exist, the component renders its own empty state.

**Loading state:** N/A.

**Error state:** Returns `c.json({ error: 'Not found' }, 404)` -- raw JSON.

**Assessment:** Functional but the error path returns JSON on a user-facing route.

### Cohorts (`/products/:id/cohorts`) -- ADEQUATE

**Empty state:** Delegates to `cohortTable()` which renders `emptyState('No cohort data yet. Cohorts are created as users sign up.')`.

**Loading state:** N/A.

**Error state:** Returns `c.json({ error: 'Not found' }, 404)` -- raw JSON.

**Assessment:** Clear empty state message explaining the prerequisite. Same JSON error issue.

### Lifecycle (`/products/:id/lifecycle`) -- MINIMAL

**Empty state:** Shows lifecycle progress bar and current prompt even when no conditions have been evaluated. This is correct -- the lifecycle starts at prompt_1 by default.

**Loading state:** N/A.

**Error state:** Returns `c.json({ error: 'Not found' }, 404)` -- raw JSON.

**Assessment:** The lifecycle route does not need an empty state since every product starts with lifecycle data.

### Scenarios (`/scenarios`) -- EXCELLENT

**Empty state:** Full-page empty state with emoji, heading, explanatory paragraph about Monte Carlo simulation, and a "Generate Scenarios" button. This is the second-best empty state after Decisions.

**Loading state:** N/A. The regenerate POST redirects back to the page.

**Error state:** If `productId` is null, shows "No product selected." inside a card. Scenario not found shows a card with "Scenario not found."

**Assessment:** Excellent. Explains what the feature does and provides a clear action to populate it.

### Weekly Brief (`/brief`) -- EXCELLENT

**Empty state:** Full-page empty state with emoji, heading "No weekly brief yet," explanatory text, and "Generate Weekly Brief" button. Centered in the page for visual focus.

**Loading state:** N/A. Generation redirects.

**Error state:** If no product, shows "No product selected." quietly. Generation failure silently redirects back.

**Assessment:** Excellent empty state. Silent error on generation failure is the only gap.

### Memory (`/memory`) -- GOOD

**Empty state:** Shows "No memory nodes yet" with a "Sync from Strategic Decisions" button. Search with no results shows "No matching nodes found." Counterfactuals shows "No counterfactuals recorded yet. Open any memory node to add one."

**Loading state:** N/A.

**Error state:** Product not found shows "No product selected." in a card.

**Assessment:** Good across all sub-pages. Each empty state explains what action will populate data.

### Portfolio (`/portfolio`) -- GOOD

**Empty state:** Redirects to `/onboarding` if no products. Redirects to `/dashboard` if single product.

**Loading state:** N/A.

**Error state:** N/A (data always exists if the route is reached).

**Assessment:** Smart routing eliminates the need for empty states.

### Digest (`/digest`) -- ADEQUATE

**Empty state:** Calls `digestView([])` which renders `emptyState('No digest data available.', { label: 'Back to Dashboard', href: '/dashboard' })`.

**Loading state:** N/A.

**Error state:** If no products, renders the empty state. No specific error handling.

**Assessment:** The "No digest data available" message could be more helpful. It does not explain that digests are generated automatically on Mondays or that the founder should submit metrics first.

---

## Findings

## Finding 01 — Multiple routes return raw JSON `{error: 'Not found'}` on user-facing pages

**Severity: P1**
**Files:** `decisions.ts` (line 57), `audit.ts` (line 21), `competitive.ts` (line 17), `cohorts.ts` (line 17), `lifecycle.ts` (line 15)

At least 5 dashboard routes return `c.json({ error: 'Not found' }, 404)` when a product is not found. These are GET routes that render HTML pages -- the founder navigates to them via links in the sidebar. A 404 JSON response renders as raw text in the browser.

**Impact:** Founders who click a stale product link or encounter a race condition see `{"error":"Not found"}` instead of a helpful error page.

**Remediation:** Create a shared `notFoundPage(ctx)` helper that renders an HTML 404 page with: a clear message ("Product not found or access denied"), a "Back to Dashboard" button, and consistent dashboard layout.

---

## Finding 02 — No loading states for client-side operations

**Severity: P1**
**Files:** `src/routes/dashboard/index.ts` (query bar), `src/routes/dashboard/onboarding-chat.ts`

The server-rendered architecture means most pages arrive fully formed. But two critical interactions involve client-side data fetching:

1. **Dashboard query bar** (`/api/ask`): Shows "Thinking" text in a `loading` CSS class. The text is not animated and there is no timeout or cancellation mechanism. If the AI call takes 30+ seconds, the founder sees static "Thinking" with no progress indication.

2. **Onboarding chat** (`/setup/message`): The HTMX indicator is defined in CSS (`.htmx-indicator { opacity: 0 }` / `.htmx-request .htmx-indicator { opacity: 1 }`) but the indicator element in the Send button uses `style="display:none"` which overrides the CSS class. The loading indicator never appears.

**Impact:** The onboarding chat button does not show a loading state. The dashboard query bar shows minimal feedback for long AI operations.

**Remediation:**
1. Fix the HTMX indicator: remove `style="display:none"` from the indicator span and let the CSS class control visibility.
2. Add a timeout indication: after 10 seconds, show "Still thinking..." with a cancel button.
3. Add a pulse/shimmer animation to "Thinking" text.

---

## Finding 03 — Silent redirects on error hide failures

**Severity: P2**
**Files:** `revenue.ts` (line 23), `exit.ts` (line 53), `weekly-brief.ts` (line 232-237)

Several routes silently redirect on error:
- Revenue: `return c.redirect('/dashboard')` if product not found.
- Exit: `return c.redirect('/products')` if no product.
- Weekly Brief: generation failure silently redirects back to `/brief`.
- Scenarios: generation failure silently redirects back to `/scenarios`.

**Impact:** The founder is redirected without explanation. They may not realize an error occurred, especially if they expected to see new data.

**Remediation:** Add flash message support (e.g., a query parameter `?error=product_not_found` rendered as a banner) so the founder understands why they were redirected.

---

## Finding 04 — Revenue page shows $0.00 instead of a meaningful empty state

**Severity: P2**
**File:** `src/routes/dashboard/revenue.ts` (lines 37-58)

When no revenue data exists, the Revenue page shows:
- "No revenue data yet. Metric snapshots will populate once ingested." (good)
- Revenue Summary card with "$0.00 Cumulative MRR" and "0.00 Health Ratio" (misleading)

The summary card renders even when there is no data, displaying zero values that look like real metrics rather than missing data.

**Impact:** A founder may interpret "$0.00 MRR" as "the system detected zero revenue" rather than "the system has no data yet."

**Remediation:** Conditionally render the Revenue Summary card only when metric data exists. Show the `emptyState` component instead.

---

## Finding 05 — Digest empty state does not explain the prerequisite

**Severity: P2**
**File:** `src/routes/dashboard/digest.ts` (lines 72-73), `src/views/components.ts`

The digest empty state renders: "No digest data available. [Back to Dashboard]". This does not explain:
- Digests are auto-generated on Monday mornings.
- Digests require at least one metric snapshot to be meaningful.
- The founder can trigger a manual digest generation (there is no button for this).

**Impact:** A new founder visiting the Digest page on their first day sees "No data" with no guidance on when or how data will appear.

**Remediation:** Replace with: "Your weekly digest will appear here every Monday morning. It combines your risk state, MRR analysis, stressor report, and competitive intelligence into a single briefing. Submit your first metrics to make the digest meaningful." Add a link to the metrics ingestion page.

---

## Finding 06 — Decision detail returns JSON 404 on HTML route

**Severity: P2**
**File:** `src/routes/dashboard/decisions.ts` (line 57)

`GET /decisions/:id` returns `c.json({ error: 'Not found' }, 404)` when the decision is not found or the founder does not own it. This is a page route that renders the "Decision Chamber" -- an immersive HTML layout. The JSON response will display as raw text.

This is particularly bad for decisions that have been resolved and potentially cleaned up, or for shared/bookmarked decision URLs where the product has changed.

**Impact:** Founders with bookmarked decision URLs see raw JSON instead of a helpful "Decision not found or already resolved" page.

**Remediation:** Return a styled HTML 404 page within the chamber layout: "This decision was not found. It may have been resolved or belongs to a different product." with a link back to `/decisions`.

---

## Finding 07 — Exit page swallows all service errors

**Severity: P2**
**File:** `src/routes/dashboard/exit.ts` (lines 55-59)

The Exit Intelligence page loads 4 data sources in parallel, each wrapped in `.catch(() => null)` or `.catch(() => [])`:

```typescript
const [maScore, topAcquirers, capScenarios, termModels] = await Promise.all([
  getLatestMAScore(ctx.productId).catch(() => null),
  getTopAcquirerCandidates(ctx.productId).catch(() => []),
  getCapTableScenarios(ctx.productId).catch(() => []),
  getTermSheetModels(ctx.productId).catch(() => []),
]);
```

If all four services fail (e.g., database timeout), the page renders with all empty sections and no indication that an error occurred.

**Impact:** The founder sees an apparently functional but entirely empty Exit Intelligence page with no explanation. They cannot distinguish between "no data yet" and "everything failed."

**Remediation:** Track whether each data source failed vs. returned empty. If any failed, show a banner: "Some sections could not be loaded. Refresh to try again."

---

## Finding 08 — `emptyState` component is well-designed (positive finding)

**Severity: P3 (positive)**
**File:** `src/views/components.ts` (line 310)

The `emptyState` component is a reusable function that renders a styled container with a message and optional CTA button. The `emptyStateWithHint` variant integrates with the contextual hints system, providing page-specific guidance when available and falling back to a standard empty state otherwise.

The component is used consistently across: decisions, cohorts, audit, digest, founding story, competitive, beta intake, lifecycle conditions, remediation, wisdom patterns, and failure logs.

**Assessment:** Good component design. Consistent usage across the codebase.

---

## Finding 09 — Scenarios page has best-in-class empty state (positive finding)

**Severity: P3 (positive)**
**File:** `src/routes/dashboard/scenarios.ts` (lines 131-157)

The Scenarios empty state includes:
1. An explanation of Monte Carlo simulation (what the feature does).
2. A visual hierarchy with emoji, heading, and paragraph.
3. A clear CTA: "Generate Scenarios" button.
4. Educational context that remains useful even after scenarios exist (the explanation card appears on both empty and populated states).

This is the template other routes should follow.

---

## Finding 10 — No global error boundary

**Severity: P3**
**Files:** All route files

There is no global error handler for unhandled exceptions in route handlers. If a route handler throws (e.g., database connection lost, undefined property access), the Hono framework returns a default 500 response. There is no:
- Custom 500 error page
- Error tracking (no Sentry, no error aggregation)
- User-facing "Something went wrong" page with retry guidance

**Impact:** An unhandled exception shows a generic server error. The founder gets no guidance and the team gets no notification.

**Remediation:** Add a global error handler middleware that renders a styled 500 page: "Something went wrong. We have been notified. [Back to Dashboard]". Integrate with an error tracking service.

---

## Finding 11 — No skeleton/shimmer loading patterns

**Severity: P3**

The server-rendered architecture largely avoids the need for loading states, which is a strength. However, for the HTMX-driven interactions (onboarding chat, dashboard query bar, scenario regeneration), there are no skeleton loading patterns. The HTMX library supports `hx-indicator` for loading states, but the implementation is inconsistent (see Finding 02).

**Impact:** HTMX interactions feel janky -- the user clicks and nothing visually happens until the response arrives.

**Remediation:** Add consistent `htmx-indicator` classes for all HTMX interactions. Use a subtle pulse animation for the target element during loading.

---

## Summary Matrix

| Route | Empty State | Loading State | Error State |
|-------|-------------|---------------|-------------|
| Dashboard | Good (redirects/conditional) | Minimal (query bar) | Minimal |
| Decisions | Excellent | N/A | JSON 404 |
| Audit | Good (with hints) | Missing | JSON 404 |
| Revenue | Adequate ($0 values) | N/A | Silent redirect |
| Competitive | Adequate | N/A | JSON 404 |
| Cohorts | Good | N/A | JSON 404 |
| Scenarios | Excellent | N/A | Card message |
| Weekly Brief | Excellent | N/A | Silent redirect |
| Memory | Good | N/A | Card message |
| Digest | Adequate | N/A | Silent fail |
| Exit | Unknown | N/A | Silent (swallowed) |
| Portfolio | Good (smart redirects) | N/A | N/A |

---

## Embarrassment Test

**Would an empty-state designer be embarrassed by this?** Not by the empty states themselves -- they are consistently above average, with several being excellent. The embarrassment is in the error layer: raw JSON on user-facing pages, silent redirects that hide failures, and the completely absent global error boundary. A founder encountering `{"error":"Not found"}` in their browser is a failure of basic UX craft.

## Pride Test

**What would make an empty-state designer proud?** The Decisions empty state ("Your decision queue is empty. Foundry is operating autonomously...") is a textbook example of how to make nothing feel like something. The Scenarios empty state with the Monte Carlo explanation is educational empty-state design. The contextual hints system that makes empty states adaptive based on product state is innovative. The server-rendered architecture that eliminates the need for most loading states is a valid architectural choice that simplifies the UX.
