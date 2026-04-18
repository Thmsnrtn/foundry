# Lens 119 — Deserialization Safety

**Auditor Persona:** Security Depth (Tier 3)
**Date:** 2026-04-16
**Scope:** JSON.parse calls without try/catch, parseJSONResponse from AI, prototype pollution, unsafe deserialization

---

## Executive Summary

Foundry has approximately 60+ `JSON.parse` calls across the codebase. About half are wrapped in try/catch (the integration fabric services are consistently defensive), while the other half parse data from the database or AI responses without error handling. The `parseJSONResponse` function in the AI client strips markdown fences and calls `JSON.parse` — if Claude returns malformed JSON, this throws an unhandled exception that propagates to the cron job or route handler. There is no prototype pollution protection on any JSON.parse call, though the practical risk is low because parsed objects are not used to set properties on shared prototypes.

---

## Findings

### DESER-01 — parseJSONResponse has no try/catch (Severity: High)

**Description:** The AI client's `parseJSONResponse` function calls `JSON.parse` without try/catch. If Claude returns invalid JSON (which happens when the response is truncated due to max_tokens, includes preamble text, or has encoding issues), the exception propagates up, potentially crashing a cron job or returning a 500 to the user.

**Evidence:**
- `src/services/ai/client.ts:197-209`: `parseJSONResponse` strips code fences then calls `JSON.parse(cleaned.trim()) as T`. No try/catch.
- This function is called from: remediation engine, competitive scan, stressor identification, risk assessment, and many other services. A failure in any of these propagates as an unhandled exception.

**Remediation:** Wrap `JSON.parse` in try/catch and return a typed error result: `{ success: false, error: 'Invalid JSON from AI', raw: content }`. Callers should handle the error gracefully.

---

### DESER-02 — Database JSON columns parsed without try/catch in many services (Severity: Medium)

**Description:** Many services parse JSON columns from database rows without error handling. If a row contains malformed JSON (e.g., from a partial write or migration issue), the parse failure crashes the request.

**Evidence (unprotected calls):**
- `src/middleware/auth.ts:120`: `JSON.parse(row.preferences)` ��� no try/catch.
- `src/middleware/tenant.ts:118`: `JSON.parse(lsRow.prompt_2_hypotheses)` — no try/catch.
- `src/services/decisions/queue.ts:97-98`: `JSON.parse(row.context)`, `JSON.parse(row.options)` — no try/catch.
- `src/services/experiments/engine.ts:129`: `JSON.parse(exp.variants as string)` — no try/catch.

**Evidence (protected calls — good pattern):**
- `src/services/integration/fabric.ts:51`: `try { return JSON.parse(row.config_json...); } catch { return {}; }` — defensive.
- `src/services/integration/fabric.ts:75,78,81`: Same defensive pattern throughout.

**Remediation:** Create a utility function `safeParseJSON<T>(value: string | null, fallback: T): T` that wraps JSON.parse in try/catch. Use it everywhere database JSON is parsed.

---

### DESER-03 — No prototype pollution protection (Severity: Low)

**Description:** `JSON.parse` in JavaScript does not create objects with `__proto__` or `constructor` properties by default (it creates plain objects). However, if parsed objects are later merged into other objects using spread or `Object.assign`, prototype pollution could theoretically occur if the parsed data contains `__proto__` keys.

**Evidence:**
- Grep for `__proto__|constructor` returned minimal results — no evidence of prototype-based merging of user data.
- `src/middleware/tenant.ts:103-121`: Uses spread operator `...lsRow` to construct lifecycle state, but `lsRow` comes from the database (trusted source).

**Remediation:** Low priority. If needed, add a `JSON.parse` reviver that strips `__proto__` and `constructor` keys. The current risk is theoretical.

---

### DESER-04 — AI response parsing trusts content structure (Severity: Medium)

**Description:** After `parseJSONResponse` succeeds, the returned object is cast to a TypeScript type with `as T`. There is no runtime validation that the parsed object actually matches the expected shape. A Claude response that returns valid JSON but with wrong keys/types would cause runtime errors downstream.

**Evidence:**
- `src/services/ai/client.ts:208`: `return JSON.parse(cleaned.trim()) as T` — pure type assertion, no runtime check.
- `src/services/audit/remediation.ts:176`: `const fix = parseJSONResponse<FixGenerationOutput>(response.content)` — if Claude returns `{ "foo": "bar" }` instead of the expected shape, `fix.files` would be `undefined` and accessing `.length` would throw.

**Remediation:** Use Zod to validate AI response shapes after parsing. Create schemas for each expected AI response type. This catches malformed responses before they propagate.

---

### DESER-05 — Clerk webhook body parsed after signature verification (Severity: None)

**Description:** The Clerk webhook handler correctly verifies the HMAC signature before parsing the JSON body. The parse itself has no try/catch, but since the signature verification ensures the body came from Clerk, malformed JSON would indicate a Clerk-side bug, not an attack.

**Evidence:**
- `src/routes/auth/clerk.ts:142`: `const payload = JSON.parse(rawBody)` — after signature verification at line 127-139.

**Remediation:** Add try/catch for robustness, but this is low priority since the body is verified.

---

## Embarrassment Test

A cron job calls `parseJSONResponse` to parse an AI response. Claude's response is truncated at max_tokens, ending mid-JSON: `{"fix_summary": "add error hand`. `JSON.parse` throws `SyntaxError: Unexpected end of JSON input`. The exception propagates to the job runner, which logs it but continues. The remediation record stays in `status = 'generating'` forever. The founder sees a stuck PR in their dashboard with no explanation. **Likelihood: Medium. Claude truncation is a known failure mode.**

## Pride Test

The integration fabric services (`src/services/integration/fabric.ts`) consistently use defensive JSON parsing with fallback values. This pattern exists in the codebase — it just needs to be applied universally.

## Distinct-Value Declaration

This lens provides an exact count of protected vs. unprotected JSON.parse calls and identifies `parseJSONResponse` as the highest-risk deserialization point because it processes untrusted AI output without try/catch or shape validation. The recommended `safeParseJSON` utility would fix dozens of callsites.

## Tenancy-Critical Flag

**No.** Deserialization failures affect individual requests or cron jobs for specific products. No cross-tenant data leakage is possible through JSON parsing errors.
