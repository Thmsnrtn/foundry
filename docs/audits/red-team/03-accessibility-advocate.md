# RT-03 -- Accessibility Advocate

**Persona:** Screen-reader-only, keyboard-only user. Uses VoiceOver/NVDA daily. Refuses to touch a mouse. Files ADA complaints for breakfast.

**Date:** 2026-04-16
**Objective:** Navigate the entire Foundry dashboard using only keyboard + screen reader. Every flow. Every modal. Every form.

---

## Session Narrative

### Attempt 1: I land on the page. Where am I?

I load `/dashboard`. VoiceOver announces "Foundry" and starts reading the header. Good news: the page has `<html lang="en">` so my screen reader knows it is English. The `<title>` reads "Dashboard -- Foundry" which is acceptable.

Bad news: **there is no skip link in the rendered HTML**. The `styles.css` has a `.skip-link` class defined at line 1516, but `layout.ts` never renders an element with that class. The CSS exists. The HTML does not. The skip link is a ghost.

I must tab through the entire header (logo link, product switcher, risk badge, notification bell, user name, "Settings" link) then the entire sidebar (the "Go anywhere" button, 20+ sidebar nav links across 6 sections) before I reach `<main>`. That is approximately 30 tab stops before I can interact with actual page content.

**Evidence:**
- `src/public/styles.css` lines 1516-1528: `.skip-link` and `.skip-link:focus` fully styled
- `src/views/layout.ts` lines 62-167: no `<a class="skip-link">` anywhere in the `<body>`
- Verdict: someone wrote the CSS, nobody wrote the HTML

**Severity: P0** -- WCAG 2.4.1 (Level A) -- Bypass Blocks

---

### Attempt 2: I try the Command Palette (Cmd+K)

I press Cmd+K. The palette opens. Focus moves to the input. So far so good.

But the palette is a pair of raw `<div>` elements (id="cmd-overlay" and id="cmd-palette"). There is:
- No `role="dialog"` or `role="combobox"`
- No `aria-label` or `aria-labelledby`
- No `aria-modal="true"` on the palette
- No focus trap -- I can Tab right out of the palette into the page behind it
- The results are `<div class="cmd-item" onclick="location.href='...'">` -- not `<button>`, not `<a>`, not `<li role="option">`
- No `aria-activedescendant` on the input -- arrow key navigation changes visual style via inline JS but my screen reader has no idea which item is "selected"
- The overlay is a `<div onclick="closeCmdPalette()">` -- not keyboard-activatable (no Enter/Space handler, no focus)
- `aria-live` region for result count: none

The command palette is the primary navigation mechanism (it is the first interactive element in the sidebar, labeled "Go anywhere"). For a keyboard+screen-reader user, it is a dead end.

**Evidence:**
- `src/views/layout.ts` lines 109-158: entire command palette implementation
- Line 113: `<input id="cmd-input" ... placeholder="Go anywhere..."` -- no `aria-label`, no `<label>`
- Line 117: `<div id="cmd-results">` -- no `aria-live`
- Line 156: `renderCmdResults` builds `<div class="cmd-item" onclick="location.href='...'">` -- divs with onclick handlers

**Severity: P0** -- WCAG 4.1.2 (Level A) Name/Role/Value, 2.1.1 (Level A) Keyboard

---

### Attempt 3: I look at the Signal Dashboard

The Signal score is rendered as a `<button>` with `aria-haspopup="dialog"` and `onclick` to open a `<dialog>` element. This is actually correct usage. The `<dialog>` has a close button with `aria-label="Close"`. Small win.

But the sparkline SVG has `aria-hidden="true"` which is correct, and the trend label next to it provides the textual equivalent. Another small win.

The query bar (`#query-input`) has no `<label>` and no `aria-label`. It has only `placeholder="Ask anything about your business..."`. Placeholders are not labels -- they disappear when you type, and some screen readers skip them. The query response container (`#query-response`) has no `aria-live` region, so when the AI answer appears, my screen reader is not notified.

**Evidence:**
- `src/routes/dashboard/index.ts` line 224: `<input ... class="query-input" id="query-input" placeholder="Ask anything..." />`
- Line 228: `<div class="query-response" id="query-response"></div>` -- no `aria-live`

**Severity: P1** -- WCAG 1.3.1 (Level A), 4.1.3 (Level AA) Status Messages

---

### Attempt 4: Notification Bell

The notification bell is a `<details><summary>` containing the bell emoji and a count badge. The `<summary>` has no `aria-label`. My screen reader announces: "disclosure triangle, bell emoji" or possibly "details" depending on the reader. I have no idea what this element does. The unread count badge is a `<span>` inside the summary but with no `aria-label` that combines the semantics (e.g., "Notifications, 3 unread").

The dropdown content appears below. There is no focus management -- opening the details element does not move focus into the dropdown. There is no Escape-to-close behavior. There is no focus trap. If I Tab past the last notification item, focus jumps to wherever the next DOM element is.

**Evidence:**
- `src/views/layout.ts` lines 189-211: `notificationBell()` function
- Line 192-193: `<summary style="list-style:none;cursor:pointer;padding:4px 8px;position:relative;"> bell emoji ${count badge}`

**Severity: P1** -- WCAG 4.1.2 (Level A)

---

### Attempt 5: Product Switcher

The product switcher is a `<select>` with `onchange="this.form.submit()"`. The `<select>` has no associated `<label>`, no `aria-label`, and no `id` to match a `for` attribute. My screen reader announces it as an unlabeled combobox.

Worse: changing the selection immediately submits the form with no confirmation. There is no undo. Auto-submitting selects are a known accessibility antipattern because screen readers trigger the `change` event while navigating options, causing an unwanted full-page reload on every arrow-key press in some screen reader modes.

**Evidence:**
- `src/views/layout.ts` lines 174-185: `productSwitcher()` function
- Line 179: `<select name="product_id" onchange="this.form.submit()">`

**Severity: P1** -- WCAG 3.2.2 (Level A) On Input

---

### Attempt 6: Delete Confirmation Modal

The "Delete My Data" button opens a modal via `document.getElementById('delete-modal').style.display='flex'`. This modal:
- Is a raw `<div>` with no `role="dialog"` or `role="alertdialog"`
- Has no `aria-modal="true"`
- Has no `aria-labelledby` pointing to the "Confirm Data Deletion" heading
- Has no focus trap
- Does not move focus to itself when opened
- Escape key does not close it (no keydown handler)
- The Cancel button uses `onclick` to hide it via `style.display='none'` -- works, but keyboard focus is not returned to the trigger element

Compare this with the Signal Anatomy dialog which correctly uses the native `<dialog>` element. The delete confirmation should do the same.

**Evidence:**
- `src/routes/dashboard/privacy.ts` lines 291-309: delete modal markup
- One `<dialog>` in the entire codebase (`src/routes/dashboard/index.ts` line 75) -- everything else uses `<div>` overlays

**Severity: P1** -- WCAG 2.1.1 (Level A) Keyboard, 4.1.2 (Level A) Name/Role/Value

---

### Attempt 7: Sidebar Navigation

The desktop sidebar `<nav>` now... wait. Let me check.

`<nav class="sidebar ${riskClass}">` -- no `aria-label`. The mobile bottom nav has `aria-label="Main navigation"` but the desktop sidebar does not. When both navs are in the DOM, screen readers cannot distinguish them.

The AGENTS section is wrapped in `<details open><summary>` which is semantically correct for expand/collapse, but the summary renders just the text "AGENTS" with no ARIA hint that it is collapsible. The other sections (FORWARD, SIGNALS, AUTONOMY, SYSTEM) are NOT wrapped in `<details>` -- they are just `<div class="nav-section-header">`. Inconsistent interaction model.

**Evidence:**
- `src/views/layout.ts` line 290: `<nav class="sidebar ${riskClass}">` -- no `aria-label`
- Lines 298-301: AGENTS in `<details open>`, other sections are plain divs

**Severity: P1** -- WCAG 1.3.1 (Level A)

---

### Attempt 8: Focus Indicators

Phase 3 CSS (lines 1478-1502) adds `*:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` and specific styles for sidebar links, buttons, etc. This is a significant improvement over what Lens 08 reported.

However, the earlier rules still exist:
- Line 717: `.query-input { outline: none; }` with `:focus` getting `box-shadow: 0 0 0 3px rgba(108,99,255,0.08)` -- an 8% opacity ring, barely visible
- Line 1076: `.chamber-reflect-input:focus { border-color: rgba(108,99,255,0.4); }` -- border-only change
- Line 1182: generic `input, textarea, select` has `outline: none` with an 8% opacity box-shadow

The Phase 3 `*:focus-visible` selector should override these, but specificity matters. `.query-input:focus` is more specific than `*:focus-visible`. The query input's near-invisible 8% ring wins. Same for `.chamber-reflect-input:focus`. The generic `input:focus` (line 1213) also wins over `input:focus-visible` (line 1493) because the `:focus` rule exists and the `:focus:not(:focus-visible)` rule at line 1485 only removes `outline`, not the `box-shadow`.

So: the Phase 3 fix helps nav links and buttons, but **form inputs still have near-invisible focus indicators**.

**Evidence:**
- CSS specificity conflict between lines 717/1076/1182-1213 and lines 1478-1502
- The `box-shadow: 0 0 0 3px rgba(108,99,255,0.08)` is effectively invisible on a `#0a0a12` background

**Severity: P1** -- WCAG 2.4.7 (Level AA) Focus Visible

---

### Attempt 9: Form Labels Across the Dashboard

I audited form inputs across multiple routes:

| Location | Element | Has `<label>`? | Has `aria-label`? | Screen Reader Announcement |
|----------|---------|---------------|-------------------|---------------------------|
| `layout.ts:113` | Command palette input | No | No | "edit text" (unlabeled) |
| `layout.ts:179` | Product switcher select | No | No | "popup button" (unlabeled) |
| `dashboard/index.ts:224` | Query input | No | No | "edit text" (unlabeled) |
| `settings.ts:153` | Share link input | No | No | "edit text" (unlabeled) |
| `settings.ts:184` | Ingest URL input | No | No | "edit text" (unlabeled) |
| `privacy.ts:221` | Preferred Region select | **Yes** | -- | Properly labeled |
| `privacy.ts:231` | Retention select | **Yes** | -- | Properly labeled |
| `privacy.ts:240` | Agent Log Retention select | **Yes** | -- | Properly labeled |

The Privacy page has proper labels. Everything else does not.

**Severity: P1** -- WCAG 1.3.1 (Level A), 4.1.2 (Level A)

---

### Attempt 10: Live Regions

Only ONE `aria-live` or `role="status"` exists in the entire codebase -- `components.ts` line 33 has `role="status"` on the risk state badge (added with the `A11Y-04` comment).

Zero `aria-live` regions. Zero `role="alert"` elements. The following dynamic content changes are invisible to screen readers:
1. Query response appearing after "Ask Foundry" submission
2. "Copied!" feedback on copy buttons (settings page)
3. HTMX one-thing banner loading (`hx-get="/api/priority/one-thing"`)
4. Decision resolve confirmation
5. Milestone toasts appearing/disappearing
6. Command palette result count changing as user types

**Evidence:**
- `grep -r 'aria-live' src/` returns zero matches
- `grep -r 'role="alert"' src/` returns zero matches
- Single `role="status"` in `components.ts`

**Severity: P1** -- WCAG 4.1.3 (Level AA) Status Messages

---

### Attempt 11: Color Contrast

The Phase 3 CSS did not address the contrast issues identified in Lens 08:
- `--text-dim` (`#44445a`) on `--bg` (`#0a0a12`): approximately 1.8:1 -- used for section headers, sparkline labels
- `--text-muted` (`#7878a0`) on `--surface` (`#111120`): approximately 3.2:1 -- used for body text in muted contexts, user name
- Locked nav items at `opacity: 0.5` halve whatever contrast the text had

Section headers like "AGENTS", "FORWARD", "SIGNALS" use `--text-dim`. These carry navigational meaning. A 1.8:1 ratio fails the 4.5:1 requirement for normal text by a factor of 2.5x.

**Severity: P1** -- WCAG 1.4.3 (Level AA) Contrast Minimum

---

### Attempt 12: Reduced Motion

Phase 3 CSS (lines 1506-1513) adds `@media (prefers-reduced-motion: reduce)` that zeros out animation and transition durations. This directly fixes what Lens 08 reported. Verified present.

**Status: FIXED**

---

### Attempt 13: Tabular Data

Cohort retention tables, audit comparison grids, and competitive analysis tables are rendered using `<div>` with CSS grid classes (`comparison-grid`, `comp-header`, `comp-row`) instead of semantic `<table>` elements. Screen readers cannot navigate these as tables -- no row/column header association, no cell navigation.

**Severity: P2** -- WCAG 1.3.1 (Level A)

---

## Summary of Findings

| ID | Finding | Severity | WCAG | Status |
|----|---------|----------|------|--------|
| RT-03-01 | Skip link CSS exists but HTML element is never rendered | P0 | 2.4.1 A | OPEN |
| RT-03-02 | Command palette: no ARIA roles, no focus trap, no keyboard nav semantics | P0 | 4.1.2 A, 2.1.1 A | OPEN |
| RT-03-03 | Query input and response: no label, no live region | P1 | 1.3.1 A, 4.1.3 AA | OPEN |
| RT-03-04 | Notification bell: no accessible name, no focus management | P1 | 4.1.2 A | OPEN |
| RT-03-05 | Product switcher: no label, auto-submit on change (screen-reader hostile) | P1 | 3.2.2 A | OPEN |
| RT-03-06 | Delete modal: raw div, no dialog role, no focus trap, no Escape handling | P1 | 2.1.1 A, 4.1.2 A | OPEN |
| RT-03-07 | Desktop sidebar nav: no aria-label, inconsistent details/non-details sections | P1 | 1.3.1 A | OPEN |
| RT-03-08 | Form input focus rings: 8% opacity box-shadow overrides Phase 3 focus-visible | P1 | 2.4.7 AA | OPEN |
| RT-03-09 | 5+ form inputs without any programmatic label | P1 | 1.3.1 A, 4.1.2 A | OPEN |
| RT-03-10 | Zero aria-live regions across entire codebase (1 role="status" only) | P1 | 4.1.3 AA | OPEN |
| RT-03-11 | Color contrast failures: text-dim 1.8:1, text-muted 3.2:1 | P1 | 1.4.3 AA | OPEN |
| RT-03-12 | Reduced motion media query added | -- | 2.3.3 | FIXED |
| RT-03-13 | Tabular data rendered as div grids, not semantic tables | P2 | 1.3.1 A | OPEN |

**P0: 2 | P1: 9 | P2: 1 | Fixed: 1**

---

## Verdict

Foundry is unusable for keyboard-only and screen-reader users on critical paths. The command palette -- the product's primary "Go anywhere" feature -- is completely opaque to assistive technology. A skip link was designed in CSS but never shipped in HTML, which is worse than never having thought of it at all (it means someone knew, started, and didn't finish). Form labels are missing on the most-used inputs. The single `role="status"` in the codebase is a rounding error against the 12+ dynamic content regions that update without announcement.

The Phase 3 CSS additions (focus-visible, reduced-motion, skip-link styles) show intent. The HTML never followed through. Intent does not pass an audit.
