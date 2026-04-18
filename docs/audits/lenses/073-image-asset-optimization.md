# Lens 073 — Image / Asset Optimization

**Distinct value:** Audits all static assets: images, SVGs, CSS, JavaScript, service worker, manifest. Checks for caching headers, asset versioning, CDN usage, bundle size, and optimization.

**Tenancy-critical:** No. Asset delivery is the same for all tenants.

## Executive Summary

Foundry has an extremely minimal asset footprint: one CSS file (`styles.css`), two PNG icons (192px and 512px), a web manifest, and a service worker stub. There are no images used in the application UI. SVG icons are either inline in templates (mobile nav, sparklines) or rendered as emoji characters. HTMX and Clerk JS are loaded from unpkg.com CDN without SRI hashes. There is no asset versioning, no cache-busting, no HTTP compression, and no CDN for self-hosted assets. The CSS file is approximately 1,600+ lines and loaded in full on every page.

## Findings

### IAO-01 No Asset Versioning or Cache Busting
- **Severity:** P2
- **Description:** `styles.css` is loaded as `/static/styles.css` with no version hash or cache-busting query parameter. After a deployment with CSS changes, users may see the old cached CSS until they hard-refresh. The same applies to the service worker (`/sw.js`), manifest (`/manifest.json`), and the two icon PNGs.
- **Evidence:** `src/views/layout.ts:69` — `<link rel="stylesheet" href="/static/styles.css" />`. No hash, no version query param. `src/public/` directory has raw filenames with no hash suffix.
- **Remediation:** Add a build step that hashes static files (`styles.abc123.css`) or append a runtime version query param (`styles.css?v=${BUILD_HASH}`). Set `Cache-Control: public, max-age=31536000, immutable` for hashed assets.
- **Target Phase:** 2

### IAO-02 Third-Party Scripts Loaded from CDN Without SRI
- **Severity:** P2
- **Description:** Two third-party scripts are loaded from unpkg.com without Subresource Integrity (SRI) hashes: HTMX 1.9.12 (loaded on every page) and Clerk JS (loaded on the landing page). A compromised CDN or MITM attack could inject malicious code into every page load. This is a supply-chain attack vector on a product handling founder business intelligence.
- **Evidence:** `src/views/layout.ts:71` — `<script src="https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js" defer>`. `src/routes/public/landing.ts:17` — `<script async crossorigin="anonymous" src="https://unpkg.com/@clerk/clerk-js/dist/clerk.browser.js">`.
- **Remediation:** Vendor both libraries locally (copy into `src/public/`) and serve from the same origin. This eliminates the CDN dependency, enables proper caching, and removes the need for SRI. If CDN is preferred, add `integrity="sha384-..."` attributes.
- **Target Phase:** 1

### IAO-03 CSS Is Single File, Not Split
- **Severity:** P3
- **Description:** All CSS is in a single `styles.css` file (~1,600+ lines). Public pages (landing, pricing, case studies) load the full CSS including dashboard-specific styles (sidebar, signal display, decision chamber, agent roster, etc.). The CSS for public pages alone would be ~200 lines. The overhead is modest for a server-rendered app (CSS is cached), but it means first-time visitors download ~30KB of unused CSS.
- **Evidence:** `src/public/styles.css` — single file containing both public and dashboard styles. `src/views/layout.ts:69` — same CSS link in both `publicLayout` and `dashboardLayout`.
- **Remediation:** For now, this is acceptable — the CSS is gzippable to ~5-8KB. If the CSS grows significantly, split into `public.css` and `dashboard.css`. Not high priority since CSS caching works well.
- **Target Phase:** 4

### IAO-04 Inline SVGs Are Well-Optimized
- **Severity:** (Positive Finding)
- **Description:** The mobile bottom nav icons and sparkline charts use inline SVGs that are compact, semantic, and accessible (`aria-hidden="true"` on decorative sparklines, `aria-label` on nav tabs). The SVGs use `currentColor` for theming and minimal path data. This is the correct approach for a server-rendered app — no extra HTTP requests for icons.
- **Evidence:** `src/views/layout.ts:333-337` — mobile nav SVG icons (5-6 lines each, ~200 bytes). `src/routes/dashboard/index.ts:22-35` — sparkline SVG generator (compact polyline).
- **Remediation:** N/A — extend this pattern to replace emoji icons (see IAO-06).
- **Target Phase:** N/A

### IAO-05 Service Worker Is a Stub
- **Severity:** P3
- **Description:** The service worker at `/sw.js` is registered on every page but its functionality is unknown (not inspected in this audit). If it caches CSS or HTML aggressively, it could serve stale content after deployments. If it does nothing, it is wasted overhead (SW registration, lifecycle events).
- **Evidence:** `src/views/layout.ts:162-164` — `navigator.serviceWorker.register('/sw.js').catch(function() {})`. `src/public/sw.js` exists but content was not examined.
- **Remediation:** Review `sw.js` content. If it is a stub, remove the registration. If it caches assets, ensure it uses versioned cache keys and properly invalidates on deployment.
- **Target Phase:** 3

### IAO-06 Emoji Icons Render Inconsistently Across Platforms
- **Severity:** P2
- **Description:** The notification bell (bell emoji), lock icon (lock emoji), lifecycle badges (circle emojis), and provisioning empty state (robot emoji) use Unicode emoji characters. Emoji rendering varies significantly across operating systems and browser versions. A Samsung phone, a Windows PC, and a Mac will each show different visual representations.
- **Evidence:** `src/views/layout.ts:193` — bell emoji for notification. `src/views/layout.ts:349` — lock emoji for nav. `src/routes/dashboard/agents.ts:59-66` — colored circle emojis for lifecycle states. `src/routes/dashboard/agents.ts:147` — robot emoji for empty state.
- **Remediation:** Replace emoji with inline SVGs using the same pattern as the mobile bottom nav icons. This ensures consistent rendering across all platforms and enables CSS theming.
- **Target Phase:** 3

### IAO-07 No HTTP Compression for Static Assets
- **Severity:** P2
- **Description:** There is no evidence of gzip or brotli compression being configured for static file serving. The CSS file (~30KB uncompressed) would be ~5-8KB compressed. HTML responses (~40-60KB for dashboard pages with inline styles) would compress to ~8-12KB. This is low-hanging fruit for performance.
- **Evidence:** `src/index.ts` — no compression middleware visible. Hono provides `compress()` middleware.
- **Remediation:** Add `app.use('*', compress())` from `hono/compress`. This compresses both static assets and dynamic HTML responses.
- **Target Phase:** 1

## Embarrassment Test
1. A security audit flags that two third-party scripts are loaded from a public CDN without SRI integrity hashes — on a product that handles business intelligence data.
2. A CSS change ships and users see broken styles until they hard-refresh because there is no cache busting.

## Recommendations (Priority Order)
1. Vendor HTMX and Clerk JS locally instead of CDN (P2, Phase 1)
2. Add HTTP compression middleware (P2, Phase 1)
3. Add cache-busting hashes to static assets (P2, Phase 2)
4. Replace emoji icons with inline SVGs (P2, Phase 3)
5. Review and rationalize the service worker (P3, Phase 3)
