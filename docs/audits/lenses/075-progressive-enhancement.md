# Lens 075 — Progressive Enhancement

**Distinct value:** Evaluates whether Foundry works with JavaScript disabled. HTMX requires JS. Inline scripts require JS. What is the degraded experience? Are critical paths (onboarding, decisions, settings) accessible without JS?

**Tenancy-critical:** No. Progressive enhancement is a per-user concern. But if a founder's corporate network blocks inline scripts or has aggressive content filtering, they may encounter the no-JS experience.

## Executive Summary

Foundry's core navigation and most form submissions work without JavaScript because they use standard `<a href>` links and `<form method="POST">` elements. This is a natural benefit of server-rendered HTML with traditional form handling. However, five critical interactions require JavaScript and will silently fail without it: (1) the AI query bar, (2) decision resolution in the Decision Chamber, (3) the command palette, (4) outcome logging, and (5) the onboarding chat (HTMX-powered). The HTMX lazy-loaded one-thing banner will show nothing. The Signal Anatomy dialog will not open (it uses `showModal()` triggered by `onclick`). Overall, the application is functional-but-degraded without JS — you can navigate, view dashboards, and submit traditional forms, but cannot interact with AI features or resolve decisions.

## Findings

### PE-01 Core Navigation Works Without JS
- **Severity:** (Positive Finding)
- **Description:** All sidebar links are standard `<a href="...">` elements. All page transitions are full-page loads. The header, sidebar, and mobile bottom nav all use standard HTML links. A founder can navigate the entire application structure without JavaScript.
- **Evidence:** `src/views/layout.ts:291-320` — sidebar with `<ul>` and `<a href>` links. `src/views/layout.ts:340-346` — mobile bottom nav with `<a href>` links. No client-side router.
- **Remediation:** N/A — this is inherently correct for server-rendered HTML.
- **Target Phase:** N/A

### PE-02 Traditional Form Submissions Work Without JS
- **Severity:** (Positive Finding)
- **Description:** Most forms use `<form method="POST" action="...">` with standard submit buttons. Product switching, checkout, competitor adding, onboarding step advancement, provisioning, team invites, and settings forms all work without JavaScript.
- **Evidence:** `src/views/layout.ts:178-185` — product switcher form. `src/routes/dashboard/onboarding.ts:82-100` — no-code onboarding form. `src/routes/dashboard/settings.ts:82-91` — checkout forms.
- **Remediation:** N/A — maintain this pattern for all new forms.
- **Target Phase:** N/A

### PE-03 Decision Resolution Fails Without JS
- **Severity:** P1
- **Description:** The Decision Chamber resolution form uses `onclick="resolveDecision()"` on a button instead of a standard `<form method="POST">`. Without JavaScript, clicking "Resolve decision" does nothing. This is the most important user interaction in the product — the founder's primary decision-making action — and it requires JavaScript.
- **Evidence:** `src/routes/dashboard/decisions.ts:154` — `<button class="btn btn-primary" onclick="resolveDecision()">Resolve decision</button>`. No `<form>` wrapper with a `method="POST"` fallback.
- **Remediation:** Wrap the resolution UI in a `<form method="POST" action="/decisions/${id}/resolve">` with hidden inputs for `chosen_option` and `resolution_reasoning`. The JS can intercept (`e.preventDefault()`) for HTMX-style submission, but the form works without JS as a standard POST.
- **Target Phase:** 2

### PE-04 AI Query Bar Has No Fallback
- **Severity:** P2
- **Description:** The query bar uses `onsubmit="handleQuery(event)"` which calls `e.preventDefault()` and then `fetch()`. Without JS, the form submits to nowhere (no `action` attribute). The query bar is non-functional without JavaScript. This is acceptable for an AI-powered feature, but there should be a `<noscript>` hint.
- **Evidence:** `src/routes/dashboard/index.ts:218-219` — `<form class="query-form" id="query-form" onsubmit="handleQuery(event)">`. No `action` attribute, no `method`.
- **Remediation:** Add an `action="/api/ask"` and `method="POST"` to the form so it at least submits to the server without JS. The server can render a result page. Or add `<noscript><p>JavaScript is required for the AI assistant.</p></noscript>`.
- **Target Phase:** 3

### PE-05 Onboarding Chat Depends on HTMX
- **Severity:** P2
- **Description:** The conversational onboarding chat uses HTMX for message submission (`hx-post="/setup/message"`). Without HTMX (which requires JS), the form falls back to a standard POST — but the response is an HTML fragment, not a full page. The user would see a partial HTML response in a new page load. The chat has a "Skip" button that is a standard form, providing an escape hatch.
- **Evidence:** `src/routes/dashboard/onboarding-chat.ts:149-153` — HTMX form. `src/routes/dashboard/onboarding-chat.ts:127` — Skip button is a standard POST form.
- **Remediation:** On the `POST /setup/message` handler, detect if the request is an HTMX request (check `HX-Request` header). If not HTMX, return a full page re-render of the chat with the new messages instead of a fragment. This provides graceful degradation.
- **Target Phase:** 3

### PE-06 Command Palette Requires JS — Acceptable
- **Severity:** P3
- **Description:** The command palette (Cmd+K) is entirely JavaScript-driven. Without JS, it does not exist. This is acceptable because every command palette target is also accessible via sidebar navigation. The command palette is an efficiency enhancement, not a primary navigation path.
- **Evidence:** `src/views/layout.ts:110-159` — command palette HTML and JS.
- **Remediation:** N/A — the sidebar provides equivalent navigation without JS.
- **Target Phase:** N/A

### PE-07 Signal Anatomy Dialog Requires JS
- **Severity:** P3
- **Description:** The Signal Anatomy dialog uses `<dialog>` with `showModal()` triggered by an `onclick` handler. Without JS, clicking the signal number does nothing. The signal score is still visible; only the breakdown explanation is inaccessible.
- **Evidence:** `src/routes/dashboard/index.ts:171-175` — `onclick="document.getElementById('anatomy-dialog').showModal()"`.
- **Remediation:** Consider making the anatomy information available via a link to a dedicated page (`/dashboard/anatomy`) as a no-JS fallback. Low priority since the score itself is always visible.
- **Target Phase:** 4

### PE-08 No `<noscript>` Element Anywhere
- **Severity:** P2
- **Description:** There is no `<noscript>` element in any template. Users with JavaScript disabled receive no indication that some features are unavailable. A simple `<noscript>` banner in the layout would set expectations.
- **Evidence:** No `<noscript>` tag found in any file in `src/`.
- **Remediation:** Add `<noscript><div class="noscript-banner">Some features require JavaScript. Navigation and forms work without it.</div></noscript>` to the layout.
- **Target Phase:** 3

## Embarrassment Test
1. A founder with a browser extension that blocks inline scripts cannot resolve decisions — the most important action in the product fails silently.
2. A corporate security policy strips `onclick` handlers, and the decision "Resolve" button becomes a dead button with no visual indication.

## Recommendations (Priority Order)
1. Make decision resolution work as a standard form POST (P1, Phase 2)
2. Add `<noscript>` banner to layout (P2, Phase 3)
3. Add form action/method to query bar as fallback (P2, Phase 3)
4. Detect non-HTMX requests in chat handler and return full pages (P2, Phase 3)
5. Consider dedicated page fallback for Signal Anatomy (P3, Phase 4)
