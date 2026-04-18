# Lens 077 — Form Design Specialist

**Distinct value:** Evaluates form visual design: input styling, label placement, error state appearance, spacing, required field indicators, field grouping, and overall form aesthetics. Separate from form *behavior* (lens 067) — this is about how forms look and feel.

**Tenancy-critical:** No. Form design is per-user experience.

## Executive Summary

Foundry's form styling in `styles.css` is clean and consistent: dark surface backgrounds, subtle borders, proper focus rings with accent color, and a custom select dropdown arrow. The `.form-group` pattern with block labels above inputs is correct for the application's context. However, the actual forms in route templates frequently bypass the CSS design system, using inline styles for spacing, borders, and sizing. There are no error states defined in CSS. No form has a disabled/submitting state. Field grouping is weak — multi-step forms show all fields in a flat list with no visual sections. The DNA editor (10+ fields) has no fieldset grouping. Overall: the design system provides good form primitives, but the implementation ignores them.

## Findings

### FD-01 CSS Form Primitives Are Well-Designed
- **Severity:** (Positive Finding)
- **Description:** The stylesheet defines consistent form element styling: dark background (`var(--surface-3)`), subtle border (`var(--border)`), proper border-radius, focus ring with accent color and box-shadow, custom select arrow SVG, and vertical textarea resize. The `.form-group` class provides proper label-input spacing. These are good design primitives.
- **Evidence:** `src/public/styles.css:1184-1226` — form group, input, textarea, select styling. Focus state: `border-color: rgba(108,99,255,0.45); box-shadow: 0 0 0 3px rgba(108,99,255,0.08)`.
- **Remediation:** N/A — these are correct. The issue is that templates don't use them.
- **Target Phase:** N/A

### FD-02 Forms Use Inline Styles Instead of Design System
- **Severity:** P1
- **Description:** Most forms in route templates override or bypass the CSS form styles with inline `style="..."` attributes. The competitor add form uses `style="flex:1;padding:0.4rem 0.75rem;border:1px solid #d1d5db;border-radius:6px;"` instead of the CSS input styles. The DNA editor fields use `style="width:100%;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:6px;"`. Note that these inline styles use `#d1d5db` (a light gray) instead of `var(--border)` (a dark-theme-appropriate border) — the inline styles are for a light theme on a dark-theme product.
- **Evidence:** `src/views/components.ts:528` — competitor input with `border:1px solid #d1d5db` (light theme border on dark theme). `src/views/components.ts:1086-1087` — DNA editor fields with inline styles and light-theme borders. `src/routes/dashboard/signals-multimodal.ts` — uses `.form-control` class which is not defined in the stylesheet.
- **Remediation:** Remove inline styles from all form inputs. Use the existing CSS form styles which are dark-theme-correct. The `#d1d5db` light-theme borders are a visual bug on the dark background.
- **Target Phase:** 2

### FD-03 No Error State Styling Defined
- **Severity:** P1
- **Description:** The CSS has no error state for form inputs. There is no `.form-group.error`, no `.input-error`, no red border, no error message styling. When validation fails, there is no visual language for communicating the error to the user within the form context. The forms just show generic text in an unstyled span.
- **Evidence:** No CSS class containing "error", "invalid", or "danger" related to form inputs in `src/public/styles.css`. No `.form-group--error` or `.input--error` pattern.
- **Remediation:** Add: `.form-group.error input { border-color: var(--risk-red); } .form-group .error-message { color: var(--risk-red); font-size: 0.82rem; margin-top: 0.25rem; }`. This integrates with the existing risk-red color token.
- **Target Phase:** 2

### FD-04 No Disabled/Submitting Button State
- **Severity:** P2
- **Description:** There is no `.btn:disabled` or `.btn-loading` style. When a form is submitted, the button remains clickable and visually unchanged. The decision chamber manually sets `btn.disabled = true; btn.textContent = 'Thinking...'` in JavaScript, but there is no CSS for the disabled state — the button may still look clickable.
- **Evidence:** No `button:disabled`, `.btn:disabled`, or `.btn-loading` styles in `src/public/styles.css`. `src/routes/dashboard/decisions.ts:192-193` — manually sets disabled and text without CSS support.
- **Remediation:** Add: `.btn:disabled { opacity: 0.5; cursor: not-allowed; }`. Add: `.btn-loading { position: relative; color: transparent; } .btn-loading::after { content: ''; position: absolute; /* spinner styles */ }`.
- **Target Phase:** 2

### FD-05 No Required Field Visual Indicator
- **Severity:** P2
- **Description:** Required form fields (`required` attribute) have no visual indicator. Labels for required and optional fields look identical. The user cannot distinguish required fields until they attempt to submit and the browser shows a native validation tooltip.
- **Evidence:** `src/routes/dashboard/team.ts:95-96` — `<label for="email">Email address</label>` with `required` on the input but no visual indicator. Same pattern across all forms.
- **Remediation:** Add: `.form-group label::after { content: ''; } .form-group.required label::after { content: ' *'; color: var(--risk-red); }`. Or use the convention of marking optional fields: `.form-group label .optional { color: var(--text-dim); font-weight: normal; }`.
- **Target Phase:** 2

### FD-06 DNA Editor Lacks Field Grouping
- **Severity:** P2
- **Description:** The DNA editor presents 10+ text fields (ICP, positioning, voice, market insight, etc.) in a flat vertical list with no visual grouping. There are no `<fieldset>` elements, no section dividers, and no visual hierarchy to help the founder understand the structure. This is the most complex form in the product and it feels like a wall of text inputs.
- **Evidence:** `src/views/components.ts:1070-1095` (approximate range based on DNA editor rendering) — flat list of form groups.
- **Remediation:** Group related fields with `<fieldset>` and `<legend>` elements styled with the existing section header pattern. Group: "Identity" (name, positioning, voice), "Market" (ICP, competitors, market insight), "Product" (stack, stage, metrics). Add completion indicators per section.
- **Target Phase:** 3

### FD-07 Textarea Height Is Inconsistent
- **Severity:** P3
- **Description:** Textareas across the application have inconsistent heights. The CSS sets `min-height: 100px` as default. The decision chamber reflection textarea sets `min-height: 80px` via CSS class. The DNA editor textareas use `rows="3"` in HTML. The signals transcript textarea uses `rows="12"`. There is no systematic approach to textarea sizing based on expected content length.
- **Evidence:** `src/public/styles.css:1226` — `min-height: 100px`. `src/public/styles.css:1102` — `.chamber-reflect-input { min-height: 80px }`. Inline `rows` attributes in templates vary from 2 to 12.
- **Remediation:** Define textarea size utilities: `.textarea-sm { min-height: 60px; }`, `.textarea-md { min-height: 120px; }`, `.textarea-lg { min-height: 240px; }`. Map to content expectations: short answer (sm), paragraph (md), transcript (lg).
- **Target Phase:** 4

## Embarrassment Test
1. A founder filling out the DNA editor sees `#d1d5db` light-theme borders on inputs against the `#0a0a12` dark background — a clear visual bug from inline styles overriding the design system.
2. A form submission error produces no visual feedback on the form — no red borders, no error messages, no indication of what went wrong.

## Recommendations (Priority Order)
1. Fix inline styles using light-theme borders on dark-theme forms (P1, Phase 2)
2. Add error state CSS for form inputs (P1, Phase 2)
3. Add disabled/loading button states (P2, Phase 2)
4. Add required field visual indicators (P2, Phase 2)
5. Group DNA editor fields with fieldsets (P2, Phase 3)
