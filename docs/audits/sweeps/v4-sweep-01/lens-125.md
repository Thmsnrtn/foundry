# Sweep 1 — Lens 125
## Prior findings status
- RB-01 (HTMX from CDN): RESOLVED — HTMX self-hosted at /static/htmx.min.js (DEFECT-0033)
- RB-02 (Clerk JS from CDN): STILL OPEN — Clerk requires CDN load (architectural)
- RB-03 (no preload hints): STILL OPEN
- RB-04 (inline styles cause reflow): STILL OPEN
- RB-05 (no critical CSS extraction): STILL OPEN
- RB-06 (self-hosted CSS): N/A (positive)
## New findings
- None
## Verdict: OPEN P0-P1 (RB-01 P1 resolved; RB-02 remains P1 — Clerk CDN render-blocking)
