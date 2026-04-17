# Lens 20 — Typography Expert

**Auditor perspective:** Evaluate the type system. Font stack, size scale, weight usage, line height, letter spacing, number formatting. Is financial data formatted with tabular numerals?

**Date:** 2026-04-16
**Repo:** /Users/user/foundry/

---

## Executive Summary

Foundry's typography is its strongest visual asset. The system font stack is correct, the base size (14px) is appropriate for data-dense dark UI, headings use tight negative tracking that feels premium, and `font-variant-numeric: tabular-nums` is applied to 10 financial/metric elements — an unusually thorough treatment. The heading hierarchy (h1: 1.55rem/700, h2: 1.25rem/600, h3: 1rem/600) is clean. However, the type scale has 30+ distinct `font-size` values with no tokenization, line-height is inconsistent (values from 1.0 to 1.75 with no system), letter-spacing has 10+ distinct values applied ad hoc, and the monospace font stack is used only for `<code>` elements despite the product having audit dimension IDs, version numbers, and dates that would benefit from it. No font-size custom properties exist.

---

## Findings

### F20.1 — 30+ font-size values with no scale tokens

**Severity:** P1
**Evidence:** Distinct `font-size` values in `styles.css`: `0.65rem`, `0.68rem`, `0.7rem`, `0.72rem`, `0.75rem`, `0.76rem`, `0.78rem`, `0.8rem`, `0.82rem`, `0.84rem`, `0.85rem`, `0.85em`, `0.87rem`, `0.88rem`, `0.9rem`, `0.92rem`, `0.95rem`, `0.97rem`, `1rem`, `1.05rem`, `1.1rem`, `1.2rem`, `1.25rem`, `1.4rem`, `1.55rem`, `1.6rem`, `1.75rem`, `2rem`, `2.5rem`, `3.5rem`, `5rem`, `6rem`, `9rem`. That is 33 distinct sizes. The difference between `0.82rem` and `0.84rem` is 0.28px at 14px base — invisible to the human eye.
**Remediation:** Define a type scale in `:root`:
```css
--text-xs:   0.68rem;   /* 9.5px — labels, badges */
--text-sm:   0.78rem;   /* 10.9px — metadata, captions */
--text-base: 0.87rem;   /* 12.2px — body text in dense contexts */
--text-md:   1rem;      /* 14px — default body */
--text-lg:   1.25rem;   /* 17.5px — h2 */
--text-xl:   1.55rem;   /* 21.7px — h1 */
--text-2xl:  2rem;      /* 28px — large metrics */
--text-3xl:  2.5rem;    /* 35px — composite scores */
--text-hero: 9rem;      /* 126px — signal number */
```
Collapse the 33 values into 9-10 steps. `0.82rem` and `0.84rem` both become `--text-sm`. `0.87rem` and `0.9rem` both become `--text-base`.

### F20.2 — Line-height is inconsistent with no tokens

**Severity:** P1
**Evidence:** Line-height values in `styles.css`: `1` (signal number, portfolio number), `1.3` (chamber-what), `1.4` (portfolio status, timeline events), `1.45` (daily insight headline), `1.5` (plan items, anatomy hint), `1.55` (scenario text), `1.6` (body default), `1.65` (reflect response, daily insight body), `1.7` (signal prose, chamber-why, query response, analytics synthesis, wisdom opt-in), `1.75` (plan synthesis). That is 10 distinct values. The body default is `1.6` but dense components use `1.4` and readable prose uses `1.7` — a reasonable intent, but the intermediate values are noise.
**Remediation:** Define three line-height tokens:
```css
--leading-tight:  1.3;   /* headings, large numbers */
--leading-normal: 1.5;   /* body text, compact content */
--leading-loose:  1.7;   /* prose, long-form readable text */
```
Collapse 10 values into 3. Single-line display numbers keep `line-height: 1`.

### F20.3 — Letter-spacing has 10+ distinct values

**Severity:** P2
**Evidence:** Negative tracking for display: `-6px` (signal number), `-2px` (portfolio number), `-1px` (large metrics, MRR amount), `-0.5px` (h1, logo, chamber-what), `-0.3px` (h2), `-0.2px` (h3). Positive tracking for labels: `0.02em` (delta, mobile label), `0.04em` (badge, portfolio header), `0.05em` (MRR label, tier badge), `0.06em` (multiple section headers), `0.08em` (nav section, risk badge, chamber resolve), `0.1em` (sparkline label, analytics section), `0.12em` (anatomy title, daily insight eyebrow, chamber section label), `0.18em` (signal label). 17 distinct values.
**Remediation:** Define letter-spacing tokens:
```css
--tracking-tighter: -0.04em;  /* display numbers */
--tracking-tight:   -0.02em;  /* headings */
--tracking-normal:  0;
--tracking-wide:    0.06em;   /* all-caps labels */
--tracking-wider:   0.12em;   /* eyebrow text */
```
The `px`-based values for large display text should stay as-is (they scale with font size correctly).

### F20.4 — Tabular numerals are correctly applied to financial data

**Severity:** P0 (strength, not a finding)
**Evidence:** `font-variant-numeric: tabular-nums` is applied to: `.signal-number`, `.signal-delta`, `.anatomy-value`, `.analytics-total-value`, `.metric-value`, `.mrr-amount`, `.mrr-comp-value`, `.composite-score`, `.dim-score`, `.portfolio-signal-number`. All 10 elements that display numeric values in columns or comparison contexts use tabular numerals. This prevents columns from misaligning when values change.
**Remediation:** None needed. This is exemplary. Consider extending to the cohort table percentage values and the MRR health ratio display.

### F20.5 — Font weight usage is disciplined but could be tokened

**Severity:** P2
**Evidence:** Weights used: `400` (implicit), `500` (nav links, buttons, body elements), `600` (h2, h3, anatomy value, delta, section labels), `700` (h1, badges, section headers, scores, dimension labels), `800` (logo, signal number, MRR amount, composite score, large metrics, portfolio numbers). Four distinct weights with clear hierarchy: 500 = body, 600 = emphasis, 700 = strong, 800 = display. This is good. But they are hardcoded — no `--font-weight-*` tokens.
**Remediation:** Define weight tokens: `--weight-normal: 500`, `--weight-medium: 600`, `--weight-bold: 700`, `--weight-black: 800`. This documents the intentional 4-weight system.

### F20.6 — Monospace font only used for code elements

**Severity:** P2
**Evidence:** The monospace stack (`'SF Mono', 'Fira Code', 'Cascadia Code', monospace`) is defined only on `code` elements (line 59). But the product displays audit dimension IDs (`D1`, `D2`...), agent versions (`v1`, `v2`), decision IDs, gate numbers, and timestamps — all of which would benefit from monospace rendering for alignment and visual distinction. The blocking issues component shows `code` tags for issue IDs, but dates and version numbers are in the body font.
**Remediation:** Create a `.mono` utility class and apply to: version badges, gate numbers, timestamps in tables, decision IDs, agent session counts. This creates a visual distinction between "data" and "prose."

### F20.7 — Currency formatting uses toLocaleString correctly

**Severity:** P0 (strength)
**Evidence:** `components.ts` line 296: `formatCents` uses `(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`. Revenue display in `revenue.ts` uses `(totalMrr / 100).toFixed(2)` with a `$` prefix. Combined with `tabular-nums` on MRR elements, financial data is consistently formatted.
**Remediation:** Minor: use `toLocaleString` consistently instead of mixing with `toFixed` (the latter doesn't add thousand separators for values >= $1,000).

---

## Embarrassment Test

The 33 distinct font-size values include pairs that differ by fractions of a pixel: `0.82rem` vs `0.84rem` (0.28px difference), `0.85rem` vs `0.87rem` (0.28px), `0.68rem` vs `0.7rem` (0.28px). These are imperceptible differences that create the illusion of intentional hierarchy without actual distinction. A designer reviewing the rendered output would not be able to identify which size is which. This is "designed by increment" rather than by a system.

## Pride Test

The `font-variant-numeric: tabular-nums` coverage is outstanding for a server-rendered product without a component library. Most products with dedicated design systems miss this detail on some numeric elements. Foundry applies it to all 10 relevant classes. The heading hierarchy — h1/h2/h3 with decreasing size, weight, and tracking — is textbook typographic practice. The body font size of 14px is a deliberate choice for data density that works well on the dark background. The combination of system font stack + tight tracking on headings + tabular numerals on data creates a product that looks expensive typographically, even where other design disciplines fall short.
