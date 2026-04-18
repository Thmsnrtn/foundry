# Lens 101 — Unicode / Emoji Handling

**Auditor Persona:** Edge-Case Hunter / Adversary (Tier 3)
**Date:** 2026-04-16
**Scope:** Product names, competitor names, decision text, AI responses, HTML rendering, database storage

---

## Executive Summary

Foundry's server-rendered HTML relies on Hono's `html` tagged template literal for escaping, which handles standard XSS vectors but has no explicit Unicode normalization, emoji width handling, or multi-byte safety checks. SQLite (Turso) stores UTF-8 natively, so raw storage works, but the application never validates or normalizes Unicode input. Product names, competitor names, and free-text fields accept arbitrary Unicode without length normalization, meaning a product named with 100 emoji characters could break layout assumptions while appearing "short" in character count.

---

## Findings

### UNI-01 — No Unicode normalization on input (Severity: Medium)

**Description:** User-supplied text (product names, competitor names, DNA fields, decision text) is stored and rendered without NFC/NFD normalization. The same visual string can have multiple byte representations, causing equality checks and uniqueness constraints to behave unexpectedly.

**Evidence:**
- `src/routes/dashboard/onboarding.ts` validates `z.string().min(1).max(100)` but `.max(100)` counts UTF-16 code units in JS, not grapheme clusters. A single emoji flag sequence is 2+ code units but one visual character.
- No call to `String.normalize()` anywhere in the codebase.
- `src/db/schema.sql`: `products.name TEXT NOT NULL` has no CHECK constraint on encoding or length.

**Remediation:** Add `.transform(s => s.normalize('NFC'))` to Zod schemas for user-facing text. Consider using `Intl.Segmenter` for grapheme-accurate length checks.

---

### UNI-02 — Hono html`` escapes HTML entities but not Unicode control characters (Severity: Low)

**Description:** Hono's `html` tagged template escapes `<`, `>`, `&`, `"`, `'` but does not strip Unicode bidirectional override characters (U+202A-U+202E, U+2066-U+2069) or zero-width joiners. An attacker could use RLO (Right-to-Left Override) in a product name to make text appear reversed in the UI, creating a visual spoofing vector.

**Evidence:**
- `src/views/layout.ts:79`: `${productName}` interpolated directly into html template. Hono auto-escapes HTML but not Unicode control chars.
- `src/views/components.ts:522`: Competitor names rendered: `${c.website}` — same pattern.

**Remediation:** Strip Unicode control characters (categories Cc and Cf except newline/tab) in validation middleware. Add a sanitizer function: `input.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')`.

---

### UNI-03 — AI responses may contain unexpected Unicode (Severity: Low)

**Description:** `parseJSONResponse` in `src/services/ai/client.ts` strips markdown fences then calls `JSON.parse()`. Claude may return smart quotes, em-dashes, or non-ASCII punctuation in its output. While `JSON.parse` handles UTF-8, the parsed content is rendered in HTML without checking for control characters or overlong sequences.

**Evidence:**
- `src/services/ai/client.ts:208`: `return JSON.parse(cleaned.trim()) as T;`
- AI-generated decision text, briefing content, and remediation summaries are rendered directly in HTML templates.

**Remediation:** Post-process AI text outputs through a Unicode sanitizer before rendering.

---

### UNI-04 — Emoji in SVG sparkline and metric cards (Severity: Low)

**Description:** UI components use emoji directly (notification bell uses literal emoji character, lock icons use emoji). These render inconsistently across platforms and are not accessible to screen readers without aria-labels.

**Evidence:**
- `src/views/layout.ts:194`: Notification bell renders literal emoji character.
- `src/views/layout.ts:350`: Lock icon uses emoji.

**Remediation:** Replace emoji with inline SVGs or use `aria-label` on every emoji-bearing element. Already partially done for mobile nav icons.

---

## Embarrassment Test

A founder names their product with a right-to-left override character prefix, making the sidebar product name display backwards. The founder screenshots this and shares it on Twitter as "Foundry can't even display my product name right." **Likelihood: Low but non-zero.** Fix: Strip bidi control chars.

## Pride Test

The Zod validation on product creation (`max(100)`) and the consistent use of parameterized SQL queries mean the common Unicode attack vectors (SQL injection via Unicode, XSS) are handled. Hono's auto-escaping is doing the heavy lifting correctly for HTML context.

## Distinct-Value Declaration

This lens uniquely identifies the gap between "HTML-safe" and "Unicode-safe" — Foundry escapes HTML entities correctly but ignores Unicode control characters, normalization, and grapheme-vs-code-unit length semantics.

## Tenancy-Critical Flag

**No.** Unicode issues are cosmetic or minor spoofing vectors within a single tenant's own UI. No cross-tenant data leakage is possible through Unicode manipulation because all queries are parameterized and scoped by `owner_id`.
