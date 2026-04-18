# Lens 085 — Loading Skeleton Design Critic

**Distinct value:** Evaluates whether loading skeletons exist, match the content shape they replace, and provide a genuine improvement over blank loading states. Specific to server-rendered apps where skeletons are relevant for HTMX lazy-loaded regions and slow-rendering pages.

**Tenancy-critical:** Yes. Fleet-scale pages have longer load times, making the absence of skeletons more noticeable.

## Executive Summary

Foundry defines skeleton CSS classes in the stylesheet but never uses them anywhere in the application. There are zero skeleton loading states rendered in any template. The only loading indicator in the entire application is the text "Thinking" shown during the AI query bar processing. The HTMX lazy-loaded one-thing banner starts as an empty `<div>` with `min-height:0`. The onboarding chat has an `.htmx-indicator` CSS class that controls opacity but it is displayed as `...` text, not a skeleton. The CSS defines four skeleton classes (`.skeleton`, `.skeleton-line`, `.skeleton-heading`, `.skeleton-card`) with a shimmer animation — someone planned to implement skeletons but never completed the work.

## Findings

### LSD-01 Skeleton CSS Exists But Is Never Used
- **Severity:** P2
- **Description:** The stylesheet defines a complete skeleton system:
  - `.skeleton` — base class with shimmer animation
  - `.skeleton-line` — horizontal line placeholder
  - `.skeleton-heading` — wider heading placeholder
  - `.skeleton-card` — card-shaped skeleton with proper height and border radius
  - `@keyframes skeleton-shimmer` — left-to-right shimmer animation
  
  These classes are never referenced in any HTML template. They represent abandoned work that should be activated.
- **Evidence:** `src/public/styles.css:1579-1604` — skeleton class definitions. Zero references to these classes in `src/views/` or `src/routes/`.
- **Remediation:** Use these existing classes for all HTMX lazy-loaded regions. The one-thing banner should show a `.skeleton-line` while loading. The query bar response area should show a `.skeleton-line` during AI processing.
- **Target Phase:** 2

### LSD-02 One-Thing Banner Loads Into Empty Space
- **Severity:** P2
- **Description:** The one-thing banner uses `hx-get="/api/priority/one-thing" hx-trigger="load"` to lazy-load content. Before the response arrives, the user sees an empty `<div>` with `style="min-height:0"`. This means: (1) no visual indication that something is loading, (2) a layout shift when content arrives (the div expands from 0 to its content height), and (3) if the request fails, the space remains empty with no indication.
- **Evidence:** `src/views/layout.ts:100-104` — `<div id="one-thing-banner" hx-get="/api/priority/one-thing" hx-trigger="load" hx-swap="innerHTML" style="min-height:0"></div>`.
- **Remediation:** Set `min-height` to match expected content height (~44px). Add a skeleton child: `<div class="skeleton-line" style="width:60%;margin:12px auto;"></div>`. The skeleton is replaced when HTMX swaps the content.
- **Target Phase:** 2

### LSD-03 No Loading State for Dashboard Initial Render
- **Severity:** P3
- **Description:** The dashboard page runs 6 async operations before rendering. During this time (potentially 200-800ms), the user sees the previous page or a blank white/dark screen. There is no server-sent skeleton or partial render. In a server-rendered app, this is inherently harder to solve — the server computes everything before sending any HTML. Streaming responses (chunked transfer encoding) could send the layout shell (header, sidebar) immediately and stream the content later.
- **Evidence:** `src/routes/dashboard/index.ts:141-155` — all data fetched before any HTML emission.
- **Remediation:** Phase 1: Ensure browser shows previous page until new page is ready (this is the default for full-page navigation). Phase 2: With `hx-boost`, add a top progress bar. Phase 3: Use Hono streaming to send the layout shell immediately and stream dashboard content as data becomes available.
- **Target Phase:** 3

### LSD-04 AI Query "Thinking" State Is Text-Only
- **Severity:** P3
- **Description:** When the AI query bar is processing, it shows the text "Thinking" with a `.loading` CSS class. This is functional but could be more engaging. The loading class sets the text color to muted but does not show any animation or skeleton. For a potentially 2-10 second AI response, a more dynamic loading state would maintain engagement.
- **Evidence:** `src/routes/dashboard/index.ts:271-272` — `responseEl.textContent = 'Thinking'`. `src/public/styles.css:767` — `.loading { display: block; color: var(--text-muted); }`.
- **Remediation:** Add a shimmer animation to the loading state: animated dots ("Thinking...") or a skeleton-style pulsing bar. The skeleton shimmer keyframes already exist. Consider: `Thinking<span class="skeleton-line" style="display:inline-block;width:60px;height:4px;vertical-align:middle;margin-left:8px;"></span>`.
- **Target Phase:** 4

### LSD-05 Onboarding Chat Has HTMX Indicator — Partially Implemented
- **Severity:** P2
- **Description:** The onboarding chat defines `.htmx-indicator` CSS and places a `<span class="htmx-indicator">...</span>` inside the send button. However, the indicator is styled as `display:none` and never becomes visible during the HTMX request because HTMX applies the indicator class to the parent element, not the indicator element itself. The actual indicator behavior depends on HTMX's class toggling, which may not work as intended here.
- **Evidence:** `src/routes/dashboard/onboarding-chat.ts:112-114` — HTMX indicator CSS. Lines 168-169 — indicator span with `display:none`.
- **Remediation:** Fix the HTMX indicator implementation. The indicator span should be shown via HTMX's class mechanism: when the form has class `htmx-request`, show the indicator and hide the "Send" text. Add `hx-indicator="#send-indicator"` to the form to explicitly target the indicator element.
- **Target Phase:** 2

### LSD-06 Portfolio Cards Should Show Skeletons During Fleet Compute
- **Severity:** P2
- **Description:** The portfolio page computes all signal scores before rendering. For a fleet of 25 products, this could take several seconds. There is no way to show skeleton cards because the server waits for all data before sending any HTML. With streaming or HTMX-powered progressive loading, each product card could appear as its signal score is computed, with the remaining cards showing skeleton states.
- **Evidence:** `src/routes/dashboard/portfolio.ts:29-36` — all scores computed via `Promise.all` before render.
- **Remediation:** Option A: Render skeleton cards immediately and use HTMX to lazy-load each card's signal score. Option B: Use Hono streaming to send skeleton HTML first, then stream each card as it resolves. Option C: Cache signal scores (most practical).
- **Target Phase:** 3

## Embarrassment Test
1. The stylesheet contains a complete skeleton animation system that was clearly planned and designed but never connected to any actual UI element — abandoned work visible in the code.
2. The HTMX lazy-loaded one-thing banner shows empty space during loading and causes a visible layout shift when content arrives.

## Recommendations (Priority Order)
1. Add skeleton content to the one-thing banner lazy load (P2, Phase 2)
2. Fix onboarding chat HTMX indicator implementation (P2, Phase 2)
3. Connect existing skeleton CSS to HTMX swap targets (P2, Phase 2)
4. Enhance AI query loading state with animation (P3, Phase 4)
5. Design progressive loading for fleet portfolio view (P2, Phase 3)
