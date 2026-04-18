# Sweep 1 — Lens 007 (Security)
## Prior findings status
- SEC-01 (Plaintext token storage): IMPROVED — `src/services/encryption.ts` implements AES-256-GCM envelope encryption. Rollout coverage to all credential columns unknown.
- SEC-02 (GitHub OAuth no state param): RESOLVED — State generation + validation + oauth_states table usage confirmed in onboarding.ts.
- SEC-03 (No CSRF protection on forms): STILL OPEN — No evidence of CSRF tokens on state-mutating forms beyond the OAuth flow.
- SEC-04 (Stored XSS in share page): RESOLVED — `escapeHtml()` applied to all interpolated values in share/index.ts.
- SEC-05 (XSS via template injection in auth pages): STILL OPEN — Not verified as fixed.
- SEC-06 (Timing-unsafe key compare): RESOLVED — `timingSafeEqual` in internal.ts (confirmed).
- SEC-07 (No input validation): IMPROVED — `validateBody` middleware with Zod used on onboarding + ask routes. Most routes still unvalidated.
- SEC-08 (Transcript webhook raw key vs hash): STILL OPEN — No evidence of fix.
- SEC-09 (No security headers): RESOLVED — `security-headers.ts` middleware registered globally, includes X-Content-Type-Options (commit visible in index.ts line 167-168).
- SEC-10 (GitHub token leaked to client): STILL OPEN — Not verified as fixed.
- SEC-11 (Rate limiting bypassable via header): STILL OPEN.
- SEC-12 (Cross-tenant intelligence leakage): IMPROVED — Consent check added to decision_patterns writes (commit b7e0cdf).
- SEC-13 (No AI call rate/cost limiting): RESOLVED — Daily cost ceiling in AI client.
## New findings since prior audit
- None.
## Verdict: OPEN P0-P1
