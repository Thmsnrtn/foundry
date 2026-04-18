# Lens 069 — HTMX Usage Patterns

**Distinct value:** Deep analysis of the 13 HTMX attributes across 3 files — are they used correctly? What patterns are missing? Where could HTMX replace full page reloads, inline scripts, and manual fetch() calls? Maps the gap between "HTMX is in the stack" and "HTMX is the interaction layer."

**Tenancy-critical:** No. HTMX patterns are UI-level, not tenancy-level. However, HTMX partial updates become important at fleet scale where full page reloads re-render all product data.

## Executive Summary

Foundry loads HTMX 1.9.12 on every page but uses it on exactly 3 pages with 13 `hx-*` attributes total. The onboarding chat is the only page that uses HTMX as intended (form submission, partial swap, OOB update). The priority banner uses HTMX for lazy loading on page load. Everything else — the query bar, decision resolution, outcome logging, reflection, notification mark-all-read, command palette, tour steps, and agent provisioning — uses either inline `<script>` blocks with `fetch()`, `onclick` handlers, or full-page form POST+redirect. There are at least 12 interaction patterns that should be HTMX but are not. The cost is: inline JavaScript that is untestable, loading states that must be manually managed, and full page reloads that reset scroll position and discard UI state.

## Findings

### HTMX-01 Current Usage Map (13 Attributes, 3 Files)
- **Severity:** (Informational)
- **Description:** Complete inventory of HTMX usage:
  - **`src/views/layout.ts:101-103`** — One-thing banner: `hx-get="/api/priority/one-thing"`, `hx-trigger="load"`, `hx-swap="innerHTML"` (3 attributes)
  - **`src/routes/api/priority.ts:77-79,130-132`** — Priority dismiss buttons: `hx-post`, `hx-target`, `hx-swap` (6 attributes, 2 buttons)
  - **`src/routes/dashboard/onboarding-chat.ts:149-152,242`** — Chat form: `hx-post`, `hx-target`, `hx-swap`, `hx-on::after-request`, `hx-swap-oob` (4 attributes + 1 OOB)
- **Evidence:** Grep for `hx-` across src/ returns exactly these 13 occurrences.
- **Remediation:** N/A — this is the baseline inventory for conversion planning.
- **Target Phase:** N/A

### HTMX-02 Decision Chamber Should Be HTMX — Currently 3 fetch() Blocks
- **Severity:** P1
- **Description:** The Decision Chamber (`/decisions/:id`) has three interactive behaviors all implemented as inline `window.function = async function()` handlers using `fetch()`: (1) reflection/clarity request, (2) decision resolution, and (3) outcome logging. Each manually manages loading text, error display, and success redirect via `setTimeout(window.location.href = ...)`. All three should be HTMX forms with `hx-post`, `hx-target`, and `hx-indicator`.
- **Evidence:** `src/routes/dashboard/decisions.ts:186-264` — three `window.*` functions: `getClarity()`, `logOutcome()`, `resolveDecision()`. Each has manual try/catch, manual DOM updates, manual redirects.
- **Remediation:** Convert each to an HTMX form. Example: `<form hx-post="/api/decisions/${id}/reflect" hx-target="#reflect-response" hx-swap="innerHTML" hx-indicator="#reflect-spinner">`. The server returns the HTML fragment directly. Loading state is automatic via `htmx-request` class.
- **Target Phase:** 2

### HTMX-03 Query Bar Should Be HTMX — Currently Inline Script
- **Severity:** P2
- **Description:** The Signal dashboard query bar (`"Ask anything about your business"`) uses a 30-line inline `<script>` with a `handleQuery()` function that calls `fetch('/api/ask', ...)`, manually toggles CSS classes for loading state, and builds HTML via string concatenation. HTMX can handle this declaratively: `<form hx-post="/api/ask" hx-target="#query-response" hx-swap="innerHTML" hx-indicator=".loading">`.
- **Evidence:** `src/routes/dashboard/index.ts:257-313` — 57 lines of inline JavaScript for query handling.
- **Remediation:** Convert the query form to HTMX. The `/api/ask` endpoint should return an HTML fragment (it currently returns JSON). Add an HTML-returning variant or use `hx-ext="json-enc"` with a server fragment endpoint.
- **Target Phase:** 3

### HTMX-04 Notification Mark-All-Read Should Be HTMX
- **Severity:** P2
- **Description:** The notification dropdown has a "Mark all as read" button that is a full `<form method="POST" action="/api/notifications/read-all">`. Submitting this form does a full page reload just to clear the notification badge. This should be `hx-post="/api/notifications/read-all" hx-swap="none"` (or swap the bell badge to remove the count).
- **Evidence:** `src/views/layout.ts:207-209` — full POST form for a side-effect-only action.
- **Remediation:** Change to `<button hx-post="/api/notifications/read-all" hx-target=".notif-count" hx-swap="outerHTML">Mark all as read</button>`. The server returns empty HTML to remove the badge.
- **Target Phase:** 2

### HTMX-05 Agent Provisioning Should Use HTMX With Progress
- **Severity:** P2
- **Description:** The agent provisioning button on the empty roster page is a full `<form method="POST" action="/agents/provision">`. Provisioning 12 agents takes noticeable time. The user sees a blank loading state until the server redirects. HTMX with `hx-indicator` would show a loading state immediately and could provide progressive updates.
- **Evidence:** `src/routes/dashboard/agents.ts:150` — `<form method="POST" action="/agents/provision">`.
- **Remediation:** Use `<button hx-post="/agents/provision" hx-target="#roster-content" hx-swap="innerHTML" hx-indicator="#provision-spinner">` with a spinner element. The server returns the rendered roster on completion.
- **Target Phase:** 3

### HTMX-06 Tour Steps Should Use HTMX for Step Advancement
- **Severity:** P3
- **Description:** The tour overlay system (visible as a step-by-step guide) uses inline JavaScript for step advancement. Each step transition could be an HTMX call that fetches the next step's HTML and swaps it in, enabling the server to track tour progress and adapt content dynamically.
- **Evidence:** Tour step rendering in `src/views/components.ts` — step indicators with form POST actions.
- **Remediation:** Convert tour step advancement to `hx-post="/api/tour/next" hx-target="#tour-overlay" hx-swap="innerHTML"`. This also enables the server to conditionally skip steps based on product state.
- **Target Phase:** 4

### HTMX-07 Onboarding Chat Is the Model Implementation
- **Severity:** (Positive Finding)
- **Description:** The onboarding chat at `/setup` demonstrates correct HTMX usage: form submission via `hx-post`, response appended via `hx-swap="beforeend"`, progress bar updated via `hx-swap-oob="true"`, and form reset via `hx-on::after-request`. This is the pattern every interactive form in Foundry should follow.
- **Evidence:** `src/routes/dashboard/onboarding-chat.ts:149-153` — declarative HTMX form. `src/routes/dashboard/onboarding-chat.ts:240-242` — OOB swap for secondary UI update.
- **Remediation:** N/A — use this as the reference implementation for HTMX conversions.
- **Target Phase:** N/A

### HTMX-08 Missing HTMX Error Handling Configuration
- **Severity:** P2
- **Description:** There is no HTMX error event handling configured. When an HTMX request fails (network error, 500 response), HTMX silently fails by default. The application should configure `htmx.on('htmx:responseError', ...)` to show user-friendly error messages instead of silent failure.
- **Evidence:** No `htmx:responseError`, `htmx:sendError`, or `htmx:error` handlers in the codebase.
- **Remediation:** Add a global HTMX error handler in the layout: `document.body.addEventListener('htmx:responseError', function(e) { /* show toast */ })`. Also configure `htmx:beforeSwap` to handle non-200 responses gracefully.
- **Target Phase:** 2

## Embarrassment Test
1. Foundry's stack description says "HTMX" but a developer looking at the codebase finds 13 attributes across 3 files and 12 inline `<script>` blocks — the opposite of what HTMX is supposed to replace.
2. The decision chamber — the most important user interaction in the product — is built with manual `fetch()` calls and `setTimeout(window.location.reload)` while HTMX sits loaded and unused on the page.

## Recommendations (Priority Order)
1. Convert Decision Chamber to HTMX (P1, Phase 2, highest-value interaction)
2. Convert notification mark-all-read to HTMX (P2, Phase 2, quick win)
3. Add global HTMX error handling (P2, Phase 2, prevents silent failures)
4. Convert query bar to HTMX (P2, Phase 3)
5. Convert agent provisioning to HTMX with progress indicator (P2, Phase 3)
6. Use onboarding chat as reference implementation for all conversions
