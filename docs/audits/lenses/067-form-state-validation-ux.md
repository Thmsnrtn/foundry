# Lens 067 — Form State and Validation UX

**Distinct value:** Examines every user-facing form in Foundry for usability: validation feedback quality, error message placement, inline validation, field-level error states, required indicators, and form state preservation on error. Focuses on the server-rendered + HTMX paradigm where form UX is inherently harder than client-side frameworks.

**Tenancy-critical:** No. Form UX is per-user, not per-company. But poor form UX during onboarding could cause founder drop-off before ever connecting a product.

## Executive Summary

Foundry has approximately 25+ forms across onboarding, settings, decisions, DNA editor, failure log, experiments, team invites, and competitive tracking. The forms are functional but provide a poor validation experience. Server-side validation exists in some routes (Zod in onboarding) but errors are returned as raw JSON `{ error: '...' }` responses rather than re-rendering the form with error state. Most forms use full-page POST submissions with redirect-on-success, meaning any validation failure loses all entered data. No form uses HTMX for inline validation despite the library being loaded. Required fields are inconsistently marked, and several text inputs lack associated `<label>` elements entirely.

## Findings

### FVUX-01 Validation Errors Return JSON, Not Rendered Forms
- **Severity:** P1
- **Description:** When server-side validation fails, most routes return `c.json({ error: '...' }, 400)` even for form submissions that came from HTML forms. The user sees a raw JSON response in their browser instead of the form re-rendered with error messages. This is a broken UX pattern for server-rendered forms.
- **Evidence:** `src/routes/dashboard/decisions.ts:57` — `return c.json({ error: 'Not found' }, 404)` on a page that should re-render. `src/routes/dashboard/onboarding.ts:169,176,177` — multiple `c.json({ error: '...' })` returns from an HTML form flow. `src/routes/dashboard/settings.ts:41` — checkout error redirects to `/settings?checkout=error` but the page never reads that query param to show an error message.
- **Remediation:** For HTML form POST handlers, re-render the form page with error state and the previously submitted values. Use a pattern like `return c.html(dashboardLayout(ctx, formWithErrors(body, errors)))`. HTMX can also swap just the error region.
- **Target Phase:** 2

### FVUX-02 Form Data Lost on Server Error or Validation Failure
- **Severity:** P1
- **Description:** All forms use traditional `method="POST"` with redirect-on-success. When a validation error occurs (or the server returns a non-redirect response), the user loses all entered data. The DNA editor form (10+ text fields), the failure log form (5 fields), and the competitor identification form (3 fields) all lose data on error. No form preserves field values through an error cycle.
- **Evidence:** `src/views/components.ts:738-760` — onboarding competitor form has no value pre-fill. `src/views/components.ts:1170-1196` — failure log form has no value pre-fill. `src/routes/dashboard/signals-multimodal.ts:210-245` — transcript upload form (large textarea) has no value preservation.
- **Remediation:** On validation failure, re-render the form with `value="${submittedValue}"` on each input. For the DNA editor and transcript forms where data loss is most costly, consider using HTMX to submit and swap only the error region while preserving the form state.
- **Target Phase:** 2

### FVUX-03 No Inline Validation Despite HTMX Being Available
- **Severity:** P2
- **Description:** Zero forms use inline validation. HTMX supports `hx-validate` and can trigger validation on blur (`hx-trigger="blur"`), which would provide instant feedback for email format, URL format, required fields, etc. Instead, all validation happens on full form submit, and errors are returned as JSON.
- **Evidence:** All form `<input>` elements across the codebase — none have `hx-*` validation attributes. `src/routes/dashboard/onboarding.ts:28-38` — Zod schema exists server-side but the form only validates on submit. `src/routes/dashboard/signals-multimodal.ts:370-410` — job signal form has no inline validation for required fields.
- **Remediation:** For the most critical forms (onboarding, DNA editor), add HTMX-powered inline validation: `hx-post="/validate/field" hx-trigger="blur" hx-target="next .error"`. The server endpoint validates the single field and returns an error span or empty.
- **Target Phase:** 3

### FVUX-04 Required Fields Not Visually Indicated
- **Severity:** P2
- **Description:** Many inputs have the HTML `required` attribute, but there is no visual indicator (asterisk, "required" text, or color) to tell users which fields are required before they submit. The form labels are styled identically for required and optional fields. This forces a trial-and-error submission experience.
- **Evidence:** `src/views/components.ts:425-426` — "Chosen Option" input has `required` but label shows no indicator. `src/routes/dashboard/signals-multimodal.ts:243` — transcript textarea is `required` with no visual marker. `src/routes/dashboard/team.ts:96` — email input `required` but label just says "Email address".
- **Remediation:** Add a CSS rule: `.form-group label[for] + input[required]::before` or use a utility class `.required` that appends a red asterisk. Alternatively, mark optional fields as "(optional)" and treat required as the default state.
- **Target Phase:** 2

### FVUX-05 Several Inputs Lack Associated Labels
- **Severity:** P2
- **Description:** Multiple form inputs have no `<label>` element associated via `for`/`id` pairing. The competitor add form in `components.ts` uses a class `form-group` on the `<input>` itself rather than using a proper `<label>`. The decision chamber "chosen option" input has a `<label>` but the resolution reasoning textarea does not have a matching `id`.
- **Evidence:** `src/views/components.ts:528` — competitor name input uses `class="form-group"` on the input element, no label. `src/routes/dashboard/decisions.ts:148-150` — "chosen-option" input has a label but no matching `for` attribute. `src/routes/dashboard/decisions.ts:152` — reasoning textarea has a label but `id="resolution-reasoning"` does not match the `for` attribute (no `for` attribute exists on the label).
- **Remediation:** Audit every form and ensure each `<input>`, `<textarea>`, and `<select>` has an associated `<label for="matching-id">`. This is both an accessibility requirement and a UX improvement (clicking the label focuses the input).
- **Target Phase:** 2

### FVUX-06 Onboarding Chat Form Uses HTMX Well
- **Severity:** (Positive Finding)
- **Description:** The conversational onboarding chat (`/setup`) is the best form UX in the application. It uses HTMX to submit messages (`hx-post="/setup/message"`), append responses without page reload (`hx-swap="beforeend"`), update the progress indicator via OOB swap, and auto-scroll to the latest message. This pattern should be the model for other forms.
- **Evidence:** `src/routes/dashboard/onboarding-chat.ts:149-153` — HTMX form with swap and OOB progress update. `src/routes/dashboard/onboarding-chat.ts:240-242` — `hx-swap-oob="true"` for progress bar.
- **Remediation:** N/A — use this as the template for converting other forms to HTMX.
- **Target Phase:** N/A

### FVUX-07 Decision Chamber Uses fetch() Instead of Form Submission
- **Severity:** P2
- **Description:** The Decision Chamber uses `fetch()` in inline `<script>` blocks for resolve, reflect, and outcome recording. This means: no form validation attributes, no loading states from the form element, error handling is manual and inconsistent, and the page requires JavaScript to function. With HTMX already loaded, these could be declarative `hx-post` forms with proper loading indicators.
- **Evidence:** `src/routes/dashboard/decisions.ts:186-264` — three `window.function = async function()` handlers using `fetch()`, manual error handling, and `setTimeout(window.location.reload)` instead of HTMX swaps.
- **Remediation:** Convert to HTMX forms: the reflect section becomes `<form hx-post="/api/decisions/${id}/reflect" hx-target="#reflect-response" hx-swap="innerHTML">`. The resolve form becomes `<form hx-post="/decisions/${id}/resolve" hx-target="#resolve-result">`. This eliminates inline scripts and adds loading state for free.
- **Target Phase:** 3

## Embarrassment Test
1. A founder filling out the DNA editor (10+ fields of company context) hits a server error and loses everything they typed. There is no draft saving, no form state preservation, no confirmation before navigating away.
2. A founder submitting the competitor identification form with an invalid entry sees raw JSON `{"error":"..."}` in their browser instead of a helpful in-context error message.

## Recommendations (Priority Order)
1. Re-render forms with error state and preserved values on validation failure (P1, Phase 2)
2. Add visual required field indicators across all forms (P2, Phase 2)
3. Associate all inputs with proper `<label>` elements (P2, Phase 2)
4. Convert Decision Chamber to HTMX forms (P2, Phase 3)
5. Add inline validation for critical forms using HTMX blur triggers (P2, Phase 3)
