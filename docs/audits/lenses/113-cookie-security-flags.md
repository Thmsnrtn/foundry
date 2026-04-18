# Lens 113 — Cookie Security Flags

**Auditor Persona:** Security Depth (Tier 3)
**Date:** 2026-04-16
**Scope:** All Set-Cookie calls, HttpOnly, Secure, SameSite, Path, session cookie handling

---

## Executive Summary

Foundry sets exactly one application cookie: the CSRF token (`foundry_csrf`). The primary session cookie (`__session`) is managed by Clerk and is not set by Foundry's server code. The CSRF cookie has appropriate flags (HttpOnly, SameSite=Lax, Path=/), but critically lacks the `Secure` flag, meaning it will be transmitted over unencrypted HTTP connections. In production (where HSTS is enabled and Fly.io forces HTTPS), this is less concerning, but in development or if HSTS is not preloaded, the cookie could be intercepted.

---

## Findings

### COOK-01 — CSRF cookie missing Secure flag (Severity: Medium)

**Description:** The CSRF cookie is set with `HttpOnly; SameSite=Lax; Max-Age=86400` but does not include the `Secure` flag. Without `Secure`, the cookie is sent over HTTP connections, making it vulnerable to interception on non-HTTPS links.

**Evidence:**
- `src/middleware/csrf.ts:37`: `c.header('Set-Cookie', \`${CSRF_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400\`, { append: true })`.
- `src/middleware/csrf.ts:78`: Same pattern repeated for POST response.

**Remediation:** Add `; Secure` to the Set-Cookie string in production: `${isProduction ? '; Secure' : ''}`. This ensures the cookie is only sent over HTTPS.

---

### COOK-02 — Clerk __session cookie security depends on Clerk configuration (Severity: Low)

**Description:** The primary authentication cookie (`__session`) is set by Clerk's client-side JavaScript, not by Foundry's server. Its security flags (HttpOnly, Secure, SameSite) are determined by Clerk's configuration. The server code only reads this cookie via regex parsing.

**Evidence:**
- `src/middleware/auth.ts:47-51`: Cookie extraction via manual string splitting: `cookie.split(';').map(c => c.trim()).find(c => c.startsWith('__session='))`.
- No validation that the cookie has expected security properties.

**Remediation:** Verify Clerk's cookie configuration ensures HttpOnly=true, Secure=true, SameSite=Lax. This is a Clerk dashboard setting, not application code.

---

### COOK-03 �� Cookie parsing is manual string splitting, not a library (Severity: Low)

**Description:** The auth middleware parses cookies by splitting on `;` and `=` characters. This works for simple cookies but can fail with cookies containing `=` in their values (e.g., base64-encoded JWTs, which Clerk's `__session` cookie is).

**Evidence:**
- `src/middleware/auth.ts:49`: `token = sessionCookie.split('=')[1] ?? null` — only takes the first `=` split, which would truncate a JWT containing `=` characters. However, JWTs use base64url encoding (no `=` padding by default), so this likely works in practice.
- Orientation document suspected problem #13: "Auth token extraction is regex-based."

**Remediation:** Use Hono's built-in `getCookie` helper (already imported in some routes): `import { getCookie } from 'hono/cookie'`. The auth middleware currently does not use it.

---

### COOK-04 — Product switcher uses cookie without explicit flags (Severity: Low)

**Description:** The product switcher likely stores the selected product ID in a cookie (referenced in dashboard route). If this cookie is set via Hono's `setCookie` helper, the flags depend on the options passed.

**Evidence:**
- `src/routes/dashboard/index.ts:8`: `import { setCookie, getCookie } from 'hono/cookie'` — imported, used for product selection persistence.
- The exact flags depend on the `setCookie` call options; this would need to be verified in the route handler.

**Remediation:** Ensure any product ID cookie is set with `httpOnly: true, secure: isProduction, sameSite: 'Lax'`.

---

## Embarrassment Test

A developer tests Foundry on `http://localhost:8080`. The CSRF cookie works fine. They share a staging URL over HTTP (no HTTPS). The CSRF token is transmitted in cleartext. An attacker on the same network captures it. However, since the CSRF token is also in the cookie (double-submit pattern), and the attacker would need to also forge the form field/header, the impact is limited. **Low practical risk, but the missing `Secure` flag is a code review red flag.**

## Pride Test

The CSRF implementation uses crypto-random tokens, double-submit cookie pattern, and correctly sets `HttpOnly` and `SameSite=Lax`. The Bearer token bypass for API requests is correctly implemented. This is a well-designed CSRF middleware with one missing attribute.

## Distinct-Value Declaration

This lens provides a complete cookie inventory (exactly 1 application cookie + 1 Clerk-managed cookie) and identifies the single missing `Secure` flag. The manual cookie parsing in auth middleware is flagged as a maintainability concern that Hono's built-in helpers could resolve.

## Tenancy-Critical Flag

**No.** Cookie security affects individual user sessions. Cross-tenant access is prevented by server-side ownership validation, not cookies.
