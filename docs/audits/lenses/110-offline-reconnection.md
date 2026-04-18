# Lens 110 — Offline / Reconnection Behavior

**Auditor Persona:** Edge-Case Hunter / Adversary (Tier 3)
**Date:** 2026-04-16
**Scope:** HTMX with server rendering, service worker, PWA offline, reconnection after network loss

---

## Executive Summary

Foundry has a functional service worker and PWA manifest, providing basic offline support. The service worker caches the CSS stylesheet and manifest as shell assets, serves static assets cache-first, and provides a minimal offline page for navigation requests. This is meaningfully better than no offline handling. However, HTMX partial updates (which drive much of the dashboard interaction) will silently fail when offline, showing no feedback to the user. The service worker does not cache any page HTML, so returning to a previously-viewed page while offline shows the generic offline message.

---

## Findings

### OFF-01 — HTMX requests fail silently when offline (Severity: Medium)

**Description:** Dashboard interactions use HTMX attributes (`hx-get`, `hx-post`, `hx-trigger`) for partial page updates. When the server is unreachable, HTMX gets a network error but there is no global error handler configured. The user sees no feedback — the UI simply does not update.

**Evidence:**
- `src/views/layout.ts:101-104`: `hx-get="/api/priority/one-thing" hx-trigger="load" hx-swap="innerHTML"` — if this fails, the div stays empty with `min-height:0`.
- No `htmx:sendError`, `htmx:responseError`, or `htmx:afterOnLoad` event handlers configured globally.
- No `hx-indicator` or offline detection JavaScript.

**Remediation:** Add a global HTMX event handler: `document.body.addEventListener('htmx:sendError', function() { showOfflineBanner(); })`. Add an `hx-indicator` with a connection-lost message.

---

### OFF-02 — Service worker only caches shell assets (Severity: Low)

**Description:** The service worker caches exactly 2 files: `/static/styles.css` and `/manifest.json`. No page HTML, no dashboard content, no API responses are cached. The offline fallback is a minimal HTML page generated inline in the fetch handler.

**Evidence:**
- `src/public/sw.js:9-11`: `SHELL_ASSETS = ['/static/styles.css', '/manifest.json']`.
- `src/public/sw.js:75-85`: Navigation requests fall back to a hardcoded inline HTML response when offline.

**Remediation:** Consider caching the last-visited dashboard page for offline access. Alternatively, pre-cache a proper offline page as a static asset rather than generating it inline in the service worker.

---

### OFF-03 — No "reconnected" behavior (Severity: Low)

**Description:** When connectivity resumes after an offline period, there is no automatic refresh of stale HTMX content, no "you're back online" notification, and no queued action replay.

**Evidence:**
- No `navigator.onLine` or `online`/`offline` event listeners in any client-side JavaScript.
- No queuing mechanism for failed form submissions.
- The service worker does not implement background sync.

**Remediation:** Add `window.addEventListener('online', () => { location.reload(); })` as a minimal reconnection handler. Consider adding `htmx.trigger(document.body, 'reconnected')` to refresh stale partial content.

---

### OFF-04 — Push notification permission not requested (Severity: Low)

**Description:** The service worker includes push notification handling (`push` and `notificationclick` event listeners), but no client-side code requests notification permission from the user. The push handlers exist but are never triggered.

**Evidence:**
- `src/public/sw.js:91-125`: Push notification handlers implemented.
- No `Notification.requestPermission()` call in any client-side JavaScript.
- No push subscription registration (no call to `registration.pushManager.subscribe()`).

**Remediation:** Add a notification opt-in flow in settings or as a post-onboarding step. Request permission only after the user has engaged with the product.

---

## Embarrassment Test

A founder is reviewing their Signal dashboard on a train. The train enters a tunnel. Every HTMX update silently fails. They click "Approve" on a pending decision — the form submission hangs with no feedback. They click again. When connectivity resumes, two approval requests hit the server (no idempotency). The founder thinks the app is buggy. **Likelihood: Medium for mobile users.**

## Pride Test

The service worker implementation is clean and follows best practices: shell caching on install, cache-first for statics, network-first for navigation, proper activation with old cache cleanup. The offline page is minimal but functional.

## Distinct-Value Declaration

This lens identifies the specific gap between Foundry's server-rendered HTMX architecture and offline resilience: the service worker handles navigation offline correctly, but HTMX partial updates (the primary interaction model) have zero offline handling.

## Tenancy-Critical Flag

**No.** Offline/reconnection behavior is a per-user experience issue with no cross-tenant implications.
