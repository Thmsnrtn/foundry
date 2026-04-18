# Lens 102 — RTL Language Handling

**Auditor Persona:** Edge-Case Hunter / Adversary (Tier 3)
**Date:** 2026-04-16
**Scope:** CSS direction, `lang` attribute, bidirectional text in mixed content, layout integrity

---

## Executive Summary

Foundry has zero RTL support. The HTML `lang` attribute is hardcoded to `"en"`, there is no `dir` attribute anywhere, and no CSS `direction` or `writing-mode` properties exist. For the current single-language English product targeting SaaS founders, this is an acceptable deferral. However, user-generated content (product names, competitor names, DNA fields) can contain Arabic, Hebrew, or other RTL text, and these will display incorrectly in the left-to-right layout without any `unicode-bidi` isolation.

---

## Findings

### RTL-01 — Hardcoded `lang="en"` with no `dir` attribute (Severity: Low)

**Description:** Every HTML page sets `<html lang="en">` and never specifies `dir="ltr"`. While browsers default to LTR, the explicit `dir="ltr"` attribute is best practice for ensuring consistent behavior when user content contains RTL characters.

**Evidence:**
- `src/views/layout.ts:63`: `<html lang="en">`
- No `dir` attribute anywhere in the codebase.
- Grep for `dir.*rtl|direction.*rtl|bidi|lang.*ar` returned zero results.

**Remediation:** Add `dir="ltr"` to the `<html>` element. Low effort, improves robustness.

---

### RTL-02 — User-generated content not bidi-isolated (Severity: Low)

**Description:** When a founder enters an Arabic product name or a competitor name in Hebrew, it will render inline without `unicode-bidi: isolate`, potentially disrupting surrounding LTR text layout (adjacent punctuation flips, numbers reorder).

**Evidence:**
- `src/views/layout.ts:79`: Product name rendered inline: `<span class="breadcrumb">/ ${productName}</span>`
- `src/views/components.ts:522`: Competitor names rendered inline.
- No `unicode-bidi` or `bdi` element usage anywhere.

**Remediation:** Wrap user-generated text in `<bdi>` elements or apply `unicode-bidi: isolate` via CSS. This is a low-priority enhancement for a US-market English product, but prevents visual bugs for international users.

---

### RTL-03 — Command palette search does not handle RTL input (Severity: Low)

**Description:** The command palette (`Cmd+K`) uses inline JavaScript with `toLowerCase()` for filtering. RTL text input in the search field will render correctly in the input element (browser handles this) but filtered results may display incorrectly because result items lack bidi isolation.

**Evidence:**
- `src/views/layout.ts:156-157`: Command palette JavaScript with inline HTML construction using string concatenation, no bidi isolation on result labels.

**Remediation:** Wrap result labels in `<bdi>` elements in the command palette template.

---

## Embarrassment Test

A founder with an Arabic SaaS product enters their product name. The sidebar shows garbled text with punctuation in wrong positions. The founder assumes the product is not mature enough for international use. **Severity: Cosmetic annoyance, not a deal-breaker for current market.**

## Pride Test

For a US-focused English-language product at the current stage, deferring full RTL support is a reasonable product decision. The `lang="en"` attribute is correct for the current audience.

## Distinct-Value Declaration

This lens establishes a clear baseline: zero RTL support today, three targeted improvements (`dir="ltr"`, `<bdi>` wrapping, command palette isolation) that take under an hour and prevent visual corruption for international user-generated content.

## Tenancy-Critical Flag

**No.** RTL handling is a per-user cosmetic concern. No tenant isolation or data integrity implications.
