# Lens 079 — Modal / Dialog Design

**Distinct value:** Audits every modal, dialog, dropdown, and overlay in the application for focus trap, close behavior (Escape key, backdrop click), accessibility, and visual design quality.

**Tenancy-critical:** No. Modal behavior is per-user interaction.

## Executive Summary

Foundry has four overlay/modal interactions: (1) the Signal Anatomy dialog (`<dialog>` element), (2) the command palette (custom overlay + panel), (3) the notification bell dropdown (`<details>` element), and (4) the tour/milestone toast system. The Signal Anatomy dialog uses the native HTML `<dialog>` element correctly — it has a backdrop, Escape closes it, and focus is trapped automatically. This is the gold standard. The command palette is a custom implementation that handles Escape but lacks proper focus trap, ARIA attributes, and keyboard navigation beyond arrow keys. The notification dropdown uses `<details>` which works but has no focus management. There are no confirmation dialogs anywhere — destructive actions (resolve decision, log outcome) execute immediately with no "Are you sure?" protection.

## Findings

### MD-01 Signal Anatomy Dialog Uses Native `<dialog>` Correctly
- **Severity:** (Positive Finding)
- **Description:** The Signal Anatomy dialog uses the native HTML `<dialog>` element with `showModal()`. This provides: automatic focus trap, Escape key to close, backdrop with click-to-close (via `::backdrop` pseudo-element), proper stacking context, and scroll lock on the underlying page. The close button has `aria-label="Close"`. The visual design is polished: dark surface background, accent-colored border, proper spacing.
- **Evidence:** `src/routes/dashboard/index.ts:74-98` — `<dialog id="anatomy-dialog" class="anatomy-dialog">`. `src/public/styles.css:486-577` — comprehensive dialog styling including backdrop blur.
- **Remediation:** N/A — this is the model for all modals. Use `<dialog>` for any future modal needs.
- **Target Phase:** N/A

### MD-02 Command Palette Lacks Focus Trap
- **Severity:** P2
- **Description:** The command palette is a custom overlay (`#cmd-overlay`) + panel (`#cmd-palette`) built with inline styles and JavaScript. It handles Escape key closure and backdrop click closure. However: (1) it has no focus trap — Tab key moves focus out of the palette into the underlying page, (2) no `role="dialog"` or `aria-modal="true"`, (3) no `aria-label` on the palette container, and (4) the results are rendered as `<div>` elements with `onclick` but no `role="option"` or `aria-selected`.
- **Evidence:** `src/views/layout.ts:110-122` — custom overlay and palette with no ARIA attributes. `src/views/layout.ts:157` — results rendered as plain divs with `onclick`.
- **Remediation:** Convert to a `<dialog>` element (like the anatomy dialog) or add proper ARIA: `role="dialog"`, `aria-modal="true"`, `aria-label="Command palette"`. Add `role="listbox"` on results container and `role="option"` on result items. Implement focus trap using a small script or CSS `inert` on background.
- **Target Phase:** 3

### MD-03 Notification Dropdown Uses `<details>` — Functional but Limited
- **Severity:** P2
- **Description:** The notification bell dropdown uses `<details>` + `<summary>` which is semantically correct for a disclosure widget. It opens on click and closes on click outside (browser behavior). However: (1) it has no `aria-expanded` tracking, (2) the dropdown does not close on Escape key, (3) there is no focus management — opening the dropdown does not move focus to the first notification, and (4) the dropdown positioning uses `position: absolute` which may overflow the viewport on mobile.
- **Evidence:** `src/views/layout.ts:191-213` — `<details class="notif-bell">` with summary and dropdown. `src/public/styles.css:1233-1250` — dropdown positioning with fixed width.
- **Remediation:** Add Escape key handler to close the details element. Add `aria-expanded` attribute that toggles. Consider viewport-aware positioning for the dropdown (check if it overflows right edge on mobile).
- **Target Phase:** 3

### MD-04 No Confirmation Dialogs for Destructive Actions
- **Severity:** P1
- **Description:** No destructive action in Foundry has a confirmation dialog. Decision resolution (the most consequential action) executes immediately on button click. Outcome logging saves immediately. Agent authority changes apply immediately. Journey artifact publishing is instant. There is no "Are you sure?" protection for any irreversible action.
- **Evidence:** `src/routes/dashboard/decisions.ts:154` — resolve button triggers `onclick="resolveDecision()"` with no confirmation. `src/routes/dashboard/agents.ts:446-451` — authority level change forms submit directly. All POST forms lack confirmation.
- **Remediation:** Add a confirmation step for: decision resolution, authority level changes, and any data deletion. Use the native `<dialog>` pattern (like the anatomy dialog) with "Confirm" and "Cancel" buttons. For the decision chamber specifically, the confirmation should summarize the choice: "You're resolving with: [chosen option]. This cannot be undone."
- **Target Phase:** 2

### MD-05 Tour/Milestone Toasts Have No Close Affordance Inspection
- **Severity:** P2
- **Description:** Milestone toasts are triggered by a script that renders toast elements. The toast rendering function exists in components.ts but the close behavior and visual persistence could not be fully traced. Toasts should: auto-dismiss after a timeout, have a close button, not stack more than 2-3, and not block interaction with the underlying page.
- **Evidence:** `src/views/components.ts` — `milestoneToastScript()` referenced in dashboard route. Toast rendering is via inline JavaScript.
- **Remediation:** Ensure toasts have: (1) auto-dismiss after 5 seconds, (2) close button with `aria-label="Dismiss"`, (3) `role="status"` or `role="alert"` for screen readers, (4) max stack of 3 with newest at top.
- **Target Phase:** 3

### MD-06 Backdrop Blur Is a Nice Touch
- **Severity:** (Positive Finding)
- **Description:** Both the Signal Anatomy dialog and the command palette use `backdrop-filter: blur(...)` to create visual depth. The anatomy dialog uses `backdrop-filter: blur(2px)` on the `::backdrop`. The command palette uses `backdrop-filter: blur(4px)` on the overlay div. This creates a polished, modern feel while maintaining focus on the modal content.
- **Evidence:** `src/public/styles.css:498-500` — `.anatomy-dialog::backdrop { backdrop-filter: blur(2px) }`. `src/views/layout.ts:111` — command overlay with `backdrop-filter:blur(4px)`.
- **Remediation:** N/A — good design detail.
- **Target Phase:** N/A

## Embarrassment Test
1. A founder accidentally resolves a decision (the most important action in the product) with a single misclick and there is no way to undo or confirm.
2. A screen reader user opens the command palette and Tab takes them to the underlying page content — the palette has no focus trap or ARIA markup.

## Recommendations (Priority Order)
1. Add confirmation dialogs for decision resolution and authority changes (P1, Phase 2)
2. Add ARIA attributes and focus trap to command palette (P2, Phase 3)
3. Add Escape key and focus management to notification dropdown (P2, Phase 3)
4. Ensure toast notifications have proper dismiss and ARIA (P2, Phase 3)
5. Use native `<dialog>` for all future modal needs
