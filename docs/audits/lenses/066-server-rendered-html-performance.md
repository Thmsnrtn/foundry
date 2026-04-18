# Lens 066 — Server-Rendered HTML Performance

**Distinct value:** Evaluates rendering speed, HTML payload size, and inline style overhead specific to Hono template literal SSR (no React, no hydration). Examines template composition cost, string concatenation volume, and response size for fleet-scale pages.

**Tenancy-critical:** Yes. Fleet view (portfolio page) calls `computeSignal()` in parallel for every product. N products = N CPU-bound template renders plus N async DB/compute calls serialized into one response.

## Executive Summary

Foundry's server-rendered HTML via Hono `html` tagged template literals is architecturally sound for performance — no virtual DOM diffing, no hydration, no client-side framework overhead. Every page is a single synchronous string emission from the server. However, the implementation has three issues that will degrade at fleet scale: (1) the portfolio page triggers N parallel `computeSignal()` calls that each hit the database and run scoring logic before any HTML is emitted, (2) every dashboard page loads the full layout including a 27-item command palette route array serialized into inline JS, and (3) the 2,891 inline style declarations inflate HTML payloads by an estimated 15-25KB per page versus using CSS classes.

## Findings

### SRHP-01 Portfolio Page Has O(N) Compute Before First Byte
- **Severity:** P1
- **Description:** The portfolio route (`/portfolio`) calls `computeSignal()` for every product via `Promise.all()` before emitting any HTML. Each `computeSignal()` runs database queries and scoring logic. For a founder with 5 companies (Investor-Ready tier), this is 5 serial DB round-trips wrapped in Promise.all. For fleet-scale (25+ companies), TTFB could exceed several seconds. No streaming, no caching, no partial rendering.
- **Evidence:** `src/routes/dashboard/portfolio.ts:29-31` — `Promise.all(productRows.map((p) => computeSignal(p.id as string)))` blocks entire response.
- **Remediation:** Cache Signal scores (they change at most hourly via SCP scheduler). Serve cached scores from the portfolio route and update them asynchronously. Alternatively, use a materialized `signal_score` column on the products table that the SCP scheduler updates.
- **Target Phase:** 2

### SRHP-02 Dashboard Index Triggers 6 Parallel Async Calls Before Render
- **Severity:** P2
- **Description:** The main dashboard route (`/dashboard`) runs `Promise.all()` with 6 async operations (computeSignal, getActiveStressors, getSignalHistory, getDailyInsight, getPreviousSignalScore, getLatestBriefing) plus the `getLayoutContext()` call which itself runs multiple queries. All must complete before any HTML is sent. This is the most frequently visited page.
- **Evidence:** `src/routes/dashboard/index.ts:141-155` — 6 parallel promises plus layout context.
- **Remediation:** Use a Response.body stream or cache the signal components. The daily insight and briefing change at most once per day and can be cached. Signal history for 60 days is expensive and should be cached with a 1-hour TTL.
- **Target Phase:** 3

### SRHP-03 Inline Styles Add ~15-25KB Per Dashboard Page
- **Severity:** P2
- **Description:** With 2,891 inline style declarations across the codebase, each dashboard page carries significant style bytes in the HTML payload that would be zero-cost if expressed as CSS classes (cached in `styles.css`). The landing page alone has 100+ inline style attributes. This inflates every response and defeats browser CSS caching.
- **Evidence:** `src/routes/public/landing.ts` — effectively every HTML element has a `style="..."` attribute. `src/routes/dashboard/decisions.ts:119-123` — option blocks use inline styles. Pattern repeats across all 59 dashboard routes.
- **Remediation:** Extract the 20 most-used inline style patterns into CSS classes. This reduces HTML payload and leverages browser CSS caching. Priority: landing page (public, crawled by search engines) and dashboard (viewed every session).
- **Target Phase:** 2

### SRHP-04 Command Palette JS Serialized Into Every Page
- **Severity:** P3
- **Description:** The command palette includes a 27-item `CMD_ROUTES` array and ~36 lines of minified JavaScript inlined into every page's `<body>`. This is ~2KB of identical JavaScript served on every single page load. It could be an external cacheable script.
- **Evidence:** `src/views/layout.ts:124-159` — inline `<script>` block with CMD_ROUTES array and 5 function definitions.
- **Remediation:** Move to `/static/cmd-palette.js` with cache headers. The route list is static and can be a cached file.
- **Target Phase:** 4

### SRHP-05 Template Literal Composition Is Allocation-Efficient
- **Severity:** (Positive Finding)
- **Description:** Hono's `html` tagged template literal returns `HtmlEscapedString` objects that auto-escape interpolated values and compose without intermediate string concatenation. This is more efficient than manual string building and prevents XSS by default. The template composition pattern (`layout()` wrapping `content`) is clean and avoids deep nesting.
- **Evidence:** `src/views/layout.ts:6` — imports `html, raw` from `hono/html`. All components return `HtmlContent` type which is properly composed.
- **Remediation:** N/A — this is the correct pattern.
- **Target Phase:** N/A

### SRHP-06 No HTTP Compression Configured
- **Severity:** P2
- **Description:** There is no evidence of gzip or brotli compression middleware in the Hono server configuration. Server-rendered HTML compresses extremely well (70-80% reduction typical), so the ~40-60KB uncompressed dashboard pages could be ~8-12KB compressed. Without compression, every page load transfers full uncompressed HTML.
- **Evidence:** `src/index.ts` (route mounting, no compression middleware visible). Hono has a `compress()` middleware available.
- **Remediation:** Add `app.use('*', compress())` from `hono/compress`. This is a single-line fix with major payload reduction.
- **Target Phase:** 1

## Embarrassment Test
1. A founder with 5 products hits the portfolio page and waits 3+ seconds for TTFB because every product's signal score is computed fresh on each page load with no caching.
2. A Lighthouse audit of the landing page shows a 45KB HTML payload where 15KB is inline styles — a metric that would raise eyebrows in any frontend review.

## Recommendations (Priority Order)
1. Add HTTP compression middleware (P1, Phase 1, single line fix)
2. Cache Signal scores for portfolio view (P1, Phase 2, prevents fleet-scale timeout)
3. Extract inline styles to CSS classes starting with landing page (P2, Phase 2)
4. Cache daily insight and briefing data with hourly TTL (P2, Phase 3)
5. Externalize command palette JS to a cacheable static file (P3, Phase 4)
