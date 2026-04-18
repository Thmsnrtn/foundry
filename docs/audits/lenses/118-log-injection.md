# Lens 118 — Log Injection

**Auditor Persona:** Security Depth (Tier 3)
**Date:** 2026-04-16
**Scope:** Can an attacker inject fake log entries via product names, webhook payloads, or API inputs?

---

## Executive Summary

Foundry's structured logger produces JSON in production and plaintext in development. In production mode, user input interpolated into log messages is embedded within JSON string values, which naturally escapes newlines and special characters. This makes log injection in production logs difficult but not impossible — a carefully crafted product name could inject misleading content within the JSON message field. In development mode (`[LEVEL] message`), log injection is trivially possible because user input is interpolated directly into the log string without escaping. Additionally, 422 raw `console.log/error/warn` calls bypass the structured logger entirely.

---

## Findings

### LOG-01 — Development-mode log injection via product names (Severity: Medium)

**Description:** In development, the logger outputs `[LEVEL] message {context}`. If a product name contains a newline followed by `[ERROR]`, it creates a fake log entry that appears to be a real error.

**Evidence:**
- `src/services/logger.ts:19`: Dev format: `` `[${level.toUpperCase()}] ${message}${ctx ? ' ' + JSON.stringify(ctx) : ''}` ``.
- `src/jobs/index.ts:49`: `logger.info(\`lifecycle_check: ${p.name} activated: ...\`)` — product name interpolated directly into log message.
- `src/jobs/index.ts:66`: `logger.info(\`competitive_scan: ${p.name} — ${signals.length} signals\`)` — same pattern.
- A product named `"MyApp\n[ERROR] SECURITY BREACH DETECTED"` would produce a fake error line in dev logs.

**Remediation:** Sanitize user input before interpolating into log messages: strip newlines and control characters. Or always use structured context (second argument) for user-supplied data rather than embedding in the message string.

---

### LOG-02 — Production JSON logs resist injection but allow misleading content (Severity: Low)

**Description:** In production, the logger outputs `JSON.stringify({ level, message, timestamp, ...ctx })`. JSON encoding escapes newlines (`\n`) and special characters, preventing log line injection. However, a product name like `"MyApp","level":"error","message":"BREACH"` would appear as a confusing string within the JSON message value — technically safe but could mislead automated log parsers.

**Evidence:**
- `src/services/logger.ts:20`: Production format: `JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...ctx })`.
- The spread `...ctx` could theoretically collide with reserved keys if a context object has a `level`, `message`, or `timestamp` property, overwriting the log entry's metadata.

**Remediation:** Use a fixed key order: construct the object with reserved keys first, spread context into a `data` sub-object: `{ level, message, timestamp, data: ctx }`.

---

### LOG-03 — 422 console.log calls bypass structured logging (Severity: Medium)

**Description:** The 422 raw console.log/error/warn calls across 40 files have no structured formatting, no escaping, and no context. Any user input logged through these calls is a direct injection vector.

**Evidence:**
- Orientation document: "422 console.log/error/warn occurrences across 40 files."
- `src/db/client.ts:25`: `console.warn('[DB] Could not enable foreign_keys PRAGMA')` — safe (no user input).
- `src/db/migrate.ts:39-61`: `console.log(\`[MIGRATE] Applying ${file}...\`)` — migration filenames are developer-controlled, not user input.
- `src/middleware/auth.ts:99`: `console.error('Auto-provision founder failed:', e)` — error objects may contain user data.

**Remediation:** Migrate all console.* calls to the structured logger. Priority: any call that interpolates user-supplied data.

---

### LOG-04 — Webhook payloads logged without sanitization (Severity: Low)

**Description:** Webhook handlers log error details from external services (Stripe, Clerk). These payloads could contain attacker-controlled data if the webhook source is spoofed or manipulated.

**Evidence:**
- `src/index.ts:237`: `logger.error('Stripe webhook error', { error: String(err) })` — error message may contain attacker data.
- `src/index.ts:256`: Same pattern for per-product Stripe webhook.

**Remediation:** Truncate error messages before logging: `String(err).slice(0, 500)`. This prevents oversized error messages from consuming log storage and limits injected content.

---

## Embarrassment Test

An attacker creates a product named `MyApp\n[ERROR] CRITICAL: Database breach detected — all founder data compromised`. In development, this produces a fake error log line. A developer sees it in the console, panics, and sends an incident response alert to all founders. **Likelihood: Low in production (JSON escaping), medium in development.**

## Pride Test

The structured logger in `src/services/logger.ts` is well-designed: JSON in production, human-readable in development, with typed context support. The production JSON format naturally resists most injection attacks.

## Distinct-Value Declaration

This lens identifies the specific code pattern — user data interpolated into the `message` string instead of passed as structured `context` — as the root cause of log injection risk. The fix is consistent use of the structured logger's second argument for all user-supplied data.

## Tenancy-Critical Flag

**No.** Log injection is a monitoring/operational concern. It does not enable cross-tenant data access, though it could be used for social engineering against operators.
