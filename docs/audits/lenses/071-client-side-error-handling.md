# Lens 071 — Client-Side Error Handling

**Distinct value:** Analyzes what happens when JavaScript errors occur in the browser. With server-rendered HTML + HTMX, client-side JS is minimal but still present — inline scripts, fetch() calls, HTMX requests. What error boundaries exist? How does the user experience a failed request?

**Tenancy-critical:** No. Client-side error handling is per-session, not per-tenant.

## Executive Summary

Foundry has approximately 12 inline `<script>` blocks across 9 route files. These scripts use `try/catch` inconsistently — some catch errors and show "Something went wrong", others silently fail, and none report errors to any monitoring service. HTMX has no configured error event handlers, meaning HTMX request failures are silent. The command palette has no error handling for its DOM manipulation. There is no global `window.onerror` or `window.onunhandledrejection` handler. The result is that client-side failures are invisible to both the user and the development team.

## Findings

### CSE-01 No Global Error Handler
- **Severity:** P1
- **Description:** There is no `window.onerror` or `window.addEventListener('unhandledrejection', ...)` handler. If any inline script throws an error (DOM element not found, null reference, network failure), it fails silently. The user sees no feedback, and the error is not logged anywhere. For a product handling business-critical decisions, silent failures are unacceptable.
- **Evidence:** No `onerror`, `unhandledrejection`, or error reporting code found in any layout or script block.
- **Remediation:** Add a global error handler in the layout that: (1) logs to `console.error` for dev, (2) shows a subtle toast for the user ("Something went wrong. Refresh to try again."), and (3) in production, POSTs to `/api/client-errors` for server-side logging.
- **Target Phase:** 2

### CSE-02 HTMX Failures Are Silent
- **Severity:** P1
- **Description:** When an HTMX request fails (network error, 500 response, timeout), HTMX fires `htmx:responseError` or `htmx:sendError` events, but Foundry has no handlers for these. The user sees no indication that the request failed. The one-thing banner lazy load, the priority dismiss, and the onboarding chat message submit all fail silently.
- **Evidence:** No `htmx:responseError`, `htmx:sendError`, `htmx:timeout`, or `htmx:swapError` event listeners in the codebase.
- **Remediation:** Add global HTMX error handlers in the layout: `document.body.addEventListener('htmx:responseError', ...)` that shows a toast. Configure `htmx.config.timeout` to prevent indefinite hangs.
- **Target Phase:** 2

### CSE-03 fetch() Error Handling Is Inconsistent
- **Severity:** P2
- **Description:** The 5 `fetch()` calls in inline scripts handle errors differently:
  - Decision resolve: catches error, shows "Something went wrong." in a div
  - Decision reflect: catches error, re-enables the button
  - Decision outcome: catches error, shows "Something went wrong." in a div
  - Dashboard query: catches error, shows "Something went wrong. Try again."
  - None of them handle specific HTTP status codes (401, 403, 429, 500 all show the same message)
- **Evidence:** `src/routes/dashboard/decisions.ts:207-209` (reflect: re-enables button only), `src/routes/dashboard/decisions.ts:261` (resolve: generic error), `src/routes/dashboard/index.ts:299-301` (query: generic error).
- **Remediation:** Create a shared error handling pattern: check `res.status`, show specific messages for 401 ("Session expired, please log in"), 429 ("Too many requests, wait a moment"), 500 ("Server error, try again"). Extract into a shared `handleFetchError(res, displayEl)` utility.
- **Target Phase:** 3

### CSE-04 Command Palette Has No Error Handling
- **Severity:** P3
- **Description:** The command palette's 5 JavaScript functions (`openCmdPalette`, `closeCmdPalette`, `filterCmdPalette`, `renderCmdResults`, `handleCmdKey`) have zero error handling. If `document.getElementById('cmd-palette')` returns null (DOM not ready, element removed), the functions throw uncaught TypeErrors. This is unlikely but represents fragile code.
- **Evidence:** `src/views/layout.ts:154-158` — direct `.style.display` access on `getElementById()` result with no null check.
- **Remediation:** Add null guards: `const el = document.getElementById('cmd-palette'); if (!el) return;`. This is defensive programming for inline scripts that depend on DOM state.
- **Target Phase:** 4

### CSE-05 Service Worker Registration Silently Catches Errors
- **Severity:** P3
- **Description:** The service worker registration at the bottom of the layout catches and discards all errors: `navigator.serviceWorker.register('/sw.js').catch(function() {})`. If the service worker fails to register (e.g., sw.js has a syntax error, or the scope is wrong), the failure is completely invisible.
- **Evidence:** `src/views/layout.ts:163` — `.catch(function() {})` — empty catch.
- **Remediation:** At minimum, log the error: `.catch(function(e) { console.warn('SW registration failed:', e); })`. In production, consider reporting to the error endpoint.
- **Target Phase:** 4

### CSE-06 No Loading/Error State for Lazy-Loaded One-Thing Banner
- **Severity:** P2
- **Description:** The one-thing banner uses `hx-get="/api/priority/one-thing" hx-trigger="load"` to lazy-load content. If the request fails or is slow, the user sees an empty `div` with `min-height:0`. There is no loading indicator, no error fallback, and no retry mechanism.
- **Evidence:** `src/views/layout.ts:100-104` — `<div id="one-thing-banner" hx-get="..." hx-trigger="load" ... style="min-height:0"></div>`.
- **Remediation:** Add `hx-indicator` to show a loading skeleton while the request is in flight. Configure a fallback via `htmx:responseError` to show a non-intrusive "Unable to load" message or retry after 5 seconds.
- **Target Phase:** 3

## Embarrassment Test
1. The AI query bar ("Ask anything about your business") fails silently if the API call to Anthropic times out — the user sees "Thinking" forever with no timeout or error recovery.
2. An HTMX-powered feature fails to load, and the user sees an empty region with no indication that something should be there.

## Recommendations (Priority Order)
1. Add global window.onerror and unhandledrejection handler (P1, Phase 2)
2. Add global HTMX error event handlers (P1, Phase 2)
3. Standardize fetch() error handling with status-specific messages (P2, Phase 3)
4. Add loading indicator and error fallback to HTMX lazy loads (P2, Phase 3)
5. Add null guards to command palette DOM operations (P3, Phase 4)
