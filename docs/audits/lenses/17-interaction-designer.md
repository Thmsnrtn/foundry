# Lens 17 — Interaction Designer

**Auditor perspective:** How does the product respond to user actions? Click feedback, form submission, transitions between states, hover effects, error recovery.

**Date:** 2026-04-16
**Repo:** /Users/user/foundry/

---

## Executive Summary

Foundry has competent hover states and a consistent 150ms transition token, but the interaction layer is fundamentally passive. The product relies almost entirely on full-page navigation for state changes, uses HTMX on only 3 surfaces (priority banner, onboarding chat, dismissals), and provides no loading indicators, no button press feedback, no optimistic updates, and no confirmation flows for destructive actions beyond two raw `window.confirm()` dialogs. Form submissions trigger full-page reloads with no inline validation or success confirmation. For a product that positions itself as an autonomous control plane — where every click is a consequential decision — this level of interaction poverty is below the bar.

---

## Findings

### F17.1 — No loading feedback on any async action

**Severity:** P1
**Evidence:** The dashboard query bar (`handleQuery` in `routes/dashboard/index.ts`) sets `responseEl.textContent = 'Thinking'` as its only loading indicator — no animation, no skeleton, no spinner. The Decision Chamber `getClarity()` changes button text to "Thinking..." but there is no visual loading state. The only CSS class for loading is `.query-response.loading` which just changes text color. There is no `.btn-loading`, no spinner component, no skeleton class anywhere in `styles.css`.
**Remediation:** Create a `.btn-loading` state with a CSS spinner replacing button text. Add `htmx:beforeRequest` / `htmx:afterRequest` listeners for HTMX-powered actions. Build a `<div class="skeleton">` component with a shimmer animation for content areas that load asynchronously.

### F17.2 — No :active state on any interactive element

**Severity:** P1
**Evidence:** `styles.css` contains zero `:active` pseudo-class rules. Buttons (`.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-ghost`) have `:hover` but no `:active`. This means there is zero tactile feedback when a user clicks — the button looks identical in pressed and unpressed states. Signal action cards, decision cards, sidebar links — none respond to press.
**Remediation:** Add `:active` states to all button variants: `transform: scale(0.97)` or `opacity: 0.85` for a pressed feel. Add `.signal-action:active`, `.decision-card:active`, `.portfolio-card:active` with similar treatment.

### F17.3 — HTMX is loaded but barely used

**Severity:** P1
**Evidence:** HTMX 1.9.12 is loaded on every page via the layout (`layout.ts` line 71), adding ~14KB to every page. Actual usage is limited to 3 surfaces: (1) priority one-thing banner load (`hx-get="/api/priority/one-thing"`), (2) priority dismiss buttons (`hx-post`), and (3) onboarding chat messages. All other interactions — decision resolution, outcome logging, clarity requests, playbook deletion, team member removal, competitor addition, settings changes — use either full-page form POSTs or custom `fetch()` calls with manual DOM manipulation.
**Remediation:** Migrate the 15+ `fetch()` + manual DOM patterns to HTMX partial updates. Decision resolve, outcome log, clarity request, and query bar are all prime candidates. This eliminates duplicated JavaScript and gives consistent loading/swap behavior.

### F17.4 — Destructive actions lack confirmation except 2 cases

**Severity:** P1
**Evidence:** Only `execution-playbooks.ts` (line 143: `return confirm('Delete this playbook?')`) and `agents-integrations.ts` (line 218: `return confirm('Disconnect ${meta.label}?')`) use any confirmation. The product deletion flow in `privacy.ts` uses a custom modal — good. But team member removal (`team.ts` line 82), decision resolution (irreversible), and all other destructive form POSTs have zero confirmation. A decision, once resolved, permanently changes product direction and feeds the wisdom system. There is no "Are you sure?" and no undo.
**Remediation:** Add `hx-confirm` or a modal confirmation for: decision resolution, team member removal, playbook deletion, product deletion. The Decision Chamber resolution should show a summary of the chosen option and reasoning before final commit.

### F17.5 — No inline form validation

**Severity:** P1
**Evidence:** Forms use `required` attributes on some inputs but provide no inline validation messages. The decision resolution form checks `if (!chosen)` in JavaScript and sets `resultEl.textContent = 'Please enter the chosen option.'` — plain text appended below the button with no styling, no icon, no association with the input that caused the error. The competitive add-competitor form has no validation at all. Settings forms do full-page POST with redirect — validation errors are invisible to the user.
**Remediation:** Create a `.form-error` CSS class with error styling (left border or text color using `--risk-red`). Add client-side validation with `input.setCustomValidity()` or display inline error messages. Server-side validation failures should return the form with error messages preserved.

### F17.6 — No success confirmation after mutations

**Severity:** P1
**Evidence:** After resolving a decision: `resultEl.textContent = 'Decision resolved. Redirecting…'` then `setTimeout(() => location.href = '/decisions', 1000)`. After logging an outcome: `resultEl.textContent = 'Saved.'` then opacity fade and reload after 1500ms. After settings save: full redirect. There is no toast, no animation, no visual celebration for completing a consequential action. The milestone toast component exists (`styles.css` line 1317) but is only used for milestone achievements, not for confirming user actions.
**Remediation:** Create a reusable toast/notification system. After decision resolution, show a styled success toast with the chosen option. After outcome logging, show confirmation with the valence. Reuse the milestone toast pattern.

### F17.7 — Focus states exist but are incomplete

**Severity:** P2
**Evidence:** `input:focus`, `textarea:focus`, `select:focus` have a purple ring (`box-shadow: 0 0 0 3px rgba(108,99,255,0.08)`). But `.btn:focus-visible` is not defined anywhere. Tab navigation through buttons shows no focus ring. The command palette input has `outline:none` with no replacement focus indicator. The `.anatomy-close` button has no focus state.
**Remediation:** Add `.btn:focus-visible { box-shadow: 0 0 0 3px rgba(108,99,255,0.2); }` globally. Add focus styles to `.tour-btn-skip`, `.anatomy-close`, `.query-reset`, and all other interactive elements.

### F17.8 — Query bar error state is a bare text string

**Severity:** P2
**Evidence:** In `dashboard/index.ts` line 300-302: the catch block sets `responseEl.textContent = 'Something went wrong. Try again.'` with class `query-response visible`. No retry button, no error icon, no distinction from a successful response visually. The same plain-text error pattern appears in `getClarity()`, `logOutcome()`, and `resolveDecision()`.
**Remediation:** Create a `.query-response.error` CSS class with `--risk-red` border or icon. Include a retry button that re-submits the last query. Differentiate error responses visually from successful ones.

---

## Embarrassment Test

If a founder clicks "Resolve decision" on a Gate 3 strategic decision — the most consequential action in the product — they see the button go dead for a moment, then plain text appears below saying "Decision resolved. Redirecting..." before a 1-second delay and hard redirect. No animation, no confirmation modal, no summary of what they chose. Compare this to resolving a PR merge on GitHub, archiving an email in Superhuman, or completing a task in Linear. The gap is stark.

## Pride Test

The Signal number as a clickable button that opens an anatomy dialog is genuinely good interaction design. Clicking the score reveals a breakdown with bars and hints — this is the kind of "explain this" interaction that builds trust. The command palette (Cmd+K) with keyboard navigation and section grouping is also well-executed. These two interactions show the team knows how to build thoughtful UI; the rest of the product needs to catch up.
