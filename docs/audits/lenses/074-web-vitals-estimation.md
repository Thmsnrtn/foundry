# Lens 074 — Web Vitals Estimation

**Distinct value:** Estimates Core Web Vitals (LCP, CLS, INP) for a server-rendered HTML app with HTMX. No hydration means no CLS from framework rendering. LCP is dominated by server processing time. INP is dominated by HTMX swap speed and inline script execution.

**Tenancy-critical:** Yes. Fleet-scale pages have longer server render times, directly impacting LCP. More products = more data = slower TTFB = worse LCP.

## Executive Summary

Foundry's server-rendered architecture gives it a natural advantage on CLS (zero layout shift from hydration) and a potential advantage on INP (no framework overhead). However, LCP is entirely bottlenecked on server processing time — every page computes all data before emitting any HTML. The estimated LCP for the dashboard is 300-800ms (6 async calls), for the portfolio page 500-2000ms (N signal computations), and for the landing page 50-100ms (static HTML). CLS should be near-zero because there is no JavaScript hydration, no lazy-loaded images above the fold, and no font swapping. INP is dominated by the AI query bar (potentially 2-10 seconds for Anthropic API call) and full-page navigation clicks (200-500ms until next page renders).

## Findings

### WV-01 LCP Bottlenecked on Server Computation, Not Rendering
- **Severity:** P1
- **Description:** In a server-rendered app, LCP = TTFB + HTML parse + largest paint. For Foundry, TTFB dominates because every page runs database queries and potentially AI calls before emitting any HTML. The dashboard runs 6 parallel async operations. The portfolio runs N signal computations. The agent detail page runs 2-3 queries. There is no streaming (chunked transfer encoding) to send the head/header before the body is ready.
- **Evidence:** `src/routes/dashboard/index.ts:141-155` — 6 Promise.all() calls before any HTML. `src/routes/dashboard/portfolio.ts:29-31` — N computeSignal() calls. Every route follows this pattern: fetch all data, then render.
- **Remediation:** Phase 1: Add HTTP compression (reduces transfer time). Phase 2: Cache frequently-read data (signal scores, daily insight, briefing). Phase 3: Use Hono's streaming response to send the `<head>` and layout wrapper immediately while data loads, then stream the body content.
- **Target Phase:** 2

### WV-02 CLS Should Be Near-Zero
- **Severity:** (Positive Finding)
- **Description:** Foundry has no client-side framework hydration, no lazy-loaded images above the fold, no dynamic font loading (uses system fonts), and no JavaScript that modifies layout after initial render. The only potential CLS source is the one-thing banner (HTMX lazy load with `min-height:0`) and the HTMX swap in the onboarding chat. Both are minor.
- **Evidence:** `src/views/layout.ts:100-104` — one-thing banner starts at `min-height:0` and expands when HTMX loads content. System font stack: `src/public/styles.css:75` — `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`.
- **Remediation:** Set `min-height` on the one-thing banner to match the expected content height (~40px) to prevent the layout shift when content loads. This is the only CLS fix needed.
- **Target Phase:** 3

### WV-03 INP Is Good for Navigation, Poor for AI Queries
- **Severity:** P2
- **Description:** INP (Interaction to Next Paint) measures the responsiveness of user interactions. For navigation clicks, INP is essentially the full page reload time (200-500ms). For HTMX interactions (priority banner dismiss, chat message), INP should be excellent (HTMX swaps are fast). For the AI query bar, INP is 2-10 seconds (Anthropic API latency) — but this is expected for an AI-powered feature and the "Thinking" loading state provides appropriate feedback.
- **Evidence:** The AI query bar at `src/routes/dashboard/index.ts:271-272` shows a loading state. All other interactions are either full-page navigations or HTMX swaps.
- **Remediation:** For navigation INP, `hx-boost="true"` would improve perceived speed by eliminating full page reloads. For AI queries, the loading state is appropriate. No further INP work needed.
- **Target Phase:** 2

### WV-04 No Font Loading Optimization Needed
- **Severity:** (Positive Finding)
- **Description:** Foundry uses system fonts exclusively: `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif` and monospace for code. No web fonts are loaded, meaning zero font-related CLS, zero FOIT (Flash of Invisible Text), and zero FOUT (Flash of Unstyled Text). This is an intentional performance optimization.
- **Evidence:** `src/public/styles.css:75` — system font stack. No `@font-face` declarations. No Google Fonts or Typekit links.
- **Remediation:** N/A — system fonts are the correct choice for this application.
- **Target Phase:** N/A

### WV-05 HTMX Script Is Render-Blocking Despite defer
- **Severity:** P3
- **Description:** The HTMX script tag has `defer` which means it downloads in parallel but executes after HTML parsing. However, it is loaded from an external CDN (unpkg.com) which adds DNS resolution + TLS handshake + download time. On slow connections, this could add 100-300ms before HTMX is available. During this window, any HTMX-enhanced elements (like the one-thing banner with `hx-trigger="load"`) will not work.
- **Evidence:** `src/views/layout.ts:71` — `<script src="https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js" defer>`.
- **Remediation:** Vendor HTMX locally (`/static/htmx.min.js`). This eliminates the external DNS lookup and leverages the existing connection to the origin server.
- **Target Phase:** 2

### WV-06 No Web Vitals Measurement in Place
- **Severity:** P2
- **Description:** There is no Real User Monitoring (RUM) for Core Web Vitals. No `web-vitals` library, no performance observer, no reporting to any analytics service. The team has no visibility into actual user-experienced LCP, CLS, or INP values.
- **Evidence:** No `PerformanceObserver`, no `web-vitals` import, no performance metric reporting in any script block.
- **Remediation:** Add the `web-vitals` library (2KB) to report LCP, CLS, and INP to the server: `import {onLCP, onCLS, onINP} from 'web-vitals'; onLCP(console.log);`. In production, POST metrics to `/api/vitals` for aggregation.
- **Target Phase:** 3

## Estimated Vital Ranges

| Page | LCP (est.) | CLS (est.) | INP (est.) |
|------|-----------|-----------|-----------|
| Landing (public) | 80-150ms | 0 | N/A (static) |
| Dashboard (single product) | 300-800ms | 0.01 (banner) | 200-500ms (nav) |
| Portfolio (5 products) | 500-1500ms | 0 | 200-500ms (nav) |
| Portfolio (25 products) | 2000-5000ms | 0 | 200-500ms (nav) |
| Decision Chamber | 200-500ms | 0 | 2-10s (AI reflect) |

## Embarrassment Test
1. A founder with 25 products experiences a 5-second blank page on the portfolio view because all signal scores are computed live before any HTML is sent.
2. The team cannot report Core Web Vitals numbers because there is no measurement in place.

## Recommendations (Priority Order)
1. Cache signal scores to fix portfolio LCP at fleet scale (P1, Phase 2)
2. Add HTTP compression to reduce transfer time (P2, Phase 1)
3. Vendor HTMX locally to eliminate CDN dependency (P2, Phase 2)
4. Add `hx-boost="true"` to improve navigation INP (P2, Phase 2)
5. Set min-height on one-thing banner to prevent CLS (P3, Phase 3)
6. Add web-vitals measurement library (P2, Phase 3)
