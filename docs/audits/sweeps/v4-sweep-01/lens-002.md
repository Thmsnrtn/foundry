# Sweep 1 — Lens 002 (Staff Frontend)
## Prior findings status
- FE-01 (2891 inline styles): STILL OPEN — `components.ts` still has 126, `layout.ts` has 26. Route files not audited but pattern unchanged.
- FE-02 (HTMX underutilized, 13 attributes): STILL OPEN — No evidence of expanded HTMX usage.
- FE-03 (Minimal accessibility, 4 aria-labels): IMPROVED — Command palette now has `role="dialog"`, `aria-label`, `aria-modal`, `role="combobox"` on input. Skip link added. Focus-visible styles added. Still extensive gaps in components.ts.
- FE-04 (Command palette inline JS/styles): IMPROVED — ARIA added (commit ad0fd3a). Still mostly inline styles.
- FE-05 (CSS design system well-structured): STILL POSITIVE.
- FE-06 (HTMX loaded everywhere, used on 3 pages): IMPROVED — HTMX now self-hosted locally (commit 27f8625). Still loaded globally.
- FE-07 (No asset versioning): STILL OPEN — `/static/styles.css` still has no hash.
- FE-08 (Emoji as icons): STILL OPEN — Notification bell still emoji.
- FE-09 (Mixed semantic HTML): STILL OPEN.
- FE-10 (Clerk/HTMX CDN no SRI): RESOLVED — HTMX self-hosted (commit 27f8625). Clerk CDN still used for auth pages.
## New findings since prior audit
- None.
## Verdict: OPEN P0-P1
