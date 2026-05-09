# Foundry — Pre-Alpha Readiness Assessment

> Date: 2026-05-08, end of the post-V3.1 / post-persona-review work cycle.
> Author: Claude Opus 4.7.
> Companion to:
>   - `docs/audits/elite-persona-review-2026-05-08.md` (the 18-persona
>     critique that drove this work cycle)
>   - `docs/architecture/FOUNDRY_V3_1_STATUS.md` (V3.1 inventory)
>   - `docs/audits/narrow-launch-readiness.md` (the prior launch-readiness
>     check that recommended friendly alpha with 3 pre-launch actions)

This document answers one question honestly: **what's still left to do
before friendly alpha?** Ranked by risk and effort.

---

## 1. What's been done this cycle

### V3.1 ship (prior session)
9 migrations (060–068), tool gateway + idempotency + budget +
classification + kill-switch, voice fingerprint + voice gate, North
Star + outcome trees, freeze period + phase-beta queue, team health.

### Persona-review actions (this session — 16 commits)
| # | Commit | What it ships |
|---|--------|---------------|
| 1 | `b448ab2` | Landing page aligned to shipped reality (drop control plane / portfolio framing) |
| 2 | `da0721c` | Three operations runbooks |
| 3 | `4c389f4` | CONTRIBUTING.md |
| 4 | `f5fbd2b` | Encryption-at-rest for `integrations.credentials_json` |
| 5 | `6194a7b` | Trace propagation + error-reporter hook + AI call observability |
| 6 | `13b5d67` | Resend `send_email` migrated through V3.1 tool gateway |
| 7 | `d9c7547` | Founder-facing weekly outcome metric on dashboard |
| 8 | `70d1875` | Eval framework + 10 golden cases (voice-gate) |
| 9 | `98c0ec3` | Surface-collapse design proposal |
| 10 | `c305eda` | Briefing visual contract (Surface 3 of UI proposal) |
| 11 | `b33f285` | Constant-time signature comparison on Clerk webhook (real CVE-class fix) |
| 12 | `0e04593` | Zod validation on onboarding repo + competitor inputs |
| 13 | `83d678d` | `seed:dogfood` CLI for Foundry's own North Star + voice fingerprint |
| 14 | `a58e0c0` | README sync to V3.1 reality |
| 15 | `2a4faee` | Production-path console → structured logger sweep |
| 16 | `28b8faa` | Second eval suite (`shouldEvolveThisSession`) |

Tests: 479 (V3.1 baseline) → **589** (+110 across 6 new suites).
Typecheck: clean throughout. Every commit pushed to master with
hooks enabled.

---

## 2. Pre-alpha readiness — current state

### Green (ready)

- **Single-product onboarding flow.** Sign up → connect repo → audit →
  agents provision → first briefing. Tested in
  `tests/simulation/01-founder-onboarding.test.ts`.
- **Daily briefing.** New visual contract: headline → number that
  matters → one decision today → folded sections → footer. Renders
  whether or not a North Star is seeded.
- **Decision queue with voice gate.** Voice-bearing artifacts
  (emails, landing copy, blog posts) auto-route to manual review on
  block/warn verdicts. Wired in commit 9 of V3.1.
- **Tool gateway protecting Resend.** Every email goes through
  idempotency / classification / per-customer-week budget / kill-switch
  / audit. Commit 13b5d67 closed the highest-risk integration trust
  gap from the persona review.
- **Encryption-at-rest** for GitHub access tokens (already in place via
  SEC-01) AND integration credentials (added this cycle). Stripe-side
  access tokens use a separate path that's also encrypted.
- **Webhook signature verification.** Stripe and Clerk both verify
  HMAC. The Clerk handler now uses `timingSafeEqual` (was `===` —
  classic timing-side-channel that this cycle fixed).
- **Zod validation** on the riskiest input boundaries (`/onboarding/
  select-repo`, `/onboarding/competitors`).
- **Observability seam.** Trace IDs flow request → service → AI call →
  DB via AsyncLocalStorage. Error reporter is a no-op stub today;
  registering Sentry is a one-line change at boot.
- **Operations runbooks.** Three written (AI bill spike, Stripe
  webhook backlog, agent silently failing). Single-operator coverage.
- **Founder-facing weekly outcome metric.** A founder can tell at a
  glance whether the agents are earning their keep this week.
- **Dogfood seed CLI.** `npm run cli -- seed:dogfood <productId>`
  installs Foundry's own North Star + voice fingerprint with sensible
  defaults.

### Yellow (works but with known gaps)

- **Multi-product flow.** Functional but manual: product switcher,
  no batch operations, no cross-product intelligence. Adequate for
  2-5 products. Bigger gap for portfolio operators (which Foundry
  is no longer positioned to serve — the landing page now narrows
  this to solo founders).
- **Cost ceiling resets on deploy.** In-memory state. A bad day
  followed by a deploy resets the daily counter. Acceptable for
  alpha (one operator can watch the Anthropic bill). Becomes
  blocking past alpha.
- **No request rate limit on AI-touching routes.** A well-formed
  authenticated user could trigger expensive AI work in a loop.
  Bounded today by tier-gate + the AI client's cost ceiling, but
  not by per-user-per-window throttling.
- **Adapter migration not complete.** Resend goes through the
  gateway; Stripe and GitHub do not. Per
  `src/services/outbound/README.md` migration order, that's the next
  two adapters but they don't block alpha.
- **First briefing delay.** A founder who signs up at noon waits
  until tomorrow's briefing cron for their first briefing. Could
  trigger an immediate briefing post-onboarding-audit; a known item
  from `narrow-launch-readiness.md`.
- **No support inbox structure.** The footer has `mailto:thomas@
  foundry.so`. There's no help center, no FAQ, no in-product chat
  surface. Acceptable for 3-5 trusted alpha founders.
- **Per-agent evals.** Two eval suites shipped; per-agent suites
  (5-10 cases × 12 agents) are documented as future work in
  `tests/evals/README.md` but not done.

### Red (would block friendly alpha if not addressed)

There are no Red items remaining as of this commit. The
narrow-launch-readiness.md three pre-launch actions are all addressed
or non-code:

1. **Support email** — added to landing footer.
2. **Fly.io secrets configured** — operator action, not code; runbook
   in `docs/operations/runbook.md` lists every secret needed.
3. **End-to-end test run** — operator action; the dogfood seed CLI
   makes it easy to set up Foundry's own product instance.

---

## 3. What I'd touch before alpha invitations go out

Ranked by leverage. Each is small.

### A. **Trigger an immediate briefing post-onboarding** (0.5d)

After the first audit completes, kick off a one-off `generateDailyBriefing`
for that product so the founder sees output the same day. Currently
they wait for the next 5:30 UTC cron, which can be hours.

**Why it matters:** The onboarding-to-first-value time is the single
strongest predictor of alpha retention. Founder #1 should see the
briefing on day 1, not day 2.

### B. **Add a per-user AI rate limit** (0.5d)

`src/middleware/rate-limit.ts` already exists for HTTP routes. Wrap the
AI-touching routes (`/api/ai/*`, decision drafting, ad-hoc audits)
with a low-volume per-user-per-hour limit. The cost ceiling is a
backstop; this is the front stop.

**Why it matters:** A confused alpha founder hammering an "Ask AI"
button is a $30 day before anyone notices. Andy Grove's concern about
input control.

### C. **Sign up for Sentry (or equivalent) and wire `setReporter`** (0.25d, mostly account setup)

The error-reporter hook is a stub. Producing real reports during
alpha is the difference between "founder reports a weird thing" and
"I have a stack trace and a trace ID."

**Why it matters:** Charity Majors's recommendation; the seam is
already there waiting.

### D. **Manual end-to-end run on production-like config** (1h)

`fly secrets set` everything per the runbook, deploy, sign up as
the founder yourself, connect a real repo, watch a briefing come
out, approve a decision. The point is to surface anything that's
been silently broken since the last manual run-through.

**Why it matters:** Tests cover units; this catches integrations and
config drift that tests can't see.

### E. **Run `seed:dogfood` against your own Foundry product** (5 min)

Self-explanatory. Without it, the briefing's "number that matters"
falls back to Signal score; with it, you see the destination block
in action and can validate the V3.1 disciplines fire end-to-end.

---

## 4. What I'd defer until after alpha

These came up during this cycle's work; they're real but not pre-alpha:

- **Stripe + GitHub through the gateway.** Both the next two adapters.
  Can wait until alpha generates real outbound volume.
- **Dashboard surface collapse (Surface 4 of design proposal).**
  Wait for two weeks of dogfooding evidence to inform which routes
  fold where.
- **Per-agent eval suites.** Two foundational evals shipped; the
  remaining work needs operator product knowledge to write well.
- **184 remaining `console.*` calls.** Predominantly in CLI / migrate
  / seed scripts where console is correct. The production-path sweep
  is done.
- **In-memory cost ceiling → DB-backed.** Survives deploys. Important
  but bounded by ops attention during alpha.
- **No-code path discovery.** The orientation noted "Alternative for
  non-GitHub users" — works but isn't surfaced anywhere prominent.
  Think about it post-alpha.
- **Multi-tenant separation (G6).** Real organizations entity. Not
  a launch concern; long-term direction once the wedge is validated.
- **Fleet-layer architecture.** Documented in `docs/scp/fleet-agents/`
  for post-validation. Still not the next move.

---

## 5. The honest one-paragraph synthesis

The product is in better shape pre-alpha than it has been. V3.1
shipped the discipline layer. This cycle wired it into reality:
landing page matches what's built, the gateway actually wraps a real
adapter, encryption-at-rest is no longer a comment on a column,
trace IDs flow, briefings have a visual hierarchy, the founder has
a number that says whether Foundry is earning its keep, and a
dogfood seed CLI sets the operator up to be customer #1 inside of
five minutes. Five small actions remain (immediate-briefing trigger,
per-user AI rate limit, Sentry hookup, manual e2e run, seed dogfood)
totalling under two operator-days. Past those, the product is ready
for three to five trusted founders. The work that I deliberately did
not do — Stripe+GitHub gateway adapters, per-agent eval suites,
dashboard surface collapse — needs alpha-evidence to inform, and
attempting it before alpha would be exactly the kind of thing the
freeze period was built to prevent.

— end —
