# Sweep 1 — Lens 111
## Prior findings status
- SRI-01: RESOLVED — HTMX now self-hosted from /static/htmx.min.js (DEFECT-0033)
- SRI-02: STILL OPEN — Clerk JS still loaded from CDN without SRI (required by Clerk architecture)
- SRI-03: IMPROVED — unpkg.com removed from CSP; script-src now 'self' + Clerk domain only
- SRI-04: RESOLVED — single HTMX version, self-hosted
## New findings
- None
## Verdict: OPEN P0-P1 (SRI-02 remains Critical — Clerk CDN dependency is architectural; accepted risk)
