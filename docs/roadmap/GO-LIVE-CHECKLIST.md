# Go-Live Checklist — safe for strangers

The code is in strong shape (741+ tests, deterministic CI, fresh-DB migration
verified). What stands between "green tests" and "strangers can safely use it"
is mostly **live verification and operator setup that can't be done from an
offline code pass.** Work top to bottom; do not open public signups until
everything through "Controlled alpha" is checked.

Legend: 🟢 done in code · 🟡 code-ready, needs a live run · 🔴 operator/live only

---

## 1. It actually boots and runs (highest-leverage gap)

- 🔴 **Deploy to staging** (`fly.staging.toml`) and confirm both process groups
  come up: `web` serves, `worker` runs the scheduler. Job locks prevent
  double-runs.
- 🔴 **Set all secrets** (per `docs/blockers/BLOCKER-FLY-TOKEN.md`): the boot now
  **fails fast** if `TURSO_DATABASE_URL`, `CLERK_SECRET_KEY`,
  `CLERK_PUBLISHABLE_KEY`, or an AI key is missing, and warns loudly for each
  degraded feature (Stripe price IDs, `ENCRYPTION_KEY`, `RESEND_API_KEY`,
  `SENTRY_DSN`). Read the boot logs — no warnings = fully configured.
- 🔴 **Seed the dogfood product**: `npm run cli -- seed:dogfood <productId>`
  (welcome email + SLO alerts route through the Foundry product's gateway scope).
- 🟡 **Manual first-run walkthrough** (Verification step 4): fresh Clerk user →
  onboarding → watch the audit progress render → land on a dashboard with a
  **non-empty** briefing → confirm welcome email queued → confirm trial state in
  the header. Repeat the no-code path. **This has not been run — it's the single
  most important pre-launch check.**
- 🔴 **Turso backup + restore drill.**
- 🔴 Sign up for Sentry, set `SENTRY_DSN`, trigger a test error, confirm it lands.

## 2. Money is safe

- 🟢 14-day card-upfront trial; webhook persists/clears `trial_ends_at`;
  idempotent webhook processing (`stripe_webhook_events`).
- 🟡 **Run one real checkout in Stripe test mode** end-to-end: trial start →
  `trialing` → convert to `active` → cancel. Confirm tier + trial state update
  and the funnel records `trial_started` / `paid`.
- 🟡 Confirm dunning (`past_due`) notification fires.
- 🔴 **Decide + test the refund path** (a real alpha will ask). No automated
  refund flow exists yet — document the manual process at minimum.
- 🟡 (Roadmap 3.4) Not every outbound side effect is idempotent through the
  gateway yet (Stripe/GitHub). Low volume in alpha; revisit before scale.

## 3. Abuse & cost control (strangers = adversaries)

- 🟢 Rate limits wired: auth (10/min), API (120/min), AI (30/hr/founder), and now
  **audit (6/hr/founder)** — the expensive op can no longer be hammered.
- 🟢 AI daily cost ceiling persisted (per-product / per-founder / global) +
  hourly SLO spend alert to the operator.
- 🟡 **Set the cost caps for real** via env (`AI_DAILY_COST_CEILING_*`) to match
  your risk tolerance, and confirm the SLO alert email actually arrives.
- 🟡 Confirm Clerk bot/abuse protection is enabled on the signup form.

## 4. Legal / privacy (required for public)

- 🟢 Privacy policy + terms (`/privacy`, `/terms`), consent gating, 180-day data
  retention job, GDPR export (Art. 20) + deletion (Art. 17) jobs + `/privacy`
  route.
- 🟡 **Test the data-export and account-deletion flows end-to-end** with a real
  account.

## 5. Support & trust

- 🟢 `/help` (FAQ + operator email), branded HTML error pages that don't leak
  stack traces, honest pricing (no unshippable iOS claim).
- 🟡 Confirm `SUPPORT_EMAIL` / `OPERATOR_EMAIL` route to a monitored inbox.

## 6. Observability

- 🟢 Structured logging, error reporter seam, SLO check job, `/internal/health`
  (checks DB + AI + Clerk, returns 503 when degraded so the LB stops routing).
- 🟡 Confirm the health check is wired to Fly's load balancer (it is in
  `fly.toml`) and that a degraded instance is actually pulled.

---

## The bar

- **Controlled alpha (10 hand-held founders, 5.3):** everything in §1–§5 that's
  🟡 verified once on staging. This is the recommended next step.
- **Open to strangers:** additionally finish 2.7 (eval net in CI so prompt
  regressions can't ship silently), a real **load test** of the 73 crons under
  the web/worker split, and the 3.4 gateway migration for money idempotency.

> Prompt-quality caveat: nobody has eyeballed a real generated briefing against
> a real repo yet (Verification step 6 — needs live keys). Do this during the
> staging walkthrough; the agents now run on real telemetry, but confirm the
> output reads like an operator, not generic MBA advice.
