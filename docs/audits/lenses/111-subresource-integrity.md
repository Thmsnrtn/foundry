# Lens 111 — Subresource Integrity

**Auditor Persona:** Security Depth (Tier 3)
**Date:** 2026-04-16
**Scope:** HTMX loaded from CDN, Clerk JS from CDN, any other external scripts, SRI hash presence

---

## Executive Summary

Foundry loads critical external JavaScript from three different CDN sources without Subresource Integrity (SRI) hashes. HTMX is loaded from unpkg.com, Clerk JS is loaded from both unpkg.com and cdn.jsdelivr.net. None of these script tags include `integrity` attributes. A CDN compromise or MITM attack on any of these sources would allow arbitrary JavaScript execution in every Foundry user's browser, with full access to their Clerk session and all displayed data.

---

## Findings

### SRI-01 — HTMX loaded from unpkg without SRI (Severity: Critical)

**Description:** The main layout loads HTMX from `unpkg.com` without an `integrity` attribute. HTMX is present on every authenticated page and has access to the full DOM and session cookies. A compromised unpkg package could exfiltrate all founder data.

**Evidence:**
- `src/views/layout.ts:71`: `<script src="https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js" defer></script>` — no `integrity` or `crossorigin` attribute.
- Additionally, a different version is loaded in onboarding: `src/routes/dashboard/onboarding-chat.ts:106`: `<script src="https://unpkg.com/htmx.org@1.9.10"></script>` — different version, also no SRI.

**Remediation:** 
1. Pin the HTMX version and add SRI hash: `<script src="https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js" integrity="sha384-..." crossorigin="anonymous" defer></script>`.
2. Fix the version mismatch between layout (1.9.12) and onboarding-chat (1.9.10).
3. Better: self-host htmx.min.js as a static asset and eliminate the CDN dependency entirely.

---

### SRI-02 — Clerk JS loaded from multiple CDNs without SRI (Severity: Critical)

**Description:** Clerk's JavaScript SDK is loaded from two different CDN providers: `unpkg.com` in the landing page and `cdn.jsdelivr.net` in the auth pages. Neither has SRI hashes. Clerk JS handles authentication, including session token management.

**Evidence:**
- `src/routes/public/landing.ts:17`: `<script async crossorigin="anonymous" src="https://unpkg.com/@clerk/clerk-js/dist/clerk.browser.js" ...>` — `crossorigin` is present but no `integrity`.
- `src/routes/auth/clerk.ts:38`: `import("https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/+esm")` — dynamic import from jsdelivr, no SRI possible with dynamic imports.
- `src/routes/auth/clerk.ts:81`: Same dynamic import pattern on login page.

**Remediation:**
1. For the landing page: add SRI hash and pin to a specific version.
2. For auth pages: the dynamic `import()` pattern does not support SRI. Self-host the Clerk JS bundle or use a static `<script>` tag with SRI instead of dynamic import.

---

### SRI-03 — CSP allows entire CDN domains (Severity: High)

**Description:** The Content Security Policy in `script-src` allows `https://unpkg.com` (the entire domain) rather than a specific package path. Any package on unpkg could be loaded as a script.

**Evidence:**
- `src/middleware/security-headers.ts:26`: `"script-src 'self' 'unsafe-inline' https://unpkg.com https://*.clerk.accounts.dev"`.

**Remediation:** Narrow the CSP to specific script hashes or nonces rather than allowing entire CDN domains. If self-hosting, the CSP can be tightened to `'self'` only for scripts.

---

### SRI-04 — Two different HTMX versions loaded (Severity: Medium)

**Description:** The main layout loads HTMX 1.9.12, while the onboarding chat loads HTMX 1.9.10. This creates inconsistent behavior between pages and doubles the attack surface.

**Evidence:**
- `src/views/layout.ts:71`: HTMX 1.9.12.
- `src/routes/dashboard/onboarding-chat.ts:106`: HTMX 1.9.10.

**Remediation:** Standardize on a single HTMX version across all pages.

---

## Embarrassment Test

unpkg.com serves a compromised version of htmx.min.js for 6 hours. Every Foundry user loads it. The malicious script exfiltrates the `__session` cookie to an attacker server. The attacker now has Clerk session tokens for every active Foundry founder. **Likelihood: Low probability, catastrophic impact.**

## Pride Test

The `crossorigin="anonymous"` attribute on the landing page's Clerk script tag shows partial awareness of cross-origin security. The version pinning on HTMX (`@1.9.12`) prevents accidental upgrades.

## Distinct-Value Declaration

This lens provides an exhaustive inventory of every external script source (3 CDN references across 4 files) and maps the specific SRI gap for each. The dynamic `import()` pattern for Clerk JS is identified as a structural barrier to SRI that requires an architectural change (self-hosting) to fix.

## Tenancy-Critical Flag

**Yes.** A CDN compromise affects all tenants simultaneously — every user's browser loads the same compromised script. This is the highest-leverage single attack vector in the application.
