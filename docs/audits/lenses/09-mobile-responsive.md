# Lens 09 — Mobile / Responsive Designer

## Executive Summary

Foundry has a mobile bottom nav and two responsive breakpoints (768px, 480px), which is a solid foundation. However, the mobile experience is undermined by pervasive inline styles that never adapt to narrow viewports, a bottom nav that renders 5 tabs in a 4-column grid (clipping the last tab), touch targets well below the 44px minimum, and dashboard grids that lack mobile-specific breakpoints. The product is technically viewable on a phone but not usable for daily operation — which matters because the product vision includes a native iOS app and "ambient" mobile-first workflows.

## Findings

### MOB-01 Mobile Bottom Nav Renders 5 Tabs in 4-Column Grid
- **Severity:** P0
- **Description:** The `mobilBottomNav()` function emits 5 tab links (Signal, Decisions, Agents, Plan, More) but the CSS `.mobile-bottom-nav` uses `grid-template-columns: repeat(4, 1fr)`. The 5th tab ("More") either overflows off-screen or wraps to a second row beneath the visible nav area, hidden by the fixed height.
- **Evidence:** `src/views/layout.ts:324-346` (5 tabs emitted), `src/public/styles.css:1366` (`repeat(4, 1fr)`)
- **Remediation:** Change to `repeat(5, 1fr)` or reduce to 4 tabs with a "More" overflow menu.
- **Target Phase:** 2

### MOB-02 Function Name Typo: `mobilBottomNav`
- **Severity:** P3
- **Description:** The mobile bottom nav function is named `mobilBottomNav` (missing 'e'). This is a minor code quality issue but affects grep-ability and discoverability.
- **Evidence:** `src/views/layout.ts:324`
- **Remediation:** Rename to `mobileBottomNav`.
- **Target Phase:** 2

### MOB-03 Touch Targets Below 44px Minimum
- **Severity:** P1
- **Description:** Multiple interactive elements have tap targets well under the 44x44px WCAG/Apple minimum. Sidebar nav links have `padding: 0.42rem 0.65rem` (~6px x 9px at 14px base). The notification bell summary has `padding: 4px 8px`. The command palette items have `padding: 8px 16px` (height ~30px). Mobile bottom nav tabs use `padding: 6px 4px 4px` with total height governed by the 56px container split across label + icon + gap.
- **Evidence:** `src/public/styles.css:160` (sidebar nav), `src/public/styles.css:1371` (mbn-tab), `src/views/layout.ts:117` (cmd-palette items)
- **Remediation:** Ensure all tappable elements meet 44x44px minimum. For sidebar links, this is moot on mobile (sidebar hidden), but bottom nav tabs and header actions need explicit `min-height: 44px; min-width: 44px`.
- **Target Phase:** 2

### MOB-04 Inline Styles Bypass Responsive Breakpoints
- **Severity:** P1
- **Description:** There are 2,739 inline `style="..."` occurrences across route files and 152 in view templates. These hardcoded styles (fixed widths, grid columns, padding, font sizes) never adapt to narrow viewports because media queries cannot override inline styles without `!important`. For example, the landing page agent grid uses `style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr))"` which on a 320px viewport forces horizontal scroll or single-column at a wasteful size.
- **Evidence:** `src/routes/public/landing.ts:50` (inline grid), `src/routes/dashboard/ambient.ts:22-30` (card function using inline styles), total count: 2,739 in routes + 152 in views
- **Remediation:** Extract inline styles into CSS classes with responsive overrides. Prioritize dashboard pages first since those are the primary mobile interaction surface.
- **Target Phase:** 3

### MOB-05 No Mobile Breakpoint for 4-Column Grids
- **Severity:** P1
- **Description:** `.analytics-totals` and `.mrr-grid` use `grid-template-columns: repeat(4, 1fr)`. The analytics grid gets a `repeat(2, 1fr)` override at 600px, and MRR grid gets `repeat(2, 1fr)` at 768px. But on phones under 375px, even 2 columns can be cramped for financial data with dollar signs and decimals, leading to text truncation.
- **Evidence:** `src/public/styles.css:609` (analytics-totals), `src/public/styles.css:819` (mrr-grid), `src/public/styles.css:700-703` (600px breakpoint), `src/public/styles.css:1341` (768px breakpoint)
- **Remediation:** Add a 375px or 400px breakpoint that collapses MRR grid and analytics totals to `1fr` (single column).
- **Target Phase:** 3

### MOB-06 Command Palette Unusable on Mobile
- **Severity:** P2
- **Description:** The command palette is triggered by `Cmd+K` which does not exist on mobile keyboards. There is no touch-accessible trigger beyond the sidebar "Go anywhere" button — which is itself hidden on mobile since the sidebar is `display: none` at 768px. Mobile users have no access to quick navigation.
- **Evidence:** `src/views/layout.ts:291-294` (sidebar button), `src/public/styles.css:1336` (sidebar hidden), `src/views/layout.ts:158` (only keyboard trigger)
- **Remediation:** Add a search/command icon to the mobile header or bottom nav that opens the palette.
- **Target Phase:** 3

### MOB-07 Header Cramped on Narrow Screens
- **Severity:** P2
- **Description:** The header right section contains risk badge, notification bell, user name, and settings link in a horizontal flex layout with `gap: 1rem`. On a 320px device, after logo and breadcrumb, this can overflow. There are no responsive rules for the header — no items are hidden or collapsed on mobile.
- **Evidence:** `src/public/styles.css:78-91` (header layout), `src/views/layout.ts:83-91` (header content), no media query adjustments for `.header-right` or `.header-left`
- **Remediation:** At 768px, hide `.user-name` and `.header-link` (Settings), rely on mobile bottom nav for settings. Collapse risk badge to icon-only.
- **Target Phase:** 3

### MOB-08 Decision Chamber Scenario Grid Doesn't Stack Gracefully
- **Severity:** P2
- **Description:** `.chamber-scenario-grid` uses `grid-template-columns: 1fr 1fr 1fr` with a 768px override to `1fr`. However, between 480-768px (tablet portrait), three columns at ~160px each become very cramped for the textual scenario content.
- **Evidence:** `src/public/styles.css:1031-1033` (3-column), `src/public/styles.css:1343` (1-column at 768px)
- **Remediation:** Add a tablet breakpoint at 600px that switches to `1fr` or `1fr 1fr`.
- **Target Phase:** 3

### MOB-09 No `touch-action` or Mobile Gesture Consideration
- **Severity:** P3
- **Description:** No CSS `touch-action` properties are set anywhere. The notification dropdown uses `<details>` which can be flaky on some mobile browsers. No swipe gestures for common actions (dismiss notification, swipe between tabs).
- **Evidence:** `src/public/styles.css` (full file, no `touch-action` declarations), `src/views/layout.ts:191` (details-based dropdown)
- **Remediation:** Add `touch-action: manipulation` to interactive elements to eliminate 300ms tap delay. Consider replacing `<details>` dropdown with a proper mobile sheet/modal.
- **Target Phase:** 4

### MOB-10 Safe Area Inset Only Applied to Bottom Padding
- **Severity:** P3
- **Description:** `env(safe-area-inset-bottom)` is correctly used for main content padding and bottom nav height, but `env(safe-area-inset-top)` is not applied to the header, and `env(safe-area-inset-left/right)` are not applied anywhere. On notched phones in landscape or phones with curved edges, content may be obscured.
- **Evidence:** `src/public/styles.css:1337-1338` (bottom insets only)
- **Remediation:** Add `padding-top: env(safe-area-inset-top)` to `.site-header` and lateral insets to `.main-with-sidebar` and `.main-full` on mobile.
- **Target Phase:** 4

## Embarrassment Test
1. A founder opens Foundry on their iPhone and the 5th bottom nav tab (More/Settings) is invisible — they cannot reach settings or account management on mobile.
2. A founder tries to use quick navigation on mobile but the Cmd+K palette has no touch trigger and the sidebar button is hidden — they must manually type URLs or scroll through pages.
3. The landing page hero section and agent grid render acceptably, but the inline-styled "How It Works" cards at 320px width are cramped with text overflowing or wrapping awkwardly.

## Pride Test
1. The viewport meta tag is correct (`width=device-width, initial-scale=1`) and theme-color is set — the browser chrome will match the dark UI.
2. The mobile bottom nav exists, uses semantic `<nav>` with `role="navigation"` and `aria-label`, includes SVG icons that scale, and handles safe area insets for the bottom. The foundation is real.
3. The responsive breakpoints at 768px and 480px cover the most critical layout adaptations (sidebar hidden, grids collapsed, signal number scaled down). The bones are there for a good mobile experience.
