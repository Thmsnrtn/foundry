# Lens 02 — Staff Frontend Engineer

## Executive Summary

Foundry's frontend is server-rendered HTML via Hono template literals with HTMX for interactivity — a deliberately simple stack that avoids framework complexity. The CSS design system in `styles.css` is well-organized with custom properties, consistent naming, and thoughtful component styles. However, the execution has two systemic problems: (1) HTMX is barely used (13 attributes across 3 files) while inline `<script>` blocks and `onclick` handlers proliferate, and (2) there are 2,891 inline `style="..."` declarations across routes and views that bypass the CSS design system entirely. The HTML is mostly semantic but accessibility is minimal — only 4 `aria-label` attributes in the entire codebase. The result is a product that looks polished but is built on a fragile, hard-to-maintain frontend foundation.

## Findings

### FE-01 Massive Inline Style Abuse — 2,891 Occurrences
- **Severity:** P1
- **Description:** There are 2,739 `style="..."` occurrences in route files and 152 in view templates (2,891 total). Landing page components are built entirely with inline styles. Dashboard route helper functions return HTML strings with hardcoded styles. This bypasses the well-designed CSS custom properties system, makes responsive design impossible (media queries cannot override inline styles), creates inconsistency (same visual pattern styled differently across pages), and bloats HTML payloads.
- **Evidence:** `src/routes/public/landing.ts:20-99` (hero section: 15+ inline style declarations), `src/routes/dashboard/ambient.ts:22-29` (card helper: 8 inline styles), `src/routes/dashboard/agents-transparency.ts:52-55` (statusBadge: returns inline-styled spans), `src/routes/dashboard/agents.ts:71` (statusDot: inline background color)
- **Remediation:** Phase 1: Extract the 20 most common inline style patterns into CSS classes (`.hero`, `.section-label`, `.agent-card`, `.status-dot`, etc.). Phase 2: Systematically convert route files, starting with landing page and high-traffic dashboard pages. Reserve inline styles only for truly data-driven values (bar widths, computed colors).
- **Target Phase:** 2

### FE-02 HTMX Underutilized — Only 13 Attributes Total
- **Severity:** P1
- **Description:** The stack description says "HTMX" but there are only 13 `hx-*` attributes across 3 files: the "one thing" banner (`hx-get`, `hx-trigger="load"`, `hx-swap`), the priority API endpoint, and the onboarding chat. Every other interactive behavior uses inline `onclick` handlers, `<script>` blocks with vanilla JS, or full-page form submissions. The command palette, notification bell, tour overlay, decision chamber reflection, and query bar all use vanilla JS instead of HTMX patterns.
- **Evidence:** `src/views/layout.ts:99-103` (one-thing banner, the only HTMX in the main layout), `src/routes/dashboard/onboarding-chat.ts` (4 HTMX attributes), `src/routes/api/priority.ts` (6 HTMX attributes for fragment responses), total: 13 across 3 files. Compare: 12 `<script>` blocks across 9 files.
- **Remediation:** Convert the decision resolve/reject forms, notification mark-all-read, tour step advancement, and query bar to HTMX patterns (`hx-post`, `hx-swap`). This eliminates the need for inline scripts and makes the behavior declarative. The HTMX library is already loaded on every page.
- **Target Phase:** 3

### FE-03 Minimal Accessibility — 4 `aria-label` Attributes
- **Severity:** P1
- **Description:** There are only 4 `aria-label` attributes in the entire codebase: 2 in `layout.ts` (mobile bottom nav `aria-label="Main navigation"` and close button), 1 on the sparkline SVG (`aria-hidden`), and 1 on a plan page element. No `aria-live` regions for dynamic content updates. No `role` attributes beyond the mobile nav. No skip links. No landmark roles on main content areas. No `aria-expanded` on the notification dropdown or command palette. Form inputs in route files frequently lack associated `<label>` elements.
- **Evidence:** `src/views/layout.ts:339` (mobile nav aria-label), `src/views/layout.ts:326` (tab aria-label), `src/routes/dashboard/index.ts` (sparkline aria-hidden), `src/routes/dashboard/plan.ts` (1 aria-label). Total: 4 across 3 files.
- **Remediation:** Priority fixes: (1) Add `aria-expanded` to notification bell `<details>` and command palette trigger. (2) Add `aria-live="polite"` to HTMX swap targets. (3) Add skip link to bypass header/sidebar. (4) Add `role="main"` to `<main>` element. (5) Audit all form inputs for label associations.
- **Target Phase:** 2

### FE-04 Command Palette Built with Inline JS and Styles
- **Severity:** P2
- **Description:** The command palette (Cmd+K) is implemented as 36 lines of minified inline JavaScript in `layout.ts` with all styling via inline `style="..."` attributes. The overlay, container, input, results, and footer are all styled inline. The JS manages state (cmdIdx), renders HTML via string concatenation, and handles keyboard events — all in `<script>` tags. This makes it unmaintainable, untestable, and impossible to style responsively.
- **Evidence:** `src/views/layout.ts:110-158` (40 lines of inline HTML + JS: overlay, palette, results, keyboard handlers, all with inline styles)
- **Remediation:** Extract the command palette into its own module. Move styles to CSS classes. Consider using HTMX + a server endpoint for the command palette results (enables server-side search).
- **Target Phase:** 3

### FE-05 CSS Design System is Well-Structured
- **Severity:** (Positive Finding)
- **Description:** `styles.css` (1,444 lines) is well-organized with CSS custom properties for colors, spacing, and transitions. Components follow BEM-ish naming (`signal-number`, `signal-label`, `signal-high`). The risk state system (`risk-green`, `risk-yellow`, `risk-red`) is consistently tokenized. The design system covers cards, badges, buttons, forms, metrics, stressors, decisions, portfolio, and more.
- **Evidence:** `src/public/styles.css:7-36` (comprehensive custom properties), organized sections with banner comments, consistent naming throughout
- **Remediation:** N/A — this is the correct foundation. The fix is to use it more (see FE-01).
- **Target Phase:** N/A

### FE-06 HTMX Loaded on Every Page but Used on 3
- **Severity:** P2
- **Description:** `htmx.min.js` (14KB gzipped) is loaded via `<script defer>` on every page including public landing, pricing, and case study pages where it is never used. On the 56+ dashboard pages where it could be used, only 3 actually use it.
- **Evidence:** `src/views/layout.ts:71` (`<script src="https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js" defer>` in every page), only 3 files use `hx-*` attributes
- **Remediation:** Short-term: Move the HTMX script tag to only be included in the `dashboardLayout`. Long-term: Actually use HTMX on dashboard pages (see FE-02), which justifies the include. Also: vendor the library locally instead of loading from unpkg.com (CDN dependency, cache invalidation, privacy).
- **Target Phase:** 2

### FE-07 No Asset Versioning or Cache Headers
- **Severity:** P2
- **Description:** `styles.css` is loaded as `/static/styles.css` with no version hash or cache-busting query parameter. There is no evidence of cache-control headers being set for static assets. On deploy, users may see stale CSS until hard-refresh. The same applies to the service worker (`/sw.js`).
- **Evidence:** `src/views/layout.ts:69` (`<link rel="stylesheet" href="/static/styles.css" />`), no hash, no version query param
- **Remediation:** Add a build step that hashes static assets (`styles.abc123.css`) or append a version query param (`styles.css?v=${BUILD_HASH}`). Set `Cache-Control: public, max-age=31536000, immutable` for hashed assets.
- **Target Phase:** 3

### FE-08 Emoji Used as Icons in Production UI
- **Severity:** P2
- **Description:** The notification bell uses the emoji character (line 193: literal bell emoji). The command palette trigger uses emoji. Various badge and status indicators use emoji characters. Emoji rendering varies across operating systems and can break visual consistency — a Samsung phone renders different emoji than macOS or Windows.
- **Evidence:** `src/views/layout.ts:193` (bell emoji in notification), `src/views/layout.ts:349` (lock emoji in nav), `src/routes/dashboard/agents.ts:59-66` (lifecycle badges use emoji circles)
- **Remediation:** Replace emoji with SVG icons (the mobile bottom nav already uses proper SVGs — use the same pattern). This ensures consistent rendering across all platforms.
- **Target Phase:** 3

### FE-09 Semantic HTML is Mixed
- **Severity:** P2
- **Description:** Some areas use proper semantic elements: `<nav>` for sidebar and mobile nav, `<main>` for content, `<header>` for site header, `<dialog>` for the signal anatomy modal, `<details>` for collapsible sections. But many areas use generic `<div>` soup — the stressor report items, decision cards, metric cards, and agent roster are all `<div>`-based rather than using `<article>`, `<section>`, or `<dl>` where semantically appropriate.
- **Evidence:** `src/views/components.ts:46-71` (stressor report: all divs), `src/views/components.ts:122-136` (metric cards: divs), `src/views/layout.ts:297-318` (sidebar sections: mix of `<details>` and raw `<div>` headers)
- **Remediation:** Use `<article>` for decision cards and stressor items. Use `<section>` with `aria-labelledby` for dashboard sections. Use `<dl>`/`<dt>`/`<dd>` for metric key-value displays.
- **Target Phase:** 4

### FE-10 Landing Page Clerk Script Loaded from CDN with No SRI
- **Severity:** P2
- **Description:** The landing page loads the Clerk JS SDK from `unpkg.com` without Subresource Integrity (SRI) hash. A compromised CDN or MITM could inject malicious code. HTMX is also loaded from unpkg without SRI.
- **Evidence:** `src/routes/public/landing.ts:17` (`<script async crossorigin="anonymous" src="https://unpkg.com/@clerk/clerk-js/dist/clerk.browser.js"`), `src/views/layout.ts:71` (`<script src="https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js" defer>`)
- **Remediation:** Either vendor both libraries locally (preferred for a product handling founder business data) or add `integrity="sha384-..."` attributes. Pin to exact versions.
- **Target Phase:** 2

## Embarrassment Test
1. A security audit flags that two third-party scripts (Clerk, HTMX) are loaded from a public CDN without SRI hashes — a supply-chain attack vector on a product that handles business intelligence data.
2. A designer asks "where are the styles for the landing page?" and discovers they are scattered across 76 inline `style` declarations in `landing.ts` — impossible to update the visual design without editing TypeScript template code.
3. A screen reader user navigates the dashboard and gets no landmark structure, no skip links, no aria-expanded on dropdowns, and a notification bell identified only by its emoji character — the product is effectively unusable for accessibility.

## Pride Test
1. The CSS design system (`styles.css`) is genuinely well-crafted — consistent custom properties, clean component naming, proper use of CSS variables for theming, and a cohesive dark-mode aesthetic. The signal display, decision chamber, and portfolio views are visually distinctive.
2. The `<dialog>` element is used correctly for the signal anatomy modal with proper `::backdrop` styling — this is native HTML being used as intended, no library needed.
3. The mobile bottom nav uses proper SVG icons with `currentColor` inheritance, `aria-label` on each tab, and semantic `<nav>` — this one component demonstrates what the whole app could be.
