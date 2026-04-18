# Lens 072 — Route Transition / Loading State

**Distinct value:** Evaluates the user experience during page transitions in a full-page-reload server-rendered app. Are there loading indicators? Skeleton screens? Visual continuity between pages? Or does the user stare at a blank white screen while the server computes?

**Tenancy-critical:** Yes. Fleet-scale pages (portfolio, digest) have longer server render times, making the loading gap more noticeable for multi-company founders.

## Executive Summary

Foundry is a full-page-reload application with no route transition indicators. When a user clicks a sidebar link, the browser's native loading indicator (tiny progress bar or spinner in the tab) is the only visual feedback. There are no skeleton screens on any page. There are no NProgress-style top bars. There are no HTMX-based partial page transitions. The `styles.css` file defines skeleton CSS classes (`.skeleton`, `.skeleton-line`, `.skeleton-heading`, `.skeleton-card`) but they are never used in any template. The only loading state in the application is the word "Thinking" shown while the AI query bar processes, and `htmx-indicator` CSS defined only in the onboarding chat.

## Findings

### RTL-01 No Loading Indicator on Page Navigation
- **Severity:** P2
- **Description:** When navigating between dashboard pages (e.g., Signal to Decisions to Agents), the user experiences a full page reload with no visual feedback beyond the browser's native tab spinner. For pages that require multiple database queries (dashboard: 6 queries, decisions: 3 queries, agents: 2 queries), the gap between click and render can be 200-500ms minimum, longer with cold database connections.
- **Evidence:** No `NProgress`, no `hx-indicator` on navigation links, no transition animations, no loading bar in any layout template. Every navigation is an `<a href="...">` that triggers a full page load.
- **Remediation:** Option A (minimal): Add NProgress or a simple CSS-animated top bar that starts on `beforeunload` and completes on `DOMContentLoaded`. Option B (HTMX): Use `hx-boost="true"` on the `<body>` to make all links HTMX-powered with a loading indicator — this is a one-attribute change that dramatically improves perceived performance.
- **Target Phase:** 2

### RTL-02 Skeleton CSS Classes Exist But Are Never Used
- **Severity:** P2
- **Description:** The stylesheet defines `.skeleton`, `.skeleton-line`, `.skeleton-heading`, and `.skeleton-card` classes with a shimmer animation. These are never referenced in any HTML template. This represents abandoned implementation intent — someone planned to add skeletons but never did.
- **Evidence:** `src/public/styles.css:1579-1604` — skeleton classes with `@keyframes skeleton-shimmer`. Grep for `skeleton` in src/ HTML returns only the CSS definitions.
- **Remediation:** Use the skeleton classes for HTMX lazy-loaded regions. Example: the one-thing banner should show a `.skeleton-line` while loading. The dashboard signal display should show a `.skeleton-heading` during the initial render if using HTMX for partial updates.
- **Target Phase:** 3

### RTL-03 AI Query Bar Shows "Thinking" — Only Loading State
- **Severity:** (Positive Finding)
- **Description:** The query bar on the Signal dashboard shows the text "Thinking" with a loading CSS class while waiting for the AI response. This is the only proper loading state in the application, and it works well for the context.
- **Evidence:** `src/routes/dashboard/index.ts:271-272` — `responseEl.className = 'query-response loading'; responseEl.textContent = 'Thinking';`.
- **Remediation:** N/A — this pattern is correct. Extend it to other async operations (decision reflection, outcome logging).
- **Target Phase:** N/A

### RTL-04 Full Page Reloads After Mutations Lose Scroll Position
- **Severity:** P2
- **Description:** Several mutation flows use `setTimeout(function() { window.location.href = ... }, 1000)` or `c.redirect(...)` after form submission. This causes a full page reload that resets scroll position and discards any transient UI state (expanded details, command palette state). Examples: decision resolution redirects to `/decisions`, outcome logging reloads the page.
- **Evidence:** `src/routes/dashboard/decisions.ts:229` — `setTimeout(function() { window.location.reload(); }, 1500)`. `src/routes/dashboard/decisions.ts:259` — `setTimeout(function() { window.location.href = '/decisions'; }, 1000)`.
- **Remediation:** Use HTMX to swap the relevant section instead of reloading. Decision resolution should swap the status badge and form section. Outcome logging should swap the outcome form with the recorded outcome display.
- **Target Phase:** 3

### RTL-05 hx-boost Would Transform Navigation With One Attribute
- **Severity:** P2
- **Description:** HTMX's `hx-boost="true"` attribute, when placed on `<body>`, converts all same-origin `<a>` links and `<form>` submissions to HTMX requests. The response body is swapped into the page, maintaining the browser history and adding a loading indicator — all without changing any route code. This is a low-effort, high-impact improvement for perceived performance.
- **Evidence:** HTMX is already loaded on every page (`src/views/layout.ts:71`). Adding `hx-boost="true"` to the `<body>` tag requires zero route changes.
- **Remediation:** Add `hx-boost="true"` to the `<body>` element in `layout.ts`. Add an `hx-indicator` element (top progress bar) to the layout. Test that all pages work with boosted navigation (check for inline scripts that assume fresh page load).
- **Target Phase:** 2

### RTL-06 Sidebar Active State Flickers on Navigation
- **Severity:** P3
- **Description:** Because navigation is full-page reload, the sidebar re-renders entirely on each page. The active state (`.active` class) is set server-side, so there is no flicker of wrong state, but the entire sidebar DOM is destroyed and rebuilt. With HTMX boosted navigation, the sidebar would persist and only the main content would swap.
- **Evidence:** `src/views/layout.ts:291-320` — sidebar rendered from scratch on every request.
- **Remediation:** With `hx-boost`, the sidebar is re-rendered as part of the body swap. To preserve it, use `hx-swap="innerHTML" hx-target="main"` on navigation links to swap only the main content area.
- **Target Phase:** 3

## Embarrassment Test
1. A founder navigating between dashboard pages sees the browser tab spinner as the only loading feedback — the page goes blank briefly on every click.
2. A stylesheet defines skeleton shimmer animations that are never used, suggesting abandoned UX work.

## Recommendations (Priority Order)
1. Add `hx-boost="true"` to body for instant-feeling navigation (P2, Phase 2)
2. Add a top-of-page loading bar (NProgress-style) for route transitions (P2, Phase 2)
3. Use existing skeleton CSS classes for HTMX lazy-loaded regions (P2, Phase 3)
4. Convert post-mutation redirects to HTMX swaps (P2, Phase 3)
5. Preserve sidebar across page transitions with targeted HTMX swaps (P3, Phase 3)
