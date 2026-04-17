# Lens 18 — Motion Designer

**Auditor perspective:** Does the product use motion meaningfully? Are transitions consistent? Is there `prefers-reduced-motion` support? Is motion purposeful or decorative?

**Date:** 2026-04-16
**Repo:** /Users/user/foundry/

---

## Executive Summary

Foundry's motion layer is near-nonexistent. The entire CSS file contains one `@keyframes` animation (milestone toast `slideUp`), one significant transition (`signal-number` color at 0.6s), and a blanket `--transition: 150ms ease` token applied to hover states. There is zero `prefers-reduced-motion` support. There are no page transitions, no enter/exit animations, no staggered list reveals, no skeleton shimmer, and no progress animations. For a dark-themed data-rich product that explicitly aspires to be "typographic" and signal-driven, the absence of motion makes state changes feel abrupt and the interface feel static — like a document rather than a living system.

---

## Findings

### F18.1 — Zero `prefers-reduced-motion` support

**Severity:** P1
**Evidence:** `grep -r 'prefers-reduced-motion' src/` returns zero results. The product has CSS transitions on ~20 elements and one `@keyframes slideUp` animation. None are wrapped in a `prefers-reduced-motion` media query. While the motion footprint is small, WCAG 2.1 Success Criterion 2.3.3 requires that all non-essential animation be disableable. The milestone toast slides up, the signal number color animates over 600ms, the portfolio card translates on hover — all should respect the preference.
**Remediation:** Add to `styles.css`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```
This is a single rule that covers all current and future motion.

### F18.2 — Only one @keyframes animation in the entire product

**Severity:** P1
**Evidence:** `styles.css` line 1327-1329 defines `@keyframes slideUp` used by `.milestone-toast`. That is it. A product with 59 dashboard routes, 12 agent cards, decision queues, stressor lists, cohort tables, scenario grids, and audit dimension bars has exactly one animation. No card entrance, no bar fill animation, no score count-up, no list stagger.
**Remediation:** Add purposeful entrance animations for key content:
- Signal score: count-up animation on page load (the 9rem number should feel alive)
- Dimension bars (`.dim-bar-fill`): animate from 0 to target width on page load
- Decision cards: staggered `fadeInUp` when the list renders
- Stressor items: staggered entrance keyed to severity
- Analytics bar fills: animate width on scroll-into-view

### F18.3 — Signal number color transition is the only meaningful motion

**Severity:** P2
**Evidence:** `.signal-number { transition: color 0.6s ease; }` — this transitions the large score number between tier colors (green/yellow/red) presumably when data updates. This is the single instance of motion communicating meaning: the score's color shift signals a state change. But it exists in isolation. The sparkline below has no draw-in animation. The risk badge has no pulse or transition. The delta indicator appears with no entrance.
**Remediation:** Extend the signal display's motion vocabulary: sparkline draw-in (SVG stroke-dashoffset animation), delta indicator entrance (slide + fade from direction of change), risk badge pulse on state change.

### F18.4 — Page transitions are nonexistent

**Severity:** P2
**Evidence:** All navigation is full-page reload (`<a href="...">` links, `location.href` redirects, form POST redirects). There is no View Transitions API usage, no HTMX `hx-boost` for SPA-like navigation, no fade between pages. The product loads HTMX on every page but doesn't use `hx-boost="true"` on the body to get free page transitions.
**Remediation:** Add `hx-boost="true"` to the `<body>` tag in `layout.ts`. This makes all same-origin links use HTMX's swap mechanism instead of full reloads. Add a CSS transition on `<main>` for content swap:
```css
main { opacity: 1; transition: opacity 150ms ease; }
main.htmx-swapping { opacity: 0; }
```

### F18.5 — Hover transitions are consistent but minimal

**Severity:** P2
**Evidence:** The `--transition: 150ms ease` token is used consistently across ~20 elements: buttons, links, sidebar items, cards, inputs. This is good discipline. But the transitions are limited to `color`, `border-color`, and `background`. No element uses `transform` on hover (except `.portfolio-card:hover { transform: translateY(-2px); }` — the single instance). Cards, decision items, and agent roster cards just change border color. The hover states feel subtle to the point of being invisible on some screens.
**Remediation:** Add `transform: translateY(-1px)` to `.card:hover`, `.decision-card:hover`, `.signal-action:hover`. Add `box-shadow` transitions to interactive cards. The portfolio card's `translateY(-2px)` pattern should be the norm, not the exception.

### F18.6 — Toggle switch animation works but is isolated

**Severity:** P3
**Evidence:** The `.toggle-thumb` has `transition: transform var(--transition), background var(--transition)` and `.toggle-track` has `transition: background var(--transition)`. This is correct and smooth. But it's the only stateful component with animation. Tab switching (`.tab-btn`) changes border-bottom color instantly. The notification bell dropdown appears/disappears with no transition (it uses `<details>` native). The command palette shows/hides with `display:none/block` — no fade.
**Remediation:** Add transitions to: notification dropdown (opacity + translateY), command palette (opacity + scale from 0.98), tab switching (border-bottom animation via pseudo-element).

---

## Embarrassment Test

Open the Agent Roster with 12 agent cards, each showing health bars, status dots, version badges, success rates, and last-run timestamps. All 12 cards appear simultaneously with no entrance animation. The health bars are at their final width instantly — no fill animation. Compare this to any modern dashboard (Linear, Vercel, Datadog) where chart bars animate in, cards stagger, and content reveals progressively. Foundry's dashboard looks like a static screenshot.

## Pride Test

The `--transition: 150ms ease` token is consistently applied and feels appropriate for hover states. The choice of 150ms (not 300ms, not 0ms) shows awareness of perceived responsiveness. The `transition: color 0.6s ease` on the signal number is a thoughtful, slower transition that gives the score change gravitas. These two timing choices, if extended to the rest of the product, would form the foundation of a good motion system.
