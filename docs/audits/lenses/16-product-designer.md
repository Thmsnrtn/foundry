# Lens 16 — Apple-Trained Product Designer

## Executive Summary

Foundry has the bones of a beautiful instrument. The dark palette, the typographic Signal number, the restraint of the sidebar, and the Decision Chamber's focused layout all suggest someone with taste built this. But taste without rigor produces inconsistency, and that is exactly where this product sits: a promising design system undermined by roughly 3,000 inline styles across 49 route files, hardcoded light-mode hex colors embedded in a dark-first UI, zero focus-visible declarations anywhere, no skeleton/shimmer loading states, no prefers-reduced-motion respect, a mobile bottom nav that renders 5 tabs in a 4-column grid, and a pricing page whose CSS classes do not exist in the stylesheet. The result is a product that looks intentional at first glance and falls apart under scrutiny — exactly the kind of thing a senior Apple designer would notice in the first 60 seconds.

## Findings

### PD-01 Inline Style Epidemic — 3,000+ Occurrences Across Route Files
- **Severity:** P1
- **Description:** There are 126 inline `style=` attributes in `components.ts`, 76 in `landing.ts`, and 2,909 across 49 dashboard route files. This defeats the design system entirely. Colors like `#f3f4f6`, `#d1d5db`, `#6b7280`, `#4b5563`, `#f0f9ff`, `#ecfdf5`, `#fef2f2` appear scattered as hardcoded hex values in template literals — these are Tailwind gray/blue/green/red palette colors that belong in CSS custom properties, not sprinkled inline. The inline styles make the product impossible to retheme, impossible to audit for visual consistency, and produce unpredictable specificity conflicts with the stylesheet.
- **Evidence:** `src/views/components.ts` (65 instances of light-mode hex colors), `src/routes/dashboard/agents.ts:144` (inline card with `var(--bg-card)` which is not defined in styles.css), `src/routes/dashboard/agents-experiments.ts` (26 hardcoded hex colors), `src/routes/public/landing.ts` (76 inline styles). Nearly every component in `components.ts` from line 370 onward uses inline `style=` for layout, color, and spacing.
- **Remediation:** Extract all inline styles into named CSS classes in `styles.css`. Replace every hardcoded hex with a CSS custom property. The existing custom property system (`--text-muted`, `--surface-2`, etc.) is solid — the problem is that half the codebase ignores it. Establish a rule: zero inline styles except computed values (e.g., bar widths for data visualization).
- **Target Phase:** Phase 3

### PD-02 Light-Mode Colors in a Dark-First UI
- **Severity:** P1
- **Description:** Components use hardcoded light-mode background colors (`#f0f9ff`, `#ecfdf5`, `#fef2f2`, `#fffbeb`, `#f9fafb`, `#f0fdf4`, `#e5e7eb`) for semantic states like recommendations, success indicators, warnings, and scenario cards. These produce jarring white/pastel rectangles inside a dark `#0a0a12` background. The `nextActionCard` component (components.ts:817-831) uses `#fef2f2` (light red) and `#fecaca` (light pink border) for critical actions — these are unreadable and visually broken against the dark surface. The `pageHintBanner` (components.ts:951-962), `optionsList` (components.ts:381), `scenarioCards` (components.ts:396-398), and `decisionDetail recommendation` block (components.ts:367-369) all have the same problem.
- **Evidence:** `src/views/components.ts:367` (`background:#f0f9ff` — light blue on dark), `src/views/components.ts:396-398` (best/base/stress case cards using `#ecfdf5`, `#f0f9ff`, `#fef2f2`), `src/views/components.ts:812-830` (nextActionCard critical/elevated/normal all light-mode), `src/views/components.ts:951-962` (pageHintBanner with light backgrounds), `src/views/components.ts:801-802` (lifecycle condition "Met" badge uses `#d1fae5` with `#065f46` text).
- **Remediation:** Replace all hardcoded light-mode hex values with dark-mode-aware custom properties. Add semantic color tokens: `--surface-success`, `--surface-warning`, `--surface-danger`, `--surface-info` following the pattern already established for risk states (e.g., `rgba(78,204,163,0.06)` for green). The risk state card in the stylesheet already does this correctly — apply the same approach everywhere.
- **Target Phase:** Phase 3

### PD-03 No Focus-Visible Styles — Keyboard Navigation is Invisible
- **Severity:** P1
- **Description:** The stylesheet contains zero `:focus-visible` declarations. The only `:focus` styles apply to form inputs (query-input, chamber-reflect-input, and generic inputs). Every button, link, sidebar nav item, card, tab, mobile nav tab, command palette item, notification bell, and toggle lacks a visible focus indicator. A keyboard-only user cannot navigate this product at all. This is both an accessibility failure and a design failure — Apple's HIG mandates visible focus states for every interactive element.
- **Evidence:** `src/public/styles.css` — searched for `:focus-visible` and `:focus`, found only 3 occurrences, all on form inputs (lines 722, 1081, 1186). No focus styles on `.btn`, `.sidebar-nav a`, `.signal-action`, `.tab-btn`, `.mbn-tab`, `.portfolio-card`, `.decision-card`, `.cmd-item`, `.notif-bell summary`, or any other interactive element.
- **Remediation:** Add a global `*:focus-visible` rule with a 2px ring using `--accent` (matching the existing input focus ring pattern). Then add specific focus-visible overrides for elements that need custom treatment (e.g., sidebar nav items should show the same style as hover, portfolio cards should show the lift animation).
- **Target Phase:** Phase 3

### PD-04 No Loading States — No Skeletons, No Shimmer, No Feedback
- **Severity:** P1
- **Description:** The product has exactly one loading state: the query response shows the word "Thinking" in muted text (dashboard index.ts:273). There are no skeleton screens, no shimmer animations, no loading spinners anywhere. The dashboard fetches 6 parallel data sources (`computeSignal`, `getActiveStressors`, `getSignalHistory`, `getDailyInsight`, `getPreviousSignalScore`, `getLatestBriefing`) — if any are slow, the user sees a white/blank screen until all resolve. Since this is server-rendered HTML, the browser shows nothing until the full response arrives. The `agents.ts` roster page queries the database and renders 12 agent cards — again, blank screen during load. HTMX is loaded but used in exactly one place (the "one-thing" banner on the dashboard).
- **Evidence:** `src/public/styles.css` — no `.skeleton`, `.shimmer`, `.loading`, `.spinner` classes anywhere. `src/routes/dashboard/index.ts:141` — 6 parallel awaits with no streaming or progressive rendering. `src/views/layout.ts:71` — HTMX loaded globally but `hx-` attributes appear only at line 100-102. Only loading indicator: `src/routes/dashboard/index.ts:273` (`responseEl.textContent = 'Thinking'`).
- **Remediation:** For server-rendered pages: implement streaming HTML using Hono's streaming support — render the layout shell immediately, then stream content sections as data becomes available. For HTMX partials: add skeleton placeholder HTML with shimmer animation that gets replaced when the response arrives. Add CSS for `.skeleton` (pulsing gray bar) and `.skeleton-card` (full card placeholder). For client-side fetches (query, reflect, resolve): show a proper shimmer animation, not plain text.
- **Target Phase:** Phase 3

### PD-05 No `prefers-reduced-motion` Respect
- **Severity:** P1
- **Description:** The stylesheet has no `@media (prefers-reduced-motion)` query. There is one `@keyframes slideUp` animation for milestone toasts and numerous CSS transitions (150ms ease on most interactive elements, 0.6s ease on the signal number color, 0.4s ease on dimension bars, 0.3s on various elements). Users who have requested reduced motion in their OS preferences will still see all animations and transitions. This is a WCAG 2.1 AA violation and an Apple HIG expectation.
- **Evidence:** `src/public/styles.css` — searched for `prefers-reduced-motion`, zero results. `@keyframes slideUp` at line 1327. Transition declarations at lines 35, 55, 102, 118, 169, 330, 373, 414, 560, 718, 783, 914, 971, 1077, 1135, 1183, 1275, 1277, 1282, 1374, 1411, 1415.
- **Remediation:** Add `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }` at the end of the stylesheet. Then selectively restore transitions where removal would harm understanding (e.g., the dimension bar fill can keep a fast transition for comprehension).
- **Target Phase:** Phase 3

### PD-06 Mobile Bottom Nav: 5 Tabs in 4-Column Grid
- **Severity:** P1
- **Description:** The mobile bottom navigation renders 5 tabs (Signal, Decisions, Agents, Plan, More) but the CSS grid is `grid-template-columns: repeat(4, 1fr)`. The fifth tab wraps to a second row or overflows, breaking the mobile navigation entirely. This is a fundamental layout bug that makes the mobile experience unusable.
- **Evidence:** `src/views/layout.ts:324-346` — function `mobilBottomNav` renders 5 `tab()` calls. `src/public/styles.css:1366` — `.mobile-bottom-nav` has `grid-template-columns: repeat(4, 1fr)`.
- **Remediation:** Change the grid to `repeat(5, 1fr)`. Alternatively, reduce to 4 tabs by folding "More" into a popover or combining Plan into another tab.
- **Target Phase:** Phase 3

### PD-07 Pricing Page CSS Classes Do Not Exist
- **Severity:** P1
- **Description:** The pricing page (`landing.ts:152-202`) uses CSS classes `.pricing-grid`, `.pricing-card`, `.pricing-card.featured`, `.pricing-tier`, `.pricing-price`, and `.pricing-features` — none of which are defined in `styles.css`. The pricing page renders with zero styling on its structural elements. This is the public-facing page that converts visitors to customers.
- **Evidence:** `src/routes/public/landing.ts:152` — uses `.pricing-grid`, `.pricing-card`, `.pricing-tier`, `.pricing-price`, `.pricing-features`. Searched `src/public/styles.css` for all five class names — zero matches.
- **Remediation:** Add pricing component styles to `styles.css`. The pricing cards should follow the existing card pattern but with differentiated visual treatment for the featured tier (accent border, subtle glow). Minimum: grid layout, card structure, tier label, price typography, feature list.
- **Target Phase:** Phase 3

### PD-08 No `prefers-color-scheme` — Dark-Only With No Escape
- **Severity:** P2
- **Description:** The product is dark-mode only. There is no light mode and no `@media (prefers-color-scheme: light)` query. The `:root` custom properties define a single dark palette. While a dark-first design is a legitimate choice, providing no light mode alternative means users in bright environments (outdoor, sunny offices) have no recourse. More critically, the absence of a toggle or system-preference detection means this is not a deliberate design decision — it is an omission.
- **Evidence:** `src/public/styles.css:7-36` — single set of custom properties with dark values. No `prefers-color-scheme` media query anywhere. No theme toggle in the UI.
- **Remediation:** Phase 3 should add a `@media (prefers-color-scheme: light)` block that overrides the custom properties. Because the design system already uses custom properties consistently in the stylesheet (the problem is the inline styles), the light mode can be added in one CSS block — once the inline-style problem (PD-01/PD-02) is fixed.
- **Target Phase:** Phase 3

### PD-09 Typography Scale Lacks Rhythm — Ad-Hoc Sizes Everywhere
- **Severity:** P2
- **Description:** The stylesheet defines a clean typographic hierarchy (h1: 1.55rem, h2: 1.25rem, h3: 1rem) with negative letter-spacing for headings. But route files and components override this constantly with inline font-size declarations. A search finds font sizes including: 0.65rem, 0.68rem, 0.7rem, 0.72rem, 0.75rem, 0.76rem, 0.78rem, 0.8rem, 0.82rem, 0.84rem, 0.85rem, 0.87rem, 0.9rem, 0.92rem, 0.95rem, 1rem, 1.05rem, 1.1rem, 1.2rem, 1.4rem, 1.5rem, 1.55rem, 1.6rem, 1.75rem, 2rem, 2.5rem, 3rem, 3.5rem, 5rem, 6rem, 9rem. That is 31 distinct font sizes with no discernible scale. Apple HIG uses a type ramp with exactly 11 sizes (Large Title through Caption 2). A well-designed product should have 6-8 sizes maximum.
- **Evidence:** All of `src/public/styles.css`, `src/views/components.ts`, and `src/routes/` directory. The sizes cluster around the 0.7-0.9rem range with increments of 0.02-0.05rem — differences that are invisible to users but create maintenance burden and visual noise.
- **Remediation:** Define a type ramp as custom properties: `--text-xs: 0.72rem`, `--text-sm: 0.82rem`, `--text-base: 0.92rem`, `--text-lg: 1.05rem`, `--text-xl: 1.25rem`, `--text-2xl: 1.55rem`, `--text-display: 2.5rem`, `--text-signal: 9rem`. Map all existing sizes to the nearest step. Enforce via code review.
- **Target Phase:** Phase 3

### PD-10 Sidebar Inconsistency — `<details>` Used for One Group Only
- **Severity:** P2
- **Description:** The AGENTS section in the sidebar uses a `<details open>` element for collapsibility, but FORWARD, SIGNALS, AUTONOMY, and SYSTEM sections are static `<ul>` groups with no collapse behavior. This creates an inconsistent interaction model — one group is collapsible and the others are not. Either all groups should be collapsible (using `<details>`) or none should be. The current state looks like an incomplete implementation.
- **Evidence:** `src/views/layout.ts:298-300` — AGENTS uses `<details open>`, `src/views/layout.ts:303-315` — all other sections use `sectionHeader()` + `<ul>` without `<details>`.
- **Remediation:** Wrap all section groups in `<details open>` for consistent collapsibility. Add a subtle disclosure triangle indicator via CSS for `details > summary` within the sidebar. This improves information density management for founders with many sections.
- **Target Phase:** Phase 3

### PD-11 Empty States Are Text-Only — No Illustration, No Hierarchy
- **Severity:** P2
- **Description:** The `emptyState` component (components.ts:310-316) renders centered text with an optional button. There is no icon, no illustration, no visual weight. The CSS (styles.css:1202) gives it `padding: 3rem 1rem` and `color: var(--text-muted)` — a single muted paragraph floating in space. Apple's empty states use illustration, a primary message, a secondary explanation, and a CTA — four layers of hierarchy. Foundry's empty states have one layer. The agent roster empty state (agents.ts:143-154) is better — it has an emoji, heading, description, and button — but it uses all inline styles and does not use the `emptyState` component.
- **Evidence:** `src/views/components.ts:310-316` — the `emptyState` function. `src/public/styles.css:1201-1203` — minimal styling. `src/routes/dashboard/agents.ts:143-154` — custom inline empty state that is better but inconsistent. `src/views/components.ts:932-941` — `emptyStateWithHint` is slightly better with a headline but still text-only.
- **Remediation:** Redesign the `emptyState` component to include: (1) a contextual icon or illustration slot, (2) a headline, (3) a description, (4) a primary CTA. Create a CSS class `.empty-state-icon` with appropriate sizing. Migrate all one-off empty states (like the agent roster one) to use the shared component.
- **Target Phase:** Phase 3

### PD-12 Command Palette — All Inline Styles, No Keyboard Focus Ring
- **Severity:** P2
- **Description:** The command palette (layout.ts:110-158) is implemented entirely with inline styles — 15+ style attributes on structural elements. The overlay uses `rgba(0,0,0,0.7)` and `backdrop-filter:blur(4px)`. The palette items have no `:focus-visible` style (they rely on JavaScript-managed background color changes). The keyboard navigation works via `handleCmdKey` but applies visual changes via direct style manipulation (`el.style.background`, `el.style.color`) rather than CSS classes, making the selected state indistinguishable from hover for assistive technology. The input has no `aria-role="combobox"`, no `aria-expanded`, no `aria-activedescendant` — it is invisible to screen readers.
- **Evidence:** `src/views/layout.ts:110-158` — all inline styles. JavaScript at lines 153-157 manipulates `style` properties directly. No ARIA attributes on the combobox pattern.
- **Remediation:** Move all command palette styles to CSS classes (`.cmd-overlay`, `.cmd-palette`, `.cmd-input`, `.cmd-section-header`, `.cmd-item`, `.cmd-item-selected`). Add ARIA combobox pattern: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant` on the input, `role="listbox"` on results, `role="option"` on items. Replace JavaScript style manipulation with class toggling.
- **Target Phase:** Phase 3

### PD-13 Notification Bell Uses Emoji Instead of Icon
- **Severity:** P2
- **Description:** The notification bell (layout.ts:192) renders as the Unicode emoji character "bell with dot" rather than a proper SVG icon. Emojis render differently across platforms (Samsung, Firefox on Linux, older Android) and cannot be styled (no stroke width, no fill color control). The mobile bottom nav correctly uses custom SVG icons — the notification bell should follow the same pattern.
- **Evidence:** `src/views/layout.ts:192` — notification bell is the emoji character. `src/views/layout.ts:332-336` — mobile nav uses proper SVGs.
- **Remediation:** Replace the emoji with an SVG bell icon matching the style of the mobile nav icons (20x20 viewBox, 1.6 stroke width, currentColor). This allows the bell to inherit `var(--text-muted)` and transition on hover.
- **Target Phase:** Phase 3

### PD-14 Hardcoded Email Gate for Founder Ops
- **Severity:** P3
- **Description:** The sidebar (layout.ts:316) checks `founderEmail?.toLowerCase() === 'thmsnrtn@gmail.com'` to show or hide the "Founder Ops" link. While this is a temporary dev convenience, it is a hardcoded personal email address in the view layer. It also uses `style="color:#f59e0b;"` — a hardcoded amber color that is not a design token.
- **Evidence:** `src/views/layout.ts:316`.
- **Remediation:** Move the founder-ops gate to middleware or a feature flag. Replace the hardcoded color with `var(--signal-mid)` or a new `--founder-ops` token if distinct styling is needed.
- **Target Phase:** Phase 3

### PD-15 HTMX Loaded But Barely Used
- **Severity:** P3
- **Description:** HTMX 1.9.12 (31KB gzipped) is loaded on every page via the global layout (layout.ts:71) but is used in exactly one place: the "one-thing" banner (`hx-get="/api/priority/one-thing"` at layout.ts:100-103). The rest of the product uses full page navigations for form submissions and `fetch()` for client-side interactions. This is a wasted download on every page load and, more importantly, a missed opportunity — HTMX could eliminate the blank-screen-during-load problem (PD-04) by enabling partial page updates with skeleton placeholders.
- **Evidence:** `src/views/layout.ts:71` — global HTMX inclusion. Searched all view and route files for `hx-` attributes — found only lines 100-102 in layout.ts.
- **Remediation:** Either adopt HTMX properly (progressive enhancement: render skeletons in the initial HTML, then swap in live data via `hx-get` with `hx-trigger="load"`) or remove the HTMX dependency and handle the one-thing banner with a native `fetch()`. The former is strongly preferred — it solves PD-04 and makes the product feel instantaneous.
- **Target Phase:** Phase 3

### PD-16 Sidebar Has a Typo in Function Name
- **Severity:** P3
- **Description:** The mobile bottom nav function is named `mobilBottomNav` (layout.ts:324) — missing the 'e' in "mobile." While cosmetic, this propagates through the codebase and suggests insufficient attention to detail.
- **Evidence:** `src/views/layout.ts:324`.
- **Remediation:** Rename to `mobileBottomNav`.
- **Target Phase:** Phase 3

### PD-17 Zero Aria Attributes in Components
- **Severity:** P1
- **Description:** The entire `components.ts` file (1,200+ lines of UI components) contains zero `aria-*` attributes and zero `role` attributes. The `layout.ts` file has exactly 3 ARIA attributes, all on the mobile bottom nav (which is well done). Every card, badge, progress bar, toggle, dialog, form, and interactive component is invisible to assistive technology. The signal number is a `<button>` that opens a dialog but has no `aria-label`. The dimension score bars have no `role="progressbar"`. The risk badges have no semantic meaning.
- **Evidence:** `src/views/components.ts` — searched for `aria-` and `role=`, zero results. `src/views/layout.ts:76` — signal button has `aria-haspopup="dialog"` (good) but the anatomy dialog close button (index.ts:76) uses `aria-label="Close"` (also good, but isolated). The toggle component (styles.css:1273-1278) has no ARIA: the hidden input is `opacity:0;width:0;height:0;position:absolute` but there is no `role="switch"` or `aria-checked`.
- **Remediation:** Audit every interactive component and add appropriate ARIA attributes. Priority items: (1) all buttons need `aria-label` if icon-only, (2) progress bars need `role="progressbar"` with `aria-valuenow/min/max`, (3) toggles need `role="switch"` with `aria-checked`, (4) the signal anatomy dialog needs `aria-modal="true"`, (5) badges should use `aria-label` for screen reader context.
- **Target Phase:** Phase 3

### PD-18 Spacing System Is Implicit, Not Tokenized
- **Severity:** P2
- **Description:** The stylesheet has no spacing custom properties. All spacing is hardcoded: padding values include 0.25rem, 0.3rem, 0.35rem, 0.4rem, 0.42rem, 0.45rem, 0.48rem, 0.5rem, 0.55rem, 0.65rem, 0.75rem, 0.85rem, 0.9rem, 1rem, 1.1rem, 1.25rem, 1.5rem, 1.75rem, 2rem, 2.5rem, 3rem, 3.5rem, 4rem. That is 23 distinct spacing values. An Apple-caliber spacing system uses 4-6 values on a consistent scale (e.g., 4px, 8px, 12px, 16px, 24px, 32px, 48px).
- **Evidence:** Throughout `src/public/styles.css` — no `--space-*` custom properties defined. Spacing values are hardcoded at every usage point.
- **Remediation:** Define spacing tokens: `--space-1: 0.25rem`, `--space-2: 0.5rem`, `--space-3: 0.75rem`, `--space-4: 1rem`, `--space-6: 1.5rem`, `--space-8: 2rem`, `--space-12: 3rem`. Migrate all padding/margin/gap values to use these tokens.
- **Target Phase:** Phase 3

## Embarrassment Test

1. **The pricing page has no styles.** A potential customer visiting `/pricing` sees unstyled content because `.pricing-grid`, `.pricing-card`, `.pricing-tier`, `.pricing-price`, and `.pricing-features` classes do not exist in the stylesheet. This is the page that is supposed to convert visitors into paying customers.

2. **Light-mode pastel boxes on dark background.** The Decision Chamber's recommendation block (`#f0f9ff`), scenario cards (`#ecfdf5`, `#fef2f2`), next-action banners, and page hint banners all render as bright pastel rectangles against the `#0a0a12` background — visually broken in a way that screams "copied from a light-mode template."

3. **Mobile bottom nav renders 5 tabs in a 4-column grid.** The fifth tab wraps or overflows. On the one platform where visual precision matters most (mobile), the primary navigation is broken.

4. **Keyboard users cannot see where they are.** Zero `:focus-visible` styles means tabbing through the interface produces no visual feedback at all. For any user relying on keyboard navigation — including power users who prefer it — the product appears unresponsive.

5. **Notification bell is an emoji.** On some platforms it renders as a colorful iOS-style bell, on others as a black-and-white outline, and on older Android devices it may not render at all. It cannot be color-matched to the header.

## Pride Test

1. **The Signal Dashboard is a masterclass in information hierarchy.** One giant number (9rem, 800 weight, tabular-nums, color-coded by health), three sentences of AI prose, a sparkline, and contextual action cards. It communicates the entire state of a business in a single viewport without a single chart or table. The restraint is exceptional.

2. **The Decision Chamber's focused layout.** Removing the sidebar, narrowing the max-width to 700px, and giving each decision a full-screen deliberation space with "Why now," "Recommendation," cross-product patterns, scenario grids, and a reflection textarea — this is genuine product design thinking. It treats decisions as events, not list items.

3. **The dark design system's foundation is strong.** The custom property palette (`--bg`, `--surface`, `--surface-2`, `--surface-3`, `--border`, `--text`, `--text-muted`, `--text-dim`, `--signal-high/mid/low`, `--accent`) creates clear semantic layers. The 7% border opacity, the 4% soft border, the subtle surface elevation — these choices show understanding of how dark interfaces create depth without contrast fatigue.

4. **The command palette (Cmd+K) exists and navigates 27 routes.** A keyboard-first power-user pattern that signals the product is built for operators, not tourists. The implementation needs ARIA and CSS extraction (PD-12), but the interaction concept is right.

5. **The Signal sparkline.** A 120x28px inline SVG that shows 60 days of trend data directly under the signal number, using `currentColor` to inherit the tier color. It adds context without demanding attention. The `opacity: 0.6` that rises to `1` on hover is a subtle, confident touch.
