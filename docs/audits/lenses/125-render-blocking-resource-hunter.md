# Lens 125 — Render-Blocking Resource Hunter

**Auditor perspective:** Edge-case hunter / domain adversary — what blocks first paint?
**Distinct-value declaration:** Catalogues every resource that blocks initial render (CSS, JS, fonts, CDN dependencies) with byte sizes and network costs. Prior lens 05 noted the CSS and HTMX CDN; this lens traces the full critical rendering path including inline scripts, CDN failure modes, and cache-busting gaps.
**Tenancy-critical:** No. Render-blocking resources are per-user, not per-company. All companies share the same CSS, JS, and CDN dependencies.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P1 | 2 |
| P2 | 4 |

---

## Critical Rendering Path

For an authenticated dashboard page load, the browser must:

1. **Receive the HTML response** (server-rendered, ~30-80 KB)
2. **Download and parse `/static/styles.css`** (render-blocking)
3. **Download and parse HTMX from CDN** (deferred, non-blocking)
4. **Download and parse Clerk JS from CDN** (deferred, non-blocking on dashboard; blocking on auth pages)
5. **Execute inline `<script>` blocks** (command palette, notification bell, etc.)

---

## RB-01. `/static/styles.css` -- 62 KB uncompressed, no gzip, no cache-busting

**Severity: P1**
**Files:** `src/public/styles.css` (1680 lines, 62,353 bytes), `src/views/layout.ts:69`, `src/index.ts:182-198`

**Render-blocking:** Yes. `<link rel="stylesheet" href="/static/styles.css" />` in the `<head>` is synchronous and blocks rendering until the full CSS is downloaded and parsed.

**No compression:** No `compress()` middleware from `hono/compress` is configured. The server sends the raw 62 KB file. With gzip/brotli, this would be ~10-12 KB -- an 80% reduction.

**No cache-busting hash:** The filename is static (`styles.css`). `Cache-Control: public, max-age=3600` is set (1 hour), but after a deploy with CSS changes, returning users will see stale styles for up to 1 hour. There is no content hash in the filename (e.g., `styles.a1b2c3.css`) to force cache invalidation.

**Read from disk on every request:** `readFileSync` is called on every `/static/:file` request (twice -- once to probe the path, once to read content). There is no in-memory file cache.

**Evidence:**
- `src/index.ts:188-191`: Two `readFileSync` calls per request
- `src/views/layout.ts:69`: `<link rel="stylesheet" href="/static/styles.css" />`
- No `hono/compress` import anywhere in the codebase

**Impact:** On a 3G connection (~1.5 Mbps), 62 KB takes ~330ms to download. On fast connections, ~50ms. The lack of compression adds 200-300ms on slower connections.

---

## RB-02. Clerk JS loaded from CDN on auth pages -- blocking for login/signup

**Severity: P1**
**Files:** `src/routes/auth/clerk.ts:38, 80`

Auth pages load Clerk JS via dynamic import from jsdelivr CDN:

```javascript
const m = await import("https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/+esm");
```

This is an ESM dynamic import in a `<script>` block (not deferred). On the login and signup pages, the entire page content depends on Clerk loading successfully:
- If jsdelivr is slow: the page shows "Foundry" header and empty `<div id="sign-up">` for several seconds
- If jsdelivr is down: the `catch` handler shows an error message, but the user cannot authenticate at all
- If the user's network blocks jsdelivr (corporate firewalls): complete authentication failure

**Evidence:**
- `src/routes/auth/clerk.ts:38`: `await import("https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/+esm")`
- No local fallback for Clerk JS
- No `<link rel="modulepreload">` hint to start the download early

**Impact:** Authentication is completely dependent on a third-party CDN. This is a single point of failure for the entire product's login flow.

---

## RB-03. HTMX loaded from unpkg CDN with no integrity hash or local fallback

**Severity: P2**
**Files:** `src/views/layout.ts:71`

```html
<script src="https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js" defer></script>
```

- **Deferred:** Yes, `defer` attribute means it does not block rendering. Good.
- **No `integrity` attribute:** Supply chain risk. If unpkg is compromised, arbitrary JS executes in every user's browser.
- **No local fallback:** If unpkg is down, HTMX features degrade. The "One Thing" banner (`hx-get="/api/priority/one-thing"`) and onboarding chat will not load.
- **DNS + TLS overhead:** First page load requires DNS resolution and TLS handshake with `unpkg.com` -- typically 100-300ms.
- **Version pinned but not integrity-pinned:** `@1.9.12` pins the version but not the content hash.

---

## RB-04. Inline JavaScript in layout -- ~3 KB of command palette + notification logic

**Severity: P2**
**Files:** `src/views/layout.ts:110-395`

The layout template includes approximately 3 KB of inline `<script>` at the bottom of the page:

1. **Command palette** (~1.5 KB): Route array with 27+ entries, keyboard shortcut handler (`Cmd+K`), search/filter logic, and navigation
2. **Notification bell** (~500 bytes): Toggle dropdown, mark-as-read HTMX triggers
3. **Product switcher** (~300 bytes): Dropdown toggle logic
4. **Mobile bottom nav** (~200 bytes): Active state management
5. **Various event handlers** bound via `onclick` attributes throughout the layout

This inline JS is:
- Not minified
- Sent on every full page load (no HTMX partial rendering for layout)
- Not cacheable (embedded in HTML)
- Duplicated across every page response

**Impact:** ~3 KB of JS per page load, ~75 KB/day per active user (25 page views). Not a performance crisis but wasteful when it could be extracted to a cacheable `/static/app.js`.

---

## RB-05. No `<link rel="preconnect">` hints for CDN domains

**Severity: P2**
**Files:** `src/views/layout.ts:62-72`

The `<head>` section does not include preconnect hints for the two CDN domains used:
- `unpkg.com` (HTMX)
- `cdn.jsdelivr.net` (Clerk, on auth pages)

Adding `<link rel="preconnect" href="https://unpkg.com">` would eliminate the DNS+TLS latency from the critical path, saving 100-300ms on first page load.

---

## RB-06. No font loading strategy -- system fonts only (positive finding)

**Severity: N/A (positive)**
**Files:** `src/public/styles.css`

The CSS uses system font stacks (`font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", ...`). No web fonts are loaded. This is correct -- no render-blocking font requests.

---

## Full Resource Waterfall (Dashboard Page, Cold Cache)

| Step | Resource | Size | Blocking? | Time |
|------|----------|------|-----------|------|
| 1 | HTML response | ~50 KB | Yes (waiting for server) | 400-4000ms (see lens 122) |
| 2 | `/static/styles.css` | 62 KB | Yes (render-blocking) | 50-330ms |
| 3 | `unpkg.com/htmx.org@1.9.12` | 14 KB gzipped | No (deferred) | 150-500ms (DNS+TLS+download) |
| 4 | `/manifest.json` | ~500 bytes | No (async) | 10-50ms |
| 5 | Inline JS execution | ~3 KB | Parser-blocking (inline) | 5-15ms |
| **First Contentful Paint** | | | | **450-4330ms** |

With warm browser cache for CSS and HTMX: **400-4000ms** (dominated by server response time).

---

## Recommendations

1. **Add response compression** -- `app.use('*', compress())` from `hono/compress`. Immediate 70-80% size reduction on HTML and CSS. Biggest bang-for-buck change.
2. **Self-host HTMX** -- Copy `htmx.min.js` to `/static/htmx.min.js` with content hash in filename. Add `integrity` attribute. Eliminates CDN dependency and DNS/TLS overhead.
3. **Add cache-busting to CSS** -- Generate a content hash at build time, serve as `/static/styles.{hash}.css`. Increase `max-age` to 1 year.
4. **Cache static files in memory** -- Read files once at startup, serve from a `Map`. Eliminates `readFileSync` on every request.
5. **Self-host Clerk JS** -- Bundle Clerk JS locally or use `<link rel="modulepreload">` to start the download early. Add a local fallback that shows a "loading authentication" message.
6. **Extract inline JS to `/static/app.js`** -- Make it cacheable. Include content hash for cache-busting.
7. **Add preconnect hints** -- `<link rel="preconnect" href="https://unpkg.com">` (until HTMX is self-hosted).
