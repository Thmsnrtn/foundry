# Lens 084 — Iconography Consistency

**Distinct value:** Audits all icon usage across the application for consistency. Identifies where emoji, SVG, Unicode symbols, and text-based indicators are mixed. Evaluates cross-platform rendering and accessibility of icon choices.

**Tenancy-critical:** No. Icon rendering is per-device.

## Executive Summary

Foundry uses three distinct icon systems with no consistent pattern: (1) emoji characters (bell, lock, robot, colored circles, checkmarks), (2) inline SVG icons (mobile bottom nav, sparklines), and (3) Unicode symbols (arrows, close X, navigation indicators). The mobile bottom nav is the only place with a consistent, well-executed SVG icon system. The rest of the application mixes emoji and Unicode freely, creating cross-platform inconsistency and a jarring visual identity shift between the polished CSS design system and the casual emoji usage.

## Findings

### IC-01 Three Icon Systems Coexist
- **Severity:** P2
- **Description:** Complete inventory of icon approaches:
  - **Emoji (12+ instances):** Notification bell, lock icon, robot (agent provisioning), construction (onboarding chat), circles for lifecycle states (white, blue, green, yellow, purple), target (briefing CTA), clock (stressor timeframe), arrow (stressor action)
  - **Inline SVG (7 instances):** Mobile bottom nav (signal, decisions, agents, plan, more icons), sparkline charts, temporal timeline
  - **Unicode (8+ instances):** Up/down arrows in command palette footer, close X (multiplication sign), return arrow, em-dash as separator, right arrow for navigation, check mark and warning sign in risk state
  
  No icon library (Lucide, Heroicons, etc.) is used.
- **Evidence:** `src/views/layout.ts:193` (bell emoji), `src/views/layout.ts:333-337` (SVG icons), `src/views/layout.ts:119` (Unicode arrows), `src/routes/dashboard/agents.ts:59-66` (circle emojis), `src/views/components.ts:21-25` (Unicode check mark and warning sign).
- **Remediation:** Standardize on inline SVG for all icons. The mobile bottom nav pattern is the correct approach. Create a small icon library (10-15 SVGs) that covers: notification bell, lock, settings gear, risk indicators, status dots, navigation arrows, close X. Remove all emoji usage.
- **Target Phase:** 3

### IC-02 Mobile Bottom Nav SVGs Are Well-Crafted
- **Severity:** (Positive Finding)
- **Description:** The 5 mobile bottom nav icons are hand-crafted inline SVGs with consistent style: 20x20 viewBox, `fill="none"`, `stroke="currentColor"`, `stroke-width="1.6"`, `stroke-linecap="round"`. They use `currentColor` for CSS color inheritance and are appropriately sized. This is the gold standard for the application.
- **Evidence:** `src/views/layout.ts:333-337` — five SVG icon definitions with consistent parameters.
- **Remediation:** N/A — use this as the template for all application icons.
- **Target Phase:** N/A

### IC-03 Emoji Renders Differently Across Platforms
- **Severity:** P2
- **Description:** The emoji icons (bell, lock, colored circles, robot, construction) render differently on macOS (Apple emoji), Windows (Segoe UI emoji), Android (Noto emoji), and Linux (Noto or platform-dependent). The colored circle emojis used for lifecycle states may render with different sizes and alignment across platforms, creating inconsistent visual hierarchy.
- **Evidence:** `src/routes/dashboard/agents.ts:59-66` — lifecycle states use colored circle emojis that vary significantly across platforms. `src/views/layout.ts:193` — bell emoji in header.
- **Remediation:** Replace all emoji with consistent inline SVGs. For status dots, use CSS-styled `<span>` elements (the `statusDot()` function already does this for agent status). For the notification bell, use an SVG matching the mobile nav icon style.
- **Target Phase:** 3

### IC-04 Risk State Uses Unicode Symbols Correctly
- **Severity:** (Positive Finding)
- **Description:** The risk state badge component pairs color with Unicode symbols for accessibility: green gets a check mark, yellow gets a warning triangle, red gets a filled circle. This ensures the risk state is not communicated by color alone (WCAG 1.4.1). The comment even references the a11y requirement.
- **Evidence:** `src/views/components.ts:21-25` — `green: 'GREEN \u2713'`, `yellow: 'YELLOW \u26A0'`, `red: 'RED \u25CF'` with comment "A11Y-04: Pair each color with a distinct symbol."
- **Remediation:** N/A — correct accessibility pattern. Consider replacing Unicode with SVG for cross-platform consistency while maintaining the symbol meaning.
- **Target Phase:** N/A

### IC-05 Command Palette Footer Uses Unicode That Could Be SVG
- **Severity:** P3
- **Description:** The command palette footer uses HTML entities for keyboard hints: up/down arrows (`&#x2191;&#x2193;`), return arrow (`&#x21b5;`), and text "esc close". These render at different sizes and weights across fonts. SVG or styled text would be more consistent.
- **Evidence:** `src/views/layout.ts:119-121` — Unicode arrows in command palette footer.
- **Remediation:** Replace with styled key indicators: `<kbd>↑</kbd> <kbd>↓</kbd> navigate` using a `<kbd>` style with consistent background and border.
- **Target Phase:** 4

### IC-06 No Icon Accessibility Labels on Decorative Icons
- **Severity:** P2
- **Description:** Emoji icons have no `aria-hidden="true"` to hide them from screen readers. A screen reader encountering the bell emoji will announce "bell" which is correct for the notification bell, but the colored circle emojis will announce "blue circle" or "green circle" which is confusing in the context of lifecycle states. The robot emoji will announce "robot" which adds no value.
- **Evidence:** `src/views/layout.ts:193` — bare bell emoji without aria attributes. `src/routes/dashboard/agents.ts:59-66` — emoji strings without aria wrapping.
- **Remediation:** Wrap decorative emoji in `<span aria-hidden="true">` and provide the semantic meaning via adjacent text or `aria-label`. For the lifecycle badges, the text label ("Learning", "Operating") is already present — just hide the emoji from screen readers.
- **Target Phase:** 2

## Embarrassment Test
1. A founder using a Windows PC sees completely different lifecycle state indicators than what was designed on a Mac — the emoji colors, sizes, and shapes are all different.
2. A screen reader user hears "blue circle Learning" instead of just "Learning" for an agent's lifecycle state.

## Recommendations (Priority Order)
1. Add `aria-hidden="true"` to all decorative emoji (P2, Phase 2)
2. Create a 10-15 icon SVG library matching mobile nav icon style (P2, Phase 3)
3. Replace lifecycle state emoji with CSS-styled status dots (P2, Phase 3)
4. Replace notification bell emoji with SVG icon (P2, Phase 3)
5. Style command palette keyboard hints with `<kbd>` elements (P3, Phase 4)
