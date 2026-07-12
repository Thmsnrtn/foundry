# Go-Live Checklist — safe for strangers

> **Status check — 2026-07-12 (remote session, no Fly token available):**
> - 🔴 **The production app is DOWN.** `foundry-intel.fly.dev` times out on every
>   path (no healthy machine) — consistent with the BLOCKER-FLY-TOKEN note
>   (machine stopped on missing secrets). General egress from the test
>   environment was fine; the app is simply not serving. **First operator
>   action: set secrets + redeploy (runbook in docs/blockers/BLOCKER-FLY-TOKEN.md).**
> - 🟢 **Local staging rehearsal passed** (the entire §1 that doesn't need live
>   keys): fresh empty DB → all 130 migrations apply → every public page
>   (/, /help, /privacy, /terms, /pricing, /auth/login) serves 200 →
>   /internal/health returns ok JSON → every authenticated surface
>   (/dashboard, /letter, /connections) correctly 401s → production boot with
>   missing Clerk vars **exits 1 naming the missing vars** → worker role boots
>   with the scheduler correctly gated to production. Degraded-config warnings
>   fire per missing var with the concrete consequence.
> - 🟢 **Stripe live account verified read-only** (acct_1SATMcRx25BFZ1Jm,
>   shared with AcreOS): Foundry product `prod_ULJCAvVQCYi864` has all three
>   tiers active with lookup keys — Solo $79 `price_1TrGcQRx25BFZ1JmKX8LLjUU`,
>   Growth $199 `price_1TMcZoRx25BFZ1JmvZC3Ebig`, Investor-Ready $399
>   `price_1TMcZpRx25BFZ1JmZauYkItz`. These are the values for the
>   STRIPE_*_PRICE_ID secrets.
> - 🔴 **Legacy $99 "Founding Cohort" price is still active**
>   (`price_1TMcZoRx25BFZ1JmLSzy4AlJ`) — archiving it was permission-blocked
>   from the session; it's one click in the dashboard (Products → Foundry →
>   Founding Cohort → Archive).
> - 🟡 **Webhook endpoint could not be listed** via the session's Stripe
>   access — verify in the dashboard that an endpoint exists for
>   `https://foundry-intel.fly.dev/webhooks/stripe` and that its signing
>   secret matches the STRIPE_WEBHOOK_SECRET Fly secret.

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
- 🟢 (Roadmap 3.4) Outbound money side effects are now idempotent. GitHub PR
  creation routes through the tool gateway with a stable `dedupKey`
  (`remediation:<id>`), and every mutating Stripe call (create customer /
  subscription / checkout session, pause, cancel) now sends a Stripe-native
  `idempotencyKey` that is stable across a call's retries — so a retry after a
  lost-response success dedups server-side instead of double-charging. Guarded by
  `tests/unit/stripe-idempotency.test.ts`.

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
- **Open to strangers:** additionally finish the 3.4 gateway migration for money
  idempotency. Two of the three items here are now done in code:
  - 🟢 **2.7 eval net in CI** — `tests/evals/prompt-assembly.eval.test.ts` guards
    the agent system-prompt scaffold (cache-cost invariant 2.2 + the C-suite
    output contract); a dedicated `evals` CI job runs `npm run test:evals`, and
    the stranger-safety walkthrough sim is now its own `walkthrough-sim` CI gate.
    A prompt edit that breaks caching or drops the output standard fails the build.
  - 🟢 **Cron load/contention test** — `tests/load/cron-load.ts` (+ the
    `cron-load` CI job and `tests/unit/job-lock-contention.test.ts`) stress the
    distributed job lock the web/worker split relies on: N instances race each
    job (exactly one wins), crashed-worker leases are reclaimed, and a full
    75-job lock sweep runs in ~10ms — far under the tightest (per-minute) cadence.
    What still needs a *live* run is the jobs' real work under real data volume
    on staging (external calls, AI cost); the lock layer itself is verified.
  - 🟢 **3.4 outbound money idempotency** — DONE in code (see §2): GitHub PRs
    dedup through the gateway; every mutating Stripe call carries a native
    idempotency key. What remains is the §2 *live* Stripe test-mode run to
    confirm the end-to-end trial→active→cancel path on real infrastructure.

> Prompt-quality caveat: nobody has eyeballed a real generated briefing against
> a real repo yet (Verification step 6 — needs live keys). Do this during the
> staging walkthrough; the agents now run on real telemetry, but confirm the
> output reads like an operator, not generic MBA advice.
