# Lens 23 — Accessibility Designer Audit

**Auditor perspective:** Accessibility designer (complementing Lens 08)
**Scope:** Color-blind accessibility for risk states, screen reader page landmarks, reading order
**Date:** 2026-04-16

---

## Executive Summary

Foundry's dark theme relies heavily on a red/yellow/green traffic-light color system for its core risk states, signal tiers, and stressor severity -- **all three distinctions are indistinguishable for deuteranopia (red-green color blindness, ~8% of males)**. There are no text labels, patterns, or icons that provide redundant encoding. The server-rendered HTML has almost no ARIA landmarks, no skip links, and no `<main>` landmark on the `<main>` element. The sidebar navigation has no `role="navigation"` (only the mobile bottom nav does). Reading order follows visual order, which is acceptable, but interactive elements beyond mobile bottom nav tabs lack `aria-label` attributes.

**P0 findings:** 1
**P1 findings:** 4
**P2 findings:** 2

---

## Finding 01 — Risk states (green/yellow/red) are color-only with no redundant encoding

**Severity: P0**
**Files:** `src/views/layout.ts`, `src/public/styles.css`

The risk badge in the header renders as:

```html
<span class="risk-badge risk-green">GREEN</span>
```

The text content says "GREEN/YELLOW/RED" in uppercase, which is good -- the text label exists. However, the signal number (the centerpiece of the dashboard) uses color alone:

```css
.signal-high .signal-number { color: var(--signal-high); }  /* #4ecca3 */
.signal-mid  .signal-number { color: var(--signal-mid); }   /* #ffb347 */
.signal-low  .signal-number { color: var(--signal-low); }   /* #ff6b6b */
```

The large signal number is colored green/yellow/red with no accompanying text label, icon, or pattern to indicate the tier. The small "SIGNAL" label below does not include the tier classification. A color-blind founder cannot distinguish whether their score of 72 is in the "high" (green) or "mid" (yellow) tier.

The same problem applies to:
- **Stressor severity**: `severity-critical` (red border-left), `severity-elevated` (yellow border-left), `severity-watch` (gray border-left) -- border color is the only differentiator. The severity text appears in the stressor meta section but not prominently.
- **MRR components**: `.mrr-new` (green), `.mrr-churned` (red) -- color-coded values with no icon or +/- prefix.
- **Score dimension bars**: `.score-good` (green), `.score-warn` (yellow), `.score-bad` (red) -- no icon, no text label on the bar itself.
- **Delta indicators**: `.signal-delta-up` (green), `.signal-delta-down` (red) -- no arrow character or +/- symbol.

**Impact:** ~8% of male founders cannot distinguish risk/health states at a glance. The core product value proposition (operational health signal) is inaccessible.

**Remediation:**
1. Add a text tier label next to or below the signal number ("HIGH" / "MID" / "LOW").
2. Add Unicode arrows or +/- symbols to delta indicators (e.g., "^+3" or "v-5").
3. Add severity text labels prominently on stressor items (not just in the meta section).
4. Consider using shape/pattern alongside color for dimension score bars (e.g., a checkmark icon for good, warning triangle for warn, X for bad).

---

## Finding 02 — No ARIA landmarks on primary page regions

**Severity: P1**
**Files:** `src/views/layout.ts`

The layout template has:
- `<header class="site-header">` -- no `role="banner"` (implicit from `<header>`, acceptable)
- `<nav class="sidebar">` -- no `role="navigation"` or `aria-label`. Screen readers will announce it as a generic navigation but without a label to distinguish it from the mobile bottom nav.
- `<main>` -- present as an HTML element, which is good. However, it has no `aria-label` to distinguish the content region.
- No `<footer>` element anywhere.
- No skip navigation link. A keyboard-only user must tab through the entire sidebar (20+ nav items) to reach main content.

The mobile bottom nav correctly has `role="navigation" aria-label="Main navigation"`. The desktop sidebar does not.

**Impact:** Screen reader users cannot efficiently navigate page regions. Keyboard-only users face a 20+ tab-stop gauntlet to reach main content.

**Remediation:**
1. Add `aria-label="Sidebar navigation"` to the desktop `<nav class="sidebar">`.
2. Add a skip link as the first focusable element: `<a href="#main-content" class="skip-link">Skip to main content</a>` with the main element having `id="main-content"`.
3. Add `aria-label="Page content"` to the `<main>` element.

---

## Finding 03 — No focus-visible styles beyond browser defaults

**Severity: P1**
**Files:** `src/public/styles.css`

The CSS has focus styles only on form inputs:

```css
input:focus, textarea:focus, select:focus {
  border-color: rgba(108,99,255,0.45);
  box-shadow: 0 0 0 3px rgba(108,99,255,0.08);
}
.query-input:focus { border-color: rgba(108,99,255,0.4); box-shadow: ... }
```

There are no `:focus-visible` styles on:
- Sidebar navigation links
- Buttons (`.btn`, `.btn-primary`, `.btn-secondary`, etc.)
- Card links
- The command palette trigger
- Mobile bottom nav tabs

Browser default focus outlines are typically thin and nearly invisible against dark backgrounds, especially on `#0a0a12`.

**Impact:** Keyboard-only users cannot see which element is focused. Navigation by tab key is effectively blind.

**Remediation:**
1. Add a global `:focus-visible` style: `*:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`.
2. Suppress default outline only where custom focus styles are provided: `*:focus:not(:focus-visible) { outline: none; }`.

---

## Finding 04 — No prefers-reduced-motion support

**Severity: P1**
**Files:** `src/public/styles.css`

The CSS includes animations (`@keyframes slideUp` for milestone toasts, CSS transitions on most interactive elements via `var(--transition)` at 150ms). There is no `@media (prefers-reduced-motion: reduce)` rule to disable or simplify these for users who have requested reduced motion in their OS settings.

**Impact:** Users with vestibular disorders or motion sensitivity cannot disable animations.

**Remediation:**
1. Add a reduced-motion media query that sets `--transition: 0ms` and disables keyframe animations:
```css
@media (prefers-reduced-motion: reduce) {
  :root { --transition: 0ms; }
  .milestone-toast { animation: none; }
}
```

---

## Finding 05 — Notification bell uses emoji with no accessible label

**Severity: P1**
**Files:** `src/views/layout.ts` (line 193)

The notification bell is rendered as a bare emoji character inside a `<summary>` element:

```html
<summary style="...">
  <unicode bell emoji><span class="notif-count">3</span>
</summary>
```

There is no `aria-label` on the summary element, and the bell emoji is not wrapped in a `<span aria-hidden="true">` with adjacent screen-reader-only text. Screen readers will either read "bell" (if they recognize the emoji) or announce nothing meaningful. The notification count badge has no screen-reader context (it will read as just "3" with no explanation).

Similarly, section headers use a lock emoji for tier-gated features with no accessible alternative.

**Impact:** Screen reader users cannot identify the notification bell or understand its count.

**Remediation:**
1. Add `aria-label="Notifications, 3 unread"` (dynamic count) to the `<summary>` element.
2. Add `aria-hidden="true"` to the emoji span.
3. Add screen-reader-only text for the lock emoji: `<span class="sr-only">Locked feature</span>`.

---

## Finding 06 — Command palette keyboard trap risk

**Severity: P2**
**Files:** `src/views/layout.ts` (lines 110-158)

The command palette (Cmd+K) uses a custom overlay and input field. The `onclick="closeCmdPalette()"` on the overlay handles mouse dismissal, and Escape key is handled. However:
- Focus is not trapped inside the palette when open. A user can tab past the input into background elements behind the overlay.
- When the palette closes, focus is not returned to the element that triggered it.
- The palette is not marked with `role="dialog"` or `aria-modal="true"`.

**Impact:** Keyboard users can tab behind the modal overlay, interacting with invisible elements.

**Remediation:**
1. Add `role="dialog" aria-modal="true" aria-label="Command palette"` to the palette container.
2. Implement focus trapping (first/last focusable element wrapping).
3. Restore focus to the trigger element on close.

---

## Finding 07 — Reading order matches visual order (partial credit)

**Severity: P2**
**Files:** `src/views/layout.ts`

The DOM order is: header -> next-action banner -> sidebar -> main content -> mobile bottom nav. This matches the visual reading order for both desktop (left sidebar, right content) and mobile (top-to-bottom). This is correct.

However, the sidebar is rendered before the main content in the DOM, meaning screen readers encounter 20+ navigation links before reaching the page content. Without a skip link (Finding 02), this creates a poor reading experience but is not technically incorrect reading order.

The notification dropdown (`<details>`) is positioned absolutely and will read in DOM order (inside the header), which is appropriate.

**Impact:** Low -- reading order is logically correct. The main concern is verbosity, addressed by the skip link recommendation in Finding 02.

**Remediation:** Addressed by Finding 02 (skip link).

---

## Summary Table

| # | Finding | Severity | File(s) |
|---|---------|----------|---------|
| 01 | Risk states are color-only (no redundant encoding) | P0 | `views/layout.ts`, `styles.css` |
| 02 | No ARIA landmarks or skip navigation | P1 | `views/layout.ts` |
| 03 | No focus-visible styles on interactive elements | P1 | `styles.css` |
| 04 | No prefers-reduced-motion support | P1 | `styles.css` |
| 05 | Notification bell emoji has no accessible label | P1 | `views/layout.ts` |
| 06 | Command palette is not a proper modal dialog | P2 | `views/layout.ts` |
| 07 | Reading order correct but verbose without skip link | P2 | `views/layout.ts` |

---

## Cross-References

- **Lens 08 (Accessibility):** This audit complements Lens 08 with specific focus on color-blind accessibility, landmarks, and reading order.
- **Lens 25 (Theme specialist):** Color contrast issues overlap with theme completeness findings.
- **Lens 16 (Product designer):** The signal number design (Finding 01) is both an accessibility and a design concern.
