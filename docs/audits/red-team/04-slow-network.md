# RT-04 -- Slow Network User

**Persona:** Founder in a coworking space in Lagos on a shared 3G connection. Latency 400ms, bandwidth 400 Kbps. Every kilobyte counts. Patience does not.

**Date:** 2026-04-16
**Objective:** Load and use the Foundry dashboard on throttled 3G. Identify every blocking resource, unnecessary payload, missing cache header, and wasted byte.

---

## Session Narrative

### Attempt 1: Initial Page Load Analysis

I request `GET /dashboard`. The server renders the full HTML response synchronously and returns it. Let me trace what the browser must download before anything is interactive:

**Blocking resources in `<head>`:**
1. `<link rel="stylesheet" href="/static/styles.css" />` -- **64 KB** (uncompressed). Render-blocking. No `media` attribute to allow progressive rendering.
2. `<script src="https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js" defer></script>` -- external CDN fetch. The `defer` attribute helps (non-render-blocking), but this is a **third-party CDN dependency**. On 3G with 400ms latency:
   - DNS lookup for `unpkg.com`: ~200ms
   - TCP + TLS handshake: ~800ms (3G, two round trips)
   - HTTP request + response: ~400ms+ for the ~47 KB htmx library
   - Total: ~1.4 seconds just for htmx, assuming no CDN issues

**Evidence:**
- `src/views/layout.ts` line 69: stylesheet link
- `src/views/layout.ts` line 71: htmx CDN script

**Problems identified:**

1. **No content hash in static asset URLs.** The stylesheet is served from `/static/styles.css` with `Cache-Control: public, max-age=3600` (1 hour). This means:
   - Every hour, the browser must re-validate the 64 KB CSS file
   - On deploy, users get stale CSS for up to 1 hour (no cache busting)
   - On 3G, a conditional GET still costs 400ms+ for the round trip
   - Best practice: `/static/styles.[contenthash].css` with `max-age=31536000` (1 year immutable)

2. **CSS is not minified.** The 64 KB `styles.css` includes 1680 lines of unminified CSS with full comments, blank lines, and human-readable formatting. A minified version would be roughly 40-45 KB. With gzip compression, the difference is smaller (~15 KB vs ~12 KB), but on 3G every KB costs 20ms.

3. **HTMX loaded from unpkg.com CDN.** This is a single-point-of-failure. If unpkg is slow (it frequently is in Africa and Southeast Asia), the entire HTMX-dependent functionality stalls. The library should be self-hosted at `/static/htmx.min.js` to share the same origin, avoiding an extra DNS+TLS handshake.

**Evidence:**
- `src/index.ts` line 194: `'Cache-Control': 'public, max-age=3600'` -- 1 hour, no content hashing
- `src/public/styles.css`: 1680 lines, 64 KB, unminified

**Severity: P1** -- External CDN dependency is a reliability risk; cache policy is suboptimal

---

### Attempt 2: HTML Response Size

The dashboard HTML response is server-rendered. Let me estimate the size:

The `layout.ts` template includes:
- Full `<head>` with meta tags, stylesheet link, script tag
- Complete `<header>` with logo, product switcher, risk badge, notifications dropdown (with all notification items inline)
- Complete `<nav class="sidebar">` with all 20+ nav items, section headers, badges, lock icons
- Command palette HTML with full JavaScript (~3 KB of inline script)
- Service worker registration script
- Mobile bottom nav
- The actual page content (Signal display, stressor report, query bar, etc.)

For the dashboard page specifically, the inline JavaScript alone (command palette + query handler + service worker registration + milestone toast script) is approximately 4-5 KB of unminified JS embedded directly in the HTML. This cannot be cached separately.

Additionally, every page load includes the full sidebar and command palette regardless of whether the user interacts with them. On a 59-page dashboard, this shared chrome is re-sent on every navigation because there is no partial-page loading for the shell.

**Severity: P2** -- Inline JS and full-page reloads waste bandwidth on 3G

---

### Attempt 3: HTMX Partial Update Usage

HTMX is loaded on every page. How much is it actually used?

Total HTMX attribute usage across the entire codebase: **13 occurrences across 3 files**.

| File | Attributes | Purpose |
|------|-----------|---------|
| `views/layout.ts` | `hx-get`, `hx-trigger="load"`, `hx-swap="innerHTML"` | One-thing banner (1 usage) |
| `routes/api/priority.ts` | `hx-get`, `hx-trigger`, `hx-swap`, `hx-target` | Priority API partial responses (6 usages) |
| `routes/dashboard/onboarding-chat.ts` | `hx-post`, `hx-trigger`, `hx-swap`, `hx-target` | Onboarding chat messages (4 usages) |

That is it. HTMX is a 47 KB library loaded on every single page to support partial updates on exactly 3 pages. On the other 56 dashboard pages, HTMX is dead weight.

The dashboard page itself (the most-visited page) only uses HTMX for the one-thing banner -- a single `hx-get` that loads a small banner on page load. The query bar uses `fetch()` directly. The Signal Anatomy dialog uses native `<dialog>`. Decision resolution uses inline `fetch()`.

On 3G, this means: every page pays ~1.4 seconds for an external CDN fetch of a library that 95% of pages do not use.

**Evidence:**
- `src/views/layout.ts` lines 99-103: sole HTMX usage in the layout (one-thing banner)
- `src/routes/dashboard/index.ts` lines 257-313: query handler uses raw `fetch()`, not HTMX
- 13 total HTMX attributes across 288 TypeScript source files

**Severity: P1** -- 47 KB library loaded globally for 3-page usage

---

### Attempt 4: Static Asset Serving

Static files are served by a Hono route handler that reads files from disk synchronously using `readFileSync`:

```typescript
app.get('/static/:file', (c) => {
  const content = readFileSync(filePath, 'utf-8');
  return c.body(content, 200, {
    'Content-Type': mimeTypes[ext] ?? 'text/plain',
    'Cache-Control': 'public, max-age=3600'
  });
});
```

Problems:

1. **Synchronous file read on every request.** `readFileSync` blocks the event loop. Under load, this serializes all static asset requests. On the single-threaded Node.js server, a slow disk read blocks all other requests.

2. **No gzip/brotli compression.** The response is sent as raw `utf-8` text. The Hono framework does not apply compression by default. The 64 KB CSS file is sent uncompressed. With gzip, it would be ~12-15 KB. On 3G at 400 Kbps, that is the difference between 1.3 seconds and 0.3 seconds.

3. **No ETag or Last-Modified headers.** The only cache header is `Cache-Control: public, max-age=3600`. There is no `ETag` and no `Last-Modified`, so after 1 hour the browser must re-download the full file -- it cannot do a conditional GET (`If-None-Match`/`If-Modified-Since`) for a 304 response.

4. **No immutable directive.** Even the 1-hour cache does not include `immutable`, so browsers may re-validate on navigation (Back/Forward).

5. **Service worker and manifest also use readFileSync.** Lines 201-213 of `index.ts` serve `manifest.json` and `sw.js` the same way.

**Evidence:**
- `src/index.ts` lines 182-198: static file handler
- `src/index.ts` line 194: `'Cache-Control': 'public, max-age=3600'`
- No `require('compression')` or `hono/compress` import anywhere in codebase

**Severity: P1** -- No compression doubles transfer time on every request

---

### Attempt 5: Full-Page Reload on Navigation

Every navigation in Foundry is a full-page reload. Clicking "Decisions" in the sidebar fetches a completely new HTML document. The browser must:

1. Close the current page's connections
2. DNS resolve (cached, ~0ms)
3. HTTP request to server (~400ms latency)
4. Server queries database, renders HTML, responds (~200-500ms)
5. Browser parses HTML, re-downloads CSS (from cache if <1hr), re-downloads HTMX from CDN (from cache if <1hr)
6. Browser re-renders the sidebar, header, command palette (identical content)
7. Finally renders the actual page content

On 3G, each page navigation takes 1.5-3 seconds minimum. The sidebar, header, and command palette (~8-10 KB of shared HTML) are re-sent every time.

HTMX was presumably included to enable partial-page updates, but it is barely used. The `hx-boost` attribute (which converts regular links into HTMX-powered partial navigations) is not used anywhere. This is the single biggest HTMX win for perceived performance, and it is not implemented.

**Severity: P1** -- Full-page reloads on every navigation on a 3G connection make the product feel broken

---

### Attempt 6: Third-Party Dependencies at Runtime

The only runtime external dependency is HTMX from unpkg.com. There are no analytics scripts, no font CDN loads (fonts are `font-src 'self'`), no image CDN loads. This is actually good.

However, the CSP header allows `script-src 'self' 'unsafe-inline' https://unpkg.com https://*.clerk.accounts.dev`. The `'unsafe-inline'` allows the 4-5 KB of inline JavaScript to execute without a nonce, which avoids a round-trip for an external script but is a security concern documented elsewhere.

Clerk's JavaScript SDK may also load dynamically for auth-related pages, adding another external dependency.

**Severity: P3** -- Acceptable for a single CDN dep; Clerk is auth-critical

---

### Attempt 7: Image and Asset Weight

Searching the codebase for `<img` tags and image references:
- No images are loaded on the dashboard page. The Signal display is pure HTML/CSS. Risk badges are text. Sparklines are inline SVGs. The mobile nav uses inline SVGs.
- The landing page may load images but public pages are less critical for this review.

This is good. Server-rendered HTML with inline SVGs is the right call for a data-heavy dashboard on slow connections.

**Severity: None** -- This is a positive finding

---

### Attempt 8: Database Query Waterfall

The dashboard route (`src/routes/dashboard/index.ts` line 141) runs 6 parallel queries using `Promise.all`:

```typescript
const [signal, stressors, history, dailyInsight, previousScore, latestBriefing] = await Promise.all([...]);
```

Good: parallel queries avoid waterfall. But `getLayoutContext()` (called before these) likely runs its own queries sequentially. And each individual "service" function may internally run multiple sequential queries.

For a user on 3G with 400ms latency to a Turso database, every sequential query adds latency. If `getLayoutContext` makes 3 sequential queries (layout badges, notifications, milestones), that is 1.2 seconds before the main queries even start.

**Severity: P2** -- Cannot fully assess without profiling, but sequential DB calls before `Promise.all` pattern is visible

---

### Attempt 9: What Happens When HTMX CDN is Down?

If `unpkg.com` is unreachable (common in regions with aggressive firewalls or DNS issues):

1. The `<script defer>` tag stalls for the browser's connection timeout (typically 30-60 seconds on 3G)
2. During this time, `defer` means the browser has already parsed and rendered the HTML -- so the page appears
3. But HTMX never loads, so the one-thing banner never loads (`hx-get` is inert without HTMX)
4. The onboarding chat is broken (`hx-post` is inert)
5. Priority API partials are broken

The page is still usable because 95% of functionality uses regular links and `fetch()`. But the one-thing banner area shows an empty `<div>` with `min-height:0` -- just a gap. No fallback content, no error indication.

**Severity: P2** -- HTMX failure is silent; banner disappears with no fallback

---

### Attempt 10: Service Worker

A service worker is registered at `/sw.js`. Without reading the sw.js file, a well-configured service worker could cache the CSS, HTMX, and other static assets, making subsequent visits nearly instant even on 3G. However:

- The sw.js is served with `Cache-Control: no-cache`, meaning the browser always re-validates it. Correct for service worker updates.
- But is the service worker actually caching anything useful? This would be the single most impactful optimization for 3G users -- pre-cache the CSS and HTMX library so repeat visits are instant.

**Severity: P2** -- Service worker exists but caching strategy unknown from server code alone

---

## Waterfall Estimate: Dashboard Load on 3G

| Step | Time (ms) | Running Total |
|------|-----------|--------------|
| DNS lookup (first visit) | 200 | 200 |
| TCP + TLS | 800 | 1,000 |
| HTML request + response (~25-40 KB) | 900 | 1,900 |
| CSS download (64 KB, no compression) | 1,300 | 3,200 |
| HTMX CDN: DNS + TLS + download | 1,400 | 4,600 |
| Parse + render | 200 | 4,800 |
| One-thing banner HTMX request | 800 | 5,600 |
| Query bar focus / interactive | 0 | 5,600 |

**Estimated first-load time-to-interactive on 3G: approximately 5.6 seconds.**

With compression alone (gzip CSS from 64 KB to ~14 KB): saves ~1,000ms.
With self-hosted HTMX: saves ~1,000ms (no extra DNS+TLS).
With content-hashed immutable caching: saves ~1,300ms on repeat visits.
With `hx-boost` for partial nav: saves ~2-3 seconds on every subsequent navigation.

Total achievable improvement: **3-5 seconds per page load**.

---

## Summary of Findings

| ID | Finding | Severity | Impact on 3G |
|----|---------|----------|-------------|
| RT-04-01 | HTMX loaded from external CDN (unpkg.com) -- extra DNS+TLS on every uncached visit | P1 | +1.4s per cold load |
| RT-04-02 | No gzip/brotli compression on static assets or HTML responses | P1 | +1.0s per page (64KB CSS uncompressed) |
| RT-04-03 | CSS not minified (64 KB, 1680 lines with comments) | P2 | +0.3s per cold load |
| RT-04-04 | Static assets use `max-age=3600` with no content hash -- re-download hourly | P1 | Re-download CSS every hour |
| RT-04-05 | No ETag or Last-Modified headers -- cannot do conditional GETs | P2 | Full re-download after cache expires |
| RT-04-06 | HTMX used on 3 of 59 dashboard pages -- 47 KB dead weight on 56 pages | P1 | Wasted 1.4s load time on most pages |
| RT-04-07 | No `hx-boost` -- every nav is a full-page reload re-sending 10 KB+ of shared chrome | P1 | +1.5-3s per navigation |
| RT-04-08 | `readFileSync` for static assets -- blocks event loop | P2 | Latency under load |
| RT-04-09 | Inline JS (4-5 KB) in HTML cannot be cached separately | P3 | Re-sent on every page load |
| RT-04-10 | HTMX CDN failure: silent degradation, no fallback for one-thing banner | P2 | Banner disappears silently |

**P1: 5 | P2: 4 | P3: 1**

---

## Verdict

Foundry on 3G is a 5+ second initial load and a 2+ second navigation between every page. The root causes are straightforward and fixable: self-host HTMX (or remove it from pages that don't use it), add gzip compression, use content-hashed immutable cache headers, and implement `hx-boost` or a similar partial navigation strategy.

The irony: HTMX was chosen specifically for its server-rendered, low-JS, fast-loading philosophy. But the implementation loads it from a slow CDN, uses it on 3 pages, and does full-page reloads everywhere else. The framework's biggest advantage (partial page updates via `hx-boost`) is completely unused. The product would literally be faster without HTMX until it is actually adopted across navigation.
