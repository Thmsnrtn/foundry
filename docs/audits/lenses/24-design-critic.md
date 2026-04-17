# Lens 24 — Design Critic Audit

**Auditor perspective:** Design critic
**Scope:** Overall design language cohesion, premium vs. rushed feel, product unity
**Date:** 2026-04-16

---

## Executive Summary

Foundry's design has a **strong foundation that fractures once you leave the CSS design system**. The `styles.css` file defines a cohesive dark theme with custom properties, consistent spacing, and restrained typography. The Signal dashboard -- the hero screen -- is genuinely well-designed: a single large number, three sentences, and a query bar. The Decision Chamber shows similar restraint. However, approximately 30% of the UI escapes the design system entirely, using inline styles with hardcoded light-mode Tailwind-esque colors (#f0f9ff, #ecfdf5, #fef2f2, #d1d5db) that clash violently with the dark theme. The `components.ts` file has 126 inline `style=` attributes. The result is a product that feels premium in its core flows and rushed in its secondary views.

**P1 findings:** 3
**P2 findings:** 4

---

## Finding 01 — Two conflicting visual languages coexist

**Severity: P1**
**Files:** `src/views/components.ts`, `src/public/styles.css`

The design system (`styles.css`) defines a cohesive dark palette through CSS custom properties (`--bg`, `--surface`, `--surface-2`, `--text`, etc.). All dashboard pages that use these classes feel like one product.

However, `components.ts` contains dozens of hardcoded light-mode colors inline:
- `#f0f9ff` (light blue) for scenario base case backgrounds
- `#ecfdf5` (light green) for best case backgrounds
- `#fef2f2` (light red) for stress case backgrounds
- `#d1fae5` (green tint) for "Published" badges
- `#f9fafb` (near-white) for fallback backgrounds
- `#d1d5db` (light gray) for step arrows and borders
- `#4b5563` (medium gray on light) for text on these backgrounds
- `#065f46` (dark green on light) for success text

These are Tailwind color values designed for light backgrounds. On Foundry's `#0a0a12` dark background, they create jarring light rectangles that look like rendering errors.

The same pattern appears in route files: `agents-debate.ts`, `agents-strategy.ts`, `agents-experiments.ts`, `founder-ops.ts`, and `roi.ts` all use hardcoded light-mode colors in inline styles.

**Impact:** The product feels like two different products stitched together. The core (Signal, Decisions, Agents) feels premium. The secondary views (scenarios, experiments, strategy) feel like they were prototyped in a different context and never adapted.

**Remediation:**
1. Define dark-appropriate semantic classes for status backgrounds: `.bg-success`, `.bg-warning`, `.bg-danger`, `.bg-info`, `.bg-muted`.
2. Replace all inline hardcoded colors with these classes.
3. Ensure all background colors use the dark palette with opacity (e.g., `rgba(78,204,163,0.06)` instead of `#ecfdf5`).

---

## Finding 02 — Excessive inline styles undermine maintainability and consistency

**Severity: P1**
**Files:** `src/views/components.ts` (126 inline styles), `src/views/layout.ts` (26 inline styles)

The layout file has 26 inline `style=` attributes, mostly on the command palette. The components file has 126. Route files add hundreds more. Many of these inline styles override or duplicate what the CSS design system already provides:

- `font-size: 0.87rem` appears in inline styles when `.text-muted` already sets appropriate sizing.
- `color: #6b7280` is used inline when `var(--text-muted)` exists.
- `border-bottom: 1px solid #f3f4f6` uses a light-mode border color when `var(--border)` is defined.

This creates a maintenance burden where design changes require updating both the CSS file and hundreds of inline styles scattered across TypeScript files.

**Impact:** Design inconsistency compounds over time. A designer cannot update the theme by changing CSS variables alone -- they must also find and update every inline style.

**Remediation:**
1. Extract repeated inline patterns into CSS classes.
2. Enforce a project rule: no inline `style=` attributes for layout, color, or typography. Reserve inline styles for truly dynamic values (e.g., bar widths computed from data).

---

## Finding 03 — The digest email uses light-mode design

**Severity: P1**
**Files:** `src/services/digest/delivery.ts`, `src/services/scp/briefing/email-digest.ts`

The weekly digest email uses light backgrounds (`#dcfce7` for green, `#fef9c3` for yellow, `#fee2e2` for red) and a light font stack. While email HTML typically uses light backgrounds for compatibility, this creates a jarring brand disconnect from the dark-themed dashboard. A founder who associates Foundry's identity with the dark, typographic dashboard will not recognize the digest email as the same product.

The email also has no Foundry branding (no logo, no header, no footer with links). It reads as a generic system email.

**Impact:** Brand fragmentation across touchpoints. The email is the primary weekly touchpoint but looks nothing like the product.

**Remediation:**
1. Design a branded email template that echoes the dark theme (dark background with light text is increasingly supported in email clients, or use a dark header/footer with light content).
2. Add the Foundry wordmark, a link back to the dashboard, and an unsubscribe/preferences link.

---

## Finding 04 — Typography is well-chosen but inconsistently applied

**Severity: P2**
**Files:** `src/public/styles.css`, `src/views/components.ts`

The CSS defines a clean typographic system: system font stack, tight heading spacing, tabular numerals for data, and a monospace stack for code. The signal number at 9rem is a bold design choice that works.

However, the components file introduces many one-off font sizes inline (`0.87rem`, `0.82rem`, `0.8rem`, `0.78rem`, `0.75rem`, `0.72rem`, `0.68rem`, `0.65rem`) that do not follow a clear typographic scale. The difference between `0.82rem` and `0.85rem` is imperceptible but creates code complexity.

**Impact:** Minor visual inconsistency. The eye cannot tell the difference between these sizes, but the code sprawl makes intentional design changes difficult.

**Remediation:** Consolidate to a defined type scale: `0.75rem` (xs), `0.82rem` (sm), `0.9rem` (base), `1rem` (md), `1.25rem` (lg). Map each to a CSS class. Remove intermediate values.

---

## Finding 05 — Settings page breaks the dark aesthetic

**Severity: P2**
**Files:** `src/routes/dashboard/settings.ts`

The settings page uses `border-bottom: 1px solid #f3f4f6` (a light-mode gray) for product dividers and `color: #6b7280` for muted text -- both Tailwind light-mode values that clash with the dark surface. The subscription section badge uses `background: rgba(108,99,255,0.15)` (correct dark-mode approach), showing the inconsistency within the same page.

**Impact:** Settings is a high-traffic page (billing, products, integrations). The visual breaks erode the premium feel.

**Remediation:** Replace all hardcoded light-mode hex values with CSS custom properties.

---

## Finding 06 — The "positive" next-action state uses green on dark with no visual weight

**Severity: P2**
**Files:** `src/views/components.ts` (nextActionUI function)

When the system is "all clear" (`urgency: 'positive'`), the next-action banner uses `background: #f0fdf4; border-color: #bbf7d0` -- light green tints that are designed for white backgrounds. On the dark theme, this creates a bright green rectangle that is both jarring and aesthetically wrong.

The critical and elevated urgency states correctly use the dark-theme rgba approach (`rgba(255,107,107,0.08)` and `rgba(255,179,71,0.06)`), making the positive state the odd one out.

**Impact:** The "everything is fine" state looks broken, which is ironic.

**Remediation:** Use `rgba(78,204,163,0.06); border-color: rgba(78,204,163,0.2)` -- the same pattern used for risk-bg-green in the CSS.

---

## Finding 07 — The product feels like one product in its core, several in its edges

**Severity: P2**
**Files:** Cross-cutting

The best-designed surfaces:
- **Signal dashboard**: One number, prose, action cards. Clean, focused, premium.
- **Decision Chamber**: Full-screen, typographic, deliberate. The scenario grid is elegant.
- **Agent Roster / Briefings**: Card-based, consistent with the design system.
- **Sidebar navigation**: Grouped, restrained, functional.

The rushed-feeling surfaces:
- **Scenario Planner**: Inline styles, light-mode colors, tabular layouts with hardcoded hex.
- **Agent Debate**: Mix of CSS classes and inline styles with different color systems.
- **Agent Strategy**: Light-mode backgrounds (#f9fafb) on dark surfaces.
- **Founder Ops**: Light-mode status colors (#dcfce7, #fef9c3, #fee2e2).
- **Settings**: Mix of design system tokens and light-mode Tailwind values.

The pattern is clear: the core founder-facing flows received design attention; the administrative and advanced features were built quickly with copied color values from a different context.

**Impact:** The product does not consistently feel premium. Advanced users who explore beyond the core flows encounter a noticeably lower quality bar.

**Remediation:** Systematic sweep of all route files and components to replace light-mode hex values with design system tokens. This is a single focused effort, not an ongoing problem.

---

## Summary Table

| # | Finding | Severity | File(s) |
|---|---------|----------|---------|
| 01 | Two conflicting visual languages (dark system + light inline) | P1 | `components.ts`, `styles.css` |
| 02 | 126+ inline styles undermine design system | P1 | `components.ts`, `layout.ts` |
| 03 | Digest email has no brand continuity with dark theme | P1 | `services/digest/delivery.ts` |
| 04 | Typography scale is inconsistent with too many one-off sizes | P2 | `styles.css`, `components.ts` |
| 05 | Settings page uses light-mode colors | P2 | `routes/dashboard/settings.ts` |
| 06 | Positive state next-action uses wrong color approach | P2 | `components.ts` |
| 07 | Core flows feel premium; edge features feel rushed | P2 | Cross-cutting |

---

## Cross-References

- **Lens 25 (Theme specialist):** Finding 01 here is the same root cause as the light-mode artifacts in Lens 25.
- **Lens 16 (Product designer):** Design language cohesion directly impacts the product designer's ability to evolve the system.
- **Lens 46 (Copywriter):** The digest email (Finding 03) has both design and copy concerns.
