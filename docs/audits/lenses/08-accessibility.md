# Lens 08 — Accessibility Audit

**Auditor perspective:** WCAG 2.1 AA compliance, keyboard navigation, screen reader support, color contrast, focus management, ARIA semantics, form labels, alt text, reduced motion.

**Date:** 2026-04-16
**Scope:** `src/views/layout.ts`, `src/views/components.ts`, `src/public/styles.css`, plus representative route files (`dashboard/index.ts`, `dashboard/decisions.ts`, `dashboard/settings.ts`, `dashboard/onboarding.ts`, `public/landing.ts`).

---

## Executive Summary

Foundry has some positive foundations: the layout uses `<html lang="en">`, viewport meta, semantic `<header>`, `<main>`, and `<nav>` elements, and the mobile bottom nav includes `role="navigation"` and `aria-label`. Forms in the onboarding flow use `<label for="">` correctly.

However, the product has **critical accessibility gaps** that would prevent WCAG 2.1 AA compliance and block users who rely on keyboard navigation, screen readers, or assistive technology from using core features. There is no skip-link, no reduced-motion support, no live regions for dynamic content, extensive use of color-only status communication, many unlabeled form inputs, missing focus indicators on interactive elements, and the command palette is completely inaccessible to screen readers.

---

## Findings

### F-08-01 | No skip navigation link — P1

**Location:** `src/views/layout.ts` (layout function, line 62-167)

There is no "Skip to main content" link anywhere in the layout. Keyboard users must tab through the entire header, command palette button, and every sidebar nav item (20+ links) on every page load before reaching page content.

**WCAG:** 2.4.1 Bypass Blocks (Level A)

**Recommendation:** Add a visually-hidden skip link as the first focusable element inside `<body>`:
```html
<a href="#main-content" class="sr-only" style="position:absolute;...">Skip to main content</a>
```
And add `id="main-content"` to the `<main>` element. The `.sr-only` class already exists in the CSS.

---

### F-08-02 | Desktop sidebar `<nav>` lacks accessible label — P1

**Location:** `src/views/layout.ts`, line 290

The desktop sidebar uses `<nav class="sidebar ...">` but has no `aria-label` or `aria-labelledby`. The mobile bottom nav correctly has `aria-label="Main navigation"`, but the desktop sidebar does not. When both navs are present in the DOM, screen readers cannot distinguish them.

**WCAG:** 1.3.1 Info and Relationships (Level A)

**Recommendation:** Add `aria-label="Sidebar navigation"` to the desktop `<nav>`.

---

### F-08-03 | No `prefers-reduced-motion` support — P1

**Location:** `src/public/styles.css` (entire file)

The stylesheet uses CSS transitions throughout (`transition: all var(--transition)`, `transition: color 0.6s ease`, `transition: width 0.4s ease`) and one keyframe animation (`slideUp` for milestone toasts). There is **zero** use of `@media (prefers-reduced-motion: reduce)` anywhere in the CSS. Users with vestibular disorders or motion sensitivity have no way to disable animations.

**WCAG:** 2.3.3 Animation from Interactions (Level AAA, but best practice for AA)

**Recommendation:** Add a media query block:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

### F-08-04 | Color-only risk state communication — P0

**Location:** `src/views/components.ts` (riskStateBadge), `src/views/layout.ts` (riskBadgeSmall, sidebar risk classes)

Risk states (GREEN/YELLOW/RED) are communicated primarily through color. The badge shows the word "GREEN", "YELLOW", or "RED" which partially mitigates this, but the sidebar itself uses `sidebar-risk-red` and `sidebar-risk-yellow` classes that change the active nav item's border color with no textual or icon-based alternative. The stressor severity items (`severity-critical`, `severity-elevated`, `severity-watch`) use only a colored left border to distinguish severity levels.

**WCAG:** 1.4.1 Use of Color (Level A)

**Evidence:**
- `src/public/styles.css` line 849: `.severity-critical { border-left-color: var(--risk-red); }` — no icon, no text indicator
- `src/views/components.ts` line 57-67: Stressor items use `severity-${s.severity}` class for color coding, with a small text badge but the overall item border is color-only
- Sidebar risk class changes only the active link border color

**Recommendation:** Add a visible icon or text prefix to severity indicators (e.g., a warning triangle for critical, a caution icon for elevated). The stressor badge partially helps but the left-border coloring on its own is insufficient for color-blind users to distinguish item severity at a glance.

---

### F-08-05 | Command palette completely inaccessible to screen readers — P0

**Location:** `src/views/layout.ts`, lines 109-158

The command palette (Cmd+K) has multiple accessibility failures:

1. **No ARIA role:** The palette is a plain `<div>` with no `role="dialog"`, `role="combobox"`, or `role="listbox"`. Screen readers see it as generic content.
2. **No `aria-label` or `aria-labelledby`:** The palette has no accessible name.
3. **Results are not announced:** The `cmd-results` div has no `aria-live` region. When results filter, screen readers get no notification.
4. **No `aria-activedescendant`:** Keyboard arrow navigation updates visual styling via inline JS but doesn't set `aria-activedescendant` on the input, so screen readers don't know which item is selected.
5. **Items are `<div>` elements with `onclick`:** Not focusable, not announced as options.
6. **Overlay dismissal:** The overlay uses `onclick="closeCmdPalette()"` on a div, not a button. Not keyboard-accessible (no Enter/Space handling, no focus trap).
7. **No focus trap:** When the palette opens, focus moves to the input, but there is no trap — Tab can escape into the page behind the overlay.

**WCAG:** 4.1.2 Name Role Value (Level A), 2.1.1 Keyboard (Level A), 1.3.1 Info and Relationships (Level A)

**Recommendation:** Rewrite the command palette as a proper combobox pattern (WAI-ARIA Combobox) or use `<dialog>` with proper roles. Alternatively, follow the [WAI-ARIA APG Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).

---

### F-08-06 | Focus indicators removed on key inputs — P1

**Location:** `src/public/styles.css`, lines 717, 1076, 1182

Three CSS rules set `outline: none` on form inputs:
- Line 717 (`.query-input`): `outline: none;`
- Line 1076 (`.chamber-reflect-input`): `outline: none;`
- Line 1182 (generic `input`, `textarea`, `select`): `outline: none;`

While the generic inputs get a `box-shadow` focus ring (`0 0 0 3px rgba(108,99,255,0.08)`), the focus ring is extremely subtle: `0.08` opacity on a dark background produces a barely-visible ring. The `.query-input` has slightly better treatment but the `.chamber-reflect-input` only gets `border-color` change with no ring at all.

**WCAG:** 2.4.7 Focus Visible (Level AA)

**Evidence:** `.query-input:focus` gets `box-shadow: 0 0 0 3px rgba(108,99,255,0.08)` — an 8% opacity ring is effectively invisible. Generic `input:focus` gets the same 8% ring.

**Recommendation:**
1. Increase focus ring visibility: `box-shadow: 0 0 0 3px rgba(108,99,255,0.35)` or use `outline` instead of removing it.
2. Add `:focus-visible` so mouse users aren't bothered but keyboard users get clear indication.
3. Add focus styles for `.chamber-reflect-input`.

---

### F-08-07 | Many form inputs lack associated `<label>` — P1

**Location:** Multiple routes and components

Many inputs across the application have `placeholder` text but no `<label>`, `aria-label`, or `aria-labelledby`. Screen readers will announce these as unlabeled inputs.

**Specific instances:**
- `layout.ts` line 113: Command palette input — no label, no `aria-label` (only `placeholder`)
- `layout.ts` line 179: Product switcher `<select>` — no label
- `components.ts` line 521: Competitor name input in competitive view — no label (only `placeholder`)
- `components.ts` lines 739-747: Competitor inputs in onboarding — labels say "Competitor 1" but use generic `<label>` without `for=` attributes matching `id` on inputs; inputs lack `id` entirely
- `decisions.ts` lines 136-152: "uncertainty" textarea and "chosen-option" input — `<label>` is present for chosen option container but the uncertainty textarea has a `<p>` instead of a `<label>`; `#chosen-option` has a `<label>` without `for` attribute
- `dashboard/index.ts` line 224: Query input — no label (only `placeholder`)
- `settings.ts` lines 153, 184: Read-only share link and ingest URL inputs — no labels
- Throughout `agents-experiments.ts`, `agents-actions.ts`, `signals-multimodal.ts`, `exit.ts`, `ambient.ts`: Numerous inputs with `placeholder` but no programmatic label

**WCAG:** 1.3.1 Info and Relationships (Level A), 4.1.2 Name Role Value (Level A)

**Recommendation:** Audit every `<input>`, `<textarea>`, and `<select>`. Either:
- Wrap in `<label>` elements, or
- Add `for="id"` on `<label>` matching `id` on the input, or
- Add `aria-label` for inputs that don't need visible labels (e.g., search inputs)

---

### F-08-08 | `target="_blank"` links lack `rel="noopener"` and context — P2

**Location:** `src/views/components.ts` lines 515, 633, 643, 1258; multiple route files

Links with `target="_blank"` do not include `rel="noopener noreferrer"` (security concern) and provide no indication to screen reader users that they open in a new window/tab.

**WCAG:** 3.2.5 Change on Request (Level AAA, but accessibility best practice)

**Recommendation:** Add `rel="noopener noreferrer"` to all `target="_blank"` links. Optionally add "(opens in new tab)" as visually-hidden text or use `aria-label` that includes the context.

---

### F-08-09 | No live regions for dynamic content updates — P1

**Location:** Multiple routes

The application has several areas where content updates dynamically (via JavaScript fetch or HTMX) with no `aria-live` regions to announce changes to screen readers:

1. **Query response** (`dashboard/index.ts`): AI answer replaces div content — no `aria-live`
2. **Decision resolve result** (`decisions.ts` line 155): Status message — no `aria-live`
3. **Outcome result** (`decisions.ts` line 177): Status message — no `aria-live`
4. **Reflect response** (`decisions.ts` line 141): AI clarity response — no `aria-live`
5. **HTMX one-thing banner** (`layout.ts` line 99): Loaded via `hx-get` — no `aria-live`
6. **Milestone toasts** (`views/components.ts`): Toasts appear/disappear — no `role="alert"` or `aria-live`
7. **Copy button feedback** (`settings.ts`): Button text changes to "Copied!" — no `aria-live`

**WCAG:** 4.1.3 Status Messages (Level AA)

**Recommendation:** Add `aria-live="polite"` to response containers. For critical alerts (errors, resolve confirmations), use `aria-live="assertive"` or `role="alert"`.

---

### F-08-10 | Notification bell has no accessible name — P1

**Location:** `src/views/layout.ts`, lines 189-211

The notification bell uses a `<details><summary>` pattern with the bell emoji as its only content. The `<summary>` has no `aria-label` and its visible content is just "bell emoji + count badge". Screen readers will announce this as something like "disclosure triangle, details" or may try to read the emoji unicode name.

**WCAG:** 4.1.2 Name Role Value (Level A)

**Recommendation:** Add `aria-label="Notifications, ${count} unread"` to the `<summary>` element.

---

### F-08-11 | Sidebar `<details>` sections not keyboard-friendly — P2

**Location:** `src/views/layout.ts`, line 298-300

The AGENTS section uses `<details open><summary>` for collapse/expand, but the summary's `list-style: none` hides the default disclosure triangle. CSS at line 66 styles `details summary { cursor: pointer; }` but there is no visual affordance that it's expandable/collapsible. The other sections (FORWARD, SIGNALS, etc.) are not in `<details>` — only AGENTS is, which is inconsistent.

**WCAG:** 3.2.4 Consistent Identification (Level AA)

---

### F-08-12 | Color contrast concerns with text on dark background — P1

**Location:** `src/public/styles.css`

Several text color values have low contrast against the backgrounds:

| Element | Foreground | Background | Approx Ratio | Required |
|---------|-----------|------------|--------------|----------|
| `.text-dim` / `.nav-section-header` | `#44445a` | `#111120` (surface) | ~1.8:1 | 4.5:1 |
| `.text-muted` | `#7878a0` | `#0a0a12` (bg) | ~3.5:1 | 4.5:1 |
| `.text-muted` | `#7878a0` | `#111120` (surface) | ~3.2:1 | 4.5:1 |
| `.signal-sparkline-label` | `var(--text-dim)` = `#44445a` | `#0a0a12` | ~1.7:1 | 4.5:1 |
| `.nav-lock` / `.nav-badge-pct` | `var(--text-dim)` 50% opacity | `#111120` | <1.5:1 | 4.5:1 |
| Locked items | `opacity: 0.5` applied to nav links | — | halves contrast | — |
| `.user-name` | `var(--text-muted)` | `var(--surface)` | ~3.2:1 | 4.5:1 |
| Badge text `.badge-watch` | `#9999cc` | `rgba(120,120,180,0.15)` on dark bg | ~3.8:1 | 4.5:1 |

**WCAG:** 1.4.3 Contrast Minimum (Level AA) — requires 4.5:1 for normal text, 3:1 for large text

**Recommendation:**
- `--text-muted` should be lightened to at least `#9898b8` or similar to hit 4.5:1
- `--text-dim` should be lightened to at least `#6868a0` — currently used for decorative/secondary content but also used for section headers, which carry navigational meaning
- Remove or reduce `opacity: 0.5` on locked items — use a different visual treatment

---

### F-08-13 | Interactive elements use `<div onclick>` instead of `<button>` — P1

**Location:** `src/views/layout.ts` line 110, 156

The command palette overlay (`<div id="cmd-overlay" ... onclick="closeCmdPalette()">`) is a click-to-dismiss area that keyboard users cannot activate. The command results items (`<div class="cmd-item" ... onclick="location.href='...'">`) are divs with click handlers — not focusable, not activatable via keyboard.

**WCAG:** 2.1.1 Keyboard (Level A)

**Recommendation:** Use `<button>` for interactive elements, or add `tabindex="0"`, `role="option"`, and keyboard event handlers. The overlay should use a proper `<dialog>` or at minimum handle Escape key (which it does, but the div itself is not keyboard-closable).

---

### F-08-14 | No `<h1>` in public layout / heading hierarchy issues — P2

**Location:** `src/views/layout.ts`, `src/routes/public/landing.ts`

The layout does not enforce heading hierarchy. The landing page places an `<h1>` inside content, but the "Foundry" logo link in the header is just an `<a>` — not a heading. This is acceptable. However:

- Some dashboard pages may render without an `<h1>` if the route content starts with `<h2>` or `<h3>`. The page-level heading comes from route content, not the layout.
- The `<title>` element properly includes the page name, which is good.

**WCAG:** 1.3.1 Info and Relationships (Level A), 2.4.6 Headings and Labels (Level AA)

**Recommendation:** Ensure every page has exactly one `<h1>`. Consider adding it in the layout for dashboard views.

---

### F-08-15 | Emoji used as functional icons without text alternatives — P2

**Location:** `src/views/layout.ts`, `src/views/components.ts`

Several functional indicators use emoji without text alternatives:
- Notification bell: `bell emoji` (line 193) — no text alternative
- Lock icon for gated features: `lock emoji` (`nav-lock`, line 349) — no `aria-label`
- Stressor meta: `hourglass emoji` (components.ts line 64) — decorative but conveys "time to material"
- Step completion in onboarding: colored `step-number` circles — partially accessible

**WCAG:** 1.1.1 Non-text Content (Level A)

**Recommendation:** Wrap functional emoji in `<span role="img" aria-label="Description">` or replace with SVG icons that have proper `aria-label`/`aria-hidden` attributes.

---

### F-08-16 | HTMX dynamic loading has no loading/error announcements — P2

**Location:** `src/views/layout.ts` line 99-103

The "one-thing banner" loads via HTMX (`hx-get`, `hx-trigger="load"`). There is no loading indicator for screen readers and no error handling announcement if the request fails. HTMX does support `hx-indicator` for loading states but it isn't used here.

**WCAG:** 4.1.3 Status Messages (Level AA)

---

### F-08-17 | Tables rendered as CSS grids instead of `<table>` — P2

**Location:** `src/views/components.ts` (cohortTable, auditComparison, competitiveView)

Tabular data (cohort retention, audit comparison, decision analytics) is rendered using `<div class="comparison-grid">` with CSS grid layout instead of semantic `<table>`, `<thead>`, `<th>`, `<tbody>`, `<tr>`, `<td>` elements. Screen readers cannot navigate this data as a table (row/column headers, cell navigation).

**WCAG:** 1.3.1 Info and Relationships (Level A)

**Evidence:** `src/views/components.ts` lines 447-476 (cohort table) and lines 213-246 (audit comparison) use `<div class="comp-header">` and `<div class="comp-row">` instead of proper table markup.

**Recommendation:** Use semantic `<table>` elements with `<th scope="col">` for column headers and `<th scope="row">` for row headers. CSS can still style them as grids if needed.

---

### F-08-18 | Wisdom toggle checkbox has no accessible state announcement — P2

**Location:** `src/routes/dashboard/settings.ts`, lines 123-134

The wisdom network toggle is a styled checkbox inside a `<label>` with `title` attribute but no `aria-checked` or accessible state indication beyond the native checkbox. The visual toggle track/thumb provides feedback, but:
- The `<label>` wrapping lacks text (it has a `title` but no visible or screen-reader text for the toggle itself)
- The `onchange="this.closest('form').submit()"` auto-submits with no confirmation — page reloads silently

**WCAG:** 4.1.2 Name Role Value (Level A)

---

### F-08-19 | Mobile bottom nav has 5 items but CSS grid shows 4 columns — P3

**Location:** `src/views/layout.ts` lines 324-346, `src/public/styles.css` line 1366

The mobile bottom nav renders 5 tabs (Signal, Decisions, Agents, Plan, More) but the CSS declares `grid-template-columns: repeat(4, 1fr)`. The 5th item ("More") wraps or overflows. This may cause visual and touch-target issues on small screens.

**Recommendation:** Change to `repeat(5, 1fr)` to accommodate all items properly.

---

### F-08-20 | No visible focus styles on sidebar links, buttons, or card links — P1

**Location:** `src/public/styles.css`

There are no `:focus` or `:focus-visible` styles defined for:
- `.sidebar-nav a` — only has `:hover` styles
- `.btn` — no focus style at all (only hover)
- `.signal-action` — link blocks, no focus style
- `.decision-card` wrapper `<a>` — no focus style
- `.dashboard-summary-card` — no focus style
- `.portfolio-card` — no focus style
- `.mbn-tab` — mobile nav tabs, no focus style
- `.tab-btn` — tab navigation buttons, no focus style

Keyboard users navigating through the sidebar, buttons, or card grids will see no focus indicator at all (the browser default outline is removed by some normalize/reset behavior in the dark theme).

**WCAG:** 2.4.7 Focus Visible (Level AA)

**Recommendation:** Add visible `:focus-visible` styles to all interactive elements. For dark themes, a common pattern:
```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

---

## Summary Table

| ID | Finding | Severity | WCAG |
|----|---------|----------|------|
| F-08-01 | No skip navigation link | P1 | 2.4.1 A |
| F-08-02 | Desktop sidebar nav lacks aria-label | P1 | 1.3.1 A |
| F-08-03 | No prefers-reduced-motion support | P1 | 2.3.3 AAA (best practice) |
| F-08-04 | Color-only risk/severity communication | P0 | 1.4.1 A |
| F-08-05 | Command palette inaccessible to screen readers | P0 | 4.1.2 A, 2.1.1 A |
| F-08-06 | Focus indicators removed / near-invisible | P1 | 2.4.7 AA |
| F-08-07 | Many form inputs lack labels | P1 | 1.3.1 A, 4.1.2 A |
| F-08-08 | target="_blank" missing rel and context | P2 | 3.2.5 AAA |
| F-08-09 | No live regions for dynamic content | P1 | 4.1.3 AA |
| F-08-10 | Notification bell has no accessible name | P1 | 4.1.2 A |
| F-08-11 | Sidebar details sections inconsistent | P2 | 3.2.4 AA |
| F-08-12 | Color contrast below 4.5:1 on multiple elements | P1 | 1.4.3 AA |
| F-08-13 | div+onclick instead of button/link | P1 | 2.1.1 A |
| F-08-14 | Heading hierarchy not enforced | P2 | 1.3.1 A |
| F-08-15 | Emoji as functional icons without alt | P2 | 1.1.1 A |
| F-08-16 | HTMX loads with no a11y announcements | P2 | 4.1.3 AA |
| F-08-17 | Tabular data in div grids, not tables | P2 | 1.3.1 A |
| F-08-18 | Toggle checkbox has no accessible label | P2 | 4.1.2 A |
| F-08-19 | Mobile nav 5 items / 4 columns mismatch | P3 | — |
| F-08-20 | No focus styles on most interactive elements | P1 | 2.4.7 AA |

**P0 findings:** 2 (color-only risk communication; command palette inaccessible)
**P1 findings:** 9 (skip link, sidebar label, reduced motion, focus indicators, form labels, live regions, notification bell, contrast, div+onclick, missing focus styles)
**P2 findings:** 7
**P3 findings:** 1

---

## Recommended Fix Priority

1. **Immediate (P0):** Fix command palette ARIA roles + keyboard access. Add non-color severity indicators.
2. **Sprint 1 (P1):** Add skip link. Add focus-visible styles globally. Fix contrast ratios. Add aria-labels to sidebar nav and notification bell. Add labels to form inputs. Add aria-live regions for dynamic updates.
3. **Sprint 2 (P2):** Convert div-grids to semantic tables. Add reduced-motion support. Fix emoji accessibility. Add heading hierarchy enforcement. Fix target="_blank" links.
