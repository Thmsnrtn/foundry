# Lens 116 — Third-Party Script Risk

**Auditor Persona:** Security Depth (Tier 3)
**Date:** 2026-04-16
**Scope:** Clerk JS from CDN, HTMX from unpkg, supply chain risk of client-side dependencies

---

## Executive Summary

Foundry loads two critical client-side dependencies from external CDNs: HTMX (from unpkg.com) and Clerk JS (from unpkg.com and cdn.jsdelivr.net). Both scripts execute in the same origin context as Foundry's pages, with full access to cookies, DOM, and any data visible to the founder. A compromise of either CDN or package would give an attacker total control over every Foundry user's browser session. The attack surface is amplified by the fact that Foundry has no Content Security Policy nonces, no Subresource Integrity, and allows `'unsafe-inline'` scripts.

---

## Findings

### 3P-01 — Clerk JS CDN compromise would steal all sessions (Severity: Critical)

**Description:** Clerk's JavaScript SDK handles authentication, session management, and token refresh in the browser. A compromised Clerk JS bundle could silently exfiltrate the `__session` JWT, intercept authentication flows, or redirect users to phishing pages.

**Evidence:**
- `src/routes/public/landing.ts:17`: `<script async crossorigin="anonymous" src="https://unpkg.com/@clerk/clerk-js/dist/clerk.browser.js" ...>`.
- `src/routes/auth/clerk.ts:38`: `import("https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/+esm")` — loaded on signup page.
- `src/routes/auth/clerk.ts:81`: Same dynamic import on login page.
- Clerk JS is loaded on the three most security-sensitive pages: landing, signup, and login.

**Remediation:**
1. Self-host Clerk JS: download the specific version, serve from `/static/clerk.js`, verify checksum.
2. If self-hosting is not possible (Clerk updates frequently), add SRI hashes and pin to exact versions.
3. The dynamic `import()` pattern for Clerk cannot use SRI — this must be converted to a static `<script>` tag with an integrity attribute.

---

### 3P-02 — HTMX CDN compromise would control all authenticated pages (Severity: Critical)

**Description:** HTMX is loaded on every page that uses the main layout (all dashboard pages). A compromised HTMX could intercept all form submissions (including CSRF tokens), modify DOM content, or exfiltrate displayed data.

**Evidence:**
- `src/views/layout.ts:71`: `<script src="https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js" defer></script>` — loaded on every dashboard page.
- HTMX processes `hx-*` attributes on the page, making it a privileged script that can trigger any server-side action.

**Remediation:** Self-host HTMX as a static asset. This eliminates the CDN dependency entirely and is a one-line change (update the `src` attribute to `/static/htmx.min.js`).

---

### 3P-03 — Two different CDN providers increases attack surface (Severity: Medium)

**Description:** Clerk JS is loaded from two different CDN providers (unpkg.com for landing, cdn.jsdelivr.net for auth pages). Each CDN is an independent point of failure and attack surface. A compromise of either CDN affects different pages.

**Evidence:**
- `unpkg.com`: Landing page (Clerk JS + HTMX), all dashboard pages (HTMX).
- `cdn.jsdelivr.net`: Signup and login pages (Clerk JS).
- Total CDN surface: 2 providers, 3 distinct script references.

**Remediation:** Consolidate to self-hosting for both dependencies. If CDN must be used, standardize on one provider.

---

### 3P-04 — No CSP report-uri for detecting unauthorized script execution (Severity: Low)

**Description:** The CSP does not include a `report-uri` or `report-to` directive. If a CDN serves a modified script that triggers a CSP violation (after tightening), there is no way to detect it.

**Evidence:**
- `src/middleware/security-headers.ts:24-32`: No `report-uri` or `report-to` directive.

**Remediation:** Add `report-uri /internal/csp-violations` and create an endpoint that logs CSP violation reports. This is especially valuable as a monitoring tool during CSP tightening.

---

### 3P-05 — No fallback if CDN is unavailable (Severity: Medium)

**Description:** If unpkg.com or cdn.jsdelivr.net is down or blocked (some corporate networks block CDNs), Foundry's pages will render but HTMX interactivity and Clerk authentication will not work. There is no local fallback.

**Evidence:**
- `src/routes/auth/clerk.ts:47-49`: Error handling shows a message if Clerk fails to load: `'Failed to load authentication. Please refresh the page.'`
- No fallback for HTMX — pages simply become non-interactive.

**Remediation:** Self-hosting eliminates this risk entirely. As a stopgap, add a `<script>` fallback: `if (!window.htmx) document.write('<script src="/static/htmx.min.js"><\/script>')`.

---

## Embarrassment Test

A supply-chain attacker publishes a compromised `htmx.org` version to npm. unpkg.com auto-serves it because Foundry pins `@1.9.12` but unpkg serves the latest matching version within the specified range (not the case for exact versions, but worth verifying). All Foundry users load the compromised script. **Likelihood: Very low with exact version pinning, but self-hosting eliminates the vector entirely.**

## Pride Test

The error handling in Clerk initialization (showing a user-friendly message on load failure) shows awareness of CDN reliability concerns. The `crossorigin="anonymous"` attribute on the landing page Clerk script enables CORS error reporting.

## Distinct-Value Declaration

This lens maps the complete external script dependency graph (2 CDN providers, 3 script references, 2 libraries) and provides a concrete self-hosting migration plan. The core recommendation — self-host both HTMX and Clerk JS — eliminates 100% of the CDN supply chain risk with minimal engineering effort.

## Tenancy-Critical Flag

**Yes.** CDN compromise affects all tenants simultaneously. Every browser loading the compromised script is vulnerable, regardless of tenant isolation on the server side.
