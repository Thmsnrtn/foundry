# Lens 19 — Design System Architect

**Auditor perspective:** Is there a coherent design system? CSS custom properties, component reuse, spacing scale, color tokens, typography scale. How consistent is visual treatment across pages?

**Date:** 2026-04-16
**Repo:** /Users/user/foundry/

---

## Executive Summary

Foundry has the skeleton of a strong design system — a well-chosen set of CSS custom properties for colors, borders, radii, and a transition token, all defined in `:root`. The color system is particularly good: three semantic signal colors mapped to risk states, a layered surface hierarchy, and three text opacity levels. However, the system breaks down in practice through massive inline style proliferation (2,909 `style="..."` occurrences across 49 dashboard route files), absence of a spacing scale, no component library abstraction, and inconsistent usage where route files bypass CSS classes entirely to hardcode colors and sizes. The design system exists in `styles.css` but is ignored by roughly half the codebase.

---

## Findings

### F19.1 — 2,909 inline styles across dashboard routes

**Severity:** P1
**Evidence:** `grep -c 'style="' src/routes/dashboard/*.ts` totals 2,909 occurrences across 49 files. Examples from `agents.ts`: `style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem;"`, `style="font-size:0.7rem;font-weight:700;letter-spacing:0.06em;background:rgba(108,99,255,0.15);color:#6c63ff;padding:2px 8px;border-radius:99px;white-space:nowrap;"`. The `components.ts` file has 126 inline styles in its "reusable" components. `agents-transparency.ts` has 203.
**Remediation:** Extract recurring inline patterns into CSS classes. The version badge pattern (`font-size:0.7rem;font-weight:700;letter-spacing:0.06em;background:rgba(108,99,255,0.15);color:#6c63ff;padding:2px 8px;border-radius:99px`) appears in 10+ agent routes — it should be `.badge-version`. Create utility classes for common layout patterns: `.flex-between`, `.flex-col`, `.gap-sm`, `.gap-md`.

### F19.2 — No spacing scale

**Severity:** P1
**Evidence:** The `:root` custom properties define `--radius: 10px`, `--radius-sm: 6px`, `--header-h: 52px`, `--sidebar-w: 192px`, and `--transition: 150ms ease`. There are zero spacing tokens. Padding and margin values are hardcoded throughout: `0.42rem`, `0.48rem`, `0.55rem`, `0.65rem`, `0.75rem`, `0.85rem`, `1rem`, `1.25rem`, `1.5rem`, `2rem`, `2.5rem`, `3.5rem`. The `0.42rem` and `0.48rem` values suggest manual tweaking rather than a scale.
**Remediation:** Define a spacing scale in `:root`:
```css
--space-1: 0.25rem;   /* 4px */
--space-2: 0.5rem;    /* 8px */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-5: 1.5rem;    /* 24px */
--space-6: 2rem;      /* 32px */
--space-8: 3rem;      /* 48px */
```
Migrate all padding/margin/gap values to use these tokens. Odd values like `0.42rem` should snap to the nearest scale step.

### F19.3 — Color tokens are well-defined but routinely bypassed

**Severity:** P1
**Evidence:** `:root` defines `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--border`, `--text`, `--text-muted`, `--text-dim`, `--accent`, `--signal-high/mid/low`, `--risk-green/yellow/red`. This is a good palette. But inline styles in route files bypass them: `color:#4b5563` (in `components.ts` line 383), `background:#f0f9ff` (line 367), `background:#ecfdf5` (line 397), `background:#fef2f2` (line 398), `border:1px solid #d1d5db` (line 521), `color:#065f46` (line 573). These are light-mode Tailwind colors that will look wrong on the dark background.
**Remediation:** Audit all hardcoded hex colors in `.ts` files. Replace `#f0f9ff`, `#ecfdf5`, `#fef2f2` (light-mode scenario card backgrounds in `components.ts`) with dark-mode equivalents using the existing `--risk-*` or `--signal-*` tokens with alpha. Replace `#d1d5db`, `#4b5563`, `#065f46` with `var(--border)`, `var(--text-muted)`, `var(--signal-high)`.

### F19.4 — Component abstraction is incomplete

**Severity:** P1
**Evidence:** `components.ts` exports 15 component functions: `riskStateBadge`, `stressorReport`, `mrrDecomposition`, `metricCard`, `auditScoreCard`, `decisionList`, `cohortTable`, `emptyState`, etc. These are good. But many routes build their own components inline instead of using or extending the shared set. `agents.ts` builds agent cards with 110 inline styles instead of a shared `agentCard()` component. `agents-briefings.ts` builds briefing cards inline. `ambient.ts` has a local `card()` helper function (line 20-31) that duplicates the design system card pattern with inline styles.
**Remediation:** Extract recurring card patterns into `components.ts`: `agentCard()`, `briefingCard()`, `timelineCard()`, `integrationCard()`. Each route file should import from `components.ts` rather than building HTML with inline styles.

### F19.5 — Two border-radius values with no system for when to use which

**Severity:** P2
**Evidence:** `--radius: 10px` and `--radius-sm: 6px` are defined. The CSS consistently uses `--radius` for cards and `--radius-sm` for smaller elements (badges, inputs, inner components). But inline styles use arbitrary values: `border-radius:12px` (agents.ts line 144), `border-radius:8px` (agents.ts line 129, multiple), `border-radius:4px` (ambient.ts line 28), `border-radius:50%` (for dots). The system has 2 tokens but practice shows 5+ different radii.
**Remediation:** Add `--radius-xs: 4px` and `--radius-full: 99px` (already used for pills). Document when to use each. Migrate all inline `border-radius` values to tokens.

### F19.6 — Hardcoded colors for agent status dots and health bars

**Severity:** P2
**Evidence:** In `agents.ts` line 70-71: `const color = status === 'active' ? '#4ecca3' : status === 'paused' ? '#ffb347' : '#ff6b6b';` — these are the same values as `--signal-high`, `--signal-mid`, `--signal-low` but hardcoded. Line 161: `const healthColor = healthScore >= 70 ? '#4ecca3' : healthScore >= 40 ? '#ffb347' : '#ff6b6b'` — same pattern repeated. These colors cannot be changed from one place if the palette evolves.
**Remediation:** Use CSS classes instead of inline color computation. Create `.status-active`, `.status-paused`, `.status-error` classes. For health bars, use CSS custom properties set via `style="--health-pct: ${healthScore}%"` with the color logic in CSS.

### F19.7 — Surface hierarchy is good but lacks a named component layer

**Severity:** P3
**Evidence:** `--bg` (darkest) > `--surface` (sidebar/header) > `--surface-2` (cards) > `--surface-3` (inner elements). This 4-layer hierarchy is well-chosen and consistently applied in `styles.css`. However, `components.ts` and route files sometimes use `rgba(255,255,255,0.03)`, `rgba(255,255,255,0.06)`, `rgba(255,255,255,0.07)` inline instead of the named tokens, creating a shadow palette outside the system.
**Remediation:** Map `rgba(255,255,255,0.03)` to `--surface-subtle`, `rgba(255,255,255,0.06)` to an alias for `--surface-3`, and audit inline `rgba(255,255,255,...)` usages to use tokens.

---

## Embarrassment Test

Open `components.ts` line 367-398 — the scenario modeling cards. Best case uses `background:#ecfdf5` (Tailwind green-50), base case uses `background:#f0f9ff` (Tailwind blue-50), stress case uses `background:#fef2f2` (Tailwind red-50). These are light-mode pastel backgrounds rendered inside a dark-mode application with `--bg: #0a0a12`. They will appear as blinding white rectangles against the dark surface. The design system has `--risk-green`, `--risk-yellow`, `--risk-red` with alpha variants already in use elsewhere (`.risk-bg-green`, `.risk-bg-yellow`, `.risk-bg-red`). The shared component file literally ignores its own design system.

## Pride Test

The color token architecture is genuinely excellent. The separation of `--signal-high/mid/low` (data states) from `--risk-green/yellow/red` (risk states) shows semantic thinking — even though the values currently map 1:1, the distinction allows future divergence. The 4-layer surface hierarchy creates clear depth without being heavy-handed. The `--border` and `--border-soft` distinction is a nice detail. This is a thoughtful foundation that deserves to be respected by the rest of the codebase.
