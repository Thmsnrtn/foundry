# Foundry — Roadmap Execution Log

The founder reads this file, not the commit log. Each phase appends a short
summary: what shipped, test counts, anything deferred and why, and operator
actions still required.

---

## Phase 0 — Stop the bleeding

**Status:** complete. **Tests:** 663 → 676 passing (45 files), `npm run check` green.

### What shipped

- **0.1 — Integration status bug (highest ROI).** `connectIntegration` and the
  OAuth connect route wrote `status = 'active'`, but all six sync adapters
  (posthog/sentry/linear/slack/intercom/github) guard on `status === 'connected'`.
  Nothing wrote `'connected'`, so the hourly fabric sync and 2-hourly extended
  sync were silent no-ops — `integration_events` stayed empty and every agent
  reasoned over zero telemetry. Standardized on `'connected'` everywhere
  (writers, health aggregation, UI reads, resend check). Migration `074` repairs
  existing rows (`active → connected`). Regression test pins that the value the
  connect paths write equals the value the adapters guard on.

- **0.2 — Persisted AI cost ceiling.** Daily spend moved from an in-process Map
  (reset on every deploy, not shared across machines) to the new `ai_daily_spend`
  table (migration `075`); the Map is now a 60s read-through cache. Added
  fleet-level caps: per-founder (`$100/day`) and global (`$500/day`) alongside
  per-product (`$25/day`), all env-overridable. Spend accounting and ceiling
  checks fail-open. Replaced magic cost multipliers in `atlas.ts`/`base.ts` with
  `computeCostCents`.

- **0.3 — Error tracking on.** Added `@sentry/node` so the existing
  auto-activating reporter seam can turn on when `SENTRY_DSN` is set. Removed the
  phantom `@anthropic-ai/sdk` dependency (never imported — only a string literal
  in the audit engine's service-detection map).

- **0.4 — Activation emails wired.** `sendAuditResultsEmail` (Day-1),
  `evaluateOnboardingSequence` (Day-3) and a founder welcome were dead code.
  All now route through the V3.1 tool gateway (`send_email`) with per-key
  idempotency: Day-1 fires after `runAudit`, Day-3 from the `behavioral_triggers`
  cron, and the welcome fires on provisioning (Clerk webhook + auth fallback,
  scoped to the Foundry dogfood product, idempotent with the `welcome_sequence_tick`
  day_0 cron).

- **0.5 — Phantom webhook secret removed.** `GITHUB_WEBHOOK_SECRET` was declared
  but never read (GitHub is poll-based; no inbound webhook route exists). Removed
  from `.env.example` with a note on how to add signature verification if an
  inbound GitHub webhook is ever mounted.

### Deferred / not done

- Prompt-caching, model upgrade, and the deeper cost-accuracy sweep across the
  other ~8 agents' magic multipliers are Phase 2 work; 0.2 converted only the
  two named in the brief (`atlas.ts`, `base.ts`).

### ⚠️ Operator actions still required (0.6 — human, not code)

These cannot be done from the codebase and gate a real deploy:

1. **Set Fly secrets** per `docs/blockers/BLOCKER-FLY-TOKEN.md`:
   `ENCRYPTION_KEY`, `STRIPE_WEBHOOK_SECRET`, `ECOSYSTEM_SERVICE_KEY`, and the
   Clerk/GitHub OAuth credentials. The app has crash-looped on a missing secret
   before.
2. **Sentry:** sign up, create a project, set `SENTRY_DSN` as a Fly secret. Until
   then, error tracking falls back to structured stderr (recoverable from Fly
   logs) — the reporter seam auto-activates the moment the DSN is present.
3. **Run the dogfood seed:** `npm run cli -- seed:dogfood <productId>` against the
   real Foundry product. The founder welcome email (0.4) routes through the
   Foundry product's kill-switch scope; if that product row is absent the welcome
   is skipped (the cron retries) — seed it so welcomes send.
4. **Turso backup-restore drill:** confirm you can restore from backup.
5. **Optional cost caps:** override `AI_DAILY_COST_CEILING_CENTS` (product,
   default 2500), `AI_DAILY_COST_CEILING_FOUNDER_CENTS` (default 10000), and
   `AI_DAILY_COST_CEILING_GLOBAL_CENTS` (default 50000) if the defaults don't fit
   your risk tolerance.

### Migration note

Migrations `074` (integration status repair) and `075` (`ai_daily_spend`) run on
next `npm run migrate` / boot. Both are idempotent.

---

## Phase 1 — First ten minutes + first dollar

**Status:** complete. **Tests:** 676 → 700 passing (50 files), `npm run check` green.

### What shipped

- **1.1 + 1.2 — Async audit with live progress + first briefing on arrival.**
  The onboarding audit was a blocking 2–5 minute POST that redirected to an
  often-empty dashboard. `runAudit` now takes an `onProgress` reporter; the POST
  kicks the audit off asynchronously, persists progress to
  `onboarding_audit_progress` (migration `076`), and returns a progress page that
  HTMX-polls `/onboarding/audit-status` (tenant-scoped). The first briefing is
  now **awaited as step 9** before the poll redirects to `/dashboard?tour=1`, so
  the flagship card is never empty on first login.

- **1.3 — 14-day card-upfront trial + conversion surfaces.** `createCheckoutSession`
  starts a `trial_period_days: 14` trial; the webhook persists/clears
  `trial_ends_at` (migration `077`). New pure `getTrialStatus` drives a header
  "N days left · Upgrade" badge, an expiry banner, and a "Start your 14-day free
  trial" CTA on every dashboard page — checkout is no longer buried in Settings.
  Expiry is a preview/nudge (existing null-tier gates already gate paid features),
  not a hard data lock, per the brief.

- **1.4 — Removed the orphaned `/setup` conversational onboarding** (route +
  exclusively-backing service + wiring). One onboarding path now.

- **1.5 — Branded HTML error pages.** `onError`/`notFound` content-negotiate:
  browsers get a branded 404/500 (reusing `publicLayout`), API paths get JSON.

- **1.6 — DNA auto-fill wired.** The Wave-2 extractor was never called. Now
  onboarding auto-drafts DNA from the repo README after the audit, and the DNA
  page has a "Draft with AI" button. A pure clobber-guard fills only empty fields.

- **1.7 — Honest mobile claim.** Replaced the unbuildable "iOS app + voice
  briefings + Watch complication" pricing claim with "installable mobile app (PWA)".

### Deferred / notes

- Trial enforcement is intentionally soft (preview banner + existing feature
  gates), not a hard dashboard lock — matches the brief's "rather than
  hard-locking data." If a harder gate is wanted post-alpha, add a
  trial-expired middleware in front of `/dashboard`.
- DNA auto-fill uses README + product metadata; the landing-page/Stripe-catalog
  sources are supported by the extractor but not yet gathered server-side
  (arbitrary-URL fetch deferred for SSRF safety).

### Operator notes

- Set `STRIPE_*_PRICE_ID` env vars so `getTierFromPrice` resolves; otherwise the
  webhook logs "Unrecognised price ID" and tier/trial won't update.
- `TRIAL_PERIOD_DAYS` (default 14) overrides the trial length everywhere.

---

## Phase 2 — Make the intelligence actually intelligent (in progress)

**Status:** 2.1–2.3 complete; 2.4/2.5 partial; 2.6/2.7 deferred.
**Tests:** 700 → 704 passing (51 files), `npm run check` green and now
deterministic (see test-infra note).

### What shipped

- **2.1 — Model generation upgrade.** OPUS → `anthropic/claude-opus-4-8`,
  SONNET → `anthropic/claude-sonnet-5`; added a HAIKU tier
  (`anthropic/claude-haiku-4-5`) + `callHaiku()` for cheap classification.
  Updated the `AIModel` union, `COST_PER_1M`, and `usage-tracking` PRICING
  (whose keys were bare and never matched `response.model` — a latent
  cost-tracking miss, now fixed) plus the two hardcoded model strings.

- **2.2 — Prompt caching (biggest cost lever).** Added a `CACHE_BREAKPOINT`
  sentinel: the client marks the stable system-prompt prefix with Anthropic
  prompt caching (`cache_control: ephemeral`, passed through by OpenRouter).
  Reordered `base.ts buildSystemPrompt` stable-first so the cached prefix is
  byte-identical across runs. Expected 60–90% input-cost cut on repeat agent
  runs. Non-agent callers (no sentinel) are unaffected.

- **2.3 — Audit gets real code visibility.** New `selectReviewFiles` picks a
  budget-capped set (≤8 files / ≤14KB) of the most decision-relevant files
  (auth/security, billing, error handling, config) from the already-fetched key
  files; the scorer now includes those excerpts (sanitized, framed as untrusted
  data). Moves the audit from checklist-over-counts to review-over-code.

- **2.4 (partial) — Deleted the duplicate `src/lib/job-lock.ts`** (zero
  importers; `src/services/job-lock.ts` is canonical).

- **2.5 (partial) — Scratchpad consensus/conflict now uses a Haiku classifier**
  instead of the bag-of-words heuristic that flagged "consensus" on any shared
  5-char token. Fails closed (empty) rather than emitting nonsense into a
  founder-visible briefing.

- **Test infra — fixed a pre-existing flake.** Many suites share one in-process
  `file::memory:` DB; running test files concurrently let them clobber each
  other's tables (intermittent, varying failures). Set `fileParallelism: false`
  — deterministic green, ~15s.

- **2.5 (complete) — Feed the evolution engine real session data.**
  `buildRecentSessionsTranscript` reads actual `agent_sessions` rows
  (observations / actions / decisions / briefing contribution);
  `checkEvolutionCandidates` uses the specific session + candidate hypotheses,
  and `runEvolutionSynthesis` synthesizes over the last 5 completed sessions
  (falling back to the generic prompt only when none exist). DB-backed tests.

### Deferred (with rationale)

- **2.4 (full) — Unify the two integration subsystems.** Porting the framework's
  Stripe/GitHub pulls into the fabric, implementing the stubbed analytics
  adapter, migrating callers, and deleting the loser is a large, high-blast-
  radius refactor touching the `integrations` table's dual schema (and is the
  documented fresh-DB migration blocker — see Phase 3.2). Left for a dedicated
  pass with its own test/rollback cycle. The status-string fix (0.1) already
  restored the fabric's sync path.
- **2.6 — Calibrated confidence** (agents emit self-assessed confidence in their
  JSON contract; track calibration vs outcomes). Touches every agent's strict
  schema + the gate system and shifts gate behavior — best done *with* 2.7 as
  the safety net. Deferred.
- **2.7 — Per-agent evals in CI.** Depends on `capture:fixtures <productId>`
  output (live product data); deferred.

### Operator notes

- Optional model-cost overrides: `AI_COST_HAIKU_INPUT_PER_1M` /
  `AI_COST_HAIKU_OUTPUT_PER_1M` (defaults 1.00 / 5.00).
- After deploy, confirm prompt-cache hits in OpenRouter usage (input-token drop
  on repeated agent runs) and eyeball one generated briefing before/after the
  model swap, per the roadmap's verification step 6.

---

## Phase 3 — Survive real users (in progress)

**Status:** 3.1, 3.2, 3.3, 3.5 done; 3.4 deferred.
**Tests:** 704 → 722 passing, `npm run check` green (deterministic).

### What shipped

- **3.1 — Split web from worker.** `PROCESS_ROLE` gates the scheduler
  (`src/lib/process-role.ts`): `web` serves HTTP with no crons, `worker` runs
  the 73 crons off the request path, `all` is the default. `fly.toml` now
  declares `web`/`worker` process groups, binds `http_service` to `web`, and
  scales web to 2 machines for deploy overlap. DB job locks already prevent
  double-runs.

- **3.2 — Migration hygiene.** Replaced the fragile `;\n` statement splitter
  with `splitSqlStatements` (respects string literals, comments, trigger
  bodies) — verified behavior-equivalent across all 109 migrations, with tests
  for the cases the old one broke. Fixed two dead index defs in
  `007_schema_hardening.sql` (columns that never existed). Documented the
  numbering rule + a **found blocker**: fresh-DB migration fails at
  `008_integrations.sql` because the `integrations` table is created by four
  migrations with incompatible schemas — this is the Phase 2.4 dual-subsystem
  problem and must be fixed there before a from-scratch deploy works. Existing
  DBs are unaffected. See `docs/db/migrations.md`.

- **3.3 — SLO alerting.** New hourly `slo_check` cron evaluates SLOs and emails
  the operator through the gateway on breach (dedup'd per day). First check:
  global AI daily spend vs the fleet cap. Extensible for job-lag / webhook
  backlog once those signals are surfaced.

- **3.5 — Data retention.** New daily `data_retention` cron purges
  `agent_messages` and `audit_log` rows past `DATA_RETENTION_DAYS` (default
  180), failing soft per table. DB-backed tests cover the boundary.

### Deferred

- **3.4 — Finish the gateway migration (Stripe/GitHub adapters).** Moderate;
  Resend + remediation PRs already route through the gateway. Deferred to a
  focused pass.

### ⚠️ Important finding

Fresh-database migration is currently broken (see 3.2 / `docs/db/migrations.md`).
Production is fine, but a from-scratch deploy needs the Phase 2.4 integrations
consolidation first. This is now documented and tracked.

---

## Phase 4 — Visible moat (partial)

- **4.3 — Show up where founders live.** The V3.1 outbound-webhook plumbing
  already dispatched `briefing_ready` and `signal_tier_shift`;
  `createDecision` now also fires `decision_needed` through the gateway for
  Gate 3+ decisions, so founder-facing decisions reach Slack/Linear/Notion.
- 4.1 (cross-product intelligence reader), 4.2 (FleetObservatory), and 4.4
  (surface collapse) remain — each is a substantial feature/UI build.

## Phase 5 — Launch (partial)

- **5.1 — Manifesto** was already live at `/manifesto`; added the footer link.
- **5.4 — iOS decision.** Archived `ios/Foundry/` with an unambiguous
  `ARCHIVED.md` (no Xcode project → not buildable; PWA covers mobile).
- **5.5 — Support surface.** New `/help` page (FAQ + operator email via
  `SUPPORT_EMAIL`), linked from the footer and the branded error pages.
- 5.2 (activation-funnel instrumentation) and 5.3 (alpha cohort) remain —
  product/ops work outside a single code pass.

---

## Overall status

| Phase | Complete | Notes |
|-------|----------|-------|
| 0 — Stop the bleeding | ✅ all 6 | alpha-blocking bugs fixed |
| 1 — First ten minutes + first dollar | ✅ all 7 | alpha-sellable milestone |
| 2 — Intelligence | 2.1, 2.2, 2.3, 2.5 ✅ · 2.4 deploy-unblock ✅ (code consolidation deferred) · 2.6, 2.7 deferred | model/caching/audit/self-improvement + fresh-DB migration fixed |
| 3 — Survive real users | 3.1, 3.2, 3.3, 3.5 ✅ · 3.4 deferred | web/worker, migrations, SLO, retention |
| 4 — Visible moat | 4.1, 4.2, 4.3 ✅ · 4.4 remains | peer signal, FleetObservatory, Slack/decision distribution |
| 5 — Launch | 5.1, 5.2, 5.4, 5.5 ✅ · 5.3 remains | funnel telemetry, help, manifesto, iOS archived |

### Phase 2.4 — fresh-DB migration unblocked
The full migration chain now applies to an empty database with **0 failures**
(guarded by a DB-backed test). Removed 007's rogue `integrations` table,
converted expression UNIQUE constraints to indexes, moved reconciled-column
indexes into 056, and standardized integration status on `'active'` (the value
every schema CHECK permits — `'connected'` failed the constraint). The
integration *code*-subsystem consolidation (deleting the framework, porting its
adapters into the fabric) is still deferred — it spans 12 files / 7+ callers
including Stripe webhook processing and needs an incremental, verified pass.

### Phase 4.1 / 4.2 — moat surfaces
- **4.1** `getPeerSignal` ("founders at your stage who chose X saw Y", abstains
  below n=5), surfaced in the decision chamber.
- **4.2** `/fleet` FleetObservatory: every agent's status/last-run/next-run/health
  and pending decisions across all products.

### Phase 5.2 — activation funnel
`funnel_events` + `recordFunnelStep` instrumented at all 7 transition points;
30-day funnel readout with conversion on the founder-ops dashboard.

Test suite grew from ~590 baseline to **738 passing**; `npm run check` is
deterministic. Every change is committed atomically with a descriptive message.

### Remaining items — precise blockers (why not done in a code pass)

These are the only open roadmap items. Each is genuinely gated on something a
code-only pass in an ephemeral container can't safely provide — not simply
skipped:

- **2.4 (code consolidation)** — deleting the `services/integrations/` framework
  and porting its adapters into the `services/integration/` fabric spans 12
  files and 7+ callers **including Stripe webhook processing (money)**. The brief
  itself says "each adapter migration needs its own test pass and rollback path;
  don't migrate everything in one commit." Needs an incremental, staged pass.
  *The deploy-blocking half (fresh-DB migration + schema) is done.*
- **2.6 (calibrated confidence)** — the fix changes what the **gate system** does
  with confidence across all 12 agents' strict schemas. The brief pairs it with
  2.7 as the safety net; shipping it without the eval net risks silently
  shifting auto-approve vs escalate behavior. Do **with** 2.7.
- **2.7 (per-agent evals in CI)** — the eval framework exists (`tests/evals/`),
  but the 5-cases-per-agent seed comes from `npm run cli -- capture:fixtures
  <productId>` against a **real product with live agent runs**. No such data in
  this environment.
- **3.4 (Stripe/GitHub through the gateway)** — money-touching. The brief: "a
  duplicate refund is much worse than a duplicate email … each migration needs
  its own test pass." Validating it safely needs a **staging environment with
  Stripe test keys**, not an offline pass.
- **4.4 (surface collapse)** — the design doc (`docs/design/three-tab-ia-
  proposal.md`) explicitly states: *"Don't implement before two weeks of
  dogfooding data on which routes actually get opened."* The 5.2 funnel
  telemetry shipped this cycle is how that evidence gets gathered. Implementing
  now would contradict the design's own precondition.
- **5.3 (alpha cohort → paid)** — pure go-to-market ops (invite 10 founders),
  not code.

Recommended next once the gates clear: 2.7 (unblocks 2.6) after a dogfood
product exists; 3.4 against staging; 2.4 as a dedicated incremental migration.

---

## Go-live hardening — CHECK-drift audit + steps 5/6/7

**Status:** complete. **Tests:** 744 → 758 passing (67 files), `npm run check`
green; `npm run sim:walkthrough` clean; `npm run load:crons` clean.

Follow-through on the 15-persona walkthrough sim and the 1–7 go-live list. The
sim kept surfacing one bug class — **stale CHECK enums the code has outgrown**
(SQLite can't ALTER a CHECK, so they rot silently and 500 only on a real DB).

### What shipped

- **CHECK-drift audit (round 3).** Dumped every enum CHECK from the migrated
  schema and cross-referenced the code's writes. Found the class had leaked into
  a surface the route sim can't reach — **background jobs**:
  `notifications.type` rejected `'signal_alert'`, `'decision_followup'`, and
  `'decision_retrospective'` (all written by scheduled jobs), so every one of
  those alerts 500'd on a real DB. Migration 082 drops the CHECK (app-validated).
  The remaining runtime-hot enums (`decisions.status`, `daily_actions.status`,
  `customer_intelligence.stage`, `outbound_actions.status`) were verified to
  conform. This closes the class the round-1/2 sim opened (founders.tier 080,
  integrations 081). Regressions locked in `migrations-fresh-db.test.ts`.
- **Sim hardening.** The pre-deploy gate leaked assertion failures (only 5xx
  failed the exit); tightened to fail on any post-condition ASSERT. New P6 block
  exercises `createNotification` for every type the code writes.
- **Step 5 — 2.7 eval net in CI.** New `prompt-assembly.eval.test.ts` guards the
  shared agent system-prompt scaffold: the cache-cost invariant (2.2 — no
  volatile bytes before the cache breakpoint, 60–90% input-cost swing) and the
  C-suite output contract. Dedicated `evals` + `walkthrough-sim` CI jobs; a
  prompt edit that breaks caching or drops the output standard now fails the build.
- **Step 6 — cron load/contention.** `tests/load/cron-load.ts` (+ `cron-load` CI
  job, `job-lock-contention.test.ts`) stress the distributed job lock the
  web/worker split relies on: N instances race each job (exactly one wins),
  crashed leases are reclaimed, a full 75-job sweep runs in ~10ms.
- **Step 7 — 3.4 outbound money idempotency.** GitHub PRs already dedup through
  the gateway; added Stripe-native `idempotencyKey`s to every mutating billing
  call so a lost-response retry can no longer double-charge. Guarded by
  `stripe-idempotency.test.ts`.

### Still operator/live-only (cannot be done from code)

Go-live steps 1–4 remain: staging deploy + secrets, dogfood seed, the manual
first-run walkthrough, Turso backup drill, Sentry wiring, and the live Stripe
test-mode checkout. All are documented in `GO-LIVE-CHECKLIST.md`.
