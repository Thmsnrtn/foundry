# Lens 25 — Theme Specialist Audit

**Auditor perspective:** Theme specialist
**Scope:** Dark theme completeness, light-mode artifacts, contrast consistency
**Date:** 2026-04-16

---

## Executive Summary

Foundry's dark theme is **structurally solid in its CSS design system** but **contaminated by 50+ hardcoded light-mode colors in server-rendered HTML templates**. The `styles.css` file uses CSS custom properties consistently and defines no light-mode overrides (no `prefers-color-scheme: light` media query, no `.light-mode` class). There is no theme toggle -- dark is the only mode, which is a valid design choice. However, the inline styles in `components.ts`, route files, and email templates introduce Tailwind-inspired light-mode colors (#f0f9ff, #ecfdf5, #fef2f2, #d1fae5, #f9fafb, #d1d5db) that create white/pastel rectangles against dark surfaces. Additionally, some hardcoded colors bypass the design system even when they are dark-appropriate (#22c55e, #ef4444 in timeline stats).

**P0 findings:** 1
**P1 findings:** 3
**P2 findings:** 2

---

## Finding 01 — 50+ light-mode background colors hardcoded in templates

**Severity: P0**
**Files:** `src/views/components.ts`, multiple route files

The following light-mode background colors appear in inline styles throughout the codebase:

| Color | Usage | Count (approx) |
|-------|-------|-----------------|
| `#f0f9ff` | Info/base case backgrounds | 4 |
| `#ecfdf5` | Success/best case backgrounds | 3 |
| `#fef2f2` | Error/stress case backgrounds | 5 |
| `#f0fdf4` | Positive state backgrounds | 3 |
| `#fffbeb` | Warning backgrounds | 3 |
| `#f8fafc` | Muted/empty backgrounds | 4 |
| `#f9fafb` | Neutral backgrounds | 5 |
| `#dcfce7` | Green status backgrounds | 3 |
| `#fef9c3` | Yellow status backgrounds | 2 |
| `#fee2e2` | Red status backgrounds | 3 |
| `#d1fae5` | Published/success badges | 2 |
| `#d1d5db` | Light gray borders/text | 3 |
| `#f3f4f6` | Light border dividers | 4 |
| `#e5e7eb` | Light border in notification dropdown | 1 |

These colors are from Tailwind's light-mode palette (50-200 range) and produce near-white backgrounds against Foundry's `#0a0a12` background. The contrast is not just wrong -- it is visually jarring. A light green (#ecfdf5) rectangle on a near-black surface looks like a rendering bug.

**Affected files:**
- `src/views/components.ts` (lines 367, 381, 396-398, 455, 521, 573, 689-691, 711, 797, 814-826, 899, 954-957, 1104-1105, 1133)
- `src/routes/dashboard/founder-ops.ts` (lines 108, 112, 116, 315)
- `src/routes/dashboard/agents-strategy.ts` (lines 120, 148, 257, 311)
- `src/routes/dashboard/agents-experiments.ts` (line 169)
- `src/routes/dashboard/agents-messages.ts` (line 141)
- `src/routes/dashboard/roi.ts` (lines 195, 345)
- `src/routes/api/priority.ts` (line 165)
- `src/services/scp/briefing/email-digest.ts` (line 84)

**Impact:** Visual credibility is undermined. A premium dark-themed product with random light rectangles feels broken, not designed.

**Remediation:**
1. Define dark-appropriate semantic background tokens in CSS:
   - `--bg-success: rgba(78,204,163,0.06)`
   - `--bg-warning: rgba(255,179,71,0.06)`
   - `--bg-danger: rgba(255,107,107,0.06)`
   - `--bg-info: rgba(108,99,255,0.06)`
   - `--bg-muted: rgba(255,255,255,0.03)`
2. Create matching CSS classes (`.bg-success`, etc.).
3. Systematic find-and-replace of all light-mode hex values with the new tokens.
4. Add a linting rule or code review checklist item: no hex colors in inline styles.

---

## Finding 02 — Text colors hardcoded for light backgrounds are illegible on dark

**Severity: P1**
**Files:** `src/views/components.ts`

When components use light backgrounds, they also use dark text colors designed for those backgrounds:
- `#4b5563` (Tailwind gray-600) for paragraph text on light backgrounds
- `#065f46` (Tailwind emerald-800) for success text
- `#047857` (Tailwind emerald-700) for secondary success text
- `#78350f` (Tailwind amber-900) for warning text on light amber backgrounds
- `#991b1b` (Tailwind red-900) for error text
- `#6b7280` (Tailwind gray-500) for muted text -- this one is borderline readable on dark

On Foundry's dark surfaces, these mid-to-dark text colors become low-contrast or invisible. For example, `#065f46` (dark green) on `#191928` (surface-2) has a contrast ratio of approximately 2.5:1 -- well below the WCAG AA minimum of 4.5:1 for normal text.

**Impact:** Text is unreadable in affected components. Founders may not notice information because it is too dark to see against the dark surface.

**Remediation:** Replace all hardcoded text colors with CSS custom property equivalents. On dark backgrounds, success text should use `var(--signal-high)`, warning text should use `var(--signal-mid)`, etc.

---

## Finding 03 — Hardcoded dark-appropriate colors bypass the design system

**Severity: P1**
**Files:** `src/public/styles.css` (lines 1381, 1394-1395), `src/routes/dashboard/*.ts`

Several colors that are dark-appropriate nonetheless bypass the CSS custom properties:

- `#ef4444` (red-500) used for mobile bottom nav badge and timeline "down" stat -- should be `var(--risk-red)` or `var(--signal-low)`
- `#22c55e` (green-500) used for timeline "up" stat -- should be `var(--signal-high)`
- `#6c63ff` used directly in inline styles instead of `var(--accent)` in 3 locations in styles.css
- `#a09aff` used in the daily insight action instead of a defined variable
- `#9999cc` used for the watch badge instead of a defined variable

While these happen to be legible on dark backgrounds, they create a maintenance problem: if the color palette changes, these values will not update with the custom properties.

**Impact:** Design system integrity. Color changes require manual updates in multiple locations.

**Remediation:**
1. Replace `#ef4444` with `var(--signal-low)` (or define `--badge-bg` if a different red is intended).
2. Replace `#22c55e` with `var(--signal-high)`.
3. Replace bare `#6c63ff` with `var(--accent)`.
4. Define additional custom properties for colors not yet tokenized (`--accent-muted` for `#a09aff`, `--badge-watch` for `#9999cc`).

---

## Finding 04 — Auth pages use a different dark color than the main app

**Severity: P1**
**Files:** `src/routes/auth/clerk.ts`

The signup and login pages define their background inline:

```css
body { background: #0f172a; }
```

The main app uses `--bg: #0a0a12`. These are noticeably different darks -- `#0f172a` is Tailwind's slate-900 (blue-tinted dark), while `#0a0a12` is Foundry's custom near-black (violet-tinted). When a founder signs up and redirects to the dashboard, the background color shifts visibly.

**Impact:** Brand discontinuity at the first and most important transition (auth -> dashboard).

**Remediation:** Replace `#0f172a` with `var(--bg)` by including the stylesheet on auth pages, or hardcode `#0a0a12` if the stylesheet cannot be loaded.

---

## Finding 05 — Notification dropdown border uses light-mode color

**Severity: P2**
**Files:** `src/views/layout.ts` (line 206)

The notification dropdown's "Mark all as read" section uses:

```html
<div style="padding:8px 14px;border-top:1px solid #e5e7eb;">
```

`#e5e7eb` is Tailwind gray-200, a very light gray that produces a bright white line against the dark dropdown background (`var(--surface-2)`). The CSS design system uses `var(--border)` (`rgba(255,255,255,0.07)`) for this purpose.

**Impact:** A single bright divider line inside an otherwise dark dropdown.

**Remediation:** Replace `#e5e7eb` with `rgba(255,255,255,0.07)` or reference `var(--border)`.

---

## Finding 06 — No theme-color meta tag consistency

**Severity: P2**
**Files:** `src/views/layout.ts`

The layout includes `<meta name="theme-color" content="#0a0a12">`, which correctly matches the app background. This is good. However, the auth pages do not include this meta tag, and the `manifest.json` was not audited for consistency. If the manifest specifies a different theme color, the browser chrome will shift colors during PWA usage.

**Impact:** Minor -- only visible in browser chrome and PWA title bars.

**Remediation:** Ensure `manifest.json` `theme_color` matches `#0a0a12`. Add the theme-color meta tag to auth pages.

---

## Summary Table

| # | Finding | Severity | File(s) |
|---|---------|----------|---------|
| 01 | 50+ light-mode background colors in templates | P0 | `components.ts`, multiple route files |
| 02 | Text colors designed for light backgrounds are illegible on dark | P1 | `components.ts` |
| 03 | Dark-appropriate colors bypass the CSS custom property system | P1 | `styles.css`, route files |
| 04 | Auth pages use a different dark background than the main app | P1 | `routes/auth/clerk.ts` |
| 05 | Notification dropdown uses light-mode border color | P2 | `views/layout.ts` |
| 06 | Theme-color meta tag not consistent across all pages | P2 | `views/layout.ts`, auth pages |

---

## Cross-References

- **Lens 24 (Design critic):** Finding 01 here is the root cause of the "two visual languages" finding in Lens 24.
- **Lens 23 (Accessibility):** Light-mode text on dark backgrounds (Finding 02) creates contrast failures that are also accessibility issues.
- **Lens 16 (Product designer):** Theme integrity is a prerequisite for a cohesive design system.
